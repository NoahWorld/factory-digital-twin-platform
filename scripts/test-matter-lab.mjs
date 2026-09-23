// Asset validation only. Visual acceptance is performed in the real browser renderer.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=join(root,'demo-assets/matter-lab');
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json')));
const require=createRequire(join(root,'apps/web/package.json')),T=require('three');
const {GLTFLoader}=await import(pathToFileURL(join(dirname(dirname(require.resolve('three'))),'examples/jsm/loaders/GLTFLoader.js')));
globalThis.self=globalThis;
// Headless structural test: validate embedded PNG headers, not decoded visual appearance.
globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),512);assert.equal(b.readUInt32BE(20),512);return{width:512,height:512,close(){}};};
globalThis.ProgressEvent=class{constructor(type,props){Object.assign(this,{type},props);}};
assert.deepEqual(manifest.modules.map(m=>m.id),['stage','gas','liquid','molten','backdrop']);
const expectedCaptions=JSON.parse(readFileSync(join(root,'scripts/matter-lab-labels.json'))),foundCaptions=[];
const report={simulation:true,models:[]};let meshInstances=0;
for(const m of manifest.modules){
  const bytes=readFileSync(join(dir,m.filename));assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256);
  const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  assert.ok(doc.buffers.every(b=>!b.uri)&&doc.images.every(i=>i.bufferView!==undefined&&!i.uri),'Assets must be self-contained');
  assert.equal(new Set(doc.nodes.map(n=>n.name)).size,doc.nodes.length,'Every node must have a unique name');
  const artworkRoot=doc.nodes.find(n=>n.name===`matter_lab_${m.id}`);assert.ok(artworkRoot,`${m.id}: missing artwork root`);
  assert.ok(Array.isArray(artworkRoot.extras.visibleLabels),`${m.id}: missing visible caption manifest`);foundCaptions.push(...artworkRoot.extras.visibleLabels);
  if(m.id==='backdrop'){assert.equal(m.animationCount,0);assert.equal(doc.images.length,1);assert.ok(doc.materials[0].extensions.KHR_materials_unlit,'Backdrop must retain its authored gradient without scene-light modulation');}
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const mixer=new T.AnimationMixer(gltf.scene);for(const clip of gltf.animations){assert.equal(clip.duration,manifest.duration);mixer.clipAction(clip).setLoop(T.LoopOnce,1).play();}
  const state=()=>{const result=[];gltf.scene.traverse(n=>{result.push(...n.position.toArray(),...n.scale.toArray(),...n.quaternion.toArray(),...(n.morphTargetInfluences??[]));});return result;};
  mixer.setTime(0);const start=state();let moved=false;
  for(let i=1;i<48;i++){mixer.setTime(i*.25);const s=state();assert.ok(s.every(Number.isFinite),`${m.id}: non-finite animated transform`);moved ||= s.some((v,j)=>Math.abs(v-start[j])>1e-4);}
  // Check the stored endpoints themselves, independent of AnimationMixer wrapping.
  for(const clip of gltf.animations)for(const tr of clip.tracks){const stride=tr.getValueSize();for(let k=0;k<stride;k++)assert.ok(Math.abs(tr.values[k]-tr.values[tr.values.length-stride+k])<1e-5,`${m.id}: non-periodic track ${tr.name}`);}
  if(['gas','liquid','molten'].includes(m.id))assert.ok(moved,`${m.id}: no fluid movement`);
  let meshes=0,triangles=0;gltf.scene.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;}});meshInstances+=meshes;
  const entry={module:m.id,sha256:m.sha256,bytes:bytes.length,meshInstances:meshes,triangles,embeddedTextures:doc.images.length,animationChannels:doc.animations?.[0]?.channels.length??0,finite48Samples:true,loopEndpointsEqual:true};report.models.push(entry);console.log(JSON.stringify(entry));mixer.stopAllAction();
}
assert.ok(meshInstances<6000);assert.ok(manifest.modules.reduce((s,m)=>s+m.bytes,0)<150*1024*1024);assert.equal(manifest.settings.playAnimations,true);assert.equal(manifest.settings.showGrid,false);
assert.deepEqual(foundCaptions,expectedCaptions,'All visible exhibit captions must match the authored Chinese labels');
writeFileSync(join(dir,'asset-verification.json'),JSON.stringify(report,null,2)+'\n');console.log('Matter lab: self-contained assets, periodic motion and scene budgets verified.');
