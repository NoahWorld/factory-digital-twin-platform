// Photo-led schematic equipment and workshop. Metres, Y-up; explicitly simulated agitators.
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
const { mergeGeometries } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/utils/BufferGeometryUtils.js')));
const { GLTFLoader } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/loaders/GLTFLoader.js')));
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }, error => this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }, error => this.onerror?.(error)); }
};
const out = join(root, 'demo-assets/silver-nitrate-workshop/models');
mkdirSync(out, { recursive: true });
const colors = { steel: ['#aab9c3', .73, .29], dark: ['#283744', .6, .43], blue: ['#20678d', .48, .34], teal: ['#187f83', .42, .34], rubber: ['#20252a', .02, .73], brass: ['#bb9550', .7, .31], white: ['#e7eef2', .1, .47], red: ['#c64735', .24, .4], glass: ['#254758', .5, .15] };
const mats = Object.fromEntries(Object.entries(colors).map(([name,[color,metalness,roughness]]) => [name,new T.MeshStandardMaterial({name,color,metalness,roughness})]));
const geoCache = new Map();
function geo(key,build) { if(!geoCache.has(key)) geoCache.set(key,build()); return geoCache.get(key); }
let serial = 0;
function group(parent,name,label,p=[0,0,0],extras={}) { const g = new T.Group(); g.name=name; g.userData={label,...extras}; g.position.set(...p); parent?.add(g); return g; }
function mesh(g,name,geometry,p,mat='steel',rotation=[0,0,0]) { const m = new T.Mesh(geometry,mats[mat]); m.name=`${g.name}_${name}_${++serial}`; m.userData={label:name}; m.position.set(...p); m.rotation.set(...rotation); g.add(m); return m; }
function box(g,n,s,p,m='steel',r) { return mesh(g,n,geo(`b${s}`,()=>new T.BoxGeometry(...s)),p,m,r); }
function cyl(g,n,r,h,p,m='steel',rotation,rt=r) { return mesh(g,n,geo(`c${r},${rt},${h}`,()=>new T.CylinderGeometry(rt,r,h,32)),p,m,rotation); }
function ring(g,n,r,t,p,m='steel',rotation=[Math.PI/2,0,0]) { return mesh(g,n,geo(`r${r},${t}`,()=>new T.TorusGeometry(r,t,10,64)),p,m,rotation); }
function sphere(g,n,s,p,m='steel') { const o=mesh(g,n,geo('sphere',()=>new T.SphereGeometry(1,32,16)),p,m); o.scale.set(...s); return o; }
function tube(g,n,points,r=.035,m='steel') { return mesh(g,n,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),40,r,10,false),[0,0,0],m); }
function line(g,n,a,b,r=.025,m='steel') { const av=new T.Vector3(...a),bv=new T.Vector3(...b),d=bv.clone().sub(av); const o=cyl(g,n,r,d.length(),av.add(bv).multiplyScalar(.5).toArray(),m); o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()); return o; }
function flange(g,p,r=.14,rotation=[0,0,0]) { const f=group(g,`${g.name}_flange_${++serial}`,'螺栓法兰',p); f.rotation.set(...rotation); cyl(f,'法兰盘',r,.045,[0,0,0]); ring(f,'密封垫',r*.8,.01,[0,-.025,0],'rubber'); for(let i=0;i<8;i++){const a=i*Math.PI/4;cyl(f,'螺栓',.014,.064,[Math.cos(a)*r*.79,0,Math.sin(a)*r*.79],'dark');} return f; }
function motor(parent,name,p,scale=1,color='blue') { const m=group(parent,name,'驱动电机',p,{explodeOffset:[0,.6,0]}); m.scale.setScalar(scale); cyl(m,'机身',.22,.46,[0,.26,0],color); for(let i=0;i<12;i++){ const a=i*Math.PI/6;box(m,'散热筋',[.025,.39,.06],[Math.cos(a)*.216,.26,Math.sin(a)*.216],color,[0,-a,0]); } cyl(m,'风扇罩',.23,.1,[0,.54,0],'dark'); cyl(m,'端盖',.24,.06,[0,.015,0],color); box(m,'接线盒',[.20,.19,.19],[.23,.27,0],color); for(let i=-3;i<=3;i++)box(m,'风罩格栅',[.29,.009,.012],[0,.596,i*.038],'steel'); return m; }
function feet(g,points,height) { for(const [i,[x,z]] of points.entries()){ const leg=group(g,`${g.name}_leg_${i}`,'支撑脚'); box(leg,'底板',[.3,.04,.3],[x,.02,z],'dark'); cyl(leg,'立柱',.07,height,[x,height/2+.04,z]); for(const dx of [-.1,.1])cyl(leg,'锚固螺栓',.018,.045,[x+dx,.055,z]); } }
function gauge(g,p) { const a=group(g,`${g.name}_gauge_${++serial}`,'仪表（无实时读数）',p); cyl(a,'表壳',.11,.06,[0,0,0],'dark',[Math.PI/2,0,0]); cyl(a,'空白表盘',.094,.008,[0,0,.034],'white',[Math.PI/2,0,0]); for(let i=0;i<9;i++){const t=Math.PI*.2+i*Math.PI*.075;line(a,'刻度',[Math.cos(t)*.07,Math.sin(t)*.07,.041],[Math.cos(t)*.082,Math.sin(t)*.082,.041],.003,'dark');} line(a,'表接管',[0,-.11,0],[0,-.23,0],.018); }
function handValve(g,p) { const v=group(g,`${g.name}_valve_${++serial}`,'手动阀',p); cyl(v,'阀体',.075,.18,[0,0,0],'brass',[Math.PI/2,0,0]); line(v,'阀杆',[0,0,0],[0,.19,0],.018); ring(v,'阀轮',.13,.015,[0,.20,0],'red'); for(let i=0;i<3;i++){const a=i*Math.PI*2/3;line(v,'阀轮辐条',[0,.2,0],[Math.cos(a)*.13,.2,Math.sin(a)*.13],.009,'red');} }
function badge(g,p,color='blue') { box(g,'设备铭牌',[.3,.14,.014],p,color); for(let i=0;i<3;i++)box(g,'铭牌刻线',[.17-i*.035,.008,.004],[p[0]-.025,p[1]+.036-i*.03,p[2]+.01],'white'); }
// Photo-led approximations; dimensions and hidden internals are illustrative, not surveyed.
mats.fluid=new T.MeshStandardMaterial({name:'simulation_liquid',color:'#21a8b0',transparent:true,opacity:.42,metalness:.15,roughness:.3});
mats.cut=new T.MeshStandardMaterial({name:'cutaway_edge',color:'#49d5e2',metalness:.5,roughness:.25});
mats.floor=new T.MeshStandardMaterial({name:'epoxy_floor',color:'#1d3741',roughness:.7});
mats.wall=new T.MeshStandardMaterial({name:'wall',color:'#253b4b',roughness:.7});
const manifest=[];
function agitator(g,r,base,top){
 const rotor=group(g,'agitator_rotor','搅拌转子（演示）',[0,base,0]);
 cyl(rotor,'轴',.035,top-base,[0,(top-base)/2,0]);
 for(const y of [.25,.8])for(let i=0;i<3;i++){let a=i*2*Math.PI/3;box(rotor,'斜桨',[r*.72,.07,.16],[Math.cos(a)*r*.35,y,Math.sin(a)*r*.35],'cut',[.35,-a,0]);}
 // Exposed coupling is also visibly animated when viewed from above.
 box(rotor,'联轴器标记',[.18,.09,.08],[.08,top-base-.12,0],'brass');
 const times=[0,1,2,3,4]; const values=times.flatMap(t=>new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),t*Math.PI/2).toArray());
 return new T.AnimationClip('Agitator_demo_15rpm',4,[new T.QuaternionKeyframeTrack('agitator_rotor.quaternion',times,values)]);
}
function vessel(g,{r=.9,h=1.65,motorized=true,flat=false,cut=true}={}){
 const bottom=.65,center=bottom+h/2,top=bottom+h;
 const shell=group(g,'vessel_shell','不锈钢罐体');
 // Missing front sector deliberately represents an inspection cutaway, not a transparent real tank.
 mesh(shell,'罐体',new T.CylinderGeometry(r,r,h,48,1,true,cut?.65:0,cut?Math.PI*2-1.3:Math.PI*2),[0,center,0]);
 sphere(shell,'下封头',[r,.22,r],[0,bottom,0]);
 if(flat)cyl(shell,'平盖',r,.07,[0,top,0]);else sphere(shell,'上封头',[r,.27,r],[0,top,0]);
 for(const y of [bottom,top])ring(shell,'焊缝',r,.018,[0,y,0]);
 feet(g,[[-r*.66,-r*.66],[r*.66,-r*.66],[-r*.66,r*.66],[r*.66,r*.66]],.82);
 if(cut){for(const a of [.65,Math.PI*2-.65])line(g,'剖视边缘',[Math.sin(a)*r,bottom,Math.cos(a)*r],[Math.sin(a)*r,top,Math.cos(a)*r],.02,'cut');cyl(g,'演示液位',r*.9,.75,[0,bottom+.4,0],'fluid');}
 cyl(g,'人孔',.23,.10,[-r*.4,top+.25,.20]);flange(g,[-r*.4,top+.33,.20],.28);line(g,'人孔提手',[-r*.5,top+.42,.2],[-r*.3,top+.42,.2],.016);
 if(flat)for(const x of [-.48,.48]){box(g,'盖把手',[.035,.12,.28],[x,top+.10,.17]);}
 for(const x of [-.45,.45]){cyl(g,'顶部工艺口',.06,.28,[x,top+.33,-.30]);flange(g,[x,top+.49,-.30],.13);}
 // Standard inlet and outlet ports, used by all scene routing definitions.
 line(g,'侧面进口',[-r,top-.35,0],[-1.25,top-.35,0],.065);flange(g,[-1.25,top-.35,0],.12,[0,0,Math.PI/2]);
 line(g,'出料管',[0,.45,0],[1.25,.45,0],.065);flange(g,[1.25,.45,0],.12,[0,0,Math.PI/2]);
 gauge(g,[r*.5,top+.28,.44]);badge(g,[-r*.8,center,r*.6]);
 if(motorized){cyl(g,'电机支架',.13,.35,[0,top+.42,0],'blue');motor(g,'drive_motor',[0,top+.63,0],.8);return [agitator(g,r,bottom,top+.65)];}
 return [];
}
function condenser(g){
 feet(g,[[-.6,-.5],[.6,-.5],[-.6,.5],[.6,.5]],1.0);
 cyl(g,'立式换热筒',.48,2.5,[0,2.1,0]);for(const y of [.83,3.37])flange(g,[0,y,0],.56);
 cyl(g,'锥形底盖',.22,.35,[0,.65,0],'steel',undefined,.48);cyl(g,'端盖',.48,.18,[0,3.5,0]);
 for(const y of [1.2,3.0]){line(g,'冷却接管',[-.48,y,0],[-.8,y,0],.06);flange(g,[-.8,y,0],.13,[0,0,Math.PI/2]);}
 line(g,'蒸气入口',[0,3.6,0],[0,3.85,0],.08);flange(g,[0,3.85,0],.15);line(g,'冷凝液出口',[0,.48,0],[0,.25,0],.07);badge(g,[0,2.2,.49]);return [];
}
function pump(g){box(g,'泵底座',[1.3,.12,.7],[0,.06,0],'dark');motor(g,'pump_motor',[-.35,.4,0],.8).rotation.z=-Math.PI/2;cyl(g,'泵壳',.25,.24,[.33,.4,0],'teal',[0,0,Math.PI/2]);line(g,'进口',[.45,.4,0],[.75,.4,0],.07);line(g,'出口',[.30,.52,0],[.30,.85,0],.07);flange(g,[.3,.85,0],.13);return [];}
const positions={neutral:[-6,0,1.8],evaporator:[-2,0,1.8],crystallizer:[2.2,0,1.8],separator:[6.3,0,1.8],condenser:[-1.4,0,-2.4],collector:[3.2,0,-2.4],pump:[-4.25,0,-.2],returnpump:[6.3,0,-1.2]};
const routes=[
 {id:'feed',label:'上游 R10103B → 中和罐',color:'#5bdcc5',points:[[-8,.45,1.8],[-7.25,.45,1.8],[-7.25,1.95,1.8]]},
 {id:'n-e',label:'中和 → 蒸发',color:'#4ddbc2',points:[[-4.75,.45,1.8],[-4.1,.45,1.8],[-4.1,1.95,1.8],[-3.25,1.95,1.8]]},
 {id:'e-c',label:'蒸发 → 结晶',color:'#4ddbc2',points:[[-.75,.45,1.8],[.1,.45,1.8],[.1,2.15,1.8],[.95,2.15,1.8]]},
 {id:'c-s',label:'结晶 → 固液分离',color:'#4ddbc2',points:[[3.45,.45,1.8],[4.35,.45,1.8],[4.35,1.5,1.8],[5.05,1.5,1.8]]},
 {id:'vapor',label:'蒸发冷凝支路（结构示意）',color:'#f3c478',points:[[-1.55,2.79,1.5],[-1.55,4.1,1.5],[-1.4,4.1,-2.4],[-1.4,3.85,-2.4]]},
 {id:'condensate',label:'冷凝器 → 收集罐',color:'#8fc9ff',points:[[-1.4,.25,-2.4],[.5,.25,-2.4],[.5,1.8,-2.4],[1.95,1.8,-2.4]]},
 {id:'cooling',label:'7℃水 → 结晶夹套',color:'#72a7ff',points:[[7.8,3.8,-4.2],[2.9,3.8,-4.2],[2.9,1.2,-4.2],[2.9,1.2,1.8]]},
 {id:'return',label:'母液回流 → R10103B',color:'#d19df5',points:[[7.55,.45,1.8],[7.9,.45,1.8],[7.9,.45,-1.2],[7.05,.45,-1.2]]},
 {id:'heat-in',label:'蒸发夹套 → P10206B',color:'#f3a578',points:[[-2,.9,1],[-2,.4,-.2],[-3.5,.4,-.2]]},
 {id:'heat-out',label:'P10206B → 蒸发夹套',color:'#f3a578',points:[[-3.95,.85,-.2],[-3.95,1.3,-1],[-2.7,1.3,-1],[-2.7,1.3,1.8]]},
 {id:'return-out',label:'P10201 → 上游 R10103B',color:'#d19df5',points:[[6.6,.85,-1.2],[7.8,.85,-1.2],[7.8,.85,-4.7]]},
 {id:'di-water',label:'去离子水 → 中和罐',color:'#72a7ff',points:[[-8,4.05,-4.5],[-6,4.05,-4.5],[-6,3.7,1.8],[-6.45,3.7,1.5],[-6.45,2.8,1.5]]},
 {id:'vacuum',label:'收集罐 → 真空／脱酸塔接口',color:'#a9bed4',points:[[3.65,2.65,-2.7],[3.65,4.3,-2.7],[3.65,4.3,-4.7]]},
 {id:'collect-out',label:'冷凝液 → V10204',color:'#8fc9ff',points:[[4.45,.45,-2.4],[5.2,.45,-2.4],[5.2,.45,-4.7]]}
];
function workshop(g){
 // Open-front workshop: the equipment and every process route stay untouched.
 mats.floor=new T.MeshStandardMaterial({name:'sealed_concrete',color:'#34424b',metalness:.16,roughness:.57});
 mats.wall=new T.MeshStandardMaterial({name:'steel_wall_panels',color:'#263842',metalness:.32,roughness:.6});
 mats.joint=new T.MeshStandardMaterial({name:'floor_joints',color:'#202e36',roughness:.8});
 mats.safety=new T.MeshStandardMaterial({name:'safety_yellow',color:'#c99e35',metalness:.3,roughness:.46});
 mats.light=new T.MeshStandardMaterial({name:'diffused_workshop_light',color:'#dcecf5',emissive:'#aecbdf',emissiveIntensity:1.35,roughness:.35});
 mats.panel=new T.MeshStandardMaterial({name:'wall_panel_alternate',color:'#2c3e47',metalness:.3,roughness:.55});
 // 28 × 20 m, three structural bays. Front/left walls and roof skin are cut away for inspection.
 box(g,'密封混凝土地坪',[28,.16,20],[0,-.08,-1],'floor');
 const paint=(name,w,d,x,z,material)=>mesh(g,name,new T.PlaneGeometry(w,d),[x,.004,z],material,[-Math.PI/2,0,0]);
 for(let x=-14;x<=14;x+=3.5)paint('地坪伸缩缝',.018,20,x,-1,'joint');
 for(let z=-11;z<=9;z+=2.5)paint('地坪伸缩缝',28,.018,0,z,'joint');
 for(let i=0;i<14;i++){
  const x=-13+i*2;
  box(g,'后墙金属墙板',[1.98,6.4,.12],[x,3.2,-10.7],i%2?'panel':'wall');
  box(g,'墙板竖缝',[.025,6.4,.035],[x-.99,3.2,-10.61],'dark');
 }
 // The far side continues all the way to the front aisle, making the room's depth readable.
 for(let i=0;i<10;i++){
  const z=-10+i*2;
  box(g,'侧墙金属墙板',[.12,6.4,1.98],[13.7,3.2,z],i%2?'panel':'wall');
  box(g,'侧墙竖缝',[.035,6.4,.025],[13.61,3.2,z-.99],'dark');
 }
 box(g,'后墙防腐踢脚',[28,.3,.10],[0,.15,-10.58],'dark');
 box(g,'侧墙防腐踢脚',[.10,.3,20],[13.58,.15,-1],'dark');
 const column=(x,z)=>{
  box(g,'钢柱腹板',[.12,6.4,.30],[x,3.2,z],'dark');
  for(const dz of [-.17,.17])box(g,'钢柱翼缘',[.38,6.4,.045],[x,3.2,z+dz],'steel');
  box(g,'柱脚底板',[.55,.065,.58],[x,.033,z],'dark');
  for(const dx of [-.21,.21])for(const dz of [-.22,.22])cyl(g,'柱脚螺栓',.028,.1,[x+dx,.08,z+dz]);
  box(g,'防撞护脚',[.40,.45,.39],[x,.24,z],'safety');
 };
 for(const x of [-13.4,-6.7,0,6.7,13.4])column(x,-10.35);
 for(const z of [-4.2,2.0,8.2])column(13.4,z);
 // Camera-side structure is retained only behind the equipment, keeping the cutaway unobstructed.
 column(-13.4,-4.2);
 for(const y of [2.8,5.0,6.25]){
  box(g,'后墙水平梁',[27,.16,.22],[0,y,-10.35],'dark');
  box(g,'侧墙水平梁',[.22,.16,18.6],[13.4,y,-1.1],'dark');
 }
 for(const x of [-10,10]){
  line(g,'墙体斜撑',[x-2.8,.45,-10.3],[x+2.8,2.7,-10.3],.04,'steel');
  line(g,'墙体斜撑',[x+2.8,.45,-10.3],[x-2.8,2.7,-10.3],.04,'steel');
 }
 // Two open roof trusses and longitudinal ties establish a full-height chemical workshop.
 for(const z of [-10.35,-4.2]){
  for(const y of [5.85,6.35])box(g,'屋架弦杆',[26.8,.11,.13],[0,y,z],'dark');
  for(let x=-13.4;x<13.3;x+=1.675){
   line(g,'屋架斜腹杆',[x,5.85,z],[x+1.675,6.35,z],.025,'steel');
   line(g,'屋架竖腹杆',[x,5.85,z],[x,6.35,z],.025,'steel');
  }
 }
 for(const x of [-13.4,-6.7,0,6.7,13.4])box(g,'屋面纵向系杆',[.10,.13,6.15],[x,6.35,-7.275],'dark');
 for(const x of [-10,-5,0,5,10]){
  box(g,'后墙高窗框',[3.8,1.1,.09],[x,4.18,-10.56],'dark');
  box(g,'后墙高窗玻璃',[3.64,.94,.035],[x,4.18,-10.49],'glass');
  for(const dx of [-.9,0,.9])box(g,'后墙窗竖梃',[.035,1.0,.05],[x+dx,4.18,-10.45],'steel');
 }
 for(const z of [-7,-1,5]){
  box(g,'侧墙高窗框',[.09,1.1,3.8],[13.56,4.18,z],'dark');
  box(g,'侧墙高窗玻璃',[.035,.94,3.64],[13.49,4.18,z],'glass');
  for(const dz of [-.9,0,.9])box(g,'侧墙窗竖梃',[.05,1,.035],[13.45,4.18,z+dz],'steel');
 }
 // Rear service aisle, ventilation trunk and inspection cabinets are building fittings.
 for(const z of [-8.3,-6.1,6.8])paint('检修通道标线',25,.07,0,z,'safety');
 for(const x of [-10.2,10.2])paint('纵向检修标线',.07,14,x,-.7,'safety');
 box(g,'高位通风干管',[25,.48,.52],[0,5.45,-9.95],'steel');
 for(const x of [-9,-3,3,9]){
  box(g,'送风支管',[.36,.32,1.3],[x,5.38,-9.1],'steel');
  box(g,'送风口',[.60,.40,.08],[x,5.35,-8.44],'dark');
  for(let y=5.2;y<5.52;y+=.07)box(g,'风口百叶',[.52,.022,.05],[x,y,-8.38],'steel');
 }
 for(const x of [-9,-3,3,9])for(const z of [-7.4,5.5]){
  for(const dx of [-.8,.8])line(g,'吊灯拉杆',[x+dx,5.9,z],[x+dx,5.25,z],.012,'steel');
  box(g,'通道条形灯壳',[2.0,.12,.22],[x,5.2,z],'dark');
  box(g,'通道条形灯罩',[1.87,.035,.18],[x,5.12,z],'light');
 }
 // Utilities continue along the rear wall and feed the original process rack.
 for(const [i,m] of ['blue','teal','steel'].entries()){
  const y=3.8+i*.25;
  line(g,'后墙公用总管',[-12,y,-9.5],[12,y,-9.5],.07,m);
  line(g,'公用总管转接',[-8,y,-9.5],[-8,y,-4.5],.07,m);
 }
 for(const x of [-11.8,-10.6,-9.4]){
  box(g,'配电柜',[1.0,2.0,.55],[x,1.06,-10.1],'steel');
  box(g,'配电柜底座',[1.08,.12,.62],[x,.06,-10.1],'dark');
  box(g,'配电柜门',[.87,1.81,.02],[x,1.08,-9.81],'panel');
  box(g,'配电柜仪表',[.25,.18,.03],[x,1.6,-9.78],'glass');
  line(g,'柜门拉手',[x+.29,.9,-9.76],[x+.29,1.12,-9.76],.015,'steel');
 }
 // Emergency wash station at the side of the maintenance aisle; no logistics props.
 line(g,'冲淋立管',[-11.5,0,-5.3],[-11.5,2.65,-5.3],.04,'teal');
 line(g,'冲淋横管',[-11.5,2.65,-5.3],[-11.5,2.65,-4.8],.04,'teal');
 cyl(g,'冲淋喷头',.2,.08,[-11.5,2.57,-4.8],'steel');
 cyl(g,'洗眼盆',.25,.10,[-11.5,1.1,-5.0],'steel');
 line(g,'洗眼支管',[-11.5,1.0,-5.3],[-11.5,1.0,-5.0],.03,'teal');
 paint('冲淋站边线',1.3,.07,-11.5,-4.2,'safety');
 // Service pipe rack, saddles and cable trays; no roof blocks the cutaway view.
 for(const x of [-7,0,7]){
  box(g,'管廊立柱',[.12,4.4,.12],[x,2.2,-4.6],'dark');
  box(g,'管廊横担',[.18,.10,1.3],[x,3.7,-4.3],'steel');
  line(g,'管廊斜撑',[x,3.1,-4.6],[x,3.7,-3.75],.035,'steel');
 }
 for(const [y,m,z] of [[3.8,'blue',-4.5],[4.05,'teal',-4.5],[4.3,'steel',-4.5]]){
  line(g,'公用管廊',[-8,y,z],[8,y,z],.07,m);
  for(const x of [-7,-3.5,0,3.5,7]){ring(g,'管路抱箍',.08,.012,[x,y,z],'steel',[0,Math.PI/2,0]);}
 }
 for(const z of [-4.12,-3.8])box(g,'桥架边梁',[16,.15,.035],[0,3.97,z],'dark');
 for(let x=-7.9;x<=8;x+=.4)box(g,'桥架横档',[.04,.035,.32],[x,3.91,-3.96],'steel');
 for(const z of [-4.04,-3.94,-3.86])line(g,'桥架电缆',[-8,3.96,z],[8,3.96,z],.017,'rubber');
 for(const x of [-6,-2,2,6]){
  box(g,'灯具安装支架',[.05,.13,.65],[x,4.27,-4.55],'dark');
  box(g,'工业条形灯外壳',[1.8,.12,.20],[x,4.18,-4.2],'dark');
  box(g,'条形灯扩散罩',[1.65,.04,.16],[x,4.10,-4.2],'light');
 }
 // Chemical process boundaries, drain gratings and clear maintenance aisle.
 box(g,'通道标线',[16.8,.008,.065],[0,.01,4.35],'safety');
 for(const x of [-8.4,8.4])box(g,'通道端线',[.065,.008,1.05],[x,.01,3.85],'safety');
 box(g,'集液沟',[16.8,.04,.32],[0,.02,3.7],'dark');
 for(let x=-8.35;x<=8.4;x+=.16)box(g,'排水格栅',[.025,.025,.29],[x,.05,3.7],'steel');
 for(const z of [-3.5,3.3])box(g,'围堰',[16.8,.12,.10],[0,.06,z],'safety');
 for(const x of [-6,-2,2.2,6.3]){
  for(const dx of [-1.35,1.35])box(g,'设备区端线',[.04,.006,2.5],[x+dx,.008,1.8],'safety');
  box(g,'设备区后线',[2.7,.006,.04],[x,.008,.55],'safety');
 }
 // Existing process geometry and valves remain at their original coordinates.
 for(const rt of routes){const mat=new T.MeshStandardMaterial({name:rt.id,color:rt.color,metalness:.35,roughness:.3,transparent:true,opacity:.28});mats[rt.id]=mat;for(let i=1;i<rt.points.length;i++)line(g,rt.id,rt.points[i-1],rt.points[i],.10,rt.id);for(const p of rt.points.slice(1,-1))sphere(g,'弯头',[.105,.105,.105],p,rt.id);}
 for(const p of [[-4.1,1.95,1.8],[.1,2.15,1.8],[4.35,1.5,1.8],[5.2,.45,-2.4]])handValve(g,p);
 // Local control cabinet with panel seams, ventilation and cable conduit.
 box(g,'仪表柜底座',[1.0,.12,.55],[-6.8,.06,-3.6],'dark');
 box(g,'仪表柜',[.9,1.75,.45],[-6.8,.995,-3.6],'steel');
 box(g,'柜门缝',[.012,1.58,.008],[-6.41,1.0,-3.369],'dark');
 box(g,'HMI显示屏',[.55,.35,.03],[-6.8,1.42,-3.36],'glass');
 box(g,'屏幕状态条',[.38,.03,.01],[-6.8,1.45,-3.338],'teal');
 for(const [x,c] of [[-6.98,'teal'],[-6.65,'red']])cyl(g,'控制按钮',.04,.03,[x,1.07,-3.34],c,[Math.PI/2,0,0]);
 for(let y=.35;y<.7;y+=.07)box(g,'电柜通风缝',[.55,.018,.012],[-6.8,y,-3.365],'dark');
 line(g,'电缆导管',[-6.8,1.88,-3.6],[-6.8,3.95,-3.6],.025,'steel');
 line(g,'导管转弯',[-6.8,3.95,-3.6],[-6.8,3.95,-3.96],.025,'steel');
 box(g,'壁挂接线箱',[.55,.7,.22],[5.85,.95,-10.45],'steel');
 for(const dx of [-.16,.16])line(g,'电气穿线管',[5.85+dx,1.3,-10.42],[5.85+dx,3.92,-10.42],.018,'steel');
 // Expanded grated service platform behind the evaporator; preserve access.
 box(g,'检修平台框架',[2.5,.12,1.05],[-2.0,1.08,-.35],'dark');
 for(let x=-3.2;x<-0.75;x+=.12)box(g,'平台格栅',[.025,.035,.98],[x,1.16,-.35],'steel');
 for(const x of [-3.2,-.8])for(const z of [-.82,.12])line(g,'平台立柱',[x,0,z],[x,1.12,z],.04,'dark');
 for(const x of [-3.2,-2,-.8])line(g,'平台护栏立柱',[x,1.15,-.85],[x,2.16,-.85],.035,'safety');
 for(const y of [1.65,2.16])line(g,'平台后护栏',[-3.2,y,-.85],[-.8,y,-.85],.035,'safety');
 for(const x of [-3.2,-.8])for(const y of [1.65,2.16])line(g,'平台侧护栏',[x,y,-.85],[x,y,.12],.035,'safety');
 for(let i=0;i<5;i++){
  const z=1.45-i*.26,y=.15+i*.22;
  box(g,'防滑踏步',[.65,.08,.25],[-3.65,y,z],'steel');
  box(g,'踏步黄色鼻口',[.65,.015,.025],[-3.65,y+.048,z+.115],'safety');
 }
 for(const x of [-4.0,-3.3]){
  line(g,'楼梯斜梁',[x,.08,1.6],[x,1.1,.18],.045,'dark');
  line(g,'楼梯扶手',[x,1.0,1.6],[x,2.05,.18],.035,'safety');
  for(const [y,z] of [[.15,1.5],[1.05,.25]])line(g,'扶手立杆',[x,y,z],[x,y+.95,z],.03,'safety');
 }
 // Fire cabinet belongs to the building, not the production equipment inventory.
 box(g,'消防箱',[.55,.95,.22],[7.6,.78,-10.43],'red');
 box(g,'消防箱面板',[.42,.70,.015],[7.6,.8,-10.305],'dark');
 for(const x of [7.5,7.7]){cyl(g,'灭火器',.055,.40,[x,.72,-10.28],'red');line(g,'灭火器提把',[x-.04,.95,-10.28],[x+.04,.95,-10.28],.012,'steel');}
 // Static background is merged by material to keep added detail inexpensive.
 g.updateMatrixWorld(true);
 const batches=new Map();
 g.traverse(o=>{if(o.isMesh){const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push(geometry);}});
 g.clear();
 for(const [material,geometries] of batches){
  const merged=mergeGeometries(geometries,false);assert(merged,'Incompatible workshop geometry '+material.name);
  const m=new T.Mesh(merged,material);m.name='workshop_static_'+material.name;m.userData={label:material.name};g.add(m);
  for(const geometry of geometries)geometry.dispose();
 }
 return [];
}
const defs=[
 ['neutral','中和罐',g=>vessel(g,{r:.86,h:1.65})],
 ['evaporator','蒸发釜',g=>vessel(g,{r:.98,h:1.65})],
 ['crystallizer','结晶罐',g=>vessel(g,{r:.9,h:1.85})],
 ['separator','立式固液分离器',g=>vessel(g,{r:1.04,h:1.2,motorized:false,flat:true,cut:false})],
 ['condenser','立式冷凝器',condenser],
 ['collector','冷凝收集罐',g=>vessel(g,{r:.84,h:1.5,motorized:false,cut:false})],
 ['pump','工艺泵',pump],['workshop','硝酸银化工车间与管路',workshop]
];
const workshopOnly=process.argv.includes('--workshop-only');
const previous=workshopOnly?JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')):null;
for(const [id,name,build] of defs){
 if(workshopOnly&&id!=='workshop'){const entry=previous.models.find(m=>m.id===id);assert(entry,'Missing unchanged asset '+id);const bytes=readFileSync(join(out,entry.filename));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);manifest.push(entry);continue;}
 serial=0;const scene=new T.Scene();scene.name=id+'_scene';const g=group(scene,id,name);const animations=build(g);scene.updateMatrixWorld(true);
 const bytes=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true,animations}));const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString().trim());
 assert(!doc.buffers.some(b=>b.uri),'External buffers');const names=doc.nodes.map(n=>n.name);assert(names.length===new Set(names).size,'Duplicate names');
 const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');assert.equal(loaded.animations.length,animations.length);
 const sha=createHash('sha256').update(bytes).digest('hex'),filename=id+'.'+sha.slice(0,12)+'.glb';writeFileSync(join(out,filename),bytes);
 const info={id,name,filename,sha256:sha,bytes:bytes.length,nodes:doc.nodes.length,meshes:doc.meshes.length,animations:animations.length,dimensions:new T.Box3().setFromObject(g).getSize(new T.Vector3()).toArray()};manifest.push(info);console.log(info);
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({models:manifest,positions,routes},null,2)+'\n');
