// Private, bounded acceptance against the isolated Java API. Never points at 18080.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = process.env.SCENE_TEST_DIR;
assert.equal(dir, '/Users/inosaki/Documents/Codex/local/state/factory-scene-extensions-20260927');
const base = 'http://127.0.0.1:18081';
const flags = new Set(process.argv.slice(2));
assert.ok([...flags].every(x => ['--keep-fixture', '--cleanup', '--resume', '--extra', '--linked', '--stale', '--delete-route-check', '--multi-source', '--builtin-publication'].includes(x)));
assert.ok(!(flags.has('--cleanup') && flags.has('--keep-fixture')));
const manifestFile = join(dir, 'scene-extension-fixture.json');
const adminFile = join(dir, 'fixture-admin.json');
const stateFile = join(dir, 'source-state.json');
const env = JSON.parse(readFileSync(join(dir, 'runtime/TEST_ENV.json'), 'utf8'));
assert.equal(env.DEFAULT_TENANT, 'scene-extensions-test');
let cookie = '';
const checks = [];
function ok(name) { checks.push(name); console.log('PASS ' + name); }
function persist(value, path = manifestFile) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); }
async function call(path, { method = 'GET', body, status = 200, as = cookie, headers = {} } = {}) {
  const response = await fetch(base + '/api/v1' + path, { method, redirect: 'manual', headers: { Origin: base, ...(as ? { Cookie: as } : {}), ...(body === undefined ? {} : { 'Content-Type': Buffer.isBuffer(body) ? 'model/gltf-binary' : 'application/json' }), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const raw = await response.text(); let value; try { value = raw ? JSON.parse(raw) : {}; } catch { value = { raw }; }
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
  assert.ok(response.headers.get('x-request-id'), `${path}: missing request ID`);
  return { value, response };
}
async function rejected(path, body, expected = [400]) {
  const before = (await call(`/projects/${manifest.projects[0].id}/scene`)).value.scene;
  const response = await fetch(base + '/api/v1' + path, { method: 'PATCH', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const error = await response.json();
  assert.ok(expected.includes(response.status), `${path}: unexpected ${response.status} ${JSON.stringify(error)}`);
  assert.equal(typeof error.error, 'string');
  const after = (await call(`/projects/${manifest.projects[0].id}/scene`)).value.scene;
  assert.deepEqual(after, before, 'rejected patch partially changed scene');
  return error.error;
}
async function login(credentials) {
  const result = await call('/auth/login', { method: 'POST', body: { tenant: env.DEFAULT_TENANT, identifier: credentials.loginName, password: credentials.password }, as: '' });
  return result.response.headers.get('set-cookie').split(';')[0];
}
const admin = existsSync(adminFile) ? JSON.parse(readFileSync(adminFile, 'utf8')) : {
  loginName: 'admin', email: `scene-${randomUUID()}@fixture.test`, displayName: 'Scene fixture admin',
  password: randomBytes(24).toString('base64url'), tenant: env.DEFAULT_TENANT
};
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
const ts = requireWeb('typescript');
const moduleText = path => ts.transpileModule(readFileSync(join(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function shared(path) { const exports = {}; new Function('exports', moduleText(path))(exports); return exports; }
if (flags.has('--cleanup')) {
  assert.ok(existsSync(manifestFile));
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.base, base); assert.equal(manifest.tenant, env.DEFAULT_TENANT);
  assert.match(manifest.runId, /^scene-api-[0-9a-f-]{36}$/);
  assert.ok(manifest.projects.length > 0 && manifest.projects.length <= 3);
  assert.ok((manifest.builtinPublicationProjects??[]).length<=2);
  const recorded=[...manifest.projects,...(manifest.builtinPublicationProjects??[])];
  for (const p of recorded) { assert.match(p.id,/^[0-9a-f-]{36}$/); assert.ok(p.name.startsWith(`${manifest.runId} `)); }
  cookie=await login(admin);
  const initialCount=recorded.length;
  const protectedProjects=[];
  for (const project of [...recorded].reverse()) {
    const current=(await call(`/projects/${project.id}`)).value.project;
    if (current.name!==project.name) {
      protectedProjects.push({id:project.id,error:'fixture_name_changed'});
      continue;
    }
    const response=await fetch(`${base}/api/v1/projects/${project.id}`,{method:'DELETE',headers:{Origin:base,Cookie:cookie},redirect:'manual'});
    const result=await response.json();
    assert.ok(response.headers.get('x-request-id'));
    if (response.status===409 && ['project_in_use','project_has_publications','resource_processing'].includes(result.error)) {
      protectedProjects.push({id:project.id,error:result.error});
      continue;
    }
    assert.equal(response.status,200,`DELETE ${project.id}: ${JSON.stringify(result)}`);
    assert.equal(result.deletedProjectId,project.id);
    manifest.projects=manifest.projects.filter(item=>item.id!==project.id);
    if (manifest.builtinPublicationProjects)
      manifest.builtinPublicationProjects=manifest.builtinPublicationProjects.filter(item=>item.id!==project.id);
    persist(manifest);
    console.log(`CLEANUP deleted manifest project ${project.id}`);
  }
  console.log(JSON.stringify({deletedCount:initialCount-protectedProjects.length,protectedProjects,remainingManifestProjects:manifest.projects.length+(manifest.builtinPublicationProjects?.length??0),viewerRetained:!!manifest.viewer}));
  process.exit(0);
}
if (flags.has('--delete-route-check')) {
  cookie=await login(admin);
  const probePath=join(dir,'delete-route-probe.json');
  assert.ok(!existsSync(probePath),'Prior delete probe receipt exists; inspect before creating another.');
  const name=`scene-delete-probe-${randomUUID()}`;
  const project=(await call('/projects',{method:'POST',status:201,body:{name,projectType:'3d'}})).value.project;
  persist({base,tenant:env.DEFAULT_TENANT,id:project.id,name,createdAt:new Date().toISOString()},probePath);
  assert.equal((await call(`/projects/${project.id}`)).value.project.name,name);
  const deleted=(await call(`/projects/${project.id}`,{method:'DELETE'})).value;
  assert.equal(deleted.deletedProjectId,project.id);
  const missing=(await call(`/projects/${project.id}`,{status:404})).value;
  assert.equal(missing.error,'project_not_found');
  persist({base,tenant:env.DEFAULT_TENANT,id:project.id,name,deleted:true,deletedAt:new Date().toISOString()},probePath);
  console.log(JSON.stringify({result:'PASS',check:'isolated empty project POST -> DELETE -> GET 404',projectId:project.id}));
  process.exit(0);
}
if (flags.has('--resume')) {
  assert.ok(existsSync(manifestFile));
  const saved=JSON.parse(readFileSync(manifestFile,'utf8'));
  assert.equal(saved.base,base); assert.equal(saved.tenant,env.DEFAULT_TENANT);
  cookie=await login(admin);
  const sceneId=saved.projects[0].id, asset=saved.assets[0];
  const scene=(await call(`/projects/${sceneId}/scene`)).value.scene;
  if (saved.versionId) {
    const frozen=(await call(`/projects/${sceneId}/publications/${saved.versionId}`)).value.version;
    assert.equal(frozen.snapshot.projects[sceneId].document.decorations.length,7);
    assert.equal(scene.decorations.length,8);
    assert.deepEqual((await call(`/projects/${sceneId}/publications/${saved.versionId}`)).value.version,frozen);
    ok('fixed publication snapshot retained seven decorations after draft advanced to eight');
  }
  const viewerLogin=`sceneviewer${randomBytes(5).toString('hex')}`, viewerPassword=randomBytes(24).toString('base64url');
  const viewer=(await call('/users',{method:'POST',status:201,body:{loginName:viewerLogin,email:`${viewerLogin}@fixture.test`,displayName:'Scene fixture viewer',password:viewerPassword,role:'viewer',modules:['3d']}})).value.user;
  saved.viewer={id:viewer.id,loginName:viewerLogin}; persist(saved);
  await call(`/projects/${sceneId}/members/${viewer.id}`,{method:'PUT',body:{role:'viewer'}});
  const vc=await login({loginName:viewerLogin,password:viewerPassword});
  await call(`/projects/${sceneId}/scene`,{as:vc});
  await call(`/projects/${sceneId}/scene`,{as:vc,method:'PATCH',status:403,body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],decorations:scene.decorations}});
  await call(`/users/${viewer.id}/modules`,{method:'PATCH',body:{modules:[]}});
  await call(`/projects/${sceneId}/scene`,{as:vc,status:403});
  ok('viewer and module revocation boundaries');
  async function until(predicate) {let last;for(let i=0;i<30;i++){const r=await fetch(`${base}/api/v1/projects/${sceneId}/assets/${asset.id}/runtime-state`,{headers:{Cookie:cookie}});last={status:r.status,value:await r.json()};if(predicate(last))return last;await delay(500);}throw new Error(`runtime transition missing: ${JSON.stringify(last)}`);}
  persist({fire:false,failure:false,oldTimestamp:false},stateFile);
  await until(r=>r.status===200&&r.value.runtimeState?.values?.fire===false);
  persist({fire:true,failure:false,oldTimestamp:false},stateFile);
  await until(r=>r.status===200&&r.value.runtimeState?.values?.fire===true); ok('simulated fire false to true via collector');
  persist({fire:true,failure:true,oldTimestamp:false},stateFile);
  await until(r=>r.status===502&&r.value.error==='runtime_source_offline');
  persist({fire:false,failure:false,oldTimestamp:false},stateFile);
  await until(r=>r.status===200&&r.value.runtimeState?.values?.fire===false); ok('simulated upstream outage and recovery');
  saved.checks=[...new Set([...(saved.checks??[]),...checks])]; persist(saved);
  console.log(JSON.stringify({result:'PASS',checks,sceneId,assetId:asset.assetId,modelAssetId:saved.resources[0].id,militaryJsonBytes:saved.militaryJsonBytes,simulatedSource:'http://127.0.0.1:8791/rooms'},null,2));
  process.exit(0);
}
if (flags.has('--extra')) {
  assert.ok(existsSync(manifestFile));
  const saved=JSON.parse(readFileSync(manifestFile,'utf8'));
  assert.equal(saved.base,base); assert.equal(saved.tenant,env.DEFAULT_TENANT);
  cookie=await login(admin);
  const sceneId=saved.projects[0].id, modelId=saved.resources[0].id;
  let scene=(await call(`/projects/${sceneId}/scene`)).value.scene;
  const original={decorations:scene.decorations,roomAlarms:scene.roomAlarms,staticMap:scene.staticMap,fluids:scene.fluids};
  async function patch(changes) { const r=(await call(`/projects/${sceneId}/scene`,{method:'PATCH',body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],...changes}})).value;scene=r.scene;return r; }
  await patch({decorations:[],roomAlarms:[],staticMap:null});
  assert.deepEqual(scene.decorations,[]);assert.deepEqual(scene.roomAlarms,[]);assert.equal(scene.staticMap,null);assert.deepEqual(scene.fluids,original.fluids);
  await patch({decorations:original.decorations,roomAlarms:original.roomAlarms,staticMap:original.staticMap});
  assert.deepEqual(scene.decorations,original.decorations);assert.deepEqual(scene.roomAlarms,original.roomAlarms);assert.deepEqual(scene.staticMap,original.staticMap);ok('explicit []/null clearing then restoration');
  async function reject(changes,expected=400) {const before=structuredClone(scene); const r=await call(`/projects/${sceneId}/scene`,{method:'PATCH',status:expected,body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],...changes}});assert.equal(typeof r.value.error,'string');scene=(await call(`/projects/${sceneId}/scene`)).value.scene;assert.deepEqual(scene,before);return r.value.error;}
  const baseDecoration=original.decorations.find(x=>x.kind==='tree');
  const dec64=Array.from({length:64},(_,i)=>({...baseDecoration,id:`budget-tree-${i}`}));
  const additional=Array.from({length:59},(_,i)=>({id:`budget-building-${i}`,assetId:null,label:`Budget building ${i}`,modelAssetId:modelId,renderMode:'interactive',sortOrder:i+2,transform:{position:[(i%10)*8,0,Math.floor(i/10)*8],rotation:[0,0,0],scale:[1,1,1]},visible:true}));
  await patch({upsertInstances:additional,decorations:dec64});
  assert.equal(scene.instances.length+scene.decorations.length+scene.staticMap.features.length,128);
  const overflow={...additional[0],id:'budget-overflow',label:'Budget overflow',sortOrder:90};
  await reject({upsertInstances:[overflow]});ok('128 aggregate instance budget accepts boundary and rejects 129 atomically');
  const river=original.decorations.find(x=>x.kind==='river');
  const rivers24=Array.from({length:24},(_,i)=>({...river,id:`budget-river-${i}`,transform:{...river.transform,position:[i*4,0,0]}}));
  await patch({decorations:rivers24});
  await reject({decorations:[...rivers24,{...rivers24[0],id:'budget-river-24'}]});
  ok('24 animated river boundary accepts 24 and rejects 25 atomically');
  await reject({staticMap:{...original.staticMap,unsupported:true}});
  await reject({roomAlarms:null});
  await reject({unknownField:true});
  ok('unknown and null extension fields rejected without partial mutation');
  await patch({deleteInstanceIds:additional.map(x=>x.id),decorations:original.decorations});
  assert.equal(scene.instances.length,2);assert.deepEqual(scene.decorations,original.decorations);assert.deepEqual(scene.roomAlarms,original.roomAlarms);assert.deepEqual(scene.staticMap,original.staticMap);
  const frozen=(await call(`/projects/${sceneId}/publications/${saved.versionId}`)).value.version;
  assert.equal(frozen.snapshot.projects[sceneId].document.decorations.length,7);
  ok('browser fixture restored and published snapshot unchanged');
  saved.checks=[...new Set([...(saved.checks??[]),...checks])];persist(saved);
  console.log(JSON.stringify({result:'PASS',checks,sceneId,restoredInstances:scene.instances.length},null,2));
  process.exit(0);
}
if (flags.has('--linked')) {
  assert.ok(existsSync(manifestFile)); const saved=JSON.parse(readFileSync(manifestFile,'utf8'));
  assert.equal(saved.base,base);assert.equal(saved.tenant,env.DEFAULT_TENANT);cookie=await login(admin);
  const sceneId=saved.projects[0].id,canvasId=saved.projects[1].id;
  const asset=(await call(`/projects/${canvasId}/assets`,{method:'POST',status:201,body:{assetId:'linked-room',name:'模拟 2D 房间',assetType:'room',metadata:{simulated:true}}})).value.asset;
  saved.assets.push({projectId:canvasId,id:asset.id,assetId:'linked-room'});persist(saved);
  const source=(await call(`/projects/${canvasId}/data-sources`,{method:'POST',status:201,body:{name:'关联 2D 模拟火警',sourceType:'rest_polling',config:{url:'http://127.0.0.1:8791/rooms',intervalSeconds:1,timeoutMs:2000,timestampPath:'$.timestamp',credentialRef:null}}})).value.dataSource;
  saved.dataSources.push({projectId:canvasId,id:source.id});persist(saved);
  const binding=(await call(`/projects/${canvasId}/assets/${asset.id}/data-bindings`,{method:'POST',status:201,body:{dataSourceId:source.id,metricKey:'fire',sourcePath:'$.rooms.a.fire',valueType:'boolean',unit:null,staleAfterSeconds:3}})).value.dataBinding;
  saved.bindings.push({projectId:canvasId,assetRecordId:asset.id,id:binding.id});persist(saved);
  let scene=(await call(`/projects/${sceneId}/scene`)).value.scene;
  const own=scene.roomAlarms;
  const linked=own.map(x=>({...x,source:{projectId:canvasId,assetId:'linked-room',metricKey:'fire'}}));
  scene=(await call(`/projects/${sceneId}/scene`,{method:'PATCH',body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],roomAlarms:linked}})).value.scene;
  assert.deepEqual(scene.roomAlarms,linked);assert.equal(scene.linked2dProjectId,canvasId);
  const denied=await call(`/projects/${sceneId}/scene`,{method:'PATCH',status:400,body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],linked2dProjectId:null}});
  assert.equal(typeof denied.value.error,'string');
  assert.deepEqual((await call(`/projects/${sceneId}/scene`)).value.scene,scene);
  scene=(await call(`/projects/${sceneId}/scene`,{method:'PATCH',body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],roomAlarms:own}})).value.scene;
  assert.deepEqual(scene.roomAlarms,own);ok('linked 2D source is valid; unlink is blocked and rolls back; original alarm restored');
  saved.checks=[...new Set([...(saved.checks??[]),...checks])];persist(saved);
  console.log(JSON.stringify({result:'PASS',checks,sceneId,canvasId},null,2));process.exit(0);
}
if (flags.has('--stale')) {
  assert.ok(existsSync(manifestFile));const saved=JSON.parse(readFileSync(manifestFile,'utf8'));
  assert.equal(saved.base,base);assert.equal(saved.tenant,env.DEFAULT_TENANT);cookie=await login(admin);
  const sceneId=saved.projects[0].id,asset=saved.assets[0];
  async function until(predicate) {let last;for(let i=0;i<30;i++){const r=await fetch(`${base}/api/v1/projects/${sceneId}/assets/${asset.id}/runtime-state`,{headers:{Cookie:cookie}});last={status:r.status,value:await r.json()};if(predicate(last))return last;await delay(500);}throw new Error(`runtime state missing: ${JSON.stringify(last)}`);}
  persist({fire:false,failure:false,oldTimestamp:true},stateFile);
  await until(r=>r.status===503&&r.value.error==='runtime_stale');
  persist({fire:false,failure:false,oldTimestamp:false},stateFile);
  await until(r=>r.status===200&&r.value.runtimeState?.values?.fire===false);
  ok('source timestamp staleness is explicit and recovers');saved.checks=[...new Set([...(saved.checks??[]),...checks])];persist(saved);
  console.log(JSON.stringify({result:'PASS',checks,sceneId},null,2));process.exit(0);
}
if (flags.has('--multi-source')) {
  assert.ok(existsSync(manifestFile));
  const saved=JSON.parse(readFileSync(manifestFile,'utf8'));
  assert.equal(saved.base,base);assert.equal(saved.tenant,env.DEFAULT_TENANT);
  cookie=await login(admin);
  const sceneId=saved.projects[0].id,asset=saved.assets.find(x=>x.projectId===sceneId);
  const fireSource=saved.dataSources.find(x=>x.projectId===sceneId);
  assert.ok(asset?.id&&fireSource?.id);
  const state={fire:false,slowFire:false,failure:false,oldTimestamp:false};
  persist(state,stateFile);
  if (!saved.multiSource?.slowSourceId) {
    const slow=(await call(`/projects/${sceneId}/data-sources`,{method:'POST',status:201,body:{name:'模拟慢源 A',sourceType:'rest_polling',config:{url:'http://127.0.0.1:8791/rooms',intervalSeconds:30,timeoutMs:2000,timestampPath:'$.timestamp',credentialRef:null}}})).value.dataSource;
    saved.multiSource={slowSourceId:slow.id};saved.dataSources.push({projectId:sceneId,id:slow.id,purpose:'slow-source-A'});persist(saved);
  }
  if (!saved.multiSource.slowBindingId) {
    const binding=(await call(`/projects/${sceneId}/assets/${asset.id}/data-bindings`,{method:'POST',status:201,body:{dataSourceId:saved.multiSource.slowSourceId,metricKey:'slow',sourcePath:'$.rooms.b.fire',valueType:'boolean',unit:null,staleAfterSeconds:60}})).value.dataBinding;
    saved.multiSource.slowBindingId=binding.id;saved.bindings.push({projectId:sceneId,assetRecordId:asset.id,id:binding.id,purpose:'slow-source-A'});persist(saved);
  }
  async function read() {const r=await fetch(`${base}/api/v1/projects/${sceneId}/assets/${asset.id}/runtime-state`,{headers:{Cookie:cookie}});return {status:r.status,value:await r.json()};}
  async function until(predicate,label,seconds=55) {let last;const start=Date.now();while(Date.now()-start<seconds*1000){last=await read();if(predicate(last))return last.value.runtimeState;if(Math.floor((Date.now()-start)/1000)%10===0&&Date.now()-start>9000)console.log(`WAIT ${label}`);await delay(650);}throw new Error(`${label}: ${JSON.stringify(last)}`);}
  const metric=(state,key)=>state.metrics?.find(item=>item.metricKey===key);
  const before=await until(r=>r.status===200&&r.value.runtimeState?.values?.fire===false&&r.value.runtimeState?.values?.slow===false&&metric(r.value.runtimeState,'slow')?.sourceId===saved.multiSource.slowSourceId&&metric(r.value.runtimeState,'fire')?.sourceId===fireSource.id&&Date.parse(metric(r.value.runtimeState,'fire').timestamp)>Date.parse(metric(r.value.runtimeState,'slow').timestamp),'distinct cached source timestamps');
  assert.equal(before.timestamp,metric(before,'slow').collectedAt);
  assert.equal(metric(before,'slow').quality,'good');assert.equal(metric(before,'fire').quality,'good');
  const beforeFireTime=Date.parse(metric(before,'fire').timestamp);
  persist({...state,fire:true},stateFile);
  const after=await until(r=>r.status===200&&r.value.runtimeState?.values?.fire===true&&Date.parse(metric(r.value.runtimeState,'fire')?.timestamp)>beforeFireTime&&r.value.runtimeState.timestamp===metric(r.value.runtimeState,'slow')?.collectedAt,'fast fire transition');
  assert.equal(after.timestamp,metric(after,'slow').collectedAt);
  assert.equal(metric(after,'fire').sourceId,fireSource.id);
  assert.equal(metric(after,'fire').value,true);
  assert.ok(Date.parse(metric(after,'fire').timestamp)>Date.parse(metric(after,'slow').timestamp));
  ok('top timestamp remains slow A while fire metric advances on fast B');
  if (!saved.multiSource.versionId) {
    const draft=(await call(`/projects/${sceneId}/publications/draft`)).value;
    const published=(await call(`/projects/${sceneId}/publications`,{method:'POST',status:201,body:{title:'Two source room alarm acceptance',expectedDraftHash:draft.draftHash}})).value;
    saved.multiSource.versionId=published.versionId;persist(saved);
  }
  const version=(await call(`/projects/${sceneId}/publications/${saved.multiSource.versionId}`)).value.version;
  assert.equal(version.id,saved.multiSource.versionId);
  assert.equal(version.snapshot.projects[sceneId].document.projectId,sceneId);
  const published=(await call(`/projects/${sceneId}/publications/${saved.multiSource.versionId}/projects/${sceneId}/assets/${asset.id}/runtime-state`)).value.runtimeState;
  assert.equal(published.values.fire,true);assert.equal(published.values.slow,false);
  assert.equal(metric(published,'fire').sourceId,fireSource.id);
  assert.equal(metric(published,'slow').sourceId,saved.multiSource.slowSourceId);
  assert.equal(published.timestamp,metric(published,'slow').collectedAt);
  assert.equal(metric(published,'fire').quality,'good');assert.equal(metric(published,'slow').quality,'good');
  ok('fixed publication maps both metrics to their own source and timestamp');
  saved.checks=[...new Set([...(saved.checks??[]),...checks])];persist(saved);
  console.log(JSON.stringify({result:'PASS',checks,sceneId,assetId:asset.id,fastSourceId:fireSource.id,slowSourceId:saved.multiSource.slowSourceId,slowBindingId:saved.multiSource.slowBindingId,versionId:saved.multiSource.versionId,topTimestamp:after.timestamp,fireMetricTimestamp:metric(after,'fire').timestamp},null,2));
  process.exit(0);
}
if (flags.has('--builtin-publication')) {
  assert.ok(existsSync(manifestFile));
  const saved=JSON.parse(readFileSync(manifestFile,'utf8'));
  assert.equal(saved.base,base);assert.equal(saved.tenant,env.DEFAULT_TENANT);
  cookie=await login(admin);
  const reg=saved.builtinPublication??{};
  async function makeProject(kind) {
    const name=`${saved.runId} builtin-publication ${kind}`;
    const project=(await call('/projects',{method:'POST',status:201,body:{name,projectType:kind}})).value.project;
    return {id:project.id,name,kind};
  }
  if (!reg.canvasId) {const p=await makeProject('2d');reg.canvasId=p.id;saved.builtinPublication=reg;saved.builtinPublicationProjects=[...(saved.builtinPublicationProjects??[]),p];persist(saved);}
  if (!reg.sceneId) {const p=await makeProject('3d');reg.sceneId=p.id;saved.builtinPublication=reg;saved.builtinPublicationProjects=[...(saved.builtinPublicationProjects??[]),p];persist(saved);}
  const imageId='builtin:industry-production-v1';
  const schema=JSON.parse(readFileSync('/Users/inosaki/Documents/Codex/work/factory-digital-twin-backend/src/main/resources/contracts/configuration.schema.json','utf8'));
  assert.deepEqual(schema.definitions.ImageProps.required,['alt','fit','backgroundColor','borderColor','borderRadius']);
  const imageProps={alt:'公开内置工业生产示例图',fit:'cover',backgroundColor:'#071525',borderColor:'#276f8d',borderRadius:0};
  assert.deepEqual(Object.keys(imageProps),schema.definitions.ImageProps.required);
  let canvas=(await call(`/projects/${reg.canvasId}/canvas`)).value.canvas;
  if (!canvas.nodes.some(x=>x.id==='builtin-image')) {
    const node={id:'builtin-image',type:'image',x:160,y:140,width:800,height:480,zIndex:1,props:imageProps,resourceRefs:[imageId],dataBindingRefs:[]};
    canvas=(await call(`/projects/${reg.canvasId}/canvas`,{method:'PATCH',body:{expectedRevision:canvas.revision,upsertNodes:[node],deleteNodeIds:[]}})).value.canvas;
  }
  assert.deepEqual(canvas.nodes.find(x=>x.id==='builtin-image').resourceRefs,[imageId]);
  if (!reg.canvasVersionId) {
    const draft=(await call(`/projects/${reg.canvasId}/publications/draft`)).value;
    assert.equal(draft.resourceCount,0);
    const version=(await call(`/projects/${reg.canvasId}/publications`,{method:'POST',status:201,body:{title:'Built-in image canvas acceptance',expectedDraftHash:draft.draftHash}})).value;
    reg.canvasVersionId=version.versionId;persist(saved);
  }
  const canvasVersion=(await call(`/projects/${reg.canvasId}/publications/${reg.canvasVersionId}`)).value.version;
  assert.deepEqual(canvasVersion.snapshot.projects[reg.canvasId].document.nodes.find(x=>x.id==='builtin-image').resourceRefs,[imageId]);
  assert.deepEqual(canvasVersion.snapshot.resources,[]);
  const {createSceneDecoration}=shared('shared/scene-decorations.ts');
  const {importGeoJson,STATIC_MAP_EXAMPLE}=shared('shared/static-map.ts');
  const mapped=importGeoJson(STATIC_MAP_EXAMPLE,{id:'publication-map',label:'模拟园区图',coordinateSystem:'local',width:40,defaultHeight:4,color:'#658fad',outlineColor:'#ffffff'});
  assert.equal(mapped.ok,true,mapped.message);
  let scene=(await call(`/projects/${reg.sceneId}/scene`)).value.scene;
  if (scene.revision===0) scene=(await call(`/projects/${reg.sceneId}/scene`,{method:'PATCH',body:{expectedRevision:0,upsertInstances:[],deleteInstanceIds:[],decorations:[createSceneDecoration('publication-tree','tree')],staticMap:mapped.value}})).value.scene;
  assert.equal(scene.linked2dProjectId,null);assert.equal(scene.instances.length,0);assert.equal(scene.decorations.length,1);assert.equal(scene.staticMap.id,'publication-map');
  if (!reg.unlinkedVersionId) {
    const draft=(await call(`/projects/${reg.sceneId}/publications/draft`)).value;
    assert.equal(draft.projectCount,1);assert.equal(draft.resourceCount,0);
    const version=(await call(`/projects/${reg.sceneId}/publications`,{method:'POST',status:201,body:{title:'Unlinked map and decoration acceptance',expectedDraftHash:draft.draftHash}})).value;
    reg.unlinkedVersionId=version.versionId;persist(saved);
  }
  const unlinked=(await call(`/projects/${reg.sceneId}/publications/${reg.unlinkedVersionId}`)).value.version;
  assert.equal(Object.keys(unlinked.snapshot.projects).length,1);
  assert.deepEqual(unlinked.snapshot.resources,[]);
  assert.equal(unlinked.snapshot.projects[reg.sceneId].document.linked2dProjectId,null);
  ok('independent map/decor 3D publication has one project and zero resources');
  if (scene.linked2dProjectId!==reg.canvasId) scene=(await call(`/projects/${reg.sceneId}/scene`,{method:'PATCH',body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],linked2dProjectId:reg.canvasId}})).value.scene;
  if (!reg.linkedVersionId) {
    const draft=(await call(`/projects/${reg.sceneId}/publications/draft`)).value;
    assert.equal(draft.projectCount,2);assert.equal(draft.resourceCount,0);
    const version=(await call(`/projects/${reg.sceneId}/publications`,{method:'POST',status:201,body:{title:'Linked built-in image acceptance',expectedDraftHash:draft.draftHash}})).value;
    reg.linkedVersionId=version.versionId;persist(saved);
  }
  const linked=(await call(`/projects/${reg.sceneId}/publications/${reg.linkedVersionId}`)).value.version;
  assert.equal(Object.keys(linked.snapshot.projects).length,2);
  assert.deepEqual(linked.snapshot.resources,[]);
  assert.deepEqual(linked.snapshot.projects[reg.canvasId].document.nodes.find(x=>x.id==='builtin-image').resourceRefs,[imageId]);
  assert.equal(linked.snapshot.projects[reg.sceneId].document.linked2dProjectId,reg.canvasId);
  ok('linked 3D publication retains built-in image without uploaded resource');
  saved.checks=[...new Set([...(saved.checks??[]),...checks])];persist(saved);
  console.log(JSON.stringify({result:'PASS',checks,canvasId:reg.canvasId,sceneId:reg.sceneId,canvasVersionId:reg.canvasVersionId,unlinkedVersionId:reg.unlinkedVersionId,linkedVersionId:reg.linkedVersionId,resourceCount:linked.snapshot.resources.length},null,2));
  process.exit(0);
}
assert.ok(!existsSync(manifestFile), 'Existing fixture present; use --cleanup or inspect it first.');
const status = (await call('/auth/bootstrap-status')).value;
if (status.setupRequired) {
  persist(admin, adminFile);
  const boot = await call('/auth/bootstrap', { method: 'POST', status: 201, as: '', headers: { 'X-Bootstrap-Token': env.BOOTSTRAP_TOKEN }, body: admin });
  cookie = boot.response.headers.get('set-cookie').split(';')[0];
} else {
  assert.ok(existsSync(adminFile), 'Tenant initialized by an unknown account; refusing to modify it.');
  cookie = await login(admin);
}
const manifest = { base, tenant: env.DEFAULT_TENANT, runId: `scene-api-${randomUUID()}`, createdAt: new Date().toISOString(), projects: [], resources: [], assets: [], dataSources: [], bindings: [], checks: [] };
persist(manifest);
async function project(kind) {
  const name = `${manifest.runId} ${kind}`;
  const result = (await call('/projects', { method: 'POST', status: 201, body: { name, projectType: kind } })).value.project;
  manifest.projects.push({ id: result.id, name, kind }); persist(manifest); return result.id;
}
const sceneId = await project('3d');
const canvasId = await project('2d');
const foreignId = await project('3d');
const { createSceneDecoration } = shared('shared/scene-decorations.ts');
const { importGeoJson, STATIC_MAP_EXAMPLE } = shared('shared/static-map.ts');
const decorations = ['tree','shrub','river','military-truck','military-tent','military-radar','military-armored'].map((kind, i) => {
  const item = createSceneDecoration(`fixture-decoration-${i}`, kind);
  item.transform.position = [i * 4, 0, -12]; return item;
});
const imported = importGeoJson(STATIC_MAP_EXAMPLE, { id: 'fixture-map', label: '模拟静态地图', coordinateSystem: 'local', width: 40, defaultHeight: 4, color: '#658fad', outlineColor: '#ffffff' });
assert.equal(imported.ok, true, imported.message); const staticMap = imported.value;
assert.ok(!JSON.stringify(staticMap).match(/https?:\/\/|resourceUrl|textureUrl/));
// Original minimal GLB: two named rooms share exactly one material object.
const THREE = requireWeb('three');
const threeRoot = dirname(dirname(requireWeb.resolve('three')));
const { GLTFExporter } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/exporters/GLTFExporter.js')));
globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(x => { this.result=x; this.onloadend?.(); }, e=>this.onerror?.(e)); } readAsDataURL(blob) { blob.arrayBuffer().then(x => { this.result=`data:${blob.type};base64,${Buffer.from(x).toString('base64')}`; this.onloadend?.(); }, e=>this.onerror?.(e)); } };
const group = new THREE.Group(); const sharedMaterial = new THREE.MeshStandardMaterial({ color: '#708ba5' });
for (const [name, x] of [['room_A', -2], ['room_B', 2]]) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), sharedMaterial); mesh.name = name; mesh.position.x = x; group.add(mesh); }
const glb = Buffer.from(await new GLTFExporter().parseAsync(group, { binary: true }));
writeFileSync(join(dir, 'two-rooms.glb'), glb, { mode: 0o600 });
const upload = (await call(`/projects/${sceneId}/model-assets?filename=two-rooms.glb`, { method: 'POST', body: glb, status: 201 })).value.modelAsset;
manifest.resources.push({ projectId: sceneId, id: upload.id, filename: 'two-rooms.glb' }); persist(manifest);
const instance = (id, x) => ({ id, assetId: null, label: id, modelAssetId: upload.id, renderMode: 'interactive', sortOrder: x, transform: { position: [x * 8, 0, 0], rotation: [0,0,0], scale: [1,1,1] }, visible: true });
const [a,b] = [instance('building-A', 0), instance('building-B', 1)];
persist({ fire: false, failure: false, oldTimestamp: false }, stateFile);
const asset = (await call(`/projects/${sceneId}/assets`, { method: 'POST', body: { assetId: 'room-a', name: '模拟 A 房间', assetType: 'room', modelNode: null, metadata: { simulated: true } }, status: 201 })).value.asset;
manifest.assets.push({ projectId: sceneId, id: asset.id, assetId: asset.assetId }); persist(manifest);
const source = (await call(`/projects/${sceneId}/data-sources`, { method: 'POST', body: { name: '本地模拟火警', sourceType: 'rest_polling', config: { url: 'http://127.0.0.1:8791/rooms', intervalSeconds: 1, timeoutMs: 2000, timestampPath: '$.timestamp', credentialRef: null } }, status: 201 })).value.dataSource;
manifest.dataSources.push({ projectId: sceneId, id: source.id }); persist(manifest);
const binding = (await call(`/projects/${sceneId}/assets/${asset.id}/data-bindings`, { method: 'POST', body: { dataSourceId: source.id, metricKey: 'fire', sourcePath: '$.rooms.a.fire', valueType: 'boolean', unit: null, staleAfterSeconds: 3 }, status: 201 })).value.dataBinding;
manifest.bindings.push({ projectId: sceneId, assetRecordId: asset.id, id: binding.id }); persist(manifest);
const alarm = { id: 'room-a-fire', label: 'A 房间模拟火警', enabled: true, source: { projectId: sceneId, assetId: 'room-a', metricKey: 'fire' }, target: { instanceId: b.id, modelAssetId: upload.id, nodeName: 'room_A' }, condition: { operator: 'eq', value: true }, color: '#ff3030' };
let scene = (await call(`/projects/${sceneId}/scene`)).value.scene;
const patch = async changes => { const out = (await call(`/projects/${sceneId}/scene`, { method: 'PATCH', body: { expectedRevision: scene.revision, upsertInstances: [], deleteInstanceIds: [], ...changes } })).value; scene = out.scene; return out; };
let out = await patch({ upsertInstances: [a,b], linked2dProjectId: canvasId, decorations, roomAlarms: [alarm], staticMap });
assert.equal(out.sceneExtensionsVersion, 1);
assert.deepEqual(scene.decorations, decorations); assert.deepEqual(scene.roomAlarms, [alarm]); assert.deepEqual(scene.staticMap, staticMap);
assert.deepEqual((await call(`/projects/${sceneId}/scene`)).value.scene, scene);
ok('atomic scene save, two real GLB instances, alarm and extension round trip');
const militaryBytes = Buffer.byteLength(JSON.stringify(decorations.filter(x => x.kind.startsWith('military-'))));
manifest.militaryJsonBytes = militaryBytes; persist(manifest);
// Settings-only and omitted extension fields preserve all saved declarations.
await patch({ settings: { ...scene.settings, showGrid: !scene.settings.showGrid } });
assert.deepEqual(scene.decorations, decorations); assert.deepEqual(scene.roomAlarms, [alarm]); assert.deepEqual(scene.staticMap, staticMap);
ok('settings-only patch retains extension fields');
for (const [label, change, expected] of [
  ['unknown decoration field', { decorations: [{ ...decorations[0], surprise: true }] }, [400]],
  ['null decorations', { decorations: null }, [400]],
  ['65 decorations', { decorations: Array.from({length:65}, (_,i)=>({ ...decorations[0], id:`overflow-${i}` })) }, [400]],
  ['map self intersection', { staticMap: { ...staticMap, features: [{ ...staticMap.features[0], polygons: [{ outer: [[0,0],[3,3],[0,3],[3,0],[0,0]], holes: [] }] }] } }, [400]],
  ['target instance deletion', { deleteInstanceIds: [b.id] }, [400]],
  ['target model mismatch', { upsertInstances: [{ ...b, modelAssetId: 'builtin:aqua-helix-hd-v1' }] }, [400]],
  ['unlink referenced source', { linked2dProjectId: null, roomAlarms: [{ ...alarm, source: { ...alarm.source, projectId: canvasId } }] }, [400]],
]) { await rejected(`/projects/${sceneId}/scene`, { expectedRevision: scene.revision, upsertInstances: [], deleteInstanceIds: [], ...change }, expected); ok(label + ' rejected atomically'); }
assert.equal(await rejected(`/projects/${sceneId}/scene`, { expectedRevision: scene.revision - 1, upsertInstances: [], deleteInstanceIds: [], decorations }, [409]), 'revision_conflict'); ok('revision conflict');
for (const [label, path, body] of [
  ['asset business key rename', `/projects/${sceneId}/assets/${asset.id}`, { assetId: 'room-new' }],
  ['binding metric rename', `/projects/${sceneId}/assets/${asset.id}/data-bindings/${binding.id}`, { metricKey: 'other' }],
  ['binding type change', `/projects/${sceneId}/assets/${asset.id}/data-bindings/${binding.id}`, { valueType: 'string' }],
]) { const r = await call(path, { method: 'PATCH', body, status: 409 }); assert.equal(r.value.error, 'room_alarm_source_referenced'); ok(label + ' blocked'); }
assert.equal((await call(`/projects/${sceneId}/assets/${asset.id}/data-bindings/${binding.id}`, { method: 'DELETE', status: 409 })).value.error, 'room_alarm_source_referenced'); ok('binding deletion blocked');
await patch({ roomAlarms: [{ ...alarm, enabled: false }] });
assert.equal((await call(`/projects/${sceneId}/assets/${asset.id}/data-bindings/${binding.id}`, { method: 'DELETE', status: 409 })).value.error, 'room_alarm_source_referenced');
await patch({ roomAlarms: [alarm] }); ok('disabled alarm retains source protection');
const foreignAsset = (await call(`/projects/${foreignId}/assets`, { method: 'POST', status: 201, body: { assetId: 'foreign-room', name:'Foreign', assetType:'room', metadata:{} } })).value.asset;
const foreignSource = (await call(`/projects/${foreignId}/data-sources`, { method:'POST', status:201, body: { name:'Foreign source', sourceType:'rest_polling', config: { url:'http://127.0.0.1:8791/rooms', intervalSeconds:1, timeoutMs:2000, timestampPath:'$.timestamp', credentialRef:null } } })).value.dataSource;
await call(`/projects/${foreignId}/assets/${foreignAsset.id}/data-bindings`, { method:'POST', status:201, body: { dataSourceId: foreignSource.id, metricKey:'fire', sourcePath:'$.rooms.a.fire', valueType:'boolean', unit:null, staleAfterSeconds:3 } });
await rejected(`/projects/${sceneId}/scene`, { expectedRevision: scene.revision, upsertInstances: [], deleteInstanceIds: [], roomAlarms: [{ ...alarm, source: { projectId: foreignId, assetId:'foreign-room', metricKey:'fire' } }] }); ok('cross-project source outside self/linked rejected');
const viewerLogin = `sceneviewer${randomBytes(5).toString('hex')}`;
const viewerPassword = randomBytes(24).toString('base64url');
const viewerUser = (await call('/users', { method:'POST', status:201, body:{ loginName:viewerLogin, email:`${viewerLogin}@fixture.test`, displayName:'Scene fixture viewer', password:viewerPassword, role:'viewer', modules:['3d'] } })).value.user;
manifest.viewer = { id:viewerUser.id, loginName:viewerLogin }; persist(manifest);
await call(`/projects/${sceneId}/members/${viewerUser.id}`, { method:'PUT', body:{role:'viewer'} });
const viewerCookie = await login({loginName:viewerLogin,password:viewerPassword});
await call(`/projects/${sceneId}/scene`, { as:viewerCookie });
await call(`/projects/${sceneId}/scene`, { as:viewerCookie, method:'PATCH', status:403, body:{expectedRevision:scene.revision,upsertInstances:[],deleteInstanceIds:[],decorations} });
await call(`/users/${viewerUser.id}/modules`, { method:'PATCH', body:{modules:[]} });
await call(`/projects/${sceneId}/scene`, { as:viewerCookie, status:403 });
ok('viewer write denied and revoked module read denied');
async function runtimeUntil(expected, timeoutMs=12000) {
  const start=Date.now(); let last;
  while (Date.now()-start<timeoutMs) {
    const response=await fetch(`${base}/api/v1/projects/${sceneId}/assets/${asset.id}/runtime-state`, {headers:{Cookie:cookie}});
    last={status:response.status,value:await response.json()};
    if (expected(last)) return last;
    await delay(500);
  }
  throw new Error(`runtime transition missing: ${JSON.stringify(last)}`);
}
persist({fire:false,failure:false,oldTimestamp:false},stateFile);
const normal=await runtimeUntil(r=>r.status===200 && r.value.runtimeState?.values?.fire===false);
assert.equal(normal.value.runtimeState.values.fire,false);
persist({fire:true,failure:false,oldTimestamp:false},stateFile);
const fireState=await runtimeUntil(r=>r.status===200 && r.value.runtimeState?.values?.fire===true);
assert.equal(fireState.value.runtimeState.values.fire,true); ok('collector mapped simulated false-to-true fire transition');
persist({fire:true,failure:true,oldTimestamp:false},stateFile);
const offline=await runtimeUntil(r=>r.status===502 && r.value.error==='runtime_source_offline');
assert.equal(offline.value.error,'runtime_source_offline');
persist({fire:false,failure:false,oldTimestamp:false},stateFile);
await runtimeUntil(r=>r.status===200 && r.value.runtimeState?.values?.fire===false);
ok('collector outage is explicit and recovers');
const draft = (await call(`/projects/${sceneId}/publications/draft`)).value;
const version = (await call(`/projects/${sceneId}/publications`, { method:'POST', status:201, body: { title:'Scene fixture v1', expectedDraftHash:draft.draftHash } })).value;
manifest.versionId = version.versionId; persist(manifest);
const frozen = (await call(`/projects/${sceneId}/publications/${version.versionId}`)).value.version;
await patch({ decorations: [...decorations, createSceneDecoration('later-tree','tree')] });
assert.deepEqual((await call(`/projects/${sceneId}/publications/${version.versionId}`)).value.version, frozen);
assert.deepEqual(frozen.snapshot.projects[sceneId].document.decorations, decorations);
ok('fixed publication snapshot freezes extensions after draft change');
console.log(JSON.stringify({ result:'PASS', checks, sceneId, canvasId, assetId:'room-a', assetRecordId:asset.id, modelAssetId:upload.id, nodes:['room_A','room_B'], sceneUrl:`http://127.0.0.1:5173/#/projects/${sceneId}/preview`, militaryJsonBytes, fixtureDir:dir, simulatedSource:'http://127.0.0.1:8791/rooms' }, null, 2));
