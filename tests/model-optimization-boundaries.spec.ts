import {test,expect,request as apiRequest} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createMockGltf,createAnimatedMockGltf,createDeformedMockGltf} from '../scripts/mock-model.mjs';
import {createUser} from '../apps/api/src/auth';
import {createModelOptimizer} from '../apps/runtime/src/model-optimization-service';
import {compressModelBytes,verifyModelCompression} from '../apps/runtime/src/model-compression';
import {packGlb} from './meshopt-fixture';
import {inspectModelDetails} from '../apps/api/src/model-inspection';
import {MeshoptDecoder} from 'meshoptimizer/decoder';

test('compression preserves skins, morphs and animation data and rejects forged provenance and byte changes',async()=>{
 for(const text of [createAnimatedMockGltf(),createDeformedMockGltf()]){const bytes=new TextEncoder().encode(text),result=await compressModelBytes(bytes);await verifyModelCompression(bytes,result.bytes);const view=new DataView(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength),length=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(result.bytes.subarray(20,20+length))),binary=result.bytes.subarray(28+length);
  const forged=structuredClone(json);forged.asset.extras.newpowerCompression.preservedViews+=1;await expect(verifyModelCompression(bytes,packGlb(forged,binary))).rejects.toThrow();await expect(inspectModelDetails(packGlb(forged,binary),'glb','forged',{meshopt:MeshoptDecoder})).rejects.toThrow();
  const changed=structuredClone(json);changed.nodes[0].translation=[900,0,0];await expect(verifyModelCompression(bytes,packGlb(changed,binary))).rejects.toThrow();
 }
});

test('model writes retain committed bytes on readback failure and reject revoked authority before commit',async({},testInfo)=>{
 const {startRuntime}=await import(pathToFileURL(resolve('apps/runtime/dist/server.mjs')).href),bootstrap=randomBytes(24).toString('hex'),runtime=await startRuntime({dataDirectory:testInfo.outputPath('data'),port:0,environment:{BOOTSTRAP_TOKEN:bootstrap}}),api=await apiRequest.newContext({baseURL:runtime.url});const db=runtime.environment.DB,prepare=db.prepare.bind(db),bucket=runtime.environment.PROJECT_FILES,put=bucket.put.bind(bucket);
 try{
  expect((await api.post('/api/v1/auth/bootstrap',{headers:{'x-bootstrap-token':bootstrap},data:{email:'optimization-boundary@example.invalid',password:randomBytes(24).toString('hex'),displayName:'Owner'}})).status()).toBe(201);const user=await prepare('SELECT id FROM users LIMIT 1').first(),created=await api.post('/api/v1/projects',{data:{name:'Write boundary'}}),id=(await created.json()).project.id,base=`/api/v1/projects/${id}`;
  const bytes=createMockGltf();db.prepare=(sql:string)=>{const statement=prepare(sql);if(sql.includes('SELECT id, project_id, original_filename') && sql.includes('WHERE project_id = ? AND id = ?')){const bind=statement.bind.bind(statement);statement.bind=(...values:unknown[])=>{const bound=bind(...values);bound.first=async()=>{throw new Error('Injected postcommit readback failure');};return bound;};}return statement;};
  const uploaded=await api.post(`${base}/model-assets?filename=readback.gltf`,{data:bytes,headers:{'content-type':'model/gltf+json'}});expect(uploaded.status()).toBe(500);db.prepare=prepare;const rows=(await prepare('SELECT id,object_key FROM model_assets WHERE project_id=?').bind(id).all()).results;expect(rows).toHaveLength(1);expect(await bucket.get(rows[0].object_key)).not.toBeNull();expect(await(await api.get(`${base}/model-assets/${rows[0].id}/content`)).text()).toBe(bytes);
  bucket.put=async(...args:Parameters<typeof put>)=>{await put(...args);await prepare('UPDATE users SET is_active=0 WHERE id=?').bind(user.id).run();};const revoked=await api.post(`${base}/model-assets?filename=revoked.gltf`,{data:bytes,headers:{'content-type':'model/gltf+json'}});expect(revoked.status()).toBe(403);bucket.put=put;await prepare('UPDATE users SET is_active=1 WHERE id=?').bind(user.id).run();expect((await prepare('SELECT id FROM model_assets WHERE project_id=?').bind(id).all()).results).toHaveLength(1);
  const viewerPassword=randomBytes(24).toString('hex'),viewer=await createUser(runtime.environment,{email:'optimization-viewer@example.invalid',password:viewerPassword,displayName:'Viewer',roles:['viewer']}),now=new Date().toISOString();await prepare("INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'viewer',?,?)").bind(id,viewer.id,now,now).run();const readOnly=await apiRequest.newContext({baseURL:runtime.url});try{expect((await readOnly.post('/api/v1/auth/login',{data:{email:'optimization-viewer@example.invalid',password:viewerPassword}})).status()).toBe(200);expect((await readOnly.post(`${base}/model-assets/${rows[0].id}/optimize`,{data:{}})).status()).toBe(403);}finally{await readOnly.dispose();}
  const worker=testInfo.outputPath('slow-worker.mjs');await mkdir(resolve(worker,'..'),{recursive:true});await writeFile(worker,"process.stdin.resume();setInterval(()=>{},1000);");const optimize=createModelOptimizer(runtime.environment,worker),controller=new AbortController(),pending=optimize(new Request('http://localhost/optimize',{method:'POST',signal:controller.signal}),id,rows[0].id,user.id);void pending.catch(()=>{});await new Promise((resolve)=>setTimeout(resolve,100));await expect(optimize(new Request('http://localhost/optimize',{method:'POST'}),id,rows[0].id,user.id)).rejects.toMatchObject({code:'model_optimization_busy'});controller.abort();await expect(pending).rejects.toMatchObject({code:'model_optimization_cancelled'});expect((await prepare('SELECT id FROM model_assets WHERE project_id=?').bind(id).all()).results).toHaveLength(1);
 }finally{db.prepare=prepare;bucket.put=put;await api.dispose();await runtime.close();}
});

test('embedded image bytes, transparency and material extension values survive buffer compression',async()=>{
 const json=JSON.parse(createMockGltf()),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),binary=Buffer.from(json.buffers[0].uri.split(',')[1],'base64');
 json.buffers[0]={byteLength:binary.length+png.length,uri:`data:application/octet-stream;base64,${Buffer.concat([binary,png]).toString('base64')}`};json.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:png.length});json.images=[{bufferView:json.bufferViews.length-1,mimeType:'image/png'}];json.textures=[{source:0}];json.materials[0].alphaMode='BLEND';json.materials[0].pbrMetallicRoughness.baseColorFactor=[.2,.4,.8,.5];json.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};json.materials[0].extensions={KHR_materials_ior:{ior:1.7}};json.extensionsUsed=['KHR_materials_ior'];
 const input=new TextEncoder().encode(JSON.stringify(json)),result=await compressModelBytes(input);await verifyModelCompression(input,result.bytes);const inspected=await inspectModelDetails(result.bytes,'glb','texture',{meshopt:MeshoptDecoder});expect(inspected.textures[0]).toMatchObject({width:1,height:1,byteSize:png.length});
});
