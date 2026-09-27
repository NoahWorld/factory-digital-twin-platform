import * as THREE from 'three';
import { parseSceneDecorations, sceneRiverEdges, type SceneDecoration } from '../../../../shared/scene-decorations';

type RecordEntry = { definition: SceneDecoration; signature: string; root: THREE.Group; geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; meshCount: number; triangleCount: number; phase: number; flow?: THREE.ShaderMaterial };
const vertex = /* glsl */ `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragment = /* glsl */ `uniform vec3 uColor; uniform vec3 uAccent; uniform float uPhase; uniform float uOpacity; varying vec2 vUv;
void main(){float wave=sin((vUv.y*7.0-uPhase)*6.2831853+sin(vUv.x*16.0)*0.35); float foam=pow(max(0.0,wave),8.0)*0.45; vec3 c=mix(uColor,uAccent,0.12+foam); gl_FragColor=vec4(c,uOpacity);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`;
const signature = (d: SceneDecoration) => JSON.stringify(d);
function release(record: RecordEntry) {
  record.root.removeFromParent();
  record.geometries.forEach(g=>g.dispose());
  record.materials.forEach(m=>m.dispose());
}
function build(d: SceneDecoration): RecordEntry {
  const geometries:THREE.BufferGeometry[]=[], materials:THREE.Material[]=[];
  const root=new THREE.Group(); root.userData.sceneDecorationId=d.id; root.name=d.label;
  let meshCount=0,triangleCount=0,flow:THREE.ShaderMaterial|undefined;
  const add=(geometry:THREE.BufferGeometry,material:THREE.Material,name:string,parent:THREE.Object3D=root) => {
    geometries.push(geometry); materials.push(material);
    const mesh=new THREE.Mesh(geometry,material); mesh.name=name; mesh.castShadow=d.kind !== 'river'; mesh.receiveShadow=true; parent.add(mesh);
    meshCount++; triangleCount+=(geometry.getIndex()?.count ?? geometry.getAttribute('position').count)/3;
    return mesh;
  };
  const mat=(color:string,flatShading=true) => new THREE.MeshStandardMaterial({color,roughness:0.84,metalness:0.04,flatShading});
  const main=()=>mat(d.color), accent=()=>mat(d.accentColor);
  try {
    if (d.kind === 'tree') {
      const trunk=add(new THREE.CylinderGeometry(0.18,0.27,2.1,6),mat('#70523b'),'trunk'); trunk.position.y=1.05;
      for(let i=0;i<3;i++) { const crown=add(new THREE.ConeGeometry(1.35-i*0.18,1.65,7),i===1?accent():main(),'crown'); crown.position.y=2.25+i*0.68; crown.rotation.y=(d.seed%17)*0.03+i*0.3; }
    } else if (d.kind === 'shrub') {
      for(let i=0;i<3;i++) {const leaf=add(new THREE.IcosahedronGeometry(i===1?0.8:0.67,0),i===1?accent():main(),'foliage'); leaf.position.set((i-1)*0.66,0.65+(i===1?0.2:0),((d.seed>>>i)&3)*0.08); leaf.scale.y=0.8;}
    } else if (d.kind === 'river') {
      const river=d.river!; const pts=river.points; const start=new THREE.Vector3(...pts[0]);
      const positions:number[]=[],uv:number[]=[],indices:number[]=[];
      const banks=sceneRiverEdges(pts,river.width)!; // Already validated during reconcile.
      for(let i=0;i<pts.length;i++) {
        for(let side=0;side<2;side++) {positions.push(banks[i][side][0]-start.x,pts[i][1]-start.y,banks[i][side][1]-start.z);uv.push(side,i);}
        if(i>0) {const n=2*i; indices.push(n-2,n-1,n,n-1,n+1,n);}
      }
      const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); geometry.setIndex(indices); geometry.computeVertexNormals();
      flow=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:{uColor:{value:new THREE.Color(d.color)},uAccent:{value:new THREE.Color(d.accentColor)},uPhase:{value:0},uOpacity:{value:river.opacity}},transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
      const surface=add(geometry,flow,'river-surface'); surface.position.copy(start); surface.castShadow=false; surface.renderOrder=1;
    } else if (d.kind === 'military-tent') {
      const floor=add(new THREE.BoxGeometry(4.3,0.12,3.2),mat('#484b37'),'floor'); floor.position.y=0.06;
      // A triangular-prism ridge: one closed geometry, without an overlapping roof plane.
      const shape=new THREE.Shape();shape.moveTo(-2,0);shape.lineTo(0,2.2);shape.lineTo(2,0);shape.closePath();
      const roof=add(new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:false}),main(),'tent');roof.position.z=-1.5;
      const door=add(new THREE.PlaneGeometry(0.9,1.45),accent(),'door');door.position.set(0,0.76,1.56);
    } else if (d.kind === 'military-radar') {
      const base=add(new THREE.CylinderGeometry(1.1,1.25,0.5,8),main(),'base');base.position.y=0.25;
      const mast=add(new THREE.CylinderGeometry(0.12,0.17,2.4,7),accent(),'mast');mast.position.y=1.7;
      const dish=add(new THREE.SphereGeometry(1.35,10,5,0,Math.PI*2,0,Math.PI/2),main(),'dish');dish.rotation.x=-Math.PI/2;dish.position.set(0,3,0);
      const receiver=add(new THREE.CylinderGeometry(0.1,0.1,0.8,6),accent(),'receiver');receiver.position.set(0,3.5,-0.25);
      const tip=add(new THREE.IcosahedronGeometry(0.2,0),accent(),'tip');tip.position.set(0,3.95,-0.25);
    } else {
      const armored=d.kind==='military-armored';
      const chassis=add(new THREE.BoxGeometry(armored?3.5:4.2,0.65,1.9),main(),'chassis');chassis.position.y=0.78;
      const cabin=add(new THREE.BoxGeometry(armored?2.2:1.5,armored?0.85:1.2,1.65),main(),'cabin');cabin.position.set(armored?0:-1.1,armored?1.3:1.55,0);
      const top=add(new THREE.BoxGeometry(armored?1.3:2.0,0.14,1.65),accent(),armored?'turret':'cargo');top.position.set(armored?0:0.8,armored?1.85:1.28,0);
      const front=add(new THREE.BoxGeometry(0.05,0.42,1.3),mat('#273d3b'),'windshield');front.position.set(armored?-1.13:-1.88,1.65,0);
      for(const x of [-1.25,1.25]) for(const z of [-0.92,0.92]) {const wheel=add(new THREE.CylinderGeometry(0.42,0.42,0.2,8),mat('#202722'),'wheel');wheel.rotation.x=Math.PI/2;wheel.position.set(x,0.43,z);}
      const detail=add(armored?new THREE.CylinderGeometry(0.1,0.1,1.6,6):new THREE.BoxGeometry(1.8,0.18,0.12),accent(),armored?'barrel':'cargo-rail');detail.position.set(armored?-1.35:0.7,armored?1.87:1.48,0);
      if(armored) detail.rotation.z=Math.PI/2;
    }
    root.position.set(...d.transform.position); root.rotation.set(...d.transform.rotation.map(THREE.MathUtils.degToRad) as [number,number,number]); root.scale.set(...d.transform.scale); root.visible=d.visible;
    return {definition:d,signature:signature(d),root,geometries,materials,meshCount,triangleCount,phase:0,flow};
  } catch(error) {
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
    throw new Error(`装饰“${d.label}” (${d.id}) 构建失败`,{cause:error});
  }
}
/** Owns only procedural objects attached to the supplied scene group. */
export class DecorationManager {
  private records=new Map<string,RecordEntry>(); private disposed=false;
  constructor(private readonly parent:THREE.Group) {}
  private active(){if(this.disposed) throw new Error('装饰管理器已释放');}
  reconcile(definitions:SceneDecoration[]):void {
    this.active(); const parsed=parseSceneDecorations(definitions); if(!parsed.ok) throw new Error(`装饰配置无效：${parsed.message}`);
    const next=new Map<string,RecordEntry>(),added:RecordEntry[]=[];
    try {for(const d of parsed.value){const old=this.records.get(d.id);if(old?.signature===signature(d)) next.set(d.id,old);else {const entry=build(d);entry.phase=old?.phase??0;if(entry.flow)entry.flow.uniforms.uPhase.value=entry.phase;next.set(d.id,entry);added.push(entry);}}}
    catch(error){added.forEach(release);throw error;}
    this.records.forEach((r,id)=>{if(next.get(id)!==r)release(r);});
    added.forEach(r=>this.parent.add(r.root));this.records=next;
  }
  getBounds():THREE.Box3 {this.active();this.parent.updateWorldMatrix(true,true);const box=new THREE.Box3();for(const r of this.records.values())if(r.definition.visible)box.union(new THREE.Box3().setFromObject(r.root));return box;}
  update(deltaSeconds:number,playAnimations:boolean,animationSpeed:number):void {
    this.active();if(!Number.isFinite(deltaSeconds)||deltaSeconds<0||typeof playAnimations!=='boolean'||!Number.isFinite(animationSpeed)||animationSpeed<0)throw new Error('装饰时钟参数无效');
    if(!playAnimations||!deltaSeconds||!animationSpeed)return;
    for(const r of this.records.values()){const river=r.definition.river;if(!r.definition.visible||!river?.playing||!r.flow)continue;r.phase=(r.phase+deltaSeconds*animationSpeed*river.speed)%10000;r.flow.uniforms.uPhase.value=r.phase;}
  }
  diagnostics(){this.active();const records=[...this.records.values()];return {decorationCount:records.length,meshCount:records.reduce((n,r)=>n+r.meshCount,0),triangleCount:records.reduce((n,r)=>n+r.triangleCount,0)};}
  getPickObjects():THREE.Object3D[]{this.active();return [...this.records.values()].filter(r=>r.definition.visible).map(r=>r.root);}
  dispose():void {if(this.disposed)return;this.disposed=true;this.records.forEach(release);this.records.clear();}
}
