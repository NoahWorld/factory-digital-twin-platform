// Update only the three cases created by the v1 journal. Preserve their project IDs.
// All database/object writes use authenticated platform APIs and optimistic revisions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fluidMetrics} from './fluid-demo-metrics.mjs';
import {buildFluidDashboard} from './fluid-dashboards-v2.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),base='http://127.0.0.1:18080',dir=join(root,'demo-assets/fluid-cases-v2');
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'))),v1=JSON.parse(readFileSync(join(root,'deploy/local/.local/fluid-cases-v1.json')));
const journalFile=join(root,'deploy/local/.local/fluid-cases-v2.json'),journal=existsSync(journalFile)?JSON.parse(readFileSync(journalFile)):{version:2,cases:{}};
const verifyOnly=process.argv.includes('--verify-only');
function save(){writeFileSync(journalFile,JSON.stringify(journal,null,2)+'\n',{mode:0o600});}
let cookie='';
async function api(path,{method='GET',body,status=200,raw=false}={}){
  const response=await fetch(base+'/api/v1'+path,{method,redirect:'manual',signal:AbortSignal.timeout(60000),headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':raw?'model/gltf-binary':'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined});
  const value=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
  assert.equal(response.status,status,`${method} ${path} requestId=${response.headers.get('x-request-id')}: ${JSON.stringify(value)}`);return {value,response};
}
const admin=JSON.parse(readFileSync(join(root,'deploy/local/.local/admin.json'))),login=await api('/auth/login',{method:'POST',body:admin});cookie=login.response.headers.get('set-cookie').split(';')[0];
const temp=mkdtempSync(join(tmpdir(),'fluid-v2-contracts-'));
try{
  execFileSync(process.execPath,[join(root,'apps/web/node_modules/typescript/bin/tsc'),'--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--rootDir',root,'--outDir',temp,join(root,'apps/web/src/canvas/themes.ts')],{stdio:'inherit'});
  const require=createRequire(import.meta.url),{createCanvasNode}=require(join(temp,'apps/web/src/canvas/types.js')),{canvasThemePresets}=require(join(temp,'apps/web/src/canvas/themes.js'));
  const projects=(await api('/projects')).value.projects;
  for(const c of manifest.cases){
    const previous=v1.cases[c.id];assert.ok(previous?.sceneId&&previous?.dashboardId,`Missing original case ${c.id}`);
    const record=journal.cases[c.id]??={sceneId:previous.sceneId,dashboardId:previous.dashboardId,models:{},assets:{}};
    assert.equal(record.sceneId,previous.sceneId);assert.equal(record.dashboardId,previous.dashboardId);
    let scene=(await api(`/projects/${record.sceneId}/scene`)).value.scene,canvas=(await api(`/projects/${record.dashboardId}/canvas`)).value.canvas;
    const assets=(await api(`/projects/${record.dashboardId}/assets`)).value.assets,models=(await api(`/projects/${record.sceneId}/model-assets`)).value.modelAssets;
    assert.equal(scene.linked2dProjectId,record.dashboardId);
    if(!verifyOnly){
      if(!record.backupFile){
        const backup={at:new Date().toISOString(),caseId:c.id,projects:projects.filter(p=>[record.sceneId,record.dashboardId].includes(p.id)),scene,canvas,assets,models};
        for(const asset of backup.assets)asset.originalDataBindings=(await api(`/projects/${record.dashboardId}/assets/${asset.id}/data-bindings`)).value.dataBindings;
        const backupFile=join(root,`deploy/local/.local/fluid-${c.id}-before-v2.json`);assert.ok(!existsSync(backupFile),`Backup exists without journal: ${backupFile}`);
        writeFileSync(backupFile,JSON.stringify(backup,null,2)+'\n',{mode:0o600});record.backupFile=backupFile;record.sceneRevision=scene.revision;record.dashboardRevision=canvas.revision;save();
      }
      assert.equal(scene.revision,record.sceneRevision,`Scene ${c.id} changed after last migration step; inspect before overwriting`);
      assert.equal(canvas.revision,record.dashboardRevision,`Canvas ${c.id} changed after last migration step; inspect before overwriting`);
      for(const m of c.modules){
        const bytes=readFileSync(join(dir,m.filename));assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256);
        let model=models.find(mo=>mo.sha256===m.sha256&&mo.state==='ready');
        if(!model){model=(await api(`/projects/${record.sceneId}/model-assets?filename=${encodeURIComponent(m.filename)}`,{method:'POST',status:201,raw:true,body:bytes})).value.modelAsset;models.push(model);console.log(`Stored v2 ${c.id}/${m.id}: ${model.id}`);}
        assert.equal(model.sha256,m.sha256);assert.equal(model.state,'ready');record.models[m.id]={id:model.id,sha256:m.sha256};save();
        if(m.background)continue;
        const assetId=`fluid-${c.id}-${m.id}`,descriptors={...fluidMetrics[c.id][m.id],status:['运行状态',null],alarmLevel:['告警等级',null]};assert.ok(fluidMetrics[c.id][m.id],`Missing metrics: ${c.id}/${m.id}`);
        let asset=assets.find(a=>a.assetId===assetId);
        const metadata={...(asset?.metadata??{}),dataLabel:'模拟数据',simulation:true,industryCase:c.id,caseVersion:2,description:m.description,runtimeMode:'simulation',metricLabels:Object.fromEntries(Object.entries(descriptors).map(([key,[label]])=>[key,label]))};
        delete metadata.sampleMetrics;
        if(asset){asset=(await api(`/projects/${record.dashboardId}/assets/${asset.id}`,{method:'PATCH',body:{name:m.label,assetType:m.type,metadata}})).value.asset;}
        else{asset=(await api(`/projects/${record.dashboardId}/assets`,{method:'POST',status:201,body:{assetId,name:m.label,assetType:m.type,modelNode:null,metadata}})).value.asset;assets.push(asset);}
        const prefix=`/projects/${record.dashboardId}/assets/${asset.id}`,bindings=(await api(`${prefix}/data-bindings`)).value.dataBindings;
        record.assets[m.id]={id:asset.id,assetId,bindings:{}};
        for(const [metricKey,[,unit]] of Object.entries(descriptors)){
          let binding=bindings.find(b=>b.metricKey===metricKey);
          if(!binding)binding=(await api(`${prefix}/data-bindings`,{method:'POST',status:201,body:{dataSourceId:previous.dataSourceId,metricKey,sourcePath:`$.assets.${m.id}.${metricKey}`,valueType:metricKey==='status'?'string':'number',unit,staleAfterSeconds:10}})).value.dataBinding;
          assert.equal(binding.sourcePath,`$.assets.${m.id}.${metricKey}`);assert.equal(binding.dataSourceId,previous.dataSourceId);record.assets[m.id].bindings[metricKey]=binding.id;
        }
        save();
      }
      const settings={animationSpeed:1,autoRotate:false,backgroundOpacity:1,playAnimations:true,rotationSpeed:.15,showGrid:false,...c.settings};
      const instances=c.modules.map((m,i)=>({id:`fluid-${c.id}-${m.id}`,assetId:m.background?null:record.assets[m.id].assetId,label:m.label,modelAssetId:record.models[m.id].id,renderMode:m.background?'background':'interactive',sortOrder:i,transform:{position:m.position,rotation:[0,0,0],scale:[1,1,1]},visible:true,animation:{enabled:true,speed:m.animationSpeed??1},appearance:{color:null,opacity:1}}));
      const desiredScene={instances,settings,linked2dProjectId:record.dashboardId},sceneHash=createHash('sha256').update(JSON.stringify(desiredScene)).digest('hex');
      if(record.sceneHash!==sceneHash){scene=(await api(`/projects/${record.sceneId}/scene`,{method:'PATCH',body:{expectedRevision:scene.revision,upsertInstances:instances,deleteInstanceIds:scene.instances.filter(old=>!instances.some(n=>n.id===old.id)).map(i=>i.id),settings,linked2dProjectId:record.dashboardId}})).value.scene;record.sceneRevision=scene.revision;record.sceneHash=sceneHash;save();}
      const {theme,nodes}=buildFluidDashboard(c,record.sceneId,createCanvasNode,canvasThemePresets),canvasHash=createHash('sha256').update(JSON.stringify({theme,nodes})).digest('hex');
      if(record.canvasHash!==canvasHash){canvas=(await api(`/projects/${record.dashboardId}/canvas`,{method:'PATCH',body:{expectedRevision:canvas.revision,upsertNodes:nodes,deleteNodeIds:canvas.nodes.filter(old=>!nodes.some(n=>n.id===old.id)).map(n=>n.id),theme}})).value.canvas;record.dashboardRevision=canvas.revision;record.canvasHash=canvasHash;save();}
      for(const [id,suffix] of [[record.sceneId,'3D 场景'],[record.dashboardId,'业务看板']]){const name=`行业案例｜${c.title}｜${suffix}（模拟）`;if(projects.find(p=>p.id===id)?.name!==name)await api(`/projects/${id}`,{method:'PATCH',body:{name}});}
    }
    assert.equal(scene.instances.length,c.modules.length);assert.equal(canvas.nodes.filter(n=>n.type==='scene-3d').length,1);assert.equal(canvas.nodes.find(n=>n.type==='scene-3d').props.sceneProjectId,record.sceneId);
    for(const m of c.modules){const model=models.find(mo=>mo.id===record.models[m.id].id);assert.equal(model.sha256,m.sha256);assert.equal(model.inspection.duplicateNodeNames.length,0);assert.equal(model.inspection.animationCount,m.animationCount);
      const signed=await api(`/projects/${record.sceneId}/model-assets/${model.id}/content`,{status:302}),download=await fetch(signed.response.headers.get('location'));assert.equal(download.status,200);assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'),m.sha256);}
    console.log(`VERIFIED stored ${c.id}: ${scene.instances.length} scene modules, ${Object.keys(record.assets).length} business assets; scene r${scene.revision}, canvas r${canvas.revision}`);
  }
  journal.verifiedAt=new Date().toISOString();save();
  const links=manifest.cases.map(c=>({name:c.title,sceneUrl:`http://127.0.0.1:5173/#/projects/${journal.cases[c.id].sceneId}/scene-preview`,dashboardUrl:`http://127.0.0.1:5173/#/projects/${journal.cases[c.id].dashboardId}/preview`}));
  writeFileSync(join(dir,'local-projects.json'),JSON.stringify(links,null,2)+'\n');console.log(JSON.stringify(links,null,2));
}finally{rmSync(temp,{recursive:true,force:true});}
