import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

// A public, recoloured cutaway, not a replacement for the customer's master.
// Geometry and native motion samples are copied byte-for-byte. No generated poses.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, process.argv[2] ?? '../output/kaide/静态/dashboard-offline/js/model-data.js');
const text = readFileSync(source, 'utf8');
const prefix = 'window.KAIDE_EMBEDDED_DATA = ';
assert(text.startsWith(prefix) && text.endsWith(';\n'), 'Unexpected native model package');
const embedded = JSON.parse(text.slice(prefix.length, -2));
const raw = gunzipSync(Buffer.from(embedded.chunks.join(''), 'base64'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(raw.length, embedded.glbByteLength);
assert.equal(sha(raw), embedded.sha256, 'Native model checksum mismatch');
const jsonLength = raw.readUInt32LE(12);
const sourceGltf = JSON.parse(raw.subarray(20, 20 + jsonLength));
const binary = raw.subarray(28 + jsonLength);
assert.equal(sourceGltf.animations.length, 1);
assert(!sourceGltf.skins, 'Extraction needs explicit skin support before use with a skinned source');

const duration = 9; // Complete native release + tool lift; stop before pallet transport.
const wantedNames = [
  'KD_02190_机器人安装板副本', 'KD_02211_3D_LRMATE200ID副本',
  'KD_02148_放料托盘副本.002', 'KD_02268_产品副本.005',
  'KD_02272_产品副本.009', 'KD_02274_产品副本.011',
  'ANIM_PALLET_01', 'ANIM_USB_01',
  ...Array.from({ length: 6 }, (_, i) => `ANIM_ROBOT_J${i + 1}`),
  'ANIM_ROBOT_FINGER_R', 'ANIM_ROBOT_FINGER_L',
];
const parents = new Map();
sourceGltf.nodes.forEach((node, index) => node.children?.forEach(child => parents.set(child, index)));
const selected = new Set();
function include(index) {
  selected.add(index);
  sourceGltf.nodes[index].children?.forEach(include);
}
for (const name of wantedNames) {
  const matches = sourceGltf.nodes.flatMap((node, i) => node.name === name ? [i] : []);
  assert.equal(matches.length, 1, `Missing or ambiguous native part: ${name}`);
  include(matches[0]);
  let parent = parents.get(matches[0]);
  while (parent !== undefined) { selected.add(parent); parent = parents.get(parent); }
}
const nodeIds = [...selected].sort((a, b) => a - b);
const nodeMap = new Map(nodeIds.map((index, i) => [index, i]));
const out = { asset: { version: '2.0', generator: 'Kingdom 3D Vision / native-motion cutaway' },
  scene: 0, scenes: [{ name: 'Precision pick and place', nodes: [] }], nodes: [], meshes: [],
  materials: [], textures: [], images: [], samplers: sourceGltf.samplers,
  accessors: [], bufferViews: [], buffers: [], animations: [],
  extensionsUsed: sourceGltf.extensionsUsed,
};
const chunks = [];
let offset = 0;
function bufferView(bytes, original = {}) {
  const padding = (4 - offset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
  const index = out.bufferViews.length;
  out.bufferViews.push({ ...original, buffer: 0, byteOffset: offset, byteLength: bytes.length });
  chunks.push(bytes); offset += bytes.length;
  return index;
}
const maps = { accessor: new Map(), view: new Map(), mesh: new Map(), material: new Map(), texture: new Map(), image: new Map() };
function view(index) {
  if (maps.view.has(index)) return maps.view.get(index);
  const v = sourceGltf.bufferViews[index];
  assert(!v.extensions, 'Compressed buffers need an explicit extraction path');
  const result = bufferView(binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), v);
  maps.view.set(index, result); return result;
}
function accessor(index) {
  if (maps.accessor.has(index)) return maps.accessor.get(index);
  const a = sourceGltf.accessors[index];
  assert(!a.sparse, 'Sparse accessors need an explicit extraction path');
  const result = out.accessors.length;
  out.accessors.push({ ...a, bufferView: view(a.bufferView) });
  maps.accessor.set(index, result); return result;
}
function texture(index) {
  if (maps.texture.has(index)) return maps.texture.get(index);
  const t = sourceGltf.textures[index];
  if (!maps.image.has(t.source)) {
    const im = sourceGltf.images[t.source];
    assert(im.bufferView !== undefined && !im.uri, 'Public demo must be self-contained');
    maps.image.set(t.source, out.images.length);
    out.images.push({ ...im, name: `surface-${out.images.length}`, bufferView: view(im.bufferView) });
  }
  const result = out.textures.length;
  out.textures.push({ ...t, source: maps.image.get(t.source) });
  maps.texture.set(index, result); return result;
}
const linear = hex => {
  const v = Number.parseInt(hex, 16);
  return [v >> 16, (v >> 8) & 255, v & 255].map(c => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
};
// Palette: titanium body, graphite joints, warm metal workpiece, blue-black tooling.
const palette = {
  0: ['c1c9cf', .9, .68], 1: ['aebbc6', .85, .78], 3: ['343e49', .65, .8],
  4: ['252f3c', .55, .82], 5: ['3e5368', .72, .75], 6: ['b89c67', .75, .75],
  7: ['35485a', .65, .8], 8: ['354353', .8, .7], 10: ['526779', .85, .7],
  11: ['515a63', .9, .72], 13: ['bec9d2', .88, .62], 14: ['d6ae6b', .86, .62],
  15: ['455a6b', .85, .31],
};
function material(index) {
  if (maps.material.has(index)) return maps.material.get(index);
  const m = structuredClone(sourceGltf.materials[index]);
  m.name = index === 13 ? 'Satin titanium' : index === 14 ? 'Champagne metal USB' : `Industrial finish ${index}`;
  const paint = palette[index];
  if (paint) {
    m.pbrMetallicRoughness.baseColorFactor = [...linear(paint[0]), 1];
    m.pbrMetallicRoughness.metallicFactor = paint[1];
    m.pbrMetallicRoughness.roughnessFactor = paint[2];
  }
  if (index === 13) m.extensions = { KHR_materials_clearcoat: { clearcoatFactor: .18, clearcoatRoughnessFactor: .3 } };
  function remapTextures(object) {
    for (const [key, value] of Object.entries(object)) {
      if (!value || typeof value !== 'object') continue;
      if (key.endsWith('Texture') && value.index !== undefined) value.index = texture(value.index);
      else remapTextures(value);
    }
  }
  remapTextures(m);
  const result = out.materials.length; out.materials.push(m); maps.material.set(index, result); return result;
}
function mesh(index) {
  if (maps.mesh.has(index)) return maps.mesh.get(index);
  const original = sourceGltf.meshes[index];
  const result = out.meshes.length;
  out.meshes.push({ name: `machined-part-${result}`, primitives: original.primitives.map(p => {
    assert(!p.targets && !p.extensions, 'Unexpected mesh features');
    return { ...p, attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, accessor(v)])),
      ...(p.indices === undefined ? {} : { indices: accessor(p.indices) }),
      ...(p.material === undefined ? {} : { material: material(p.material) }) };
  }) });
  maps.mesh.set(index, result); return result;
}
out.nodes = nodeIds.map(index => {
  const original = sourceGltf.nodes[index];
  const n = { ...original, name: original.name.startsWith('ANIM_') ? original.name : `part-${index}` };
  delete n.extras;
  if (n.mesh !== undefined) n.mesh = mesh(n.mesh);
  if (n.children) n.children = n.children.filter(i => selected.has(i)).map(i => nodeMap.get(i));
  return n;
});
out.scenes[0].nodes = sourceGltf.scenes[sourceGltf.scene ?? 0].nodes.filter(i => selected.has(i)).map(i => nodeMap.get(i));
const components = { SCALAR: 1, VEC3: 3, VEC4: 4 };
function floatBytes(index, count) {
  const a = sourceGltf.accessors[index]; const v = sourceGltf.bufferViews[a.bufferView];
  assert.equal(a.componentType, 5126); assert(!v.byteStride && !a.sparse);
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return binary.subarray(start, start + count * components[a.type] * 4);
}
const animation = { name: 'Precision_pick_place', channels: [], samplers: [] };
let sampleCount;
for (const channel of sourceGltf.animations[0].channels) {
  if (!selected.has(channel.target.node)) continue;
  const s = sourceGltf.animations[0].samplers[channel.sampler];
  assert.equal(s.interpolation, 'LINEAR');
  const times = floatBytes(s.input, sourceGltf.accessors[s.input].count);
  let count = 0;
  while (count < times.length / 4 && times.readFloatLE(count * 4) <= duration + 1e-6) count++;
  assert.equal(times.readFloatLE((count - 1) * 4), duration);
  sampleCount = count;
  const sampler = { interpolation: 'LINEAR' };
  for (const key of ['input', 'output']) {
    const original = sourceGltf.accessors[s[key]];
    const a = { ...original, count, byteOffset: 0, bufferView: bufferView(floatBytes(s[key], count)) };
    delete a.min; delete a.max;
    if (key === 'input') { a.min = [0]; a.max = [duration]; }
    sampler[key] = out.accessors.length; out.accessors.push(a);
  }
  animation.channels.push({ sampler: animation.samplers.length, target: { ...channel.target, node: nodeMap.get(channel.target.node) } });
  animation.samplers.push(sampler);
}
assert.equal(animation.channels.length, 20, 'Expected six joints, two fingers, one USB and one pallet');
out.animations.push(animation);
const binPadding = (4 - offset % 4) % 4;
if (binPadding) { chunks.push(Buffer.alloc(binPadding)); offset += binPadding; }
out.buffers = [{ byteLength: offset }];
const json = Buffer.from(JSON.stringify(out));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonPadded.length + offset, 8); header.writeUInt32LE(jsonPadded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(offset); binHeader.writeUInt32LE(0x004e4942, 4);
const output = Buffer.concat([header, jsonPadded, binHeader, ...chunks]);
assert(output.length < 25 * 1024 * 1024, 'Public cutaway exceeds 25 MiB budget');
const hash = sha(output);
const contentPath = `/models/precision-pick-place.${hash.slice(0, 12)}.glb`;
writeFileSync(resolve(root, `apps/web/public${contentPath}`), output);
const manifest = { assetId: 'public:precision-pick-place', contentPath, sha256: hash, byteSize: output.length,
  duration, sampleCount, nodeCount: out.nodes.length, meshCount: out.meshes.length,
  animationChannels: animation.channels.length, sourceSha256: embedded.sha256 };
writeFileSync(resolve(root, 'apps/web/src/pages/precision-demo-asset.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const reportPath = resolve(root, 'demo-assets/precision-pick-place/provenance.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify({ ...manifest, sourceNodes: nodeIds, selectedRoots: wantedNames,
  method: 'Lossless native geometry and 0–9 s animation extraction; material-only recolour; enclosure and unrelated plant omitted.' }, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
