import { MeshoptEncoder } from "meshoptimizer/encoder";
import { createMockGltf } from "../scripts/mock-model.mjs";
export function packGlb(document:unknown,binary:Uint8Array) {
  const json=Buffer.from(JSON.stringify(document)),padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),data=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]),header=Buffer.alloc(20),chunk=Buffer.alloc(8);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+data.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);chunk.writeUInt32LE(data.length,0);chunk.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,padded,chunk,data]);
}
export async function meshoptFixture() {
  await MeshoptEncoder.ready;const document = JSON.parse(createMockGltf([{ mesh:0,name:"MeshoptDevice" }])),original = Buffer.from(document.buffers[0].uri.split(",")[1],"base64"),chunks:Uint8Array[] = [];let offset = 0;
  document.extensionsUsed = ["EXT_meshopt_compression"];document.extensionsRequired = ["EXT_meshopt_compression"];
  for (const [index,view] of document.bufferViews.entries()) {
    const accessor = document.accessors[index],stride = index === 0 ? 12:2,mode = index === 0 ? "ATTRIBUTES":"TRIANGLES",encoded = MeshoptEncoder.encodeGltfBuffer(original.subarray(view.byteOffset,view.byteOffset+view.byteLength),accessor.count,stride,mode);
    view.buffer=1;view.extensions={ EXT_meshopt_compression:{ buffer:0,byteOffset:offset,byteLength:encoded.length,byteStride:stride,count:accessor.count,mode } };chunks.push(encoded);const padding = (4-encoded.length%4)%4;if (padding) chunks.push(new Uint8Array(padding));offset+=encoded.length+padding;
  }
  document.buffers=[{byteLength:offset},{byteLength:original.length,extensions:{EXT_meshopt_compression:{fallback:true}}}];const binary=Buffer.concat(chunks);return {document,binary,bytes:packGlb(document,binary)};
}
