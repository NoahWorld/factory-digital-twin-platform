// One additive local project, formal APIs only. Never modifies pre-existing projects.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=join(root,'demo-assets/matter-lab');
const manifestBytes=readFileSync(join(dir,'manifest.json')),manifest=JSON.parse(manifestBytes);
const hash=b=>createHash('sha256').update(b).digest('hex'),digest=hash(manifestBytes);
const base='http://127.0.0.1:18080',journalPath=join(root,'deploy/local/.local/matter-lab-v1.json');
const verifyOnly=process.argv.includes('--verify-only'),allowUpdate=process.argv.includes('--update');
const journal=existsSync(journalPath)?JSON.parse(readFileSync(journalPath)):{version:1,projectId:null,models:{},revision:0};
function journalSave(){writeFileSync(journalPath,JSON.stringify(journal,null,2)+'\n',{mode:0o600});}
for(const m of manifest.modules)assert.equal(hash(readFileSync(join(dir,m.filename))),m.sha256,`Source checksum: ${m.id}`);
let cookie='';
async function api(path,{method='GET',body,status=200,raw=false}={}){
  const res=await fetch(base+'/api/v1'+path,{method,redirect:'manual',signal:AbortSignal.timeout(60000),headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':raw?'model/gltf-binary':'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined});
  const value=res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text();
  assert.equal(res.status,status,`${method} ${path} requestId=${res.headers.get('x-request-id')}: ${JSON.stringify(value)}`);return{value,res};
}
assert.equal((await fetch(base+'/health',{signal:AbortSignal.timeout(10000)})).status,200,'Backend is not healthy');
const login=await api('/auth/login',{method:'POST',body:JSON.parse(readFileSync(join(root,'deploy/local/.local/admin.json')))});cookie=login.res.headers.get('set-cookie').split(';')[0];
if(!journal.projectId){
  assert.ok(!verifyOnly,'Project has not been imported');const projects=(await api('/projects')).value.projects;assert.ok(!projects.some(p=>p.name===manifest.title),'An existing project has this name but no ownership journal; refusing to duplicate or overwrite it');
  journal.projectId=(await api('/projects',{method:'POST',status:201,body:{name:manifest.title,projectType:'3d'}})).value.project.id;journalSave();console.log(`Created 3D project: ${journal.projectId}`);
}
const prefix=`/projects/${journal.projectId}`;
const current=(await api(prefix+'/scene')).value.scene;
assert.equal(current.revision,journal.revision,'Scene was changed outside this importer. Refusing to overwrite user edits.');
if(!verifyOnly&&journal.manifestSha256!==digest){
  assert.ok(journal.revision===0||allowUpdate,'Pass --update explicitly to update only this journal-owned project');
  writeFileSync(join(root,`deploy/local/.local/matter-lab-before-revision-${current.revision}.json`),JSON.stringify(current,null,2)+'\n',{mode:0o600});
  const existing=(await api(prefix+'/model-assets')).value.modelAssets;
  for(const m of manifest.modules){
    if(journal.models[m.id]?.sha256===m.sha256)continue;
    const resource=existing.find(r=>r.sha256===m.sha256)??(await api(prefix+`/model-assets?filename=${encodeURIComponent(m.filename)}`,{method:'POST',status:201,raw:true,body:readFileSync(join(dir,m.filename))})).value.modelAsset;
    assert.equal(resource.state,'ready');assert.equal(resource.sha256,m.sha256);assert.equal(resource.inspection.duplicateNodeNames.length,0);
    journal.models[m.id]={id:resource.id,sha256:m.sha256};journalSave();console.log(`Stored ${m.id}: ${m.bytes} bytes / ${resource.id}`);
  }
  const upsertInstances=manifest.modules.map((m,i)=>({id:`matter-lab-${m.id}`,assetId:null,label:m.label,modelAssetId:journal.models[m.id].id,renderMode:m.background?'background':'interactive',sortOrder:i,transform:{position:m.position,rotation:[0,0,0],scale:[1,1,1]},visible:true,animation:{enabled:true,speed:1},appearance:{color:null,opacity:1},clickActions:[]}));
  const saved=(await api(prefix+'/scene',{method:'PATCH',body:{expectedRevision:current.revision,upsertInstances,deleteInstanceIds:[],settings:manifest.settings,linked2dProjectId:null}})).value.scene;
  journal.revision=saved.revision;journal.manifestSha256=digest;journalSave();console.log(`Saved scene revision ${saved.revision}: ${saved.instances.length} modules`);
}
const scene=(await api(prefix+'/scene')).value.scene,models=(await api(prefix+'/model-assets')).value.modelAssets;
assert.equal(scene.instances.length,manifest.modules.length);assert.equal(scene.linked2dProjectId,null);assert.deepEqual(scene.settings,manifest.settings);
for(const m of manifest.modules){const record=journal.models[m.id],resource=models.find(r=>r.id===record.id);assert.ok(resource);assert.equal(resource.sha256,m.sha256);assert.equal(resource.inspection.animationCount,m.animationCount);assert.ok(scene.instances.some(i=>i.modelAssetId===record.id));}
const links={name:manifest.title,projectId:journal.projectId,revision:scene.revision,previewUrl:`http://127.0.0.1:5173/#/projects/${journal.projectId}/scene-preview`,editUrl:`http://127.0.0.1:5173/#/projects/${journal.projectId}/scene`};
writeFileSync(join(dir,'local-project.json'),JSON.stringify(links,null,2)+'\n');console.log(JSON.stringify(links,null,2));
