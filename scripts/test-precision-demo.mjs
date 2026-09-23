import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const manifest = readJson('apps/web/src/pages/precision-demo-asset.json');
const provenance = readJson('demo-assets/precision-pick-place/provenance.json');
const bytes = readFileSync(resolve(root, `apps/web/public${manifest.contentPath}`));
const sha = value => createHash('sha256').update(value).digest('hex');
function parseGlb(buffer) {
  assert.equal(buffer.readUInt32LE(0), 0x46546c67);
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.length);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength));
  assert.equal(buffer.readUInt32LE(24 + jsonLength), 0x004e4942);
  const binary = buffer.subarray(28 + jsonLength);
  assert.equal(buffer.readUInt32LE(20 + jsonLength), binary.length);
  assert.equal(gltf.buffers.length, 1);
  assert.equal(gltf.buffers[0].byteLength, binary.length);
  return { gltf, binary };
}
const { gltf, binary } = parseGlb(bytes);
assert.equal(manifest.sha256, sha(bytes));
assert.equal(provenance.sha256, manifest.sha256);
assert.equal(manifest.byteSize, bytes.length);
assert.ok(bytes.length < 25 * 1024 * 1024);
assert.ok(manifest.contentPath.includes(manifest.sha256.slice(0, 12)));
assert.equal(manifest.assetId, 'public:precision-pick-place');
assert.equal(gltf.nodes.length, manifest.nodeCount);
assert.equal(gltf.meshes.length, manifest.meshCount);
assert.equal(new Set(gltf.nodes.map(node => node.name)).size, gltf.nodes.length);
assert.ok(!/长沙|凯德|KAIDE|KD_/.test(JSON.stringify(gltf)), 'Public metadata excludes customer identifiers');
assert.ok(gltf.images.every(image => image.bufferView !== undefined && !image.uri));
assert.ok(gltf.buffers.every(buffer => !buffer.uri), 'No external texture or buffer requests');
const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessorBytes(document, bin, index, count = document.accessors[index].count) {
  const accessor = document.accessors[index];
  const view = document.bufferViews[accessor.bufferView];
  assert.ok(!accessor.sparse);
  const width = sizes[accessor.componentType] * components[accessor.type];
  assert.ok(width > 0);
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? width;
  assert.ok(start + (count - 1) * stride + width <= (view.byteOffset ?? 0) + view.byteLength);
  return Buffer.concat(Array.from({ length: count }, (_, i) => bin.subarray(start + i * stride, start + i * stride + width)));
}
for (const view of gltf.bufferViews) {
  assert.equal(view.buffer, 0);
  assert.ok((view.byteOffset ?? 0) + view.byteLength <= binary.length);
}
gltf.accessors.forEach((_, index) => accessorBytes(gltf, binary, index));
const animation = gltf.animations[0];
assert.equal(gltf.animations.length, 1);
assert.equal(animation.channels.length, 20);
for (const channel of animation.channels) {
  assert.ok(gltf.nodes[channel.target.node]);
  const sampler = animation.samplers[channel.sampler];
  assert.equal(sampler.interpolation, 'LINEAR');
  assert.equal(gltf.accessors[sampler.input].count, 271);
  assert.equal(gltf.accessors[sampler.output].count, 271);
  const times = accessorBytes(gltf, binary, sampler.input);
  for (let i = 0; i < 271; i++) assert.ok(Math.abs(times.readFloatLE(i * 4) - i / 30) < 1e-6);
  assert.equal(times.readFloatLE(270 * 4), 9);
}
assert.ok(gltf.materials.find(m => m.name === 'Satin titanium').pbrMetallicRoughness.metallicFactor > .8);
assert.ok(gltf.materials.find(m => m.name === 'Champagne metal USB').pbrMetallicRoughness.metallicFactor > .8);

if (process.argv.includes('--verify-source')) {
  const sourcePath = resolve(root, '../output/kaide/静态/dashboard-offline/js/model-data.js');
  const text = readFileSync(sourcePath, 'utf8');
  const prefix = 'window.KAIDE_EMBEDDED_DATA = ';
  assert.ok(text.startsWith(prefix) && text.endsWith(';\n'));
  const embedded = JSON.parse(text.slice(prefix.length, -2));
  const sourceBytes = gunzipSync(Buffer.from(embedded.chunks.join(''), 'base64'));
  assert.equal(sha(sourceBytes), manifest.sourceSha256, 'Only the recorded native master is accepted');
  const { gltf: original, binary: originalBinary } = parseGlb(sourceBytes);
  const selected = new Set(provenance.sourceNodes);
  const remap = new Map(provenance.sourceNodes.map((id, index) => [id, index]));
  for (const [index, sourceIndex] of provenance.sourceNodes.entries()) {
    const node = gltf.nodes[index];
    const source = original.nodes[sourceIndex];
    for (const key of ['matrix', 'translation', 'rotation', 'scale']) assert.deepEqual(node[key], source[key]);
    assert.deepEqual(node.children, source.children?.filter(id => selected.has(id)).map(id => remap.get(id)));
    if (source.mesh === undefined) continue;
    const primitives = gltf.meshes[node.mesh].primitives;
    const sourcePrimitives = original.meshes[source.mesh].primitives;
    assert.equal(primitives.length, sourcePrimitives.length);
    primitives.forEach((primitive, i) => {
      const before = sourcePrimitives[i];
      assert.deepEqual(Object.keys(primitive.attributes), Object.keys(before.attributes));
      for (const key of Object.keys(before.attributes)) assert.deepEqual(
        accessorBytes(gltf, binary, primitive.attributes[key]), accessorBytes(original, originalBinary, before.attributes[key]), `${sourceIndex}/${key}: original geometry`);
      if (before.indices !== undefined) assert.deepEqual(accessorBytes(gltf, binary, primitive.indices), accessorBytes(original, originalBinary, before.indices));
    });
  }
  for (const channel of animation.channels) {
    const sourceIndex = provenance.sourceNodes[channel.target.node];
    const sourceChannel = original.animations[0].channels.find(c => c.target.node === sourceIndex && c.target.path === channel.target.path);
    assert.ok(sourceChannel);
    const sourceSampler = original.animations[0].samplers[sourceChannel.sampler];
    const sampler = animation.samplers[channel.sampler];
    for (const key of ['input', 'output']) assert.deepEqual(accessorBytes(gltf, binary, sampler[key]), accessorBytes(original, originalBinary, sourceSampler[key], 271), `${sourceIndex}/${key}: original animation`);
  }
  console.log('precision-demo: all retained geometry, transforms and native motion samples match the source byte-for-byte');
}
console.log(`precision-demo: checksum, self-contained buffers, public metadata, metallic palette and 271 native frames passed (${(bytes.length / 1024 / 1024).toFixed(2)} MiB)`);
