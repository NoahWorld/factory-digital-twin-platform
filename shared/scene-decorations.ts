/** Compact, self-contained procedural objects in local Y-up scene coordinates. */
export type DecorationKind = 'tree' | 'shrub' | 'river' | 'military-truck' | 'military-tent' | 'military-radar' | 'military-armored';
export type SceneDecoration = {
  id: string; label: string; kind: DecorationKind; visible: boolean;
  transform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
  color: string; accentColor: string; seed: number;
  river?: { points: [number, number, number][]; width: number; speed: number; opacity: number; playing: boolean };
};
export const SCENE_DECORATION_LIMITS = {
  maximumDecorations: 64, minimumRiverPoints: 2, maximumRiverPoints: 64,
  maximumCoordinate: 10_000, maximumRotation: 3600, minimumScale: 0.001, maximumScale: 100,
  minimumRiverWidth: 0.1, maximumRiverWidth: 100, maximumRiverSpeed: 10,
  minimumRiverOpacity: 0.05, maximumLabelLength: 80,
} as const;
const kinds: DecorationKind[] = ['tree', 'shrub', 'river', 'military-truck', 'military-tent', 'military-radar', 'military-armored'];
const common = ['id','label','kind','visible','transform','color','accentColor','seed'];
const matchKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const numberIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const vector = (v: unknown, lo: number, hi: number): v is [number,number,number] => Array.isArray(v) && v.length === 3 && v.every(n => numberIn(n, lo, hi));
const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}(?![\s\S])/.test(v);
const cross = (a: number[], b: number[], c: number[]) => (b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
const overlaps = (a: number[], b: number[], c: number[], d: number[]) => {
  const e = cross(a,b,c), f = cross(a,b,d), g = cross(c,d,a), h = cross(c,d,b);
  if (Math.abs(e) < 1e-9 && Math.abs(f) < 1e-9 && Math.abs(g) < 1e-9 && Math.abs(h) < 1e-9) {
    return Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0])) <= Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0])) &&
      Math.max(Math.min(a[2],b[2]),Math.min(c[2],d[2])) <= Math.min(Math.max(a[2],b[2]),Math.max(c[2],d[2]));
  }
  return e*f <= 0 && g*h <= 0;
};
/** The exact mitered XZ edges consumed by the renderer. Null means the strip folds or overlaps. */
export function sceneRiverEdges(points: readonly [number,number,number][], width: number): [number,number][][] | null {
  const normals: [number,number][] = [];
  for (let i=1;i<points.length;i++) {
    const dx=points[i][0]-points[i-1][0], dz=points[i][2]-points[i-1][2], length=Math.hypot(dx,dz);
    if (!Number.isFinite(length) || length<1e-5) return null;
    normals.push([-dz/length,dx/length]);
  }
  const edges: [number,number][][]=[];
  for (let i=0;i<points.length;i++) {
    let nx:number,nz:number,miter=1;
    if (i===0 || i===points.length-1) [nx,nz]=normals[i===0?0:normals.length-1];
    else {
      const before=normals[i-1],after=normals[i];
      const sumX=before[0]+after[0],sumZ=before[1]+after[1],length=Math.hypot(sumX,sumZ);
      if (length<1e-8) return null;
      nx=sumX/length;nz=sumZ/length;
      const projection=nx*after[0]+nz*after[1];
      if (projection<0.25) return null; // Bound the miter to 4x half-width.
      miter=1/projection;
    }
    const x=nx*width*miter/2,z=nz*width*miter/2;
    edges.push([[points[i][0]-x,points[i][2]-z],[points[i][0]+x,points[i][2]+z]]);
  }
  // Each quad must retain its winding. Large widths around short bends invert a bank.
  for (let i=1;i<edges.length;i++) {
    const a=edges[i-1],b=edges[i];
    const first=cross([a[0][0],0,a[0][1]],[a[1][0],0,a[1][1]],[b[0][0],0,b[0][1]]);
    const second=cross([a[1][0],0,a[1][1]],[b[1][0],0,b[1][1]],[b[0][0],0,b[0][1]]);
    if (first>=-1e-8 || second>=-1e-8) return null;
  }
  // Check the complete ribbon perimeter, including opposite banks and end caps.
  const perimeter=[...edges.map(e=>e[0]),...edges.map(e=>e[1]).reverse()];
  for (let i=0;i<perimeter.length;i++) for (let j=i+2;j<perimeter.length;j++) {
    if (i===0 && j===perimeter.length-1) continue;
    const a=perimeter[i],b=perimeter[(i+1)%perimeter.length],c=perimeter[j],d=perimeter[(j+1)%perimeter.length];
    if (overlaps([a[0],0,a[1]],[b[0],0,b[1]],[c[0],0,c[1]],[d[0],0,d[1]])) return null;
  }
  return edges;
}
export function createSceneDecoration(id: string, kind: DecorationKind): SceneDecoration {
  const names: Record<DecorationKind,string> = {tree:'乔木',shrub:'灌木',river:'河流','military-truck':'运输车','military-tent':'帐篷','military-radar':'雷达','military-armored':'装甲车'};
  const military = kind.startsWith('military-');
  return {
    id, kind, label:names[kind], visible:true,
    transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},
    color: kind === 'river' ? '#2688a8' : military ? '#526747' : '#4c8b53',
    accentColor: kind === 'river' ? '#9bdce4' : military ? '#a0a879' : '#8fbd69',
    seed:0,
    ...(kind === 'river' ? {river:{points:[[0,0,0],[5,0,0]] as [number,number,number][],width:2,speed:1,opacity:0.82,playing:true}} : {}),
  };
}
export function parseSceneDecorations(input: unknown): {ok:true,value:SceneDecoration[]} | {ok:false,message:string} {
  const fail = (message:string): {ok:false,message:string} => ({ok:false,message});
  if (!Array.isArray(input) || input.length > SCENE_DECORATION_LIMITS.maximumDecorations) return fail('decorations must be an array of at most 64 entries');
  const ids = new Set<string>(); const result:SceneDecoration[]=[];
  for (let i=0;i<input.length;i++) {
    const raw:unknown=input[i], at=`decorations[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(`${at} must be an object`);
    const v=raw as Record<string,unknown>;
    if (!kinds.includes(v.kind as DecorationKind)) return fail(`${at}.kind is invalid`);
    if (!matchKeys(v, v.kind === 'river' ? [...common,'river'] : common)) return fail(`${at} has missing or unknown fields`);
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}(?![\s\S])/.test(v.id) || ids.has(v.id)) return fail(`${at}.id is invalid or duplicated`);
    ids.add(v.id);
    if (typeof v.label !== 'string' || v.label.length < 1 || v.label.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(v.label) || !v.label.trim()) return fail(`${at}.label must contain 1..80 printable characters`);
    if (typeof v.visible !== 'boolean' || !hex(v.color) || !hex(v.accentColor) || !numberIn(v.seed,0,0xffffffff) || !Number.isInteger(v.seed)) return fail(`${at} has invalid visibility, color or seed`);
    const t=v.transform;
    if (!t || typeof t !== 'object' || Array.isArray(t) || !matchKeys(t as Record<string,unknown>,['position','rotation','scale'])) return fail(`${at}.transform is invalid`);
    const tr=t as Record<string,unknown>;
    if (!vector(tr.position,-10000,10000) || !vector(tr.rotation,-3600,3600) || !vector(tr.scale,SCENE_DECORATION_LIMITS.minimumScale,100)) return fail(`${at}.transform has invalid coordinates`);
    let river:SceneDecoration['river'];
    if (v.kind === 'river') {
      const r=v.river;
      if (!r || typeof r !== 'object' || Array.isArray(r) || !matchKeys(r as Record<string,unknown>,['points','width','speed','opacity','playing'])) return fail(`${at}.river is invalid`);
      const rv=r as Record<string,unknown>;
      if (!Array.isArray(rv.points) || rv.points.length < 2 || rv.points.length > 64 || !rv.points.every(p=>vector(p,-10000,10000))) return fail(`${at}.river.points is invalid`);
      const p=rv.points as [number,number,number][];
      for (let j=1;j<p.length;j++) {
        const dx=p[j][0]-p[j-1][0], dz=p[j][2]-p[j-1][2];
        if (Math.hypot(dx,dz) < 1e-5) return fail(`${at}.river.points has a degenerate XZ segment`);
        for (let k=0;k<j-2;k++) if (overlaps(p[k],p[k+1],p[j-1],p[j])) return fail(`${at}.river.points crosses itself`);
      }
      if (!numberIn(rv.width,0.1,100) || !numberIn(rv.speed,0,10) || !numberIn(rv.opacity,0.05,1) || typeof rv.playing !== 'boolean') return fail(`${at}.river parameters are invalid`);
      if (!sceneRiverEdges(p,rv.width)) return fail(`${at}.river banks fold or overlap at this width`);
      river={points:p.map(point=>[...point] as [number,number,number]),width:rv.width,speed:rv.speed,opacity:rv.opacity,playing:rv.playing};
    }
    result.push({id:v.id as string,label:v.label as string,kind:v.kind as DecorationKind,visible:v.visible as boolean,
      transform:{position:[...tr.position as number[]] as [number,number,number],rotation:[...tr.rotation as number[]] as [number,number,number],scale:[...tr.scale as number[]] as [number,number,number]},
      color:v.color as string,accentColor:v.accentColor as string,seed:v.seed as number,...(river ? {river} : {})});
  }
  return {ok:true,value:result};
}
/** Conservative upper bounds for the actual primitive tessellation in DecorationManager. */
export function sceneDecorationBudget(definitions: readonly SceneDecoration[]) {
  let meshes=0, triangles=0, animatedInstances=0;
  for (const d of definitions) {
    if (d.kind === 'river') { meshes+=1; triangles+=2*((d.river?.points.length ?? 64)-1); if (d.river?.playing) animatedInstances++; }
    else if (d.kind === 'tree') {meshes+=4;triangles+=120;}
    else if (d.kind === 'shrub') {meshes+=3;triangles+=60;}
    else if (d.kind === 'military-tent') {meshes+=3;triangles+=80;}
    else if (d.kind === 'military-radar') {meshes+=5;triangles+=220;}
    else {meshes+=9;triangles+=250;}
  }
  return {instances:definitions.length,meshes,triangles,animatedInstances};
}
