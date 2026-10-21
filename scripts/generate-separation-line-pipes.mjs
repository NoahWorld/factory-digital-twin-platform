// Conceptual connecting pipework for the user's seven-machine scene. Metres, Y-up.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'apps/web/package.json'));
const T = require('three');
const threeRoot = dirname(dirname(require.resolve('three')));
const { GLTFExporter } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/exporters/GLTFExporter.js')));
const { GLTFLoader } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/loaders/GLTFLoader.js')));
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result=result; this.onloadend?.(); }, error=>this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); },error=>this.onerror?.(error)); }
};
const out = join(root,'demo-assets/separation-line'); mkdirSync(out,{recursive:true});
const equipment = [
  ['反应釜 C','反应釜.0a4dc2ba2f25.glb',[-10,0,-5]],
  ['清洗釜 A','清洗釜.7ca44ff8f675.glb',[-5,0,-5]],
  ['清洗釜 B','清洗釜.7ca44ff8f675.glb',[0,0,-5]],
  ['固液分离器 A','固液分离器.8c96d335c9f2.glb',[5,0,-5]],
  ['固液分离器 B','固液分离器.8c96d335c9f2.glb',[10,0,-5]],
  ['分散机 A','分散机.79cb532ac467.glb',[10,0,0]],
  ['分散机 B','分散机.79cb532ac467.glb',[10,0,5]],
].map(([label,filename,position])=>({label,filename,position,rotation:[0,0,0],scale:[1,1,1]}));
// Orthogonal routes keep the floor aisle clear and terminate on schematic process ports.
const routes = [
  [[-10,.44,-3.97],[-10,.44,-3.3],[-7.2,.44,-3.3],[-7.2,2.95,-3.3],[-5.45,2.95,-3.3],[-5.45,2.95,-5.3],[-5.45,2.5,-5.3]],
  [[-5,.3,-4.23],[-5,.3,-3.3],[-2.2,.3,-3.3],[-2.2,2.95,-3.3],[-.45,2.95,-3.3],[-.45,2.95,-5.3],[-.45,2.5,-5.3]],
  [[0,.3,-4.23],[0,.3,-3.3],[2.5,.3,-3.3],[2.5,2.15,-3.3],[6.98,2.15,-3.3],[6.98,2.15,-5],[6.98,1.57,-5]],
  [[4.16,.37,-4.72],[4.16,.18,-4.72],[4.16,.18,-3.3],[8,.18,-3.3],[8,2.15,-3.3],[11.98,2.15,-3.3],[11.98,2.15,-5],[11.98,1.57,-5]],
  [[9.16,.37,-4.72],[9.16,.18,-4.72],[9.16,.18,-2.6],[10.9,.18,-2.6],[10.9,1.65,-2.6],[10.9,1.65,.2],[10.9,1.25,.2]],
  [[10.7,.5,.47],[10.7,.5,1.5],[12,.5,1.5],[12,.5,3],[12,1.65,3],[10.9,1.65,3],[10.9,1.65,5.2],[10.9,1.25,5.2]],
];
const scene=new T.Scene();scene.name='separation_line_pipework';
const steel=new T.MeshStandardMaterial({name:'stainless_pipe',color:'#b8cad2',metalness:.65,roughness:.3});
const teal=new T.MeshStandardMaterial({name:'process_direction',color:'#21aeb2',metalness:.35,roughness:.35});
const dark=new T.MeshStandardMaterial({name:'pipe_support',color:'#324c61',metalness:.5,roughness:.45});
let serial=0;
function mesh(parent,label,geometry,position,material=steel){const m=new T.Mesh(geometry,material);m.name=`pipe_${++serial}`;m.userData={label};m.position.set(...position);parent.add(m);return m;}
function cylinder(parent,label,a,b,r,material=steel){const from=new T.Vector3(...a),to=new T.Vector3(...b),d=to.clone().sub(from);const m=mesh(parent,label,new T.CylinderGeometry(r,r,d.length(),16),from.add(to).multiplyScalar(.5).toArray(),material);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return m;}
function rounded(points){const p=points.map(v=>new T.Vector3(...v)),path=new T.CurvePath();let last=p[0];for(let i=1;i<p.length-1;i++){const a=p[i-1],b=p[i],c=p[i+1];const r=Math.min(.18,b.distanceTo(a)*.3,b.distanceTo(c)*.3);const entry=b.clone().addScaledVector(a.clone().sub(b).normalize(),r),exit=b.clone().addScaledVector(c.clone().sub(b).normalize(),r);path.add(new T.LineCurve3(last,entry));path.add(new T.QuadraticBezierCurve3(entry,b,exit));last=exit;}path.add(new T.LineCurve3(last,p.at(-1)));return path;}
for(const [index,points] of routes.entries()){
  const g=new T.Group();g.name=`connection_${index+1}`;g.userData={label:`${equipment[index].label} → ${equipment[index+1].label}`,schematic:true,from:equipment[index].label,to:equipment[index+1].label};scene.add(g);
  mesh(g,g.userData.label,new T.TubeGeometry(rounded(points),Math.max(90,points.length*22),.055,12,false),[0,0,0]);
  for(const end of [0,points.length-1]){const p=new T.Vector3(...points[end]);const neighbor=new T.Vector3(...points[end===0?1:end-1]);const d=neighbor.sub(p).normalize();cylinder(g,'连接法兰',p.clone().addScaledVector(d,-.015).toArray(),p.clone().addScaledVector(d,.035).toArray(),.105);}
  // One direction arrow and one support on the longest horizontal run of each route.
  const runs=points.slice(1).map((b,i)=>({a:new T.Vector3(...points[i]),b:new T.Vector3(...b)})).filter(({a,b})=>Math.abs(a.y-b.y)<1e-6).sort((l,r)=>r.a.distanceTo(r.b)-l.a.distanceTo(l.b));
  const {a,b}=runs[0],d=b.clone().sub(a).normalize(),middle=a.clone().add(b).multiplyScalar(.5);
  cylinder(g,'流向色环',middle.clone().addScaledVector(d,-.22).toArray(),middle.clone().addScaledVector(d,-.08).toArray(),.065,teal);
  const arrow=mesh(g,'示意流向',new T.ConeGeometry(.115,.24,16),middle.clone().addScaledVector(d,.15).toArray(),teal);arrow.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d);
  if(middle.y>.15){cylinder(g,'管道支撑',[middle.x,.04,middle.z],[middle.x,middle.y-.055,middle.z],.025,dark);mesh(g,'支撑底板',new T.BoxGeometry(.28,.04,.28),[middle.x,.02,middle.z],dark);}
}
scene.updateMatrixWorld(true);
const names=new Set();scene.traverse(o=>{assert(o.name&&!names.has(o.name));names.add(o.name);if(o.isMesh)assert([...o.geometry.attributes.position.array].every(Number.isFinite));});
const bytes=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true}));
const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');let connectionCount=0;loaded.scene.traverse(o=>{if(/^connection_\d+$/.test(o.name))connectionCount++;});assert.equal(connectionCount,6);
const filename='贵金属分离产线-连接管道.glb';writeFileSync(join(out,filename),bytes);
writeFileSync(join(out,'layout.json'),JSON.stringify({projectId:'4f5249c5-44cd-4819-b892-fa8a09748719',unit:'metre',up:'Y',schematic:true,equipment,pipes:{filename,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],routes}},null,2)+'\n');
writeFileSync(join(out,'README.md'),'# 贵金属、重金属分离产线示意\n\n横段依次为反应釜 C、清洗釜 A/B、固液分离器 A/B；右侧竖段为分散机 A/B。设备间距 5 米，Y 轴向上。\n\n管道 GLB 与 layout.json 坐标一致，加入场景后保持位置 (0,0,0)、旋转 (0,0,0)、比例 (1,1,1)。六段管道各有独立节点与流向标识。连接表达布局顺序，不代表已确认的实际工艺接口、压力或管径。\n');
console.log(JSON.stringify({filename,byteSize:bytes.length,routes:6,equipment:equipment.length,bounds:new T.Box3().setFromObject(scene)}));
