// Original conceptual chemical workshop, metres/Y-up. No engineering compliance claim.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(join(root,'apps/web/package.json')); const T=require('three');
const {GLTFExporter}=await import(pathToFileURL(join(dirname(dirname(require.resolve('three'))),'examples/jsm/exporters/GLTFExporter.js')));
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();},error=>this.onerror?.(error));}};
const scene=new T.Scene(); scene.name='chemical_workshop'; let count=0;
const material=(name,color,metalness=0,roughness=.55)=>new T.MeshStandardMaterial({name,color,metalness,roughness});
const floor=material('epoxy','#294653'),wall=material('wall','#254658'),steel=material('stainless','#a6c2cd',.65,.28),dark=material('structure','#335467',.5),yellow=material('safety','#d3aa45'),green=material('cooling_water','#399f93',.35),blue=material('process_water','#4a93be',.35),black=material('drain','#132b35'),screen=material('instrument','#51cacc',.1);
function mesh(name,g,p,m){const o=new T.Mesh(g,m);o.name=name+'_'+(++count);o.position.set(...p);scene.add(o);return o;}
function box(name,p,size,m){return mesh(name,new T.BoxGeometry(...size),p,m);}
function pipe(name,a,b,r,m=steel){const av=new T.Vector3(...a),bv=new T.Vector3(...b),d=bv.clone().sub(av);const o=mesh(name,new T.CylinderGeometry(r,r,d.length(),12),av.add(bv).multiplyScalar(.5).toArray(),m);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;}
box('epoxy_floor',[0,-.16,0],[34,.25,24],floor);
box('rear_wall',[0,3.2,-9],[34,6.4,.2],wall);
for(let x=-16;x<=16;x+=4){box('steel_column',[x,3.2,-8.7],[.2,6.4,.22],dark);box('high_window',[x+1.8,4.7,-8.83],[3.3,1.2,.06],screen);}
// Containment perimeter and grated drain follow the actual seven-shaped process line.
for(const [p,s] of [[[0,.06,-7.4],[27,.12,.12]],[[0,.06,-2.6],[27,.12,.12]],[[-13.5,.06,-5],[.12,.12,4.8]],[[13.5,.06,0],[.12,.12,15]],[[7.7,.06,3],[.12,.12,11]],[[10.6,.06,8.5],[5.8,.12,.12]]])box('containment_kerb',p,s,yellow);
box('drain_channel',[0,-.015,-2.3],[27,.04,.34],black);
for(let x=-13.4;x<13.5;x+=.25)box('drain_grating',[x,.015,-2.3],[.035,.025,.34],steel);
// Utility header behind the production equipment, with valve handwheels and drops.
for(const [y,m] of [[3.9,steel],[4.3,green],[4.7,blue]]){
 pipe('utility_header',[-14,y,-7.8],[14,y,-7.8],.09,m);
 for(const x of [-10,-5,0,5,10]){pipe('utility_drop',[x,y,-7.8],[x,1,-7.8],.035,m);pipe('valve_stem',[x,2.6,-7.8],[x,2.6,-7.48],.025,dark);const wheel=mesh('valve_handwheel',new T.TorusGeometry(.14,.025,8,16),[x,2.6,-7.45],yellow); wheel.rotation.z=Math.PI/4;}
}
for(const x of [-13,-7,-1,5,13]){box('pipe_rack_column',[x,2.6,-8.1],[.12,5.2,.12],dark);box('pipe_rack_beam',[x,5.1,-7.6],[.12,.12,1.2],steel);}
// Service platform at the reactor, stainless rail and access stair.
box('service_platform',[-10,1.2,-6.9],[4,.12,.8],dark);
for(const x of [-12,-10,-8]){pipe('platform_leg',[x,0,-7],[x,2.2,-7],.035,steel);}
pipe('platform_handrail',[-12,2.2,-7],[-8,2.2,-7],.035,yellow);
for(let i=0;i<5;i++)box('access_step',[-12.6+i*.18,.12+i*.24,-6.9],[.38,.12,.8],steel);
// Two utility vessels at the far left; cabinets/eyewash identify the process environment.
for(const [x,z] of [[-15,-5],[-15,-1]]){pipe('utility_vessel',[x,.4,z],[x,2.6,z],.65,steel);mesh('vessel_head',new T.SphereGeometry(.65,20,10),[x,2.6,z],steel).scale.y=.35;pipe('vessel_supply',[x,2.7,z],[x,3.9,z],.06,green);for(const dx of [-.45,.45])box('vessel_leg',[x+dx,.2,z],[.1,.4,.1],dark);}
for(const x of [2.7,4]){box('control_cabinet',[x,1.05,-8],[.95,2.1,.5],dark);box('control_display',[x,1.5,-7.73],[.55,.35,.03],screen);for(let i=0;i<3;i++)box('control_key',[x-.2+i*.2,1.15,-7.71],[.08,.08,.04],i===0?green:yellow);}
pipe('eyewash_pedestal',[-13,0,3],[-13,1.2,3],.055,green);mesh('eyewash_bowl',new T.CylinderGeometry(.3,.15,.12,20),[-13,1.2,3],steel);pipe('shower_riser',[-13,0,3.4],[-13,2.7,3.4],.035,green);pipe('shower_arm',[-13,2.7,3.4],[-13,2.7,2.9],.035,green);
for(const x of [-5,0,5]){box('walkway_mark',[x,.005,1],[2,.018,.06],yellow);}
scene.updateMatrixWorld(true);
const bytes=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true}));const hash=createHash('sha256').update(bytes).digest('hex');
const dir=join(root,'apps/web/public/models/chemical');mkdirSync(dir,{recursive:true});const filename=`chemical-workshop.${hash.slice(0,12)}.glb`;writeFileSync(join(dir,filename),bytes);
const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const meta={id:'builtin:chemical-workshop-v1',name:'化工车间 · 管廊与集液区',description:'金属盐产线概念环境，包含公用管廊、围堰、排水沟、检修平台及仪表柜。',contentPath:`/models/chemical/${filename}`,thumbnailPath:'/models/chemical/chemical-workshop.svg',originalFilename:'chemical-workshop.glb',format:'glb',contentType:'model/gltf-binary',byteSize:bytes.length,sha256:hash,createdAt:'2026-10-22T00:00:00.000Z',inspection:{format:'glb',gltfVersion:'2.0',sceneCount:1,nodeCount:gltf.nodes.length,meshCount:gltf.meshes.length,materialCount:gltf.materials.length,textureCount:0,imageCount:0,animationCount:0,namedNodeCount:gltf.nodes.filter(node=>node.name).length,duplicateNodeNames:[],externalResourceCount:0},defaults:{backgroundColor:'#071525',backgroundOpacity:1,environmentLightColor:'#d9efff',environmentLightIntensity:1.5,keyLightColor:'#ffffff',keyLightIntensity:2.5,cameraFov:42,cameraView:'front',modelScale:1,autoRotate:false,playAnimations:false,animationSpeed:1,presentation:{lighting:'studio',shellMode:'original',showFlow:false,explosion:0}}};
writeFileSync(join(root,'shared/chemical-workshop-model.ts'),'// Generated by scripts/generate-chemical-workshop.mjs\nexport const chemicalWorkshopModel = '+JSON.stringify(meta,null,2)+' as const;\n');
writeFileSync(join(dir,'chemical-workshop.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#163143"/><g fill="none" stroke="#7da5b6" stroke-width="5"><path d="M30 50H290M30 70H290M60 35V145M160 35V145M260 35V145"/><path d="M20 150H300" stroke="#d3aa45"/></g><text x="160" y="117" text-anchor="middle" fill="#e9f6ff" font-size="20">化工公用管廊</text></svg>');
console.log({bytes:bytes.length,meshes:count,filename});
