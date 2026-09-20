// Original, reproducible industry demonstrations. Geometry and motion are illustrative, not CFD.
// No runtime scripts are embedded: all motion is standard glTF animation / morph targets.
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'apps/web/package.json'));
const T = require('three');
const three = dirname(dirname(require.resolve('three')));
const {GLTFExporter} = await import(pathToFileURL(join(three, 'examples/jsm/exporters/GLTFExporter.js')));
const {FontLoader} = await import(pathToFileURL(join(three, 'examples/jsm/loaders/FontLoader.js')));
const {mergeGeometries} = await import(pathToFileURL(join(three, 'examples/jsm/utils/BufferGeometryUtils.js')));
const font = new FontLoader().parse(JSON.parse(readFileSync(join(root, 'scripts/fluid-assets/helvetiker_regular.typeface.json'))));
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result=result; this.onloadend?.(); }, error=>this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result=> { this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.(); }, error=>this.onerror?.(error)); }
};
const output = join(root, 'demo-assets/fluid-cases');
mkdirSync(output, {recursive:true});
const palette = {
  slab:'#152b3b', edge:'#294555', steel:'#80939c', dark:'#233442', cream:'#c4d3d6',
  copper:'#b87438', yellow:'#f9bd53', white:'#e2f7fa', teal:'#008e99', blue:'#237fc2',
  warm:'#ca5043', charcoal:'#3c454c', earth:'#685b46', green:'#48826b',
};
const mats = Object.fromEntries(Object.entries(palette).map(([key,color])=>[key,new T.MeshStandardMaterial({
  name:key,color,roughness:['steel','copper'].includes(key)?.28:.57,metalness:['steel','copper'].includes(key)?.72:.24,
})]));
function liquidMaterial(name,color,opacity=1,emission=.08) {
  return new T.MeshStandardMaterial({name,color,metalness:.18,roughness:.18,transparent:opacity<1,opacity,
    emissive:color,emissiveIntensity:emission,side:T.DoubleSide,depthWrite:opacity===1});
}
Object.assign(mats,{
  water:liquidMaterial('water','#128ead',.91,.15), clean:liquidMaterial('clean_water','#20c5c3',.92,.15),
  raw:liquidMaterial('raw_water','#566d55',1,.03), bio:liquidMaterial('aeration_water','#368d8b',.95,.05),
  molten:liquidMaterial('molten_steel','#ff6418',1,1.5), hot:liquidMaterial('hot_core','#ffd16a',1,2.5),
  tracer:liquidMaterial('water_tracer','#95f8ff',1,.9), foam:liquidMaterial('foam','#b9eef1',.85,.2),
  glass:liquidMaterial('cutaway_window','#58c6d8',.16,.02),
});
const cache=new Map();
const geo=(key,make)=>{if(!cache.has(key)) cache.set(key,make());return cache.get(key);};
let serial=0, tracks=[], animated=new Set();
const name=n=>`${n}_${String(++serial).padStart(5,'0')}`;
const vec=p=>new T.Vector3(...p);
function group(parent,n,p=[0,0,0]){const g=new T.Group();g.name=name(n);g.position.set(...p);parent?.add(g);return g;}
function mesh(parent,n,geometry,mat,p=[0,0,0],r=[0,0,0]){
  const m=new T.Mesh(geometry,typeof mat==='string'?mats[mat]:mat);m.name=name(n);m.position.set(...p);m.rotation.set(...r);parent.add(m);return m;
}
function box(g,n,size,p,mat='cream',r){return mesh(g,n,geo(`b:${size}`,()=>new T.BoxGeometry(...size)),mat,p,r);}
function cyl(g,n,r,h,p,mat='steel',rotation,top=r,open=false){return mesh(g,n,geo(`c:${r}:${h}:${top}:${open}`,()=>new T.CylinderGeometry(top,r,h,32,1,open)),mat,p,rotation);}
function sphere(g,n,r,p,mat='tracer'){return mesh(g,n,geo(`s:${r}`,()=>new T.SphereGeometry(r,10,7)),mat,p);}
function line(g,n,a,b,r=.04,mat='steel'){
  const delta=vec(b).sub(vec(a));const m=cyl(g,n,r,delta.length(),vec(a).add(vec(b)).multiplyScalar(.5).toArray(),mat);
  m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return m;
}
function pipe(g,n,points,r=.16,mat='steel'){
  const curve=new T.CatmullRomCurve3(points.map(vec),false,'centripetal');
  return mesh(g,n,new T.TubeGeometry(curve,Math.max(32,points.length*10),r,10,false),mat);
}
function ring(g,n,r,t,p,mat='steel',rot=[Math.PI/2,0,0]){return mesh(g,n,geo(`t:${r}:${t}`,()=>new T.TorusGeometry(r,t,8,48)),mat,p,rot);}
function text(g,label,p,size=.26,mat='white',floor=false){
  const geometry=new T.ShapeGeometry(font.generateShapes(label,size));geometry.computeBoundingBox();
  geometry.translate(-(geometry.boundingBox.max.x-geometry.boundingBox.min.x)/2,0,0);
  return mesh(g,'label',geometry,mat,p,floor?[-Math.PI/2,0,0]:[0,0,0]);
}
function plaque(g,number,title,x,z,width=3.6){
  box(g,'nameplate',[width,.65,.12],[x,.58,z],'dark');
  box(g,'nameplate_stripe',[.08,.65,.135],[x-width/2+.04,.58,z+.01],'teal');
  text(g,`${number}  ${title}`,[x,.50,z+.07],.20);
}
function track(object,property,times,values,kind='vector'){
  animated.add(object);
  const cls=kind==='quaternion'?T.QuaternionKeyframeTrack:kind==='number'?T.NumberKeyframeTrack:T.VectorKeyframeTrack;
  tracks.push(new cls(`${object.name}.${property}`,times,values.flat()));
}
function rotate(g,axis='y',duration=12){
  const unit={x:[1,0,0],y:[0,1,0],z:[0,0,1]}[axis];
  track(g,'quaternion',[0,duration/4,duration/2,duration*3/4,duration],Array.from({length:5},(_,i)=>new T.Quaternion().setFromAxisAngle(vec(unit),i*Math.PI/2).toArray()),'quaternion');
}
// Four analytic wave shapes, blended by glTF weights; includes normal morphs for moving highlights.
function wave(g,n,w,d,y,mat='water',cx=0,cz=0,circle=false,amplitude=.065){
  const geometry=circle?new T.CircleGeometry(w/2,64):new T.PlaneGeometry(w,d,36,22);
  geometry.rotateX(-Math.PI/2);
  const base=geometry.attributes.position.array.slice();
  geometry.morphAttributes.position=[];geometry.morphAttributes.normal=[];
  for(let phase=0;phase<4;phase++){
    const copy=geometry.clone();
    const a=copy.attributes.position.array;
    for(let i=0;i<a.length;i+=3){const x=base[i],z=base[i+2];a[i+1]=amplitude*(Math.sin(x*3+z*2+phase*Math.PI/2)+.45*Math.cos(z*5-x*1.8+phase*Math.PI/2));}
    copy.computeVertexNormals();
    geometry.morphAttributes.position.push(copy.attributes.position.clone());
    geometry.morphAttributes.normal.push(copy.attributes.normal.clone());
  }
  const m=mesh(g,n,geometry,mat,[cx,y,cz]);m.updateMorphTargets();m.userData.category='flow';
  for(let phase=0;phase<4;phase++)track(m,`morphTargetInfluences[${phase}]`,[0,1,2,3,4],Array.from({length:5},(_,i)=>i%4===phase?1:0),'number');
  return m;
}
// Motion is sampled on a centerline. Reset happens at zero scale, so particles never fly backwards.
function flow(g,n,points,{count=10,radius=.065,duration=3,mat='tracer',stretch=1.8}={}){
  const curve=new T.CatmullRomCurve3(points.map(vec),false,'centripetal');
  for(let k=0;k<count;k++){
    const dot=sphere(g,n,radius,points[0],mat);dot.userData.category='flow';
    const phase=k/count,times=new Set([0,duration]);
    for(let j=0;j<=32;j++)times.add(((j/32-phase+1)%1)*duration);
    const reset=(1-phase)*duration;
    for(const offset of [-.018,-.002,0,.002,.018])if(reset+offset>0&&reset+offset<duration)times.add(reset+offset);
    const sorted=[...times].sort((a,b)=>a-b),positions=[],scales=[],quats=[];
    for(const t of sorted){const u=(t/duration+phase)%1;const p=curve.getPointAt(u);positions.push(p.toArray());
      const visible=Math.min(1,u*60,(1-u)*60);scales.push([visible,visible*stretch,visible]);
      quats.push(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),curve.getTangentAt(u).normalize()).toArray());}
    // Exactly equal endpoints, including quaternions, make the animation mathematically periodic.
    positions[positions.length-1]=positions[0];scales[scales.length-1]=scales[0];quats[quats.length-1]=quats[0];
    track(dot,'position',sorted,positions);track(dot,'scale',sorted,scales);track(dot,'quaternion',sorted,quats,'quaternion');
  }
}
function ripple(g,cx,cz,y,r=1,mat='foam'){
  for(let j=0;j<3;j++){
    const obj=ring(g,'surface_ripple',r,.017,[cx,y,cz],mat);obj.userData.category='flow';
    const values=Array.from({length:9},(_,i)=>{const f=(i/8+j/3)%1;const s=.15+f*.8;return[s,s,Math.sin(Math.PI*f)];});
    values[8]=values[0];track(obj,'scale',[0,.5,1,1.5,2,2.5,3,3.5,4],values);
  }
}
function tank(g,w,d,h,waterY,mat='water',base=0){
  box(g,'foundation',[w+.5,.25,d+.5],[0,.125,0],'edge');
  box(g,'basin_bottom',[w,.20,d],[0,base+.25,0],'cream');
  for(const x of [-w/2,w/2])box(g,'side_wall',[.18,h,d],[x,base+h/2+.3,0],'cream');
  box(g,'rear_wall',[w,h,.18],[0,base+h/2+.3,-d/2],'cream');
  box(g,'cutaway_front',[w,h,.06],[0,base+h/2+.3,d/2],'glass');
  box(g,'front_sill',[w,.32,.22],[0,base+.44,d/2],'cream');
  for(const z of [-d/2,d/2])box(g,'basin_rim',[w+.25,.1,.18],[0,base+h+.35,z],'steel');
  wave(g,'liquid_surface',w-.22,d-.22,waterY,mat);
  // Subsurface volume makes the section readable without covering its dynamic free surface.
  box(g,'liquid_volume',[w-.24,Math.max(.05,waterY-base-.44),d-.24],[0,(waterY+base+.4)/2-.025,0],mat);
}
function rails(g,a,b,y){
  const length=vec(b).sub(vec(a)).length();for(let i=0;i<=Math.ceil(length/1.2);i++){
    const p=vec(a).lerp(vec(b),i/Math.ceil(length/1.2));line(g,'rail_post',[p.x,y,p.z],[p.x,y+.65,p.z],.025,'yellow');}
  for(const dy of [.35,.65])line(g,'safety_rail',[a[0],y+dy,a[2]],[b[0],y+dy,b[2]],.027,'yellow');
}
function pump(g,x,z,color='teal'){
  box(g,'pump_skid',[1.7,.18,.85],[x,.18,z],'dark');
  cyl(g,'motor',.27,.8,[x-.30,.55,z],color,[0,0,Math.PI/2]);
  for(let i=0;i<6;i++)cyl(g,'motor_fin',.30,.027,[x-.62+i*.105,.55,z],'steel',[0,0,Math.PI/2]);
  cyl(g,'volute',.38,.3,[x+.4,.55,z],color,[0,0,Math.PI/2]);
  line(g,'pump_discharge',[x+.4,.55,z],[x+.4,1.2,z],.12,color);
  ring(g,'discharge_flange',.19,.045,[x+.4,1.05,z],'steel');
  cyl(g,'gauge',.12,.05,[x+.4,1.3,z+.07],'white',[Math.PI/2,0,0]);
}
function control(g,p){
  box(g,'control_cabinet',[.7,1.4,.45],[p[0],p[1]+.7,p[2]],'cream');
  box(g,'hmi',[.48,.34,.025],[p[0],p[1]+1.03,p[2]+.24],'dark');
  for(let i=0;i<3;i++)box(g,'hmi_line',[.3-i*.055,.028,.01],[p[0],p[1]+1.1-i*.08,p[2]+.26],'teal');
  sphere(g,'status_lamp',.055,[p[0]-.16,p[1]+.55,p[2]+.255],'clean');
}
function site(g,title,subtitle,color='teal'){
  box(g,'site_plinth',[24,.46,15],[0,-.25,0],'slab');
  box(g,'front_edge',[24,.12,.10],[0,-.11,7.53],color);
  for(let x=-11;x<=11;x+=2)box(g,'slab_joint',[.014,.008,13.5],[x,-.014,0],'edge');
  for(let z=-6;z<=6;z+=2)box(g,'slab_joint',[23,.008,.014],[0,-.014,z],'edge');
  text(g,title,[0,.018,6.2],.49,'white',true);
  text(g,subtitle,[0,.019,6.92],.17,'steel',true);
  for(let i=0;i<22;i++)box(g,'boundary_mark',[.36,.015,.10],[-10.5+i,0,-6.7],'yellow');
}

// Keep moving subtrees intact; merge static geometry per material to bound WebGL draw calls.
function optimize(scene){
  scene.updateMatrixWorld(true);const bins=new Map(),remove=[];
  scene.traverse(object=>{
    if(!object.isMesh)return;
    for(let p=object;p;p=p.parent)if(animated.has(p))return;
    const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    for(const attr of Object.keys(geometry.attributes))if(!['position','normal','uv'].includes(attr))geometry.deleteAttribute(attr);
    if(!geometry.attributes.uv)geometry.setAttribute('uv',new T.BufferAttribute(new Float32Array(geometry.attributes.position.count*2),2));
    const bin=bins.get(object.material)??[];bin.push(geometry);bins.set(object.material,bin);remove.push(object);
  });
  remove.forEach(o=>o.removeFromParent());
  for(const [mat,geometries] of bins){const merged=mergeGeometries(geometries);assert.ok(merged,`Cannot merge ${mat.name}`);mesh(scene,`structure_${mat.name}`,merged,mat);}
}
const definitions=[];
function module(caseId,id,label,position,build,extra={}){definitions.push({caseId,id,label,position,build,...extra});}

module('steel','site','连铸工位与安全底座',[0,0,0],g=>{
  site(g,'01 / MOLTEN STEEL','LADLE > TUNDISH > CASTING > COOLING > BILLET   /   SIMULATED PROCESS','warm');
  for(const x of [-8.7,1.8]){
    for(const z of [-3.1,1.3])box(g,'gantry_column',[.32,7.7,.32],[x,3.8,z],'dark');
    box(g,'gantry_cross',[.4,.35,4.9],[x,7.5,-.9],'yellow');
  }
  for(const z of [-3.1,1.3])box(g,'crane_beam',[11,.28,.24],[-3.5,7.65,z],'yellow');
  for(const z of [-2.6,.7])rails(g,[-5.3,0,z],[.3,0,z],3.2);
  box(g,'platform',[5.7,.16,3.2],[-2.5,3.15,-1],'dark');
  // Water utility headers: the two colors visibly close the supply / return circuit.
  for(const [z,mat] of [[3.55,'blue'],[4.25,'warm']]){
    const pts=[[-6,1.05,z],[-2,1.05,z],[3,1.05,z],[3,2.4,-1]];
    pipe(g,'cooling_header',pts,.13,mat);flow(g,'cooling_direction',mat==='blue'?pts:[...pts].reverse(),{count:9,radius:.10,duration:4});
  }
},{background:true});
module('steel','ladle','01 钢包与可视浇注流束',[-6,0,-1],g=>{
  const pot=group(g,'tilted_ladle',[0,5.6,0]);pot.rotation.z=-.22;
  cyl(pot,'steel_shell',1.08,2,[0,0,0],'charcoal',undefined,1.36,true);
  cyl(pot,'refractory',.94,1.9,[0,.02,0],'earth',undefined,1.2,true);
  cyl(pot,'ladle_bottom',1.07,.18,[0,-1,0],'charcoal');
  for(const y of [-.6,.65])ring(pot,'reinforcing_ring',y<0?1.17:1.31,.09,[0,y,0],'steel');
  wave(pot,'molten_bath',2.16,2.16,.62,'molten',0,0,true,.05);
  for(const z of [-1.3,1.3]){cyl(g,'trunnion',.24,.45,[0,5.5,z],'steel',[Math.PI/2,0,0]);line(g,'lifting_yoke',[0,5.5,z],[0,7.4,z],.09,'steel');}
  const pour=[[1.22,6.26,0],[1.55,6.07,0],[1.73,5.35,0],[1.87,4.17,0]];
  pipe(g,'continuous_pour',pour,.115,'molten');flow(g,'pour_highlights',pour,{count:10,radius:.085,duration:1.2,mat:'hot',stretch:2.8});
  for(let k=0;k<8;k++){
    const a=k*Math.PI/4;flow(g,'impact_splash',[[1.87,4.17,0],[1.87+Math.cos(a)*.27,4.48,Math.sin(a)*.27],[1.87+Math.cos(a)*.5,4.16,Math.sin(a)*.5]],{count:2,radius:.035,duration:1.2,mat:'hot'});
  }
  plaque(g,'01','LADLE / POUR',-.1,2.35,3.4);
},{type:'ladle',metrics:{温度:'1,565 °C',工况:'连续浇注演示',介质:'钢水'},description:'钢包内液面、连续流束与冲击飞溅。剖面用于观察钢液。'});
module('steel','tundish','02 中间包稳流与结晶器',[-2.5,0,-1],g=>{
  tank(g,5,2,1.05,4.14,'molten',3.15);
  for(const x of [-2,2])for(const z of [-.72,.72])box(g,'tundish_leg',[.18,3,.18],[x,1.5,z],'steel');
  box(g,'flow_baffle',[.17,.5,1.8],[0,3.8,0],'earth');
  ripple(g,-1.63,0,4.22,.55,'hot');
  cyl(g,'submerged_nozzle',.11,1.2,[2,3.1,0],'earth');
  cyl(g,'nozzle_cutaway_steel',.062,1.3,[2,3.07,.02],'molten');
  flow(g,'submerged_downflow',[[2,3.7,.1],[2,2.48,.1]],{count:4,duration:1.2,radius:.065,mat:'hot'});
  plaque(g,'02','TUNDISH',0,2.35,3.7);
},{type:'tundish',metrics:{液位:'720 mm',钢液温度:'1,542 °C',作用:'缓冲 / 稳流'},description:'钢包注入中间包，经耐火浸入式水口进入结晶器。'});
module('steel','caster','03 结晶器、二冷喷淋与拉坯',[-.5,0,-1],g=>{
  box(g,'mold_outer',[.95,.6,1.1],[0,2.52,0],'copper');
  box(g,'mold_meniscus',[.56,.035,.72],[0,2.84,0],'molten');
  const path=[[0,2.8,0],[0,2.15,0],[.45,1.36,0],[1.5,.9,0],[4,.9,0],[9,.9,0]];
  pipe(g,'strand',path,.24,'warm');
  flow(g,'hot_strand_motion',path,{count:8,radius:.16,duration:12,mat:'molten',stretch:2.2});
  for(let i=0;i<13;i++){
    const x=.4+i*.66,y=x<1.6?1.3-x*.28:.58;
    cyl(g,'guide_roller',.18,1.35,[x,y,0],'steel',[Math.PI/2,0,0]);
    for(const z of [-.72,.72])box(g,'roller_bearing',[.3,.35,.20],[x,y-.1,z],'dark');
  }
  for(const x of [1.3,2.6,3.9]){
    for(const z of [-.82,.82]){
      line(g,'spray_riser',[x,.2,z],[x,1.95,z],.065,'blue');
      for(let k=0;k<3;k++)flow(g,'secondary_spray',[[x,1.8,z],[x+(k-1)*.15,1.15,0]],{count:3,radius:.032,duration:1.2});
    }
  }
  for(const z of [-1,1])box(g,'roller_frame',[8,.16,.14],[5,.52,z],'dark');
  box(g,'finished_billet',[2.1,.36,.5],[7.5,.94,0],'charcoal');
  plaque(g,'03','CAST / SPRAY / BILLET',5.2,2.35,6.0);
},{type:'continuous_caster',metrics:{拉速:'1.10 m/min',二冷水量:'92 m³/h',铸坯:'方坯演示'},description:'钢液进入水冷结晶器，铸坯沿导辊弯曲引出并经二次喷淋冷却。'});
module('steel','utilities','04 连铸冷却水辅助站',[-5,0,4],g=>{
  pump(g,-1.2,0);pump(g,1.0,0);control(g,[2.3,.1,-.3]);
  plaque(g,'04','COOLING WATER',0,1.2,5);
},{type:'cooling_station',metrics:{供水温度:'28 °C',回水温度:'36 °C',说明:'模拟辅助系统'},description:'供回水支路连接结晶器及二冷段，蓝色表示冷供水，红色表示热回水。'});

module('water','site','水处理工艺底座与连接管网',[0,0,0],g=>{
  site(g,'02 / WATER RECLAMATION','SCREENING > AERATION > CLARIFICATION > REUSE   /   SIMULATED PROCESS');
  for(const pts of [
    [[-7,1.15,-3],[-7,1.15,-4.4],[-1,1.15,-4.4],[-1,1.15,-3.5]],
    [[1.7,1.15,-1],[2.8,1.15,-1],[3.4,1.15,-1]],
    [[8.7,1.1,-1],[9.7,1.1,-1],[9.7,1.1,4.4],[7.8,1.1,4.4]],
  ]){pipe(g,'process_pipe',pts,.14,'teal');flow(g,'process_direction',pts,{count:9,radius:.11,duration:4});}
  const sludge=[[6,.5,-1],[6,.5,2.6],[-1,.5,2.6],[-1,.5,3.5]];
  pipe(g,'sludge_waste',sludge,.1,'earth');flow(g,'sludge_direction',sludge,{count:7,radius:.085,mat:'yellow',duration:6});
  const returnSludge=[[-1,.6,3.3],[-3.6,.6,3.3],[-3.6,.6,-.7]];
  pipe(g,'return_sludge',returnSludge,.09,'green');flow(g,'return_direction',returnSludge,{count:5,radius:.075,duration:6});
},{background:true});
module('water','inlet','01 格栅与进水调节池',[-7,0,-1],g=>{
  tank(g,3.6,3.6,1.7,1.5,'raw');
  for(let i=0;i<15;i++)box(g,'screen_bar',[.06,1.7,.05],[-1.2+i*.17,1.65,-.6],'steel',[.34,0,0]);
  const inlet=[[-3.3,2.5,0],[-2.25,2.5,0],[-1.4,2.5,0],[-1.25,1.5,0]];
  pipe(g,'inlet_pipe',inlet.slice(0,3),.22,'teal');
  pipe(g,'incoming_water',inlet.slice(2),.16,'raw');flow(g,'inlet_fall',inlet.slice(2),{count:8,radius:.06,duration:1.2});
  ripple(g,-1.22,0,1.58,.48);rails(g,[-1.8,0,-1.8],[1.8,0,-1.8],2.08);
  control(g,[-2.2,0,1.3]);plaque(g,'01','INLET / SCREEN',0,2.35,4.1);
},{type:'screening',metrics:{进水流量:'120 m³/h',COD:'280 mg/L',池位:'1.2 m'},description:'原水经格栅拦截大颗粒后进入调节段，跌水与扰动水面可见。'});
module('water','aeration','02 生化曝气池',[-1,0,-1],g=>{
  tank(g,5.3,4.7,1.85,1.65,'bio');
  for(const x of [-1.7,0,1.7]){
    pipe(g,'diffuser_header',[[x,.5,-1.8],[x,.5,1.8]],.055,'blue');
    for(let k=0;k<4;k++){
      const z=-1.5+k*.95;cyl(g,'disc_diffuser',.16,.06,[x,.55,z],'dark');
      flow(g,'aeration_bubbles',[[x,.57,z],[x+.12,1.1,z-.07],[x-.10,1.74,z+.09]],{count:3,radius:.045,duration:2,stretch:1});
    }
  }
  for(const x of [-1.6,1.6])ripple(g,x,.6,1.74,.55);
  box(g,'service_bridge',[5.7,.11,.48],[0,2.3,-.6],'steel');rails(g,[-2.75,0,-.86],[2.75,0,-.86],2.35);
  for(const x of [-2.7,2.7])box(g,'bridge_support',[.1,2.3,.1],[x,1.15,-.6],'steel');
  cyl(g,'air_blower',.32,.8,[-2,.55,2.9],'cream',[0,0,Math.PI/2]);
  pipe(g,'air_feed',[[-2,.6,2.9],[-2,.6,2.2],[-2,.5,1.8]],.09,'blue');
  plaque(g,'02','BIO / AERATION',0,3.25,4.5);
},{type:'aeration',metrics:{溶解氧:'2.4 mg/L',风量:'680 m³/h',水温:'24 °C'},description:'池底微孔曝气、上升气泡和水面波纹；透明观察侧用于演示。'});
module('water','clarifier','03 二沉池与刮泥机',[6,0,-1],g=>{
  cyl(g,'clarifier_foundation',2.95,.25,[0,.13,0],'edge');
  cyl(g,'circular_basin',2.7,1.5,[0,1,0],'glass',undefined,2.7,true);
  cyl(g,'basin_bottom',2.7,.24,[0,.36,0],'cream');
  ring(g,'concrete_rim',2.72,.15,[0,1.85,0],'cream');
  wave(g,'settling_surface',5.25,5.25,1.46,'clean',0,0,true,.045);
  cyl(g,'feed_well',.52,.7,[0,1.6,0],'cream',undefined,.52,true);
  cyl(g,'center_pier',.16,2.0,[0,1.25,0],'steel');
  const scraper=group(g,'rotating_scraper',[0,1.93,0]);
  box(scraper,'scraper_bridge',[5.3,.1,.28],[0,0,0],'steel');
  rails(scraper,[-2.5,0,-.17],[2.5,0,-.17],.05);rotate(scraper,'y',12);
  for(const x of [-1.7,1.7]){line(scraper,'scraper_shaft',[x,0,0],[x,-1.15,0],.045,'steel');box(scraper,'bottom_scraper',[1.2,.15,.15],[x,-1.15,0],'dark');}
  ripple(g,0,0,1.53,1.4);plaque(g,'03','CLARIFIER',0,3.25,4.2);
},{type:'clarifier',metrics:{表面负荷:'0.9 m³/(m²·h)',泥位:'0.55 m',刮泥机:'慢速连续演示'},description:'辐流沉淀、旋转刮泥及出水回用支路；底部污泥输送至排泥/回流站。'});
module('water','sludge','04 污泥回流与排泥站',[-1,0,4.25],g=>{
  cyl(g,'sludge_tank',.66,1.65,[0,1.02,0],'green',undefined,.83,true);
  wave(g,'sludge_surface',1.4,1.4,1.69,'raw',0,0,true,.03);pump(g,-1.7,0,'green');
  pipe(g,'sludge_pump_line',[[-1.2,.7,0],[-.7,.7,0],[0,.7,0]],.10,'earth');
  plaque(g,'04','SLUDGE RETURN',0,1.15,4.3);
},{type:'sludge_pump',metrics:{回流比:'60 %',排泥量:'8 m³/d',方式:'回流 + 剩余污泥'},description:'回流污泥返回生化段，剩余污泥经排泥支路外送；不包含脱水车间。'});
module('water','reuse','05 消毒接触与回用供水',[6,0,4.2],g=>{
  tank(g,3.2,1.9,1.1,1.0,'clean');
  for(const x of [-.6,.6])box(g,'contact_baffle',[.07,.65,1.3],[x,.77,x<0?-.18:.18],'cream');
  pump(g,-2.55,0);control(g,[2.3,0,0]);
  pipe(g,'reuse_outlet',[[1.6,.8,0],[2.9,.8,0],[2.9,.8,-.6]],.12,'teal');
  flow(g,'reuse_direction',[[1.2,1.08,.4],[.1,1.08,.4],[-1.3,1.08,.4]],{count:5,duration:4,radius:.055});
  plaque(g,'05','DISINFECT / REUSE',0,1.6,4.9);
},{type:'reuse',metrics:{浊度:'1.2 NTU',回用流量:'108 m³/h',出水COD:'32 mg/L'},description:'折流接触段与回用泵站展示处理末端。全部水质数值为虚构示例。'});

module('cooling','site','循环冷却闭环管网与底座',[0,0,0],g=>{
  site(g,'03 / CLOSED WATER LOOP','TOWER > PUMPS > HEAT EXCHANGER > RETURN   /   SIMULATED PROCESS','blue');
  const cold=[[-6,.8,1.7],[-6,.8,3.1],[-2,.8,3.1],[1.7,.8,3.1],[1.7,1.3,0],[3,1.3,0]];
  const hot=[[6,1.3,0],[9,1.3,0],[9,1.3,-4.4],[-6,1.3,-4.4],[-6,5.0,-2.8],[-6,5.0,-1]];
  for(const [pts,mat] of [[cold,'blue'],[hot,'warm']]){pipe(g,'water_header',pts,.17,mat);flow(g,'water_direction',pts,{count:16,radius:.13,duration:6});}
  const makeup=[[7,.8,3.8],[7,.8,4.8],[-7,.8,4.8],[-7,.8,1.7]];
  pipe(g,'makeup_line',makeup,.085,'teal');flow(g,'makeup_flow',makeup,{count:8,radius:.07,duration:6});
},{background:true});
module('cooling','tower','01 开式冷却塔剖面与喷淋',[-6,0,-1],g=>{
  tank(g,4.7,4.7,.9,.94,'water');
  for(const x of [-2.1,2.1])for(const z of [-2.1,2.1])box(g,'tower_column',[.18,4.8,.18],[x,2.7,z],'cream');
  box(g,'tower_rear',[4.4,3.5,.12],[0,3.3,-2.16],'cream');
  for(const x of [-2.16,2.16])box(g,'cutaway_side',[.06,3.5,4.2],[x,3.3,0],'glass');
  for(let j=0;j<9;j++)box(g,'fill_lamella',[4,.09,3.5],[0,2.2+j*.075,-.25],'steel');
  box(g,'top_deck',[4.7,.16,4.7],[0,5.15,0],'cream');
  cyl(g,'fan_stack',1.48,.7,[0,5.55,0],'cream',undefined,1.3,true);
  const fan=group(g,'induced_draft_fan',[0,5.63,0]);cyl(fan,'fan_hub',.20,.28,[0,0,0],'dark');
  for(let i=0;i<6;i++){const blade=box(fan,'fan_blade',[1.08,.08,.34],[Math.cos(i*Math.PI/3)*.68,0,Math.sin(i*Math.PI/3)*.68],'dark');blade.rotation.y=-i*Math.PI/3;}
  rotate(fan,'y',1);
  pipe(g,'spray_header',[[-1.65,4.4,0],[1.65,4.4,0]],.13,'warm');
  for(const x of [-1.5,0,1.5])for(const z of [-1.2,0,1.2]){
    line(g,'nozzle_branch',[x,4.4,0],[x,4.4,z],.05,'steel');
    cyl(g,'nozzle',.12,.12,[x,4.3,z],'copper');
    for(let k=0;k<3;k++)flow(g,'spray_drops',[[x,4.22,z],[x+(k-1)*.25,3.5,z+.1],[x+(k-1)*.38,2.9,z+.2]],{count:3,radius:.035,duration:1.2});
  }
  // The front inspection cut exposes film falling from fill to the basin.
  for(let x=-1.6;x<=1.61;x+=.4)flow(g,'falling_film',[[x,2.2,1.61],[x,1,1.63]],{count:4,radius:.04,duration:1.2,stretch:3});
  ripple(g,0,1.2,1.02,1);plaque(g,'01','TOWER / SPRAY',0,3.15,4.7);
},{type:'cooling_tower',metrics:{进塔温度:'37 °C',出塔温度:'29 °C',风机:'运行演示'},description:'剖面展示布水喷头、填料、下落水膜、集水盘与风机。'});
module('cooling','pumps','02 一用一备循环泵组',[-2,0,3.1],g=>{
  pump(g,0,-.55,'blue');pump(g,0,.65,'blue');control(g,[1.3,0,-.6]);
  pipe(g,'pump_manifold',[[-1,.55,-.55],[-1,.55,.65]],.12,'blue');
  plaque(g,'02','DUTY / STANDBY',0,1.5,4.6);
},{type:'circulation_pumps',metrics:{运行泵:'P-01',备用泵:'P-02',流量:'240 m³/h',出口压力:'0.28 MPa'},description:'泵组与供水干管组成连续闭环，备用泵保留为业务场景组成。'});
module('cooling','exchanger','03 换热器与热负载',[4.5,0,-1],g=>{
  for(const x of [-1.4,1.4])box(g,'vessel_saddle',[.32,1,.95],[x,.55,0],'dark');
  cyl(g,'shell_cutaway',.88,4,[0,1.65,0],'glass',[0,0,Math.PI/2]);
  for(const x of [-2,2]){cyl(g,'tube_sheet',.92,.18,[x,1.65,0],'steel',[0,0,Math.PI/2]);cyl(g,'head',.80,.45,[x*1.12,1.65,0],'blue',[0,0,Math.PI/2]);}
  for(const y of [-.36,0,.36])for(const z of [-.36,0,.36]){
    line(g,'heat_exchange_tube',[-1.85,1.65+y,z],[1.85,1.65+y,z],.072,'copper');
  }
  const coolant=[[-2.4,1.65,.1],[-1.6,1.9,.5],[0,1.9,.5],[1.6,1.9,.5],[2.4,1.65,.1]];
  flow(g,'shell_side_water',coolant,{count:12,radius:.085,duration:4});
  box(g,'heat_load',[2.7,1.5,1.3],[0,.87,-3],'warm');text(g,'HEAT LOAD',[0,1.3,-2.33],.23);
  for(const x of [-1,1]){
    const pts=[[x,1.5,-2.35],[x,2.8,-1.8],[x,2.8,-.5],[x,2.2,0]];
    pipe(g,'process_loop',pts,.11,'warm');flow(g,'hot_process',x<0?pts:[...pts].reverse(),{count:5,radius:.083,duration:4,mat:'yellow'});
  }
  plaque(g,'03','HEAT EXCHANGER',0,2.1,5.2);
},{type:'heat_exchanger',metrics:{热侧入口:'62 °C',热侧出口:'45 °C',负荷:'2.2 MW'},description:'透明壳体显示铜管束与壳程水流，独立热负载回路与冷却水换热。'});
module('cooling','makeup','04 补水与水质辅助单元',[7,0,3.8],g=>{
  cyl(g,'makeup_tank',.82,1.9,[0,1.1,0],'glass',undefined,.82,true);
  cyl(g,'tank_bottom',.85,.16,[0,.22,0],'cream');ring(g,'tank_rim',.83,.08,[0,2.05,0]);
  wave(g,'makeup_surface',1.58,1.58,1.52,'clean',0,0,true,.04);
  cyl(g,'chemical_dose',.33,.9,[-1.6,.65,0],'yellow');control(g,[1.55,.1,0]);
  pipe(g,'dosing_line',[[-1.6,1.15,0],[-1.1,1.15,0],[-.9,.75,0]],.035,'teal');
  plaque(g,'04','MAKEUP / DOSING',0,1.45,4.7);
},{type:'makeup_tank',metrics:{补水量:'3.6 m³/h',电导率:'850 μS/cm',补水液位:'72 %'},description:'补水接入集水盘，药剂投加与水质监测组成辅助业务闭环。'});

const cases={
  steel:{title:'钢水浇注与连铸',accent:'#ffab62',theme:'steel-orange',flow:'钢包浇注 → 中间包稳流 → 结晶器 → 二冷喷淋 → 铸坯输出',summary:'高温液态金属的自由流束、液面扰动、冲击飞溅及连铸冷却。',kpis:[['钢液温度','1,565','°C'],['浇注拉速','1.10','m/min'],['冷却水量','92','m³/h']],steps:[['01','钢包浇注','倾斜钢包、连续流束、冲击飞溅'],['02','中间包稳流','蓄流液面、挡坝、浸入式水口'],['03','凝固与二冷','结晶器、导辊、喷淋、铸坯'],['04','冷却水辅助','供回水环路、泵组、控制柜']],trend:{title:'模拟钢液温度',unit:'°C',values:[1572,1568,1566,1565,1563,1565]},controls:['重点观察钢包出口流束与落点飞溅','中间包液面持续波动，水口向下输送','二冷区喷淋与铸坯拉出同时播放']},
  water:{title:'污水处理与中水回用',accent:'#66ddd0',theme:'energy-green',flow:'格栅进水 → 生化曝气 → 二沉分离 → 消毒接触 → 回用供水',summary:'从原水到回用水，展示跌水、动态水面、曝气与污泥回流支路。',kpis:[['进水流量','120','m³/h'],['溶解氧','2.4','mg/L'],['回用流量','108','m³/h']],steps:[['01','预处理','格栅拦截、进水跌落、调节池'],['02','曝气处理','池底布气、上升气泡、水面扰动'],['03','沉淀与污泥','旋转刮泥、污泥回流及外排'],['04','消毒与回用','折流接触池、回用泵与出水']],trend:{title:'模拟分段 COD',unit:'mg/L',values:[280,235,130,65,38,32]},controls:['观察曝气气泡由池底上升至水面','透明侧壁展示液位及池内结构','二沉池缓慢旋转，出水与污泥支路分流']},
  cooling:{title:'工业循环冷却水站',accent:'#63caff',theme:'deep-blue',flow:'冷却塔集水 → 循环泵 → 换热器吸热 → 热回水 → 塔内喷淋',summary:'供水、换热、热回水及塔内散热组成闭环，含补水与投药辅助单元。',kpis:[['循环流量','240','m³/h'],['供回水温差','8','°C'],['换热负荷','2.2','MW']],steps:[['01','冷却塔','布水喷淋、填料水膜、风机与集水盘'],['02','循环供水','一用一备泵组与蓝色供水管'],['03','负载换热','透明壳体、铜管束、独立热回路'],['04','回水与补水','红色热回水、补水箱、投药装置']],trend:{title:'模拟循环温度',unit:'°C',values:[29,29.5,34,37,33,29]},controls:['冷却塔前部剖开，可观察喷淋和水膜','蓝管供冷水，红管输送热回水','换热器透明壳体内可见水流方向']},
};

const manifest={version:1,units:'meters',dataLabel:'虚构演示 / 模拟数据',simulation:'Visual process animation, not engineering CFD or a live plant connection.',cases:[]};
for(const [id,info] of Object.entries(cases)){
  const record={id,...info,modules:[]};
  for(const def of definitions.filter(d=>d.caseId===id)){
    serial=0;tracks=[];animated=new Set();
    const scene=new T.Scene();scene.name=`fluid_${id}_${def.id}`;scene.userData={label:def.label,units:'meters',simulation:true,generator:'generate-fluid-cases-v1'};
    def.build(scene);optimize(scene);
    const animations=tracks.length?[new T.AnimationClip(`${id}_${def.id}_fluid_cycle`,12,tracks)]:[];
    // Repeat shorter tracks to the common 12-second cycle; glTF clips loop as a whole.
    for(const animation of animations)for(const tr of animation.tracks){
      const duration=tr.times.at(-1);assert.ok(Math.abs(12/duration-Math.round(12/duration))<1e-5,`Non-periodic track ${tr.name}`);
      if(duration===12)continue;const stride=tr.getValueSize(),times=[],values=[];
      for(let rep=0;rep<Math.round(12/duration);rep++)for(let i=0;i<tr.times.length;i++){
        if(rep>0&&i===0)continue;times.push(tr.times[i]+rep*duration);values.push(...tr.values.slice(i*stride,(i+1)*stride));
      }
      tr.times=new Float32Array(times);tr.values=new Float32Array(values);
    }
    const binary=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true,animations,onlyVisible:true}));
    const doc=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString());
    const names=doc.nodes.map(n=>n.name);assert.equal(new Set(names).size,names.length,`Duplicate names: ${scene.name}`);
    assert.ok(binary.length<25*1024*1024,`Model exceeds upload budget: ${scene.name}`);
    assert.ok(!doc.buffers.some(b=>b.uri)&&!(doc.images??[]).some(i=>i.uri),'GLB must be self contained');
    const hash=createHash('sha256').update(binary).digest('hex');
    const filename=`${id}-${def.id}.${hash.slice(0,12)}.glb`;
    writeFileSync(join(output,filename),binary);
    const bounds=new T.Box3().setFromObject(scene);
    record.modules.push({id:def.id,label:def.label,filename,sha256:hash,bytes:binary.length,position:def.position,
      background:def.background??false,type:def.type??'site',metrics:def.metrics??{},description:def.description??info.flow,
      meshCount:doc.meshes?.length??0,nodeCount:doc.nodes.length,animationCount:doc.animations?.length??0,
      animationChannels:doc.animations?.reduce((sum,a)=>sum+a.channels.length,0)??0,
      bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}});
    console.log(`${id}/${def.id}: ${(binary.length/1024).toFixed(0)} KiB, ${doc.meshes.length} meshes, ${tracks.length} tracks`);
  }
  manifest.cases.push(record);
}
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Generated ${definitions.length} GLBs for ${manifest.cases.length} industry cases.`);
