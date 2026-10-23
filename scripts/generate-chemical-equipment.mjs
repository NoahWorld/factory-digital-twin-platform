// Original schematic equipment. Metres, Y-up, floor origin; no live data or motion.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'apps/web/package.json'));
const T = require('three');
const threeRoot = dirname(dirname(require.resolve('three')));
const { GLTFExporter } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/exporters/GLTFExporter.js')));
const { GLTFLoader } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/loaders/GLTFLoader.js')));
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }, error => this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }, error => this.onerror?.(error)); }
};
const out = join(root, 'demo-assets/chemical-equipment');
mkdirSync(out, { recursive: true });
const colors = { steel: ['#aab9c3', .73, .29], dark: ['#283744', .6, .43], blue: ['#20678d', .48, .34], teal: ['#187f83', .42, .34], rubber: ['#20252a', .02, .73], brass: ['#bb9550', .7, .31], white: ['#e7eef2', .1, .47], red: ['#c64735', .24, .4], glass: ['#254758', .5, .15] };
const mats = Object.fromEntries(Object.entries(colors).map(([name,[color,metalness,roughness]]) => [name,new T.MeshStandardMaterial({name,color,metalness,roughness})]));
const geoCache = new Map();
function geo(key,build) { if(!geoCache.has(key)) geoCache.set(key,build()); return geoCache.get(key); }
let serial = 0;
function group(parent,name,label,p=[0,0,0],extras={}) { const g = new T.Group(); g.name=name; g.userData={label,...extras}; g.position.set(...p); parent?.add(g); return g; }
function mesh(g,name,geometry,p,mat='steel',rotation=[0,0,0]) { const m = new T.Mesh(geometry,mats[mat]); m.name=`${g.name}_${name}_${++serial}`; m.userData={label:name}; m.position.set(...p); m.rotation.set(...rotation); g.add(m); return m; }
function box(g,n,s,p,m='steel',r) { return mesh(g,n,geo(`b${s}`,()=>new T.BoxGeometry(...s)),p,m,r); }
function cyl(g,n,r,h,p,m='steel',rotation,rt=r) { return mesh(g,n,geo(`c${r},${rt},${h}`,()=>new T.CylinderGeometry(rt,r,h,48)),p,m,rotation); }
function ring(g,n,r,t,p,m='steel',rotation=[Math.PI/2,0,0]) { return mesh(g,n,geo(`r${r},${t}`,()=>new T.TorusGeometry(r,t,10,64)),p,m,rotation); }
function sphere(g,n,s,p,m='steel') { const o=mesh(g,n,geo('sphere',()=>new T.SphereGeometry(1,48,24)),p,m); o.scale.set(...s); return o; }
function tube(g,n,points,r=.035,m='steel') { return mesh(g,n,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),40,r,10,false),[0,0,0],m); }
function line(g,n,a,b,r=.025,m='steel') { const av=new T.Vector3(...a),bv=new T.Vector3(...b),d=bv.clone().sub(av); const o=cyl(g,n,r,d.length(),av.add(bv).multiplyScalar(.5).toArray(),m); o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()); return o; }
function flange(g,p,r=.14,rotation=[0,0,0]) { const f=group(g,`${g.name}_flange_${++serial}`,'螺栓法兰',p); f.rotation.set(...rotation); cyl(f,'法兰盘',r,.045,[0,0,0]); ring(f,'密封垫',r*.8,.01,[0,-.025,0],'rubber'); for(let i=0;i<8;i++){const a=i*Math.PI/4;cyl(f,'螺栓',.014,.064,[Math.cos(a)*r*.79,0,Math.sin(a)*r*.79],'dark');} return f; }
function motor(parent,name,p,scale=1,color='blue') { const m=group(parent,name,'驱动电机',p,{explodeOffset:[0,.6,0]}); m.scale.setScalar(scale); cyl(m,'机身',.22,.46,[0,.26,0],color); for(let i=0;i<12;i++){ const a=i*Math.PI/6;box(m,'散热筋',[.025,.39,.06],[Math.cos(a)*.216,.26,Math.sin(a)*.216],color,[0,-a,0]); } cyl(m,'风扇罩',.23,.1,[0,.54,0],'dark'); cyl(m,'端盖',.24,.06,[0,.015,0],color); box(m,'接线盒',[.20,.19,.19],[.23,.27,0],color); for(let i=-3;i<=3;i++)box(m,'风罩格栅',[.29,.009,.012],[0,.596,i*.038],'steel'); return m; }
function feet(g,points,height) { for(const [i,[x,z]] of points.entries()){ const leg=group(g,`${g.name}_leg_${i}`,'支撑脚'); box(leg,'底板',[.3,.04,.3],[x,.02,z],'dark'); cyl(leg,'立柱',.07,height,[x,height/2+.04,z]); for(const dx of [-.1,.1])cyl(leg,'锚固螺栓',.018,.045,[x+dx,.055,z]); } }
function gauge(g,p) { const a=group(g,`${g.name}_gauge_${++serial}`,'仪表（无实时读数）',p); cyl(a,'表壳',.11,.06,[0,0,0],'dark',[Math.PI/2,0,0]); cyl(a,'空白表盘',.094,.008,[0,0,.034],'white',[Math.PI/2,0,0]); for(let i=0;i<9;i++){const t=Math.PI*.2+i*Math.PI*.075;line(a,'刻度',[Math.cos(t)*.07,Math.sin(t)*.07,.041],[Math.cos(t)*.082,Math.sin(t)*.082,.041],.003,'dark');} line(a,'表接管',[0,-.11,0],[0,-.23,0],.018); }
function handValve(g,p) { const v=group(g,`${g.name}_valve_${++serial}`,'手动阀',p); cyl(v,'阀体',.075,.18,[0,0,0],'brass',[Math.PI/2,0,0]); line(v,'阀杆',[0,0,0],[0,.19,0],.018); ring(v,'阀轮',.13,.015,[0,.20,0],'red'); for(let i=0;i<3;i++){const a=i*Math.PI*2/3;line(v,'阀轮辐条',[0,.2,0],[Math.cos(a)*.13,.2,Math.sin(a)*.13],.009,'red');} }
function badge(g,p,color='blue') { box(g,'设备铭牌',[.3,.14,.014],p,color); for(let i=0;i<3;i++)box(g,'铭牌刻线',[.17-i*.035,.008,.004],[p[0]-.025,p[1]+.036-i*.03,p[2]+.01],'white'); }
function reactor(g) {
 const shell=group(g,'reactor_shell','夹套釜体',[0,0,0],{inspectionShell:true,explodeOffset:[1.5,0,0]});
 cyl(shell,'釜身',.80,1.55,[0,1.90,0]); sphere(shell,'上封头',[.80,.33,.80],[0,2.675,0]); sphere(shell,'下封头',[.80,.34,.80],[0,1.125,0]);
 for(const y of [1.16,2.64]){ ring(shell,'夹套焊缝',.806,.022,[0,y,0]); }
 badge(shell,[0,1.94,.805]); feet(g,[[-.57,-.57],[.57,-.57],[-.57,.57],[.57,.57]],1.24);
 const head=group(g,'reactor_head','顶盖接口',[0,0,0],{explodeOffset:[0,.7,0]});
 cyl(head,'驱动支架',.19,.29,[0,3.05,0],'blue'); flange(head,[0,2.94,0],.25); motor(head,'reactor_motor',[0,3.20,0]);
 cyl(head,'人孔接管',.22,.16,[-.43,2.89,.20]); flange(head,[-.43,2.99,.20],.27); cyl(head,'人孔盖',.245,.035,[-.43,3.03,.20]); line(head,'人孔把手',[-.54,3.10,.2],[-.32,3.10,.2],.016);
 for(const x of [-.48,.48]){cyl(head,'工艺接管',.045,.24,[x,2.95,-.28]);flange(head,[x,3.08,-.28],.095);}
 const rotor=group(g,'reactor_agitator','搅拌轴与桨叶',[0,1.10,0]); cyl(rotor,'搅拌轴',.032,1.95,[0,.97,0]);
 for(const y of [.18,.72])for(let i=0;i<3;i++){const a=i*Math.PI*2/3;box(rotor,'搅拌桨叶',[.50,.07,.13],[Math.cos(a)*.28,y,Math.sin(a)*.28],'steel',[.25,-a,0]);}
 tube(g,'出料管',[[0,.83,0],[0,.51,0],[0,.44,.48],[0,.44,1.0]],.055);handValve(g,[0,.44,.76]);flange(g,[0,.44,1.03],.12,[Math.PI/2,0,0]);
 tube(g,'夹套进口',[[.72,1.35,0],[.99,1.35,0],[1.08,1.55,0],[1.08,1.84,0]],.036);flange(g,[1.08,1.86,0],.095);
 gauge(g,[.43,2.90,.57]);
}
function cleaning(g) {
 const shell=group(g,'cleaning_shell','清洗釜外壳',[0,0,0],{inspectionShell:true,explodeOffset:[-1.5,0,0]});
 cyl(shell,'釜身',.69,1.29,[0,1.72,0]); cyl(shell,'锥形釜底',.12,.40,[0,.875,0],'steel',undefined,.69); sphere(shell,'上封头',[.69,.24,.69],[0,2.365,0]);
 for(const y of [1.075,2.365])ring(shell,'环焊缝',.695,.018,[0,y,0]);badge(shell,[0,1.81,.696],'teal'); feet(g,[[-.5,-.47],[.5,-.47],[-.5,.47],[.5,.47]],1.13);
 cyl(g,'检修人孔',.24,.12,[-.25,2.60,.1]);flange(g,[-.25,2.69,.1],.28);line(g,'盖把手',[-.36,2.76,.1],[-.14,2.76,.1],.016);
 const cip=group(g,'cleaning_spray','清洗喷淋组件',[0,0,0],{explodeOffset:[0,.65,0]});
 tube(cip,'回流主管',[[.30,2.32,0],[.30,2.80,0],[.85,2.91,0],[1.08,2.64,0],[1.08,.54,0]],.042);
 sphere(cip,'喷淋球',[.13,.13,.13],[.30,2.18,0]);for(let i=0;i<12;i++){const a=i*Math.PI/6;sphere(cip,'喷孔',[.012,.012,.012],[.30+Math.cos(a)*.13,2.18,Math.sin(a)*.13],'dark');}
 const skid=group(g,'cleaning_pump','循环泵总成',[1.07,0,0],{explodeOffset:[.7,0,0]});box(skid,'泵底座',[.62,.09,.92],[0,.045,0],'dark'); motor(skid,'cleaning_pump_motor',[0,.39,-.28],.67,'teal').rotation.x=Math.PI/2; cyl(skid,'泵壳',.19,.18,[0,.34,.16],'teal',[Math.PI/2,0,0]);
 tube(g,'排水管',[[0,.66,0],[0,.34,0],[0,.30,.77]],.045);handValve(g,[0,.30,.55]);
 tube(g,'吸入管',[[0,.59,0],[.60,.37,0],[1.07,.34,.30]],.039);
 gauge(g,[1.08,1.27,.08]);flange(g,[1.08,1.60,0],.105);
}
function separator(g) {
 const frame=group(g,'separator_frame','离心机底架'); for(const z of [-.48,.48])box(frame,'底架纵梁',[3.44,.18,.15],[0,.27,z],'blue');for(const x of [-1.5,1.5])box(frame,'横梁',[.16,.18,1.13],[x,.27,0],'blue');feet(frame,[[-1.40,-.47],[1.40,-.47],[-1.40,.47],[1.40,.47]],.22);
 const shell=group(g,'separator_shell','卧式离心机护罩',[0,0,0],{inspectionShell:true,explodeOffset:[0,.9,0]});
 cyl(shell,'圆筒护罩',.43,1.78,[-.19,1.01,0],'steel',[0,0,Math.PI/2]); cyl(shell,'锥段护罩',.25,.70,[1.05,1.01,0],'steel',[0,0,Math.PI/2],.43);
 for(const x of [-1.10,.69]){cyl(shell,'端法兰',.46,.055,[x,1.01,0],'steel',[0,0,Math.PI/2]); for(let i=0;i<12;i++){const a=i*Math.PI/6; cyl(shell,'端盖螺栓',.017,.07,[x,1.01+Math.cos(a)*.42,Math.sin(a)*.42],'dark',[0,0,Math.PI/2]);}}
 for(const x of [-.75,.45]){line(shell,'吊环立柱',[x,1.42,0],[x,1.5,0],.02);ring(shell,'吊环',.06,.015,[x,1.56,0],'dark',[0,0,0]);}
 badge(shell,[-.28,1.03,.44]);
 const rotor=group(g,'separator_rotor','转鼓与螺旋输送器',[-.18,1.01,0]);cyl(rotor,'转轴',.06,2.75,[0,0,0],'steel',[0,0,Math.PI/2]);cyl(rotor,'内转鼓',.30,1.65,[0,0,0],'dark',[0,0,Math.PI/2]);
 const points=[];for(let i=0;i<=200;i++){const a=i/200*Math.PI*12;points.push([-.76+i/200*1.52,Math.cos(a)*.32,Math.sin(a)*.32]);} tube(rotor,'螺旋叶缘',points,.035);
 for(const x of [-1.22,1.42]){box(g,'轴承座',[.25,.26,.52],[x,.56,0],'blue');cyl(g,'轴承',.19,.26,[x,.87,0],'blue',[0,0,Math.PI/2]);}
 const drive=motor(g,'separator_motor',[-1.44,.69,-.65],.9);drive.rotation.z=-Math.PI/2;box(g,'传动防护罩',[.18,.70,.90],[-1.48,.96,-.28],'blue');
 tube(g,'进料管',[[1.40,1.01,0],[1.80,1.01,0],[1.98,1.23,0],[1.98,1.56,0]],.043);flange(g,[1.98,1.57,0],.11);
 box(g,'固相落料斗',[.43,.22,.38],[1.07,.57,0]);cyl(g,'液相排出口',.09,.30,[-.84,.52,.28]);
}
function disperser(g) {
 box(g,'底座',[2.15,.14,1.40],[0,.07,0],'dark');
 const mast=group(g,'disperser_mast','升降立柱',[-.69,0,0]);cyl(mast,'液压缸筒',.18,1.65,[0,.96,0],'blue');cyl(mast,'升降杆',.10,1.12,[0,2.05,0]);box(mast,'导向柱',[.13,2.45,.13],[-.24,1.37,0],'dark');
 const head=group(g,'disperser_head','升降机头',[0,0,0],{explodeOffset:[0,.5,0]});box(head,'横臂',[1.62,.24,.44],[.03,2.63,0],'blue');cyl(head,'前轴承座',.16,.25,[.70,2.41,0],'blue');motor(head,'disperser_motor',[-.65,2.77,0],.85);box(head,'皮带防护盖',[1.69,.15,.48],[.03,2.82,0],'dark');
 const shaft=group(head,'disperser_shaft','分散轴与齿盘',[.70,.65,0]);cyl(shaft,'高速轴',.028,1.84,[0,.92,0]);cyl(shaft,'分散盘',.25,.025,[0,0,0]);for(let i=0;i<20;i++){const a=i*Math.PI/10;box(shaft,'锯齿',[.07,.065,.025],[Math.cos(a)*.24,i%2?.025:-.025,Math.sin(a)*.24],'steel',[0,-a,0]);}
 const vessel=group(g,'disperser_vessel','敞口分散桶',[.70,0,0],{inspectionShell:true,explodeOffset:[1.4,0,0]});
 const profile=[[0,.27],[.43,.27],[.48,.32],[.48,1.35],[.455,1.35],[.455,.34],[.42,.31],[0,.31]].map(p=>new T.Vector2(...p));mesh(vessel,'双壁敞口桶',new T.LatheGeometry(profile,64),[0,0,0]);ring(vessel,'桶口卷边',.47,.019,[0,1.35,0]);feet(vessel,[[-.32,-.27],[.32,-.27],[-.32,.27],[.32,.27]],.25);badge(vessel,[0,.85,.48]);
 for(const z of [-.49,.49]){line(vessel,'桶侧把手',[-.1,1.12,z],[.1,1.12,z],.018);}
 const panel=group(g,'disperser_panel','设备控制箱',[-.86,1.17,.45]);box(panel,'控制箱',[.37,.46,.18],[0,0,0],'blue');box(panel,'显示屏（无读数）',[.25,.14,.012],[0,.08,.097],'glass');for(const [x,c] of [[-.09,'teal'],[.09,'red']])cyl(panel,'按钮',.03,.018,[x,-.10,.105],c,[Math.PI/2,0,0]);
 tube(g,'液压软管',[[-.84,.25,-.16],[-1.01,.41,-.25],[-.99,1.53,-.22],[-.69,1.77,-.10]],.023,'rubber');
}
const defs=[['reactor','反应釜',reactor,'立式夹套搅拌釜'],['cleaning-vessel','清洗釜',cleaning,'带循环泵与喷淋组件的立式清洗釜'],['solid-liquid-separator','固液分离器',separator,'卧式螺旋离心分离机示意'],['disperser','分散机',disperser,'液压升降式高速分散机与敞口桶']];
const manifest=[];
for(const [id,name,build,description] of defs){
 serial=0;const scene=new T.Scene();scene.name=`${id}_scene`;const g=group(scene,id,name);build(g);scene.updateMatrixWorld(true);
 const names=new Set();let triangles=0;scene.traverse(o=>{assert(o.name&&!names.has(o.name),`Duplicate/empty node ${o.name}`);names.add(o.name);if(o.isMesh){const pos=o.geometry.getAttribute('position');assert([...pos.array].every(Number.isFinite),`Invalid vertex ${o.name}`);triangles+=(o.geometry.index?.count??pos.count)/3;}});
 const bounds=new T.Box3().setFromObject(g);assert(Math.abs(bounds.min.y)<1e-5,`Floor origin ${id}: ${bounds.min.y}`);
 const bytes=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true}));
 const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString().trim());assert(!doc.buffers.some(b=>b.uri),'External buffer');assert(!doc.images?.length,'Unexpected texture');
 const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');assert(loaded.scene.children.length===1,'Reload failed');
 const sha256=createHash('sha256').update(bytes).digest('hex');const filename=`${name}.${sha256.slice(0,12)}.glb`;const path=join(out,filename);if(existsSync(path))assert(readFileSync(path).equals(bytes));else writeFileSync(path,bytes);
 const record={id,name,description,filename,sha256,byteSize:bytes.length,triangles,nodeCount:doc.nodes.length,meshCount:doc.meshes.length,dimensionsM:bounds.getSize(new T.Vector3()).toArray().map(v=>+v.toFixed(3)),unit:'metre',up:'Y',simulation:true,animations:0};manifest.push(record);console.log(JSON.stringify(record));
}
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
