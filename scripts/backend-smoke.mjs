// Real PostgreSQL/S3/API integration checks. Run only against this local Compose stack.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {websocket} from './backend-websocket-client.mjs';
import {createCoverPng} from './backend-cover-smoke.mjs';
import {checkFluidDocument,checkFluidViewer} from './backend-fluid-smoke.mjs';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
const base=process.env.BACKEND_URL??'http://127.0.0.1:18080';assert.equal(base,'http://127.0.0.1:18080','Smoke test is limited to the local deployment.');
const admin=JSON.parse(readFileSync(join(root,'deploy/local/.local/admin.json')));
let cookie='';let passed=0;const projects=[],users=[],tenants=[];
async function call(path,{method='GET',body,status=200,as=cookie,headers={},raw=false}={}){
 const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:base,...(as?{Cookie:as}:{}),...(body&&!raw?{'Content-Type':'application/json'}:{}),...headers},body:body?(raw?body:JSON.stringify(body)):undefined,redirect:'manual'});
 const value=r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text();
 assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(value)}`);assert.ok(r.headers.get('x-request-id'));
 return {value,r};
}
function ok(name){passed++;console.log('PASS '+name);}
const sql=s=>execFileSync('docker',['compose','--env-file','deploy/local/.env','-f','deploy/local/compose.yml','exec','-T','postgres','psql','-U','twin','-d','factory_twin','-v','ON_ERROR_STOP=1','-At'],{cwd:root,input:s,encoding:'utf8'});
async function project(type='2d'){const p=(await call('/projects',{method:'POST',status:201,body:{name:'Integration '+type,projectType:type}})).value.project;projects.push(p.id);assert.match(p.createdAt,/Z$/);assert.ok(Number.isFinite(Date.parse(p.createdAt)));return p.id;}
let outage=false;let oldTimestamp=false;let socket;
const mock=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.statusCode=outage?503:200;res.end(JSON.stringify({timestamp:oldTimestamp?'2000-01-01T00:00:00Z':new Date().toISOString(),temperature:42,privateField:'must-not-be-sent'}));});
await new Promise((resolve,reject)=>{mock.once('error',reject);mock.listen(8790,'127.0.0.1',resolve);});
const temp=mkdtempSync(join(tmpdir(),'twin-integration-'));
try{
 assert.equal((await fetch(base+'/health')).status,200);assert.equal((await call('/projects',{as:'',status:401})).value.error,'unauthenticated');ok('health and anonymous rejection');
 const login=await call('/auth/login',{method:'POST',body:admin});cookie=login.r.headers.get('set-cookie').split(';')[0];assert.equal(login.value.user.loginName,'admin');ok('persistent cookie login');
 await call('/projects',{method:'POST',body:{name:'Blocked'},headers:{Origin:'https://untrusted.example'},status:403});ok('cross-origin write rejection');
 const id=await project(),scene=await project('3d');
 const initialProjects=(await call('/projects')).value.projects;
 const initial2d=initialProjects.find(project=>project.id===id),initial3d=initialProjects.find(project=>project.id===scene);
 const coverPng=createCoverPng();
 for(const project of [initial2d,initial3d]){
   assert.equal(project.coverStatus,'pending');assert.equal(project.coverUrl,null);
   assert.equal((await call(`/projects/${project.id}/cover.png`,{status:404})).value.error,'project_cover_pending');
   const uploaded=(await call(`/projects/${project.id}/cover?sourceRevision=${project.documentRevision}&expectedCoverRevision=${project.coverRevision}`,{method:'PUT',body:coverPng,raw:true,headers:{'Content-Type':'image/png'}})).value.project;
   assert.equal(uploaded.coverStatus,'ready');assert.equal(uploaded.coverSourceRevision,project.documentRevision);assert.match(uploaded.coverUrl,/\/cover\.png\?revision=\d+$/);
   const ready=await call(uploaded.coverUrl.replace('/api/v1',''));assert.match(ready.r.headers.get('content-type'),/^image\/png/);assert.ok(ready.r.headers.get('etag'));
 }
 ok('2D and 3D covers remain pending until a revision-bound PNG is uploaded');
 const page=(await call('/projects?limit=1')).value;assert.equal(page.projects.length,1);assert.equal(page.nextOffset,1);const next=(await call('/projects?limit=1&offset=1')).value;assert.notEqual(next.projects[0].id,page.projects[0].id);await call('/projects?limit=0',{status:400});ok('bounded explicit list pagination');
 execFileSync(process.execPath,[join(root,'apps/web/node_modules/typescript/bin/tsc'),'--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--rootDir',root,'--outDir',temp,join(root,'apps/web/src/canvas/templates.ts')],{stdio:'inherit'});
 const {canvasTemplates,instantiateCanvasTemplate}=require(join(temp,'apps/web/src/canvas/templates.js'));
 let revision=0,old=[];
 for(const t of canvasTemplates){const nodes=instantiateCanvasTemplate(t.id,[]);const result=await call(`/projects/${id}/canvas`,{method:'PATCH',body:{expectedRevision:revision,theme:t.canvasTheme,upsertNodes:nodes,deleteNodeIds:old}});revision=result.value.canvas.revision;assert.equal(result.value.canvas.nodes.length,nodes.length);old=nodes.map(n=>n.id);}
 const saved2dProject=(await call(`/projects/${id}`)).value.project;assert.equal(saved2dProject.coverStatus,'pending');assert.equal(saved2dProject.documentRevision,revision);
 assert.match(saved2dProject.coverUrl,/\/cover\.png\?revision=\d+$/);
 assert.match((await call(saved2dProject.coverUrl.replace('/api/v1',''))).r.headers.get('content-type'),/^image\/png/);
 ok('2D content saves mark the previous screenshot pending');
 ok('all '+canvasTemplates.length+' actual frontend templates save and round trip');
 const {createCanvasNode,parseModel3DProps}=require(join(temp,'apps/web/src/canvas/types.js'));
 const legacy=createCanvasNode('model-3d',0,0,100);
 legacy.props.animationSpeed=2;
 delete legacy.props.modelInstances; // Imported pre-instance canvas: moving/resizing submits raw props.
 const expectedModel=parseModel3DProps(legacy.props);assert.equal(expectedModel.ok,true);
 const legacySave=await call(`/projects/${id}/canvas`,{method:'PATCH',body:{expectedRevision:revision,upsertNodes:[legacy],deleteNodeIds:[]}});
 revision=legacySave.value.canvas.revision;
 const reread=(await call(`/projects/${id}/canvas`)).value.canvas;
 assert.deepEqual(reread.nodes.find(n=>n.id===legacy.id).props,expectedModel.value);
 // Older canvases also predate presentation/lighting/animation. Match frontend migration exactly.
 const oldest={...legacy,props:{backgroundColor:'#123456',autoRotate:false,rotationSpeed:.35,showGrid:true}};
 const oldestExpected=parseModel3DProps(oldest.props);assert.equal(oldestExpected.ok,true);
 const oldestSave=await call(`/projects/${id}/canvas`,{method:'PATCH',body:{expectedRevision:revision,upsertNodes:[oldest],deleteNodeIds:[]}});
 revision=oldestSave.value.canvas.revision;
 assert.deepEqual(oldestSave.value.canvas.nodes.find(n=>n.id===legacy.id).props,oldestExpected.value);
 for(const badProps of [{...legacy.props,modelInstances:null},{...legacy.props,animationSpeed:'fast'},{...legacy.props,unknownProperty:true}]){
   const rejected=await call(`/projects/${id}/canvas`,{method:'PATCH',status:400,body:{expectedRevision:revision,upsertNodes:[{...legacy,props:badProps}],deleteNodeIds:[]}});
   assert.equal(rejected.value.error,'schema_validation_failed');
   assert.doesNotMatch(rejected.value.message,/property 'animationSpeed' is not defined|accentColor/);
 }
 assert.equal((await call(`/projects/${id}/canvas`)).value.canvas.revision,revision);
 ok('legacy model saves match frontend defaults; invalid fields stay rejected without changing revision');
 const patch={expectedRevision:revision,upsertNodes:[],deleteNodeIds:[],theme:(await call(`/projects/${id}/canvas`)).value.canvas.theme};
 const writes=await Promise.all([fetch(base+`/api/v1/projects/${id}/canvas`,{method:'PATCH',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(patch)}),fetch(base+`/api/v1/projects/${id}/canvas`,{method:'PATCH',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(patch)})]);assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);revision++;ok('concurrent document revision conflict');
 const manifest=(await call(`/projects/${id}/manifest`)).value;assert.equal(manifest.revision,revision);assert.ok(manifest.settings.backgroundColor);const chunk=(await call(`/projects/${id}/document-items?revision=${revision}&limit=2`)).value;assert.equal(chunk.items.length,2);await call(`/projects/${id}/document-items?revision=0`,{status:409});ok('manifest and revision-bound document chunks');
 let cameraScene=(await call(`/projects/${scene}/scene`)).value.scene;
 assert.equal(cameraScene.settings.preventBottomView,true);
 assert.deepEqual(cameraScene.fluids,[]);
 for(const enabled of [false,true]){
   cameraScene=(await call(`/projects/${scene}/scene`,{method:'PATCH',body:{expectedRevision:cameraScene.revision,settings:{...cameraScene.settings,preventBottomView:enabled},upsertInstances:[],deleteInstanceIds:[]}})).value.scene;
   assert.equal((await call(`/projects/${scene}/scene`)).value.scene.settings.preventBottomView,enabled);
   assert.equal((await call(`/projects/${scene}/manifest`)).value.settings.preventBottomView,enabled);
 }
 for(const invalid of [null,'false',0,{}]){
   await call(`/projects/${scene}/scene`,{method:'PATCH',status:400,body:{expectedRevision:cameraScene.revision,settings:{...cameraScene.settings,preventBottomView:invalid},upsertInstances:[],deleteInstanceIds:[]}});
   assert.equal((await call(`/projects/${scene}/scene`)).value.scene.revision,cameraScene.revision);
 }
 ok('camera bottom-view restriction defaults on, round-trips both values and rejects malformed settings');
 const models=(await call(`/projects/${scene}/model-assets`)).value.modelAssets;assert.ok(models.length>0);
 const instance={id:'test-instance',assetId:null,label:'Integration model',modelAssetId:models[0].id,renderMode:'interactive',sortOrder:0,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},visible:true};
 const sr=await call(`/projects/${scene}/scene`,{method:'PATCH',body:{expectedRevision:cameraScene.revision,upsertInstances:[instance],deleteInstanceIds:[],linked2dProjectId:id}});assert.equal(sr.value.scene.instances[0].modelAssetId,models[0].id);ok('3D instance, built-in catalog and 2D link');
 const saved3dProject=(await call(`/projects/${scene}`)).value.project;assert.equal(saved3dProject.coverStatus,'pending');assert.equal(saved3dProject.documentRevision,sr.value.scene.revision);
 assert.match(saved3dProject.coverUrl,/\/cover\.png\?revision=\d+$/);
 assert.match((await call(saved3dProject.coverUrl.replace('/api/v1',''))).r.headers.get('content-type'),/^image\/png/);
 ok('3D content saves mark the previous screenshot pending');
 const {snapshot:fluidSnapshot}=await checkFluidDocument(call,scene,ok);
 const asset=(await call(`/projects/${id}/assets`,{method:'POST',status:201,body:{assetId:'motor-01',name:'Test motor',assetType:'motor',modelNode:null,metadata:{}}})).value.asset;
 const source=(await call(`/projects/${id}/data-sources`,{method:'POST',status:201,body:{name:'Integration source',sourceType:'rest_polling',config:{url:'http://host.docker.internal:8790/metrics',intervalSeconds:1,timeoutMs:2000,timestampPath:'$.timestamp',credentialRef:null}}})).value.dataSource;
 await call(`/projects/${id}/assets/${asset.id}/data-bindings`,{method:'POST',status:201,body:{dataSourceId:source.id,metricKey:'temperature',sourcePath:'$.temperature',valueType:'number',unit:'C',staleAfterSeconds:3}});
 for(let i=0;i<20;i++){const r=await fetch(base+`/api/v1/projects/${id}/assets/${asset.id}/runtime-state`,{headers:{Cookie:cookie}});if(r.ok){assert.equal((await r.json()).runtimeState.values.temperature,42);break;}if(i===19)throw new Error('Collector did not produce runtime state: '+await r.text());await new Promise(r=>setTimeout(r,500));}ok('independent collector, cached metric mapping');
 socket=await websocket(cookie);socket.send({type:'subscribe',projectId:id});const snapshot=await socket.wait(m=>m.type==='snapshot');assert.ok(!JSON.stringify(snapshot).includes('privateField'));const update=await socket.wait(m=>m.type==='source_update');assert.equal(update.data.assets[0].values.temperature,42);assert.ok(!JSON.stringify(update).includes('privateField'));ok('WebSocket snapshot and mapped incremental event');
 const cursor=update.cursor;socket.close();socket=await websocket(cookie);socket.send({type:'subscribe',projectId:id,cursor});await socket.wait(m=>m.type==='source_update');ok('WebSocket reconnect and cursor resume');
 socket.send({type:'subscribe',projectId:id,cursor:'1-0'});await socket.wait(m=>m.type==='resync_required');await socket.wait(m=>m.type==='snapshot');ok('expired cursor requests a fresh snapshot');
 await assert.rejects(websocket(cookie,'https://untrusted.example'),/rejected/);ok('WebSocket origin authorization');
 oldTimestamp=true;await socket.wait(m=>m.type==='source_update'&&m.data.assets.some(a=>a.quality==='stale'));await call(`/projects/${id}/assets/${asset.id}/runtime-state`,{status:503});oldTimestamp=false;ok('source timestamp staleness is visible');
 outage=true;await socket.wait(m=>m.type==='source_update'&&m.data.quality==='offline');await call(`/projects/${id}/assets/${asset.id}/runtime-state`,{status:502});outage=false;await socket.wait(m=>m.type==='source_update'&&m.data.quality==='good');ok('upstream outage and recovery');
 socket.close();socket=null;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC','base64');
 const image=(await call(`/projects/${id}/image-assets?filename=smoke.png`,{method:'POST',body:png,raw:true,status:201,headers:{'Content-Type':'image/png'}})).value.imageAsset;
 const redirect=await call(`/projects/${id}/image-assets/${image.id}/content`,{status:302});const download=await fetch(redirect.r.headers.get('location'));assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);ok('raw upload, signed S3 download and byte integrity');
 const range=await fetch(redirect.r.headers.get('location'),{headers:{Range:'bytes=0-7'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,8);ok('object storage Range requests');
 await call(`/projects/${id}/image-assets?filename=fake.png`,{method:'POST',body:Buffer.from('not png'),raw:true,status:400});ok('file signature rejection');
 const upload=(await call(`/projects/${id}/uploads`,{method:'POST',status:201,body:{kind:'image',filename:'multipart.png',byteSize:png.length}})).value;
 const part=(await call(`/projects/${id}/uploads/${upload.resourceId}/parts/1`,{method:'POST'})).value;assert.equal((await fetch(part.url,{method:'PUT',body:png})).status,200);
 await call(`/projects/${id}/uploads/${upload.resourceId}/complete`,{method:'POST',status:202});
 let state;for(let i=0;i<30;i++){state=(await call(`/projects/${id}/uploads/${upload.resourceId}`)).value.resource;if(['ready','failed'].includes(state.state))break;await new Promise(r=>setTimeout(r,500));}assert.equal(state.state,'ready',JSON.stringify(state));ok('signed multipart upload and durable worker inspection');
 const username='smoke'+Date.now();const user=(await call('/users',{method:'POST',status:201,body:{loginName:username,email:username+'@local.test',displayName:'Integration viewer',password:admin.password,role:'viewer',modules:['2d','3d']}})).value.user;users.push(user.id);
 const other=await call('/auth/login',{method:'POST',body:{identifier:username,password:admin.password}});const viewer=other.r.headers.get('set-cookie').split(';')[0];await call(`/projects/${id}`,{as:viewer,status:404});
 await call(`/projects/${id}/members/${user.id}`,{method:'PUT',body:{role:'viewer'}});await call(`/projects/${id}/canvas`,{as:viewer});await call(`/projects/${id}`,{method:'PATCH',as:viewer,body:{name:'denied'},status:403});await call(`/projects/${scene}`,{as:viewer,status:404});ok('project membership and viewer write isolation');
 await call(`/projects/${scene}/members/${user.id}`,{method:'PUT',body:{role:'viewer'}});
 await checkFluidViewer(call,scene,viewer,fluidSnapshot,ok);
 await call(`/users/${user.id}/revoke-sessions`,{method:'POST'});await call('/auth/me',{as:viewer,status:401});ok('session revocation');
 const tenant='isolation-'+Date.now(),tenantUser='tenant-user-'+Date.now();tenants.push(tenant);users.push(tenantUser);
 sql(`INSERT INTO tenants(id,name) VALUES('${tenant}','Isolation check'); INSERT INTO users(id,tenant_id,email,login_name,display_name,password_hash,role) SELECT '${tenantUser}','${tenant}','admin@isolation.test','admin','Isolated admin',password_hash,'platform_admin' FROM users WHERE tenant_id='local' AND login_name='admin';`);
 const isolated=await call('/auth/login',{method:'POST',body:{tenant,identifier:'admin',password:admin.password}});const isolatedCookie=isolated.r.headers.get('set-cookie').split(';')[0];
 await call(`/projects/${id}`,{as:isolatedCookie,status:404});await call(`/projects/${id}/image-assets/${image.id}/content`,{as:isolatedCookie,status:404});
 const isolatedList=(await call('/projects',{as:isolatedCookie})).value;assert.equal(isolatedList.projects.length,0);
 socket=await websocket(isolatedCookie);socket.send({type:'subscribe',projectId:id});await socket.wait(m=>m.type==='error');socket.close();socket=null;ok('tenant isolation across API, files and WebSocket');
 await call(`/projects/${id}/image-assets/${image.id}`,{method:'DELETE'});await call(`/projects/${id}/image-assets/${upload.resourceId}`,{method:'DELETE'});
 console.log(`Backend integration checks passed: ${passed}.`);
}finally{
 socket?.close();await new Promise(r=>mock.close(r));
 // This script only deletes IDs it created; existing local projects/accounts are preserved.
 for(const id of projects.reverse()){const result=await call(`/projects/${id}`,{method:'DELETE'});assert.equal(result.value.deletedProjectId,id);}
 for(const id of users)sql(`DELETE FROM users WHERE id='${id}';`);
 for(const id of tenants)sql(`DELETE FROM tenants WHERE id='${id}';`);
 rmSync(temp,{recursive:true,force:true});
}
