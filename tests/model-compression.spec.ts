import {test,expect} from '@playwright/test';
import {compressModelBytes} from '../apps/runtime/src/model-compression';
import {representativeModel} from './representative-model';
import {createMockGltf} from '../scripts/mock-model.mjs';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {inspectModelDetails} from '../apps/api/src/model-inspection';

test('raw Meshopt compression preserves original indices, objects and metadata with reproducible output',async()=>{
  const original=representativeModel(1000000),first=await compressModelBytes(original.bytes),second=await compressModelBytes(original.bytes);expect(first.bytes).toEqual(second.bytes);expect(first.report).toEqual(second.report);expect(first.report.outputBytes).toBeLessThan(original.bytes.length);
  const inspection=await inspectModelDetails(first.bytes,'glb','compressed',{meshopt:MeshoptDecoder});expect(inspection.triangleCount).toBe(original.triangles);expect(inspection.objects?.[0].sourceId).toBe('representative-surface');console.log(JSON.stringify({benchmark:'meshopt-exact-buffer',...first.report}));
});
test('U8 indices and independent embedded buffers are retained while unknown extensions are rejected',async()=>{
  const json=JSON.parse(createMockGltf()),binary=Buffer.from(json.buffers[0].uri.split(',')[1],'base64'),indices=new Uint16Array(binary.buffer,binary.byteOffset+96,36),u8=Uint8Array.from(indices);
  json.buffers=[{byteLength:96,uri:`data:application/octet-stream;base64,${binary.subarray(0,96).toString('base64')}`},{byteLength:36,uri:`data:application/octet-stream;base64,${Buffer.from(u8).toString('base64')}`}];json.bufferViews[1]={...json.bufferViews[1],buffer:1,byteOffset:0,byteLength:36};json.accessors[1].componentType=5121;
  const result=await compressModelBytes(new TextEncoder().encode(JSON.stringify(json)));expect(result.report.preservedViews).toBe(1);expect((await inspectModelDetails(result.bytes,'glb','u8',{meshopt:MeshoptDecoder})).triangleCount).toBe(12);
  json.nodes[0].extensions={UNKNOWN_extension:{customData:1}};await expect(compressModelBytes(new TextEncoder().encode(JSON.stringify(json)))).rejects.toMatchObject({compressionCode:'model_compression_extension_unsupported'});
});


test('overlapping preserved views cannot allocate a combined output beyond the file budget',async()=>{
 const binary=Buffer.alloc(1024*1024+1,7),json={asset:{version:'2.0'},buffers:[{byteLength:binary.length,uri:`data:application/octet-stream;base64,${binary.toString('base64')}`}],bufferViews:Array.from({length:30},()=>({buffer:0,byteOffset:0,byteLength:binary.length}))};await expect(compressModelBytes(new TextEncoder().encode(JSON.stringify(json)))).rejects.toMatchObject({compressionCode:'model_compression_output_limit'});
});
