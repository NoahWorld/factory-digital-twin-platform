// Original, reproducible industry demonstrations. Geometry and motion are illustrative, not CFD.
// No runtime scripts are embedded: all motion is standard glTF animation / morph targets.
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';

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
const output = join(root, 'demo-assets/fluid-cases-v2');
mkdirSync(output, {recursive:true});
const palette = {
  slab:'#636864', edge:'#464e50', steel:'#68747b', dark:'#252e35', cream:'#bcb9aa',
  copper:'#936438', yellow:'#ce963d', white:'#deddd0', teal:'#27676b', blue:'#28556d',
  warm:'#964f3b', charcoal:'#393b3c', earth:'#645644', green:'#596b43',
  concrete:'#a3a395', paving:'#92958b', grass:'#62764d', bark:'#4b4637', leaf:'#3e6044',
  rust:'#655244', refractory:'#aa967a', sludge:'#52513c', deepwater:'#244b46',
};
const mats = Object.fromEntries(Object.entries(palette).map(([key,color])=>[key,new T.MeshStandardMaterial({
  name:key,color,roughness:['steel','copper'].includes(key)?.42:.84,metalness:['steel','copper','rust'].includes(key)?.65:0,
})]));
function liquidMaterial(name,color,opacity=1,emission=0) {
  return new T.MeshStandardMaterial({name,color,metalness:0,roughness:.19,transparent:opacity<1,opacity,
    emissive:color,emissiveIntensity:emission,side:T.DoubleSide,depthWrite:opacity===1});
}
Object.assign(mats,{
  water:liquidMaterial('water','#366d73',.93), clean:liquidMaterial('clean_water','#407b7f',.95),
  raw:liquidMaterial('raw_water','#62664a'), bio:liquidMaterial('aeration_water','#536251'),
  molten:liquidMaterial('molten_steel','#d44c13',1,.8), hot:liquidMaterial('hot_core','#ffa948',1,1.2),
  tracer:liquidMaterial('water_droplet','#b3c9c7',.58), foam:liquidMaterial('foam','#c4cbc0',.7),
  glass:liquidMaterial('section_window','#678e8c',.09),
  film:liquidMaterial('water_film','#82a9aa',.44),
  billet:new T.MeshStandardMaterial({name:'billet_skin',color:'#8f3924',roughness:.85,emissive:'#c14613',emissiveIntensity:.23}),
  slag:new T.MeshStandardMaterial({name:'slag_cover',color:'#3c3027',roughness:1}),
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
function wave(g,n,w,d,y,mat='water',cx=0,cz=0,circle=false,amplitude=.022){
  let geometry;
  if(circle){
    // Polar rings allow interior waves, unlike a triangle fan with only a centre and perimeter.
    const positions=[],uv=[],indices=[],rings=18,sectors=64;
    for(let ri=0;ri<=rings;ri++)for(let si=0;si<=sectors;si++){
      const r=w*.5*ri/rings,a=si/sectors*Math.PI*2,x=r*Math.cos(a),z=r*Math.sin(a);
      positions.push(x,0,z);uv.push(x*.32,z*.32);
    }
    for(let ri=0;ri<rings;ri++)for(let si=0;si<sectors;si++){
      const a=ri*(sectors+1)+si,b=a+sectors+1;indices.push(a,b,a+1,a+1,b,b+1);
    }
    geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  }else{
    geometry=new T.PlaneGeometry(w,d,Math.max(20,Math.ceil(w*3)),Math.max(16,Math.ceil(d*3)));geometry.rotateX(-Math.PI/2);
    const pos=geometry.attributes.position,uv=geometry.attributes.uv;for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)*.32,pos.getZ(i)*.32);
  }
  const base=geometry.attributes.position.array.slice();geometry.morphAttributes.position=[];geometry.morphAttributes.normal=[];
  for(let phase=0;phase<4;phase++){
    const copy=geometry.clone(),a=copy.attributes.position.array;
    for(let i=0;i<a.length;i+=3){const x=base[i],z=base[i+2];
      const shore=circle?Math.min(1,Math.max(0,(w*.5-Math.hypot(x,z))*3)):Math.min(1,Math.max(0,(w*.5-Math.abs(x))*3),Math.max(0,(d*.5-Math.abs(z))*3));
      a[i+1]=amplitude*shore*(Math.sin(x*2.1+z*1.4+phase*Math.PI/2)+.38*Math.cos(z*3.7-x*.8+phase*Math.PI/2));}
    copy.computeVertexNormals();geometry.morphAttributes.position.push(copy.attributes.position.clone());geometry.morphAttributes.normal.push(copy.attributes.normal.clone());
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
    if(['concrete','paving','slab','refractory','rust'].includes(object.material.name)){const pos=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;for(let i=0;i<pos.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));uv.setXY(i,ny>.6?pos.getX(i):nx>.6?pos.getZ(i):pos.getX(i),ny>.6?pos.getZ(i):pos.getY(i));}}
    const bin=bins.get(object.material)??[];bin.push(geometry);bins.set(object.material,bin);remove.push(object);
  });
  remove.forEach(o=>o.removeFromParent());
  for(const [mat,geometries] of bins){const merged=mergeGeometries(geometries);assert.ok(merged,`Cannot merge ${mat.name}`);mesh(scene,`structure_${mat.name}`,merged,mat);}
}

// Shared geometry library. All animations export as glTF tracks, without custom runtime code.
function reset(){serial=0;tracks=[];animated=new Set();}
function basin(g,{w,d,h=2.6,level=2.05,x=0,z=0,base=.1,mat='water',section=false}){
  const b=group(g,'basin',[x,base,z]);
  box(b,'raft',[w+.6,.3,d+.6],[0,.15,0],'concrete');
  for(const xx of [-w/2,w/2])box(b,'retaining_wall',[.28,h,d+.28],[xx,h/2+.3,0],'concrete');
  box(b,'rear_wall',[w,h,.28],[0,h/2+.3,-d/2],'concrete');
  if(section){
    // Deliberate local engineering section, never an entirely transparent physical plant.
    for(const xx of [-w*.36,w*.36])box(b,'front_wall',[w*.28,h,.28],[xx,h/2+.3,d/2],'concrete');
    box(b,'section_sill',[w*.44,.35,.28],[0,.475,d/2],'concrete');
    box(b,'section_water',[w*.44,level-.65,.016],[0,(level+.65)/2,d/2-.04],mat);
    for(const xx of [-w*.22,w*.22])box(b,'cut_edge',[.08,h,.31],[xx,h/2+.3,d/2],'yellow');
  }else box(b,'front_wall',[w,h,.28],[0,h/2+.3,d/2],'concrete');
  wave(b,'bounded_free_surface',w-.3,d-.3,level,mat,0,0,false,mat==='bio'?.045:.018);
  for(const zz of [-d/2,d/2])box(b,'coping',[w+.52,.13,.48],[0,h+.33,zz],'cream');
  for(const xx of [-w/2,w/2])box(b,'coping',[.48,.13,d],[xx,h+.33,0],'cream');
  return b;
}
function flange(g,p,axis='x',r=.24){
  const rot=axis==='x'?[0,0,Math.PI/2]:axis==='z'?[Math.PI/2,0,0]:[0,0,0];
  cyl(g,'flange',r*1.5,.12,p,'steel',rot);
  for(let k=0;k<8;k++){const a=k/8*Math.PI*2;const q=axis==='x'?[p[0]+.075,p[1]+r*1.22*Math.cos(a),p[2]+r*1.22*Math.sin(a)]:axis==='z'?[p[0]+r*1.22*Math.cos(a),p[1]+r*1.22*Math.sin(a),p[2]+.075]:[p[0]+r*1.22*Math.cos(a),p[1]+.075,p[2]+r*1.22*Math.sin(a)];sphere(g,'flange_bolt',.035,q,'dark');}
}
function valve(g,p,axis='x',r=.24){
  const b=group(g,'isolation_valve',p);sphere(b,'valve_body',r*1.3,[0,0,0],'steel');line(b,'stem',[0,0,0],[0,r*3,0],.035,'steel');ring(b,'handwheel',r,.025,[0,r*3,0],'warm');
  flange(b,axis==='x'?[-r*1.7,0,0]:[0,0,-r*1.7],axis,r);flange(b,axis==='x'?[r*1.7,0,0]:[0,0,r*1.7],axis,r);
}
function stair(g,p,height,width=1.2,axis='x'){
  const s=group(g,'access_stair',p);if(axis==='z')s.rotation.y=Math.PI/2;
  const n=Math.ceil(height/.22),run=n*.25;
  for(let i=0;i<n;i++)box(s,'tread',[.29,.06,width],[-run/2+i*.25,(i+1)*height/n,0],'steel');
  for(const z of [-width/2,width/2]){line(s,'stringer',[-run/2,0,z],[run/2,height,z],.07,'dark');rails(s,[-run/2,0,z],[run/2,0,z],.05);line(s,'inclined_handrail',[-run/2,.9,z],[run/2,height+.9,z],.032,'yellow');}
}
function tree(g,x,z,s=1){
  const b=group(g,'tree',[x,0,z]);b.scale.setScalar(s);cyl(b,'trunk',.12,1.8,[0,.9,0],'bark');
  for(let k=0;k<4;k++){const m=sphere(b,'crown',.85,[Math.sin(k*2)*.43,2+k*.3,Math.cos(k*2)*.43],'leaf');m.scale.y=1.15;}
}
function building(g,p,size,label,{roof=true,color='cream'}={}){
  const b=group(g,'building',p);box(b,'walls',size,[0,size[1]/2,0],color);
  box(b,'foundation',[size[0]+.4,.2,size[2]+.4],[0,.1,0],'concrete');
  if(roof)box(b,'roof',[size[0]+.5,.18,size[2]+.5],[0,size[1]+.05,0],'dark');
  for(let x=-size[0]/2+1;x<size[0]/2;x+=1.8){box(b,'window',[1.1,.65,.035],[x,size[1]*.66,size[2]/2+.03],'blue');}
  box(b,'door',[1.1,1.95,.05],[0,1,size[2]/2+.04],'teal');text(b,label,[0,size[1]-.65,size[2]/2+.055],.35,'dark');return b;
}
function jet(g,n,start,end,width=.12,mat='water'){
  // Gravity increases speed and reduces cross-sectional area: A(y) v(y) = constant.
  assert.ok(start[1]>end[1],`Jet ${n} must fall`);
  const h=start[1]-end[1],steps=28,sides=12,positions=[],uv=[],indices=[];
  for(let i=0;i<=steps;i++){const u=i/steps,v=Math.sqrt(1.2**2+2*9.81*h*u),r=width*Math.sqrt(1.2/v);
    for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2;positions.push(start[0]+(end[0]-start[0])*u+r*Math.cos(a),start[1]-h*u,start[2]+(end[2]-start[2])*u+r*Math.sin(a));uv.push(j/sides,u*5);}}
  for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+sides+1;indices.push(a,b,a+1,a+1,b,b+1);}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();mesh(g,n,geo,mat);
  flow(g,'jet_surface_droplets',[start,end],{count:4,radius:width*.22,duration:1,mat:'tracer',stretch:3});
}
function curtain(g,x,z,top,bottom,width,mat='film'){
  const geometry=new T.PlaneGeometry(width,top-bottom,28,18);geometry.translate(0,(top+bottom)/2,0);
  const base=geometry.attributes.position.array.slice();geometry.morphAttributes.position=[];geometry.morphAttributes.normal=[];
  for(let phase=0;phase<4;phase++){const q=geometry.clone(),p=q.attributes.position;
    for(let i=0;i<p.count;i++){const xx=base[i*3],yy=base[i*3+1],u=(top-yy)/(top-bottom);p.setXYZ(i,xx*(1-.025*u),yy,.032*u*Math.sin(xx*8+u*16+phase*Math.PI/2));}
    q.computeVertexNormals();geometry.morphAttributes.position.push(p.clone());geometry.morphAttributes.normal.push(q.attributes.normal.clone());}
  const m=mesh(g,'continuous_water_sheet',geometry,mat,[x,0,z]);m.updateMorphTargets();
  for(let phase=0;phase<4;phase++)track(m,`morphTargetInfluences[${phase}]`,[0,.5,1,1.5,2],Array.from({length:5},(_,i)=>i%4===phase?1:0),'number');
}
function spray(g,start,end,count=7,width=.035){
  const mid=vec(start).lerp(vec(end),.5).add(new T.Vector3(0,.08,0)).toArray();
  flow(g,'fine_spray',[start,mid,end],{count,radius:width,duration:1,mat:'tracer',stretch:2.4});
}
function squareStrand(g,points,side=.36){
  const shape=new T.Shape();shape.moveTo(-side/2,-side/2);shape.lineTo(side/2,-side/2);shape.lineTo(side/2,side/2);shape.lineTo(-side/2,side/2);shape.closePath();
  const curve=new T.CatmullRomCurve3(points.map(vec),false,'centripetal');mesh(g,'solidifying_square_billet',new T.ExtrudeGeometry(shape,{steps:90,bevelEnabled:false,extrudePath:curve}),'billet');return curve;
}
// Deterministic, embedded PBR detail maps; no browser-side shader patches or network textures.
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function pngChunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function png(kind){const size=128,raw=Buffer.alloc(size*(size*4+1));let seed=918;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const offset=y*(size*4+1)+1+x*4;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/4294967296;
    if(kind==='water'){const a=x/size*Math.PI*2,b=y/size*Math.PI*2,dx=.24*Math.cos(7*a+3*b)+.15*Math.cos(13*a-7*b),dy=.16*Math.cos(3*a+9*b)+.11*Math.sin(11*b-5*a);const n=new T.Vector3(dx,dy,1).normalize();raw[offset]=Math.round((n.x*.5+.5)*255);raw[offset+1]=Math.round((n.y*.5+.5)*255);raw[offset+2]=Math.round((n.z*.5+.5)*255);}
    else{const lines=kind==='metal'?(y%16===0?-24:0):0;const c=Math.max(90,Math.min(255,205+noise*40+lines+(noise<.035?-50:0)));raw[offset]=c;raw[offset+1]=c;raw[offset+2]=c;}
    raw[offset+3]=255;
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
}
function addTextures(binary){
  const oldJSON=binary.readUInt32LE(12),doc=JSON.parse(binary.subarray(20,20+oldJSON).toString()),start=28+oldJSON;
  let bin=Buffer.from(binary.subarray(start,start+doc.buffers[0].byteLength));const textures=new Map();
  doc.images??=[];doc.textures??=[];doc.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
  function texture(kind){if(textures.has(kind))return textures.get(kind);const bytes=png(kind),padding=(4-bin.length%4)%4;bin=Buffer.concat([bin,Buffer.alloc(padding)]);const offset=bin.length;bin=Buffer.concat([bin,bytes]);
    const view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});const img=doc.images.length;doc.images.push({bufferView:view,mimeType:'image/png',name:`procedural_${kind}`});const i=doc.textures.length;doc.textures.push({sampler:0,source:img});textures.set(kind,i);return i;}
  for(const m of doc.materials??[]){
    if(['concrete','paving','slab','refractory','rust','slag_cover','billet_skin'].includes(m.name))m.pbrMetallicRoughness.baseColorTexture={index:texture('aggregate')};
    if(['steel','charcoal','dark','copper'].includes(m.name))m.pbrMetallicRoughness.baseColorTexture={index:texture('metal')};
    if(['water','clean_water','raw_water','aeration_water','water_film'].includes(m.name))m.normalTexture={index:texture('water'),scale:m.name==='aeration_water'?.45:.27};
  }
  doc.buffers[0].byteLength=bin.length;bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const header=Buffer.alloc(20),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,json,bh,bin]);
}
async function exportModule(caseId,def){
  reset();const scene=new T.Scene();scene.name=`fluid_v2_${caseId}_${def.id}`;scene.userData={label:def.label,units:'meters',simulation:true,generator:'generate-fluid-cases-v2'};def.build(scene);optimize(scene);
  const animations=tracks.length?[new T.AnimationClip(`${caseId}_${def.id}_cycle`,12,tracks)]:[];
  for(const animation of animations)for(const tr of animation.tracks){const duration=tr.times.at(-1);assert.ok(Math.abs(12/duration-Math.round(12/duration))<1e-5,`Non-periodic track ${tr.name}`);if(duration===12)continue;
    const stride=tr.getValueSize(),times=[],values=[];for(let rep=0;rep<Math.round(12/duration);rep++)for(let i=0;i<tr.times.length;i++){if(rep>0&&i===0)continue;times.push(tr.times[i]+rep*duration);values.push(...tr.values.slice(i*stride,(i+1)*stride));}tr.times=new Float32Array(times);tr.values=new Float32Array(values);}
  const binary=addTextures(Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true,animations,onlyVisible:true})));
  const doc=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString()),names=doc.nodes.map(n=>n.name);
  assert.equal(new Set(names).size,names.length,`Duplicate names: ${scene.name}`);assert.ok(binary.length<25*1024*1024,`Upload budget: ${scene.name}`);
  assert.ok(!doc.buffers.some(b=>b.uri)&&!(doc.images??[]).some(i=>i.uri),'GLB must be self contained');
  const hash=createHash('sha256').update(binary).digest('hex'),filename=`${caseId}-${def.id}.${hash.slice(0,12)}.glb`;writeFileSync(join(output,filename),binary);
  const bounds=new T.Box3().setFromObject(scene);let triangles=0;scene.traverse(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});
  console.log(`${caseId}/${def.id}: ${(binary.length/1024).toFixed(0)} KiB, ${doc.meshes.length} meshes, ${tracks.length} tracks`);
  const {build,...meta}=def;return {...meta,filename,sha256:hash,bytes:binary.length,background:def.background??false,type:def.type??'equipment',metrics:{},meshCount:doc.meshes.length,triangles,nodeCount:doc.nodes.length,animationCount:doc.animations?.length??0,animationChannels:tracks.length,textureCount:doc.images.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
}
export {T,root,output,mats,vec,group,mesh,box,cyl,sphere,line,pipe,ring,text,track,rotate,wave,flow,ripple,rails,pump,control,basin,flange,valve,stair,tree,building,jet,curtain,spray,squareStrand,exportModule};
