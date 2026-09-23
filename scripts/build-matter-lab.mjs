// Original, deterministic visual demonstration: standard glTF, not a CFD solver.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';

const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(join(root,'apps/web/package.json'));
const T=require('three');
const three=dirname(dirname(require.resolve('three')));
const {GLTFExporter}=await import(pathToFileURL(join(three,'examples/jsm/exporters/GLTFExporter.js')));
const {RoundedBoxGeometry}=await import(pathToFileURL(join(three,'examples/jsm/geometries/RoundedBoxGeometry.js')));
const {mergeGeometries}=await import(pathToFileURL(join(three,'examples/jsm/utils/BufferGeometryUtils.js')));
const captions=JSON.parse(readFileSync(join(root,'scripts/fluid-assets/matter-label-outlines.json')));
const output=join(root,'demo-assets/matter-lab');
mkdirSync(output,{recursive:true});
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();},error=>this.onerror?.(error));}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result=`data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;this.onloadend?.();},error=>this.onerror?.(error));}
};
const tau=Math.PI*2, duration=12;
const vec=p=>new T.Vector3(...p);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
let seed=20260922;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
let serial=0,tracks=[],animated=new Set(),visibleLabels=[];
const id=n=>`${n}_${String(++serial).padStart(5,'0')}`;
const material=(name,color,roughness=.4,metalness=0,extra={})=>new T.MeshPhysicalMaterial({name,color,roughness,metalness,...extra});
const mats={
  titanium:material('brushed_titanium','#9eaeb8',.29,.88),
  graphite:material('graphite_ceramic','#1b2430',.33,.65),
  dark:material('anodized_charcoal','#10151e',.44,.6),
  floor:material('satin_basalt','#222b39',.34,.5),
  brass:material('brushed_brass','#b38244',.3,.85),
  white:material('etched_lettering','#d1dfec',.42,.15),
  cyan:material('cyan_light','#49d6f3',.25,.2,{emissive:'#14bdda',emissiveIntensity:2}),
  amber:material('amber_light','#ffb050',.25,.2,{emissive:'#ff701b',emissiveIntensity:2}),
  ice:material('ice_light','#a5bddd',.3,.2,{emissive:'#6d9edd',emissiveIntensity:1.2}),
  water:material('water_surface','#047f9b',.095,.08,{ior:1.333,clearcoat:1,clearcoatRoughness:.06,side:T.DoubleSide,transmission:.22,thickness:.65}),
  waterSheet:material('water_sheet','#a9dfe3',.045,0,{ior:1.333,clearcoat:1,side:T.DoubleSide,transmission:.92,thickness:.12}),
  drop:material('water_droplets','#9debf0',.06,.04,{ior:1.333,clearcoat:1,transmission:.5,thickness:.06}),
  foam:material('whitewater_foam','#d9f5ed',.45,0,{transparent:true,opacity:.38,depthWrite:false,side:T.DoubleSide}),
  glass:material('clear_guard_glass','#a5d8e2',.055,0,{transmission:.92,thickness:.15,ior:1.46,transparent:true,opacity:.23,side:T.DoubleSide,depthWrite:false}),
  refractory:material('refractory_ceramic','#4d3f39',.94,.06),
  molten:material('molten_metal','#ec6b23',.24,.57,{emissive:'#ff4104',emissiveIntensity:1.5,side:T.DoubleSide}),
  hot:material('white_hot_core','#ffd27c',.2,.25,{emissive:'#ffae30',emissiveIntensity:2.1,side:T.DoubleSide}),
  crust:material('cooling_crust','#322723',.9,.12,{emissive:'#7a1703',emissiveIntensity:.24}),
  smoke:new T.MeshBasicMaterial({name:'volumetric_smoke',color:'#c4d1df',transparent:true,opacity:.62,depthWrite:false,side:T.DoubleSide}),
  glow:new T.MeshBasicMaterial({name:'heat_halo',color:'#ff7717',transparent:true,opacity:.24,depthWrite:false,side:T.DoubleSide}),
  backdrop:new T.MeshBasicMaterial({name:'studio_gradient_backdrop',color:'#ffffff',side:T.DoubleSide}),
};
function mesh(g,name,geometry,mat,p=[0,0,0],r=[0,0,0]){const m=new T.Mesh(geometry,typeof mat==='string'?mats[mat]:mat);m.name=id(name);m.position.set(...p);m.rotation.set(...r);g.add(m);return m;}
function group(g,name,p=[0,0,0]){const n=new T.Group();n.name=id(name);n.position.set(...p);g.add(n);return n;}
function box(g,name,size,p,mat='graphite',radius=.07){return mesh(g,name,new RoundedBoxGeometry(...size,3,Math.min(radius,...size.map(v=>v*.24))),mat,p);}
function cylinder(g,name,r,h,p,mat='titanium',rt=r,open=false){return mesh(g,name,new T.CylinderGeometry(rt,r,h,64,1,open),mat,p);}
function ring(g,name,r,t,p,mat='titanium',rotation=[Math.PI/2,0,0]){return mesh(g,name,new T.TorusGeometry(r,t,12,96),mat,p,rotation);}
function pipe(g,name,points,r=.08,mat='titanium'){return mesh(g,name,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(vec)),96,r,12,false),mat);}
function rod(g,name,a,b,r=.04,mat='titanium'){const d=vec(b).sub(vec(a)),m=cylinder(g,name,r,d.length(),vec(a).add(vec(b)).multiplyScalar(.5).toArray(),mat);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return m;}
function label(g,words,size,p,mat='white',floor=false){
  const commands=captions.captions[words];assert.ok(commands,`Missing authored Chinese caption: ${words}`);
  const path=new T.ShapePath(),scale=size/captions.unitsPerEm;
  for(const [op,...points] of commands){const v=points.map(n=>n*scale);if(op==='m')path.moveTo(...v);else if(op==='l')path.lineTo(...v);else if(op==='q')path.quadraticCurveTo(...v);else if(op==='c')path.bezierCurveTo(...v);else if(op==='z')path.currentPath.closePath();else throw new Error(`Invalid caption outline: ${op}`);}
  const geo=new T.ShapeGeometry(path.toShapes(),8);assert.ok(geo.attributes.position.count>0,`Empty caption: ${words}`);geo.computeBoundingBox();geo.translate(-(geo.boundingBox.max.x+geo.boundingBox.min.x)/2,-geo.boundingBox.min.y,0);visibleLabels.push(words);
  return mesh(g,'engraved_label',geo,mat,p,floor?[-Math.PI/2,0,0]:[0,0,0]);
}
function keyframes(node,prop,times,values,number=false){animated.add(node);if(prop==='position'||prop==='scale')node[prop].fromArray(values[0]);tracks.push(new (number?T.NumberKeyframeTrack:T.VectorKeyframeTrack)(`${node.name}.${prop}`,times,values.flat()));}
function pulse(node,scale=[1,1,1],amount=.06,period=3){const ts=[],vs=[];for(let i=0;i<=48;i++){const t=duration*i/48;ts.push(t);vs.push(scale.map(v=>v*(1+amount*Math.sin(tau*t/period))));}keyframes(node,'scale',ts,vs);}
// A one-hot morph cycle interpolates fluid surfaces without runtime shader overrides.
function morphSurface(g,name,geometry,mat,deform,period=3,phases=8){
  const base=geometry.attributes.position.array.slice();geometry.morphAttributes.position=[];geometry.morphAttributes.normal=[];
  for(let k=0;k<phases;k++){const q=geometry.clone(),p=q.attributes.position;
    for(let i=0;i<p.count;i++)p.setXYZ(i,...deform(base[i*3],base[i*3+1],base[i*3+2],k*tau/phases));
    q.computeVertexNormals();geometry.morphAttributes.position.push(p.clone());geometry.morphAttributes.normal.push(q.attributes.normal.clone());}
  const m=mesh(g,name,geometry,mat);m.updateMorphTargets();
  for(let k=0;k<phases;k++){const times=[],values=[];for(let j=0;j<=duration/period*phases;j++){times.push(j*period/phases);values.push(j%phases===k?1:0);}keyframes(m,`morphTargetInfluences[${k}]`,times,values,true);}
  m.userData={category:'flow',label:name};return m;
}
function pool(g,name,r,y,mat,amplitude=.09,vortex=false){
  const positions=[0,y,0],uv=[.5,.5],indices=[],rings=32,sectors=128;
  for(let j=1;j<=rings;j++)for(let i=0;i<=sectors;i++){const rr=r*j/rings,a=i*tau/sectors;positions.push(rr*Math.cos(a),y,rr*Math.sin(a));uv.push(.5+rr*Math.cos(a)/r/2,.5+rr*Math.sin(a)/r/2);}
  for(let i=0;i<sectors;i++)indices.push(0,i+2,i+1);
  for(let j=0;j<rings-1;j++)for(let i=0;i<sectors;i++){const a=1+j*(sectors+1)+i,b=a+sectors+1;indices.push(a,a+1,b,b,a+1,b+1);}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  return morphSurface(g,name,geo,mat,(x,yy,z,p)=>{const rr=Math.hypot(x,z),a=Math.atan2(z,x),edge=smooth((r-rr)/.3);return[x,yy+edge*(amplitude*smooth(rr/.4)*(Math.sin(rr*7-p*2+a*2)*.6+Math.cos(x*4-z*3+p)*.4)-(vortex?.48*Math.exp(-rr*rr/.65):0)),z];},3);
}
function curtain(g,name,width,top,bottom,z,mat,thickness=.035){
  const geo=new T.PlaneGeometry(width,top-bottom,48,48);geo.translate(0,(top+bottom)/2,z);
  return morphSurface(g,name,geo,mat,(x,y,zz,p)=>{const u=(top-y)/(top-bottom),ripple=Math.sin(x*6+u*9-p*2)*.11+Math.sin(x*13-u*17+p)*.045;return[x*(1-.065*u)+u*.025*Math.sin(u*12-p*2),y,zz+u*ripple+thickness*Math.sin(x*9+u*22-p*2)];},2);
}
function fluidStrand(g,name,points,r,mat,phase=0){
  const curve=new T.CatmullRomCurve3(points.map(vec));const geo=new T.TubeGeometry(curve,100,r,12,false);
  return morphSurface(g,name,geo,mat,(x,y,z,p)=>[x+.03*Math.sin(y*7-p*2+phase),y,z+.025*Math.sin(y*9+p*2+phase)],2,6);
}
function particles(g,name,count,mat,trajectory,{period=3,size=.035,stretch=1}={}){
  const geo=new T.SphereGeometry(1,10,7);
  for(let i=0;i<count;i++){const offset=i/count,params=[random(),random(),random()];const m=mesh(g,name,geo,mat);const ts=[],ps=[],ss=[];
    for(let k=0;k<=144;k++){const t=duration*k/144,u=((t/period+offset)%1+1)%1,fade=smooth(u/.045)*(1-smooth((u-.85)/.15)),p=trajectory(u,params,i);ts.push(t);ps.push(p);ss.push([size*fade,size*stretch*fade,size*fade]);}
    keyframes(m,'position',ts,ps);keyframes(m,'scale',ts,ss);m.userData.category='flow';}
}
function bolts(g,r,y,count=24){for(let i=0;i<count;i++){const a=i*tau/count;cylinder(g,'socket_bolt',.048,.065,[r*Math.cos(a),y,r*Math.sin(a)],'titanium');}}
function plinth(g,accent){cylinder(g,'pod_lower',3.75,.28,[0,.65,0],'dark');cylinder(g,'pod_machined_rim',3.64,.1,[0,.84,0]);cylinder(g,'pod_top',3.56,.2,[0,.97,0],'graphite');ring(g,'illuminated_pod_edge',3.64,.025,[0,.72,0],accent);bolts(g,3.45,1.09);}
function nameplate(g,number,title,subtitle,accent){box(g,'nameplate',[6.7,.82,.13],[0,.89,4.65],'dark');label(g,`${number} / ${title}`,.46,[0,.96,4.724],accent);label(g,subtitle,.23,[0,.64,4.725]);}

function stage(g){
  box(g,'floating_exhibit_base',[29.7,.42,12.6],[0,.2,.2],'dark',.2);box(g,'satin_exhibit_surface',[29.2,.11,12.1],[0,.465,.2],'floor',.05);
  for(const x of [-9.4,0,9.4]){box(g,'service_lane',[.022,.008,10.4],[x+4.4,.526,.1],'titanium',0);}
  box(g,'front_silver_inlay',[27.7,.025,.08],[0,.21,6.48],'titanium',.01);
  label(g,'流体万象 · 三相实验舱',.63,[0,.535,5.77],'white',true);
  label(g,'气体翻卷 · 液体流动 · 熔融浇注',.27,[0,.535,6.18],'white',true);
  for(const [x,a] of [[-9.4,'ice'],[0,'cyan'],[9.4,'amber']]){
    box(g,'rear_service_cabinet',[6.1,1.35,.65],[x,1.17,-4.5],'graphite');box(g,'rear_service_trim',[5.55,.036,.02],[x,1.59,-4.16],a,.005);
    for(let j=0;j<12;j++)box(g,'cabinet_vent',[.032,.51,.03],[x-2.15+j*.105,1.13,-4.155],'dark',.004);
    for(let j=0;j<3;j++){cylinder(g,'service_indicator',.035,.025,[x+1.6+j*.21,1.37,-4.15],a).rotation.x=Math.PI/2;}
    rod(g,'service_conduit',[x-2.8,.57,-4.0],[x-2.8,.57,-1.8],.075,'dark');
  }
}
function gas(g){
  plinth(g,'ice');nameplate(g,'01','气体','翻卷 · 扩散','ice');
  cylinder(g,'turbulence_chamber',1.65,.85,[0,1.5,0],'graphite');cylinder(g,'diffuser_top',1.73,.16,[0,1.97,0]);
  ring(g,'diffuser_lip',1.54,.045,[0,2.1,0],'ice');bolts(g,1.6,2.075,20);
  for(let r=.24;r<1.4;r+=.19)ring(g,'perforated_diffuser_ring',r,.027,[0,2.06,0],'dark');
  for(const s of [-1,1]){
    box(g,'air_duct_foot',[.65,.2,.7],[s*2.8,1.15,-.4]);rod(g,'arched_chamber_support',[s*2.8,1.25,-.4],[s*2.8,8.0,-.4],.075,'titanium');
    pipe(g,'intake_tube',[[s*2.45,1.2,-2.5],[s*2.45,1.7,-2.2],[s*1.6,1.6,-.6]],.18);
    ring(g,'stanchion_collar',.17,.035,[s*2.8,1.6,-.4]);
  }
  ring(g,'open_capture_hood',2.7,.13,[0,8.08,-.4]);ring(g,'capture_hood_inset',2.56,.025,[0,8.08,-.4],'ice');
  // Intersecting, noise-textured volumes remain visible from every orbit angle.
  const geo=new T.PlaneGeometry(1,1,1,1);
  for(let i=0;i<46;i++){
    const n=group(g,'advecting_vapour'),phase=i/46,a0=random()*tau,lane=(random()-.5)*.5;
    for(let j=0;j<2;j++){const p=mesh(n,'soft_density_slice',geo,'smoke');p.rotation.set(0,a0+j*Math.PI/2,(random()-.5)*1.1);}
    const times=[],positions=[],scales=[];
    for(let k=0;k<=192;k++){const t=duration*k/192,u=((t/6+phase)%1+1)%1,a=a0+u*5.5,spread=.23+u*.83,fade=smooth(u/.085)*(1-smooth((u-.7)/.3)),s=(1.05+u*2.35)*fade;
      times.push(t);positions.push([Math.sin(a)*spread+lane,2.1+u*5.9,-.12+Math.cos(a*1.13)*spread*.54]);scales.push([s,s*1.13,s]);}
    keyframes(n,'position',times,positions);keyframes(n,'scale',times,scales);n.userData.category='flow';
  }
}
function water(g){
  plinth(g,'cyan');nameplate(g,'02','液体','瀑流 · 涡流 · 飞溅','cyan');
  cylinder(g,'catchment_basin',2.94,.39,[0,1.27,0],'titanium');cylinder(g,'deep_water',2.81,.24,[0,1.4,0],'water');
  ring(g,'basin_rolled_edge',2.88,.065,[0,1.54,0]);pool(g,'circulating_water_surface',2.8,1.58,'water',.115,true);
  for(const x of [-2.52,2.52]){box(g,'waterfall_spine',[.23,4.85,.4],[x,3.88,-1.45],'titanium');box(g,'blue_edge_light',[.03,4.5,.035],[x,3.93,-1.2],'cyan',.009);}
  box(g,'overflow_reservoir',[5.45,.57,1.15],[0,6.02,-1.55],'titanium');box(g,'overflow_shadow',[4.85,.21,.95],[0,6.27,-1.49],'dark');
  box(g,'upper_sheet_water',[4.78,.035,.95],[0,6.39,-1.4],'water',.005);rod(g,'polished_weir',[-2.43,6.37,-.94],[2.43,6.37,-.94],.04);
  curtain(g,'falling_water_membrane',4.76,6.39,1.58,-.93,'waterSheet');
  pipe(g,'recirculation_riser',[[2.97,1.5,-.4],[3.08,1.9,-1.9],[2.99,5.55,-2.1],[2.37,6.08,-1.8]],.16);
  for(let y=2;y<5.5;y+=.7){ring(g,'riser_flange',.22,.04,[3.03,y,-2.05]);}
  // The second narrow stream makes the direction and scale of the water unmistakable.
  const jet=fluidStrand(g,'arched_water_jet',[[-2.2,1.8,1.1],[-1.6,3.5,1.35],[-.6,3.8,1.5],[.55,1.64,1.6]],.075,'waterSheet');
  const nozzle=cylinder(g,'fountain_nozzle',.13,.3,[-2.2,1.7,1.1]);nozzle.rotation.z=-.6;
  particles(g,'water_spray',88,'drop',(u,p)=>{const x=(p[0]-.5)*4.4,v=2.5+p[1]*2.5,t=u*v/4.9;return[x+(p[2]-.5)*u*.7,1.6+v*t-4.9*t*t,-.87+u*(1.1+p[2]*1.8)];},{period:1,size:.028,stretch:1.9});
  particles(g,'arc_spray',22,'drop',(u,p)=>[-2.2+2.77*u+(p[0]-.5)*.07,1.79+7.8*u*(1-u),1.1+.5*u],{period:2,size:.023,stretch:1.6});
  for(let i=0;i<12;i++){
    const r=ring(g,'expanding_impact_ripple',.25,.008,[.7,1.63,1.1],'foam');const ts=[],ss=[];
    for(let k=0;k<=144;k++){const t=duration*k/144,u=((t/2+i/12)%1+1)%1,fade=1-smooth((u-.85)/.15),s=(.1+u*4)*fade;ts.push(t);ss.push([s,s,.25*fade]);}keyframes(r,'scale',ts,ss);
  }
  // The low guard keeps the cutaway unobstructed, while showing tinted glass edges.
  for(const s of [-1,1]){box(g,'glass_guard',[.025,1.35,2.4],[s*3.05,1.88,1.2],'glass',.005);for(const z of [.1,2.3])box(g,'glass_clamp',[.14,.17,.22],[s*3.05,1.28,z],'titanium',.02);}
}
function molten(g){
  plinth(g,'amber');nameplate(g,'03','熔融','浇注 · 对流 · 冷却','amber');
  cylinder(g,'casting_vessel_shell',2.83,.65,[0,1.4,.3],'graphite');cylinder(g,'refractory_liner',2.7,.4,[0,1.64,.3],'refractory');
  ring(g,'casting_vessel_rim',2.72,.09,[0,1.88,.3],'titanium');
  const melt=group(g,'melt_bath',[0,0,.3]);pool(melt,'convecting_hot_melt',2.57,1.86,'molten',.095);
  for(let i=0;i<26;i++){
    const a=i*2.399,r=.45+Math.sqrt((i+.5)/26)*1.8,xx=r*Math.cos(a),zz=r*Math.sin(a);const island=mesh(melt,'floating_slag_island',new T.IcosahedronGeometry(.15+(i%4)*.07,1),'crust',[xx,1.9,zz]);island.scale.set(1,.09,.6);
    keyframes(island,'position',[0,3,6,9,12],[[xx,1.9,zz],[xx+.08,1.92,zz+.06],[xx,1.9,zz],[xx-.08,1.92,zz-.06],[xx,1.9,zz]]);
  }
  // Tilted refractory crucible, with a fully open inner bowl and a true lip.
  const crucible=group(g,'tilted_crucible',[0,5.68,-1.13]);crucible.rotation.x=.4;
  const pts=[[0,-1.0],[.74,-1.0],[1.02,-.76],[1.3,1.0],[1.15,1.08],[.97,-.62],[.68,-.81],[0,-.81]].map(p=>new T.Vector2(...p));
  mesh(crucible,'heavy_crucible',new T.LatheGeometry(pts,96),'refractory');
  ring(crucible,'crucible_outer_band',1.02,.12,[0,-.38,0],'titanium');ring(crucible,'crucible_top_band',1.3,.1,[0,.95,0],'titanium');
  pool(crucible,'crucible_hot_surface',1.05,.68,'molten',.03);
  for(const s of [-1,1]){
    box(g,'crucible_support_column',[.43,4.7,.52],[s*2.3,3.4,-1.42],'graphite');rod(g,'crucible_pivot',[s*1.0,5.55,-1.25],[s*2.36,5.55,-1.25],.19,'titanium');
    const cap=cylinder(g,'pivot_disk',.4,.16,[s*2.49,5.55,-1.25],'titanium');cap.rotation.z=Math.PI/2;
    box(g,'warm_spine_accent',[.032,3.55,.018],[s*2.3,3.4,-1.149],'amber',.003);
  }
  // Lip connects the visibly tilted bowl to the gravity stream.
  const lip=box(g,'pour_spout',[.62,.15,1.02],[0,6.15,.21],'refractory');lip.rotation.x=.17;
  fluidStrand(g,'molten_falling_column',[[0,6.19,.14],[.03,5.8,.68],[.06,4.5,.84],[.03,3,.87],[0,1.92,.9]],.185,'molten');
  fluidStrand(g,'incandescent_stream_core',[[0,6.21,.14],[.03,5.8,.695],[.06,4.5,.872],[.03,3,.9],[0,1.92,.94]],.099,'hot',1);
  for(let i=0;i<7;i++){const a=i*tau/7;fluidStrand(melt,'hot_convection_vein',[[.2*Math.cos(a),1.97,.6+.2*Math.sin(a)],[.7*Math.cos(a+.4),1.99,.3+.7*Math.sin(a+.4)],[1.5*Math.cos(a+.8),1.94,1.5*Math.sin(a+.8)],[2.2*Math.cos(a+1.0),1.91,2.2*Math.sin(a+1.0)]],.012,'hot',i);}
  particles(g,'incandescent_spatter',55,'hot',(u,p)=>{const a=p[0]*tau,v=2+p[1]*3.3,t=u*v/4.3,r=u*(.9+p[2]*2.4);return[Math.cos(a)*r,1.96+v*t-4.3*t*t,.9+Math.sin(a)*r*.66];},{period:2,size:.024,stretch:1.9});
  const halo=mesh(g,'soft_hot_contact_glow',new T.PlaneGeometry(1.7,1.7),'glow',[0,2.0,.91],[-Math.PI/2,0,0]);pulse(halo,[1,1,1],.16,2);
  for(let j=0;j<3;j++){const h=mesh(g,'stream_heat_halo',new T.PlaneGeometry(.9,4.2),'glow',[.01,4.01,.9],[0,j*Math.PI/3,0]);pulse(h,[1,1,1],.08,3);}
}

function backdrop(g){
  // An ordinary, removable studio light screen. It is not a camera-bound skybox.
  const direction=vec([-1.35,.78,1.78]).normalize(),center=vec([0,4,0]).addScaledVector(direction,-18);
  const screen=mesh(g,'studio_soft_gradient_screen',new T.PlaneGeometry(68,62),'backdrop',center.toArray());
  screen.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),direction);
}

// PNG textures are authored procedurally and embedded in the GLB binary.
function hash2(x,y){let h=Math.imul(x,374761393)+Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;}
function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y),a=smooth(x-ix),b=smooth(y-iy);return T.MathUtils.lerp(T.MathUtils.lerp(hash2(ix,iy),hash2(ix+1,iy),a),T.MathUtils.lerp(hash2(ix,iy+1),hash2(ix+1,iy+1),a),b);}
function fbm(x,y){let v=0,a=.54;for(let i=0;i<6;i++){v+=noise(x,y)*a;x=x*2.03+17;y=y*2.03+9;a*=.49;}return v;}
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c]);}
function png(kind){const size=512,raw=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const o=y*(size*4+1)+1+x*4,u=x/size,v=y/size,n=fbm(u*8,v*8);let c=[255,255,255,255];
    if(kind==='smoke'){
      const dx=(u-.5)*2,dy=(v-.5)*2,edge=clamp(1-Math.hypot(dx,dy)),warp=fbm(u*3+20,v*3+10),density=fbm(u*7+warp*2,v*7+warp*2);
      const alpha=clamp((density-.17)*2.0)*Math.pow(smooth(edge*1.8),1.5),lit=clamp(.52+fbm(u*5-.18,v*5-.2)*.55-v*.08);
      c=[230*lit,240*lit,255*lit,255*alpha];
    }else if(kind==='studio'){
      const cool=Math.exp(-((u-.25)**2/.15+(v-.3)**2/.2)),warm=Math.exp(-((u-.85)**2/.065+(v-.66)**2/.16));
      const wash=Math.exp(-((u-.52)**2/.38+(v-.46)**2/.1)),grain=(hash2(x,y)-.5)*1.8;
      const sweep=Math.exp(-((v-.75-u*.23)**2)/.004)*2.8;
      c=[10+cool*13+warm*20+wash*5+sweep+grain,17+cool*26+warm*11+wash*7+sweep+grain,27+cool*39+warm*4+wash*10+sweep+grain,255];
    }else if(kind==='glow'){const d=Math.hypot((u-.5)*2,(v-.5)*2);c=[255,255,255,255*Math.pow(clamp(1-d),3)];}
    else if(kind==='waterFallNormal'){
      const a=u*tau,b=v*tau,dx=.23*Math.cos(a*21+b*2)+.13*Math.sin(a*39+b*5)+.06*Math.sin(a*67-b*11),dy=.055*Math.cos(a*7+b*19);
      const nn=new T.Vector3(dx,dy,1).normalize();c=[(nn.x*.5+.5)*255,(nn.y*.5+.5)*255,(nn.z*.5+.5)*255,255];
    }else if(kind==='waterNormal'){
      const a=u*tau,b=v*tau,dx=.2*Math.cos(a*15+b*6)+.14*Math.sin(a*27-b*19)+.07*Math.sin(a*51+b*37),dy=.16*Math.sin(a*9+b*17)+.1*Math.cos(a*23-b*31);
      const nn=new T.Vector3(dx,dy,1).normalize();c=[(nn.x*.5+.5)*255,(nn.y*.5+.5)*255,(nn.z*.5+.5)*255,255];
    }else if(kind==='metal'){const scratch=hash2(x,y),stripe=noise(u*4,v*220);const b=199+stripe*33+scratch*16;c=[b,b,b,255];}
    else if(kind==='lava'){
      const n1=fbm(u*7+2*Math.sin(v*6),v*7),vein=Math.pow(clamp(1-Math.abs(n1-.48)*18),1.7);c=[180+vein*75,36+vein*160,4+vein*46,255];
    }else if(kind==='stone'){const b=150+n*90;c=[b,b*.97,b*.92,255];}
    else throw new Error(`Unknown procedural texture ${kind}`);
    for(let k=0;k<4;k++)raw[o+k]=Math.round(clamp(c[k],0,255));
  }
  const h=Buffer.alloc(13);h.writeUInt32BE(size,0);h.writeUInt32BE(size,4);h[8]=8;h[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const textureCache=new Map();
function embedTextures(binary){
  const len=binary.readUInt32LE(12),doc=JSON.parse(binary.subarray(20,20+len)),used=new Map();let bin=Buffer.from(binary.subarray(28+len,28+len+doc.buffers[0].byteLength));
  doc.images=[];doc.textures=[];doc.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
  function tex(kind){if(used.has(kind))return used.get(kind);if(!textureCache.has(kind))textureCache.set(kind,png(kind));const bytes=textureCache.get(kind);bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);const offset=bin.length;bin=Buffer.concat([bin,bytes]);const view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});const i=doc.images.length;doc.images.push({bufferView:view,mimeType:'image/png',name:`matter_lab_${kind}_512`});doc.textures.push({sampler:0,source:i});used.set(kind,i);return i;}
  for(const m of doc.materials){
    if(m.name==='studio_gradient_backdrop')m.pbrMetallicRoughness.baseColorTexture={index:tex('studio')};
    if(m.name==='volumetric_smoke')m.pbrMetallicRoughness.baseColorTexture={index:tex('smoke')};
    if(m.name==='heat_halo')m.pbrMetallicRoughness.baseColorTexture={index:tex('glow')};
    if(['water_surface','water_sheet','water_droplets'].includes(m.name))m.normalTexture={index:tex(m.name==='water_sheet'?'waterFallNormal':'waterNormal'),scale:m.name==='water_surface'?.72:.4};
    if(['brushed_titanium','brushed_brass','graphite_ceramic'].includes(m.name))m.pbrMetallicRoughness.baseColorTexture={index:tex('metal')};
    if(['refractory_ceramic','cooling_crust','satin_basalt'].includes(m.name))m.pbrMetallicRoughness.baseColorTexture={index:tex('stone')};
    if(m.name==='molten_metal'){m.pbrMetallicRoughness.baseColorTexture={index:tex('lava')};m.emissiveTexture={index:tex('lava')};}
  }
  doc.buffers[0].byteLength=bin.length;bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const h=Buffer.alloc(20),b=Buffer.alloc(8);h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+bin.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);b.writeUInt32LE(bin.length);b.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,json,b,bin]);
}
function mergeStatic(scene){
  scene.updateMatrixWorld(true);const buckets=new Map(),remove=[];
  scene.traverse(o=>{if(!o.isMesh||o.material.transparent||o.geometry.morphAttributes.position?.length)return;let p=o;while(p){if(animated.has(p))return;p=p.parent;}
    const geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(o.matrixWorld);for(const key of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(key))geo.deleteAttribute(key);assert.ok(geo.attributes.uv,`Missing UV ${o.name}`);
    if(!buckets.has(o.material))buckets.set(o.material,[]);buckets.get(o.material).push(geo);remove.push(o);});
  remove.forEach(o=>o.removeFromParent());for(const [mat,geos] of buckets){const merged=mergeGeometries(geos,false);assert.ok(merged,`Cannot merge material ${mat.name}`);mesh(scene,`static_${mat.name}`,merged,mat);geos.forEach(g=>g.dispose());}
}
const defs=[{id:'stage',label:'整体展台 · 金属与灯光',position:[0,0,0],build:stage,background:true},{id:'gas',label:'气体 · 翻卷与扩散',position:[-9.4,0,0],build:gas},{id:'liquid',label:'液体 · 瀑流、涡流与飞溅',position:[0,0,0],build:water},{id:'molten',label:'熔融 · 浇注与热对流',position:[9.4,0,0],build:molten},{id:'backdrop',label:'摄影棚背景 · 冷暖渐变光幕',position:[0,0,0],build:backdrop,background:true}];
const modules=[];
for(const def of defs){
  serial=0;tracks=[];animated=new Set();visibleLabels=[];seed=20260922;
  const scene=new T.Scene();scene.name=`matter_lab_${def.id}`;scene.userData={label:def.label,simulation:true,units:'meters',description:'原创预设流体视觉动画，非 CFD、非真实生产采集。',generator:'build-matter-lab-v1'};def.build(scene);scene.userData.visibleLabels=visibleLabels;mergeStatic(scene);
  const animations=tracks.length?[new T.AnimationClip(`${def.id}_continuous_cycle`,duration,tracks)]:[];
  const binary=embedTextures(Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true,animations,onlyVisible:true})));
  const doc=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)));const names=doc.nodes.map(n=>n.name);assert.equal(new Set(names).size,names.length,'Duplicate node names');assert.ok(binary.length<50*1024*1024,'Model upload budget exceeded');
  const sha256=createHash('sha256').update(binary).digest('hex'),filename=`matter-${def.id}.${sha256.slice(0,12)}.glb`;writeFileSync(join(output,filename),binary);
  let triangles=0;scene.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});const bounds=new T.Box3().setFromObject(scene);
  const {build,...meta}=def;const result={...meta,filename,sha256,bytes:binary.length,meshes:doc.meshes.length,triangles,animationCount:doc.animations?.length??0,animationChannels:tracks.length,textureCount:doc.images.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};modules.push(result);console.log(JSON.stringify(result));
}
const manifest={version:1,title:'三相流体实验舱｜气体 · 液体 · 熔融（视觉演示）',duration,simulation:true,modules,settings:{animationSpeed:1,autoRotate:false,backgroundColor:'#080e18',backgroundOpacity:1,cameraFov:36,cameraView:'isometric-left',preventBottomView:true,environmentLightColor:'#d6e7fa',environmentLightIntensity:1.1,keyLightColor:'#fff4df',keyLightIntensity:3.2,modelScale:3.55,playAnimations:true,rotationSpeed:.12,showGrid:false}};
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Saved ${modules.length} modules; ${(modules.reduce((s,m)=>s+m.bytes,0)/1048576).toFixed(2)} MiB total.`);
