/** Indexed, smooth double-sided sheet: every triangle is real geometry, not repeated indices. */
export function representativeModel(targetTriangles:number) {
  const segments = Math.ceil(Math.sqrt(targetTriangles/2)),width = segments+1,vertices = width*width,triangles = segments*segments*2;
  if (!Number.isSafeInteger(targetTriangles) || targetTriangles<1 || targetTriangles>1010000) throw new Error("Representative model size is outside the fixture budget.");
  const positions = new Float32Array(vertices*3),normals = new Float32Array(vertices*3),indices = new Uint32Array(triangles*3);
  for (let z=0;z<=segments;z++) for (let x=0;x<=segments;x++) {
    const u=x/segments,v=z/segments,index=(z*width+x)*3,dx=.08*4*Math.PI*Math.cos(u*4*Math.PI),dz=-.08*3*Math.PI*Math.sin(v*3*Math.PI),length=Math.hypot(dx,1,dz);
    positions.set([u-.5,.08*Math.sin(u*4*Math.PI)+.08*Math.cos(v*3*Math.PI),v-.5],index);normals.set([-dx/length,1/length,-dz/length],index);
  }
  let offset=0;for (let z=0;z<segments;z++) for (let x=0;x<segments;x++) { const a=z*width+x,b=a+1,c=a+width,d=c+1;indices.set([a,c,b,b,c,d],offset);offset+=6; }
  const positionBytes=Buffer.from(positions.buffer),normalBytes=Buffer.from(normals.buffer),indexBytes=Buffer.from(indices.buffer),binary=Buffer.concat([positionBytes,normalBytes,indexBytes]);
  const document = { asset:{ version:"2.0",generator:"NewPower representative synthetic surface" },scene:0,scenes:[{ nodes:[0] }],nodes:[{ mesh:0,name:"RepresentativeSurface",extras:{ newpowerObjectId:"representative-surface" } }],meshes:[{ primitives:[{ attributes:{ POSITION:0,NORMAL:1 },indices:2,material:0 }] }],materials:[{ doubleSided:true,pbrMetallicRoughness:{ baseColorFactor:[.05,.6,.7,1],metallicFactor:.15,roughnessFactor:.75 } }],buffers:[{ byteLength:binary.length }],bufferViews:[{ buffer:0,byteOffset:0,byteLength:positionBytes.length,target:34962 },{ buffer:0,byteOffset:positionBytes.length,byteLength:normalBytes.length,target:34962 },{ buffer:0,byteOffset:positionBytes.length+normalBytes.length,byteLength:indexBytes.length,target:34963 }],accessors:[{ bufferView:0,componentType:5126,type:"VEC3",count:vertices,min:[-.5,-.16,-.5],max:[.5,.16,.5] },{ bufferView:1,componentType:5126,type:"VEC3",count:vertices },{ bufferView:2,componentType:5125,type:"SCALAR",count:indices.length }] };
  const json=Buffer.from(JSON.stringify(document)),padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),header=Buffer.alloc(20),chunk=Buffer.alloc(8);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+binary.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);chunk.writeUInt32LE(binary.length,0);chunk.writeUInt32LE(0x004e4942,4);
  return { bytes:Buffer.concat([header,padded,chunk,binary]),triangles,vertices,segments,materials:1,textures:0 };
}
