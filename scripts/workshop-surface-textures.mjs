// Deterministic, embedded PBR surface maps. No downloaded imagery or canvas dependency.
import { deflateSync } from 'node:zlib';
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type), block = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const b of block) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, block, tail]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgb = pixel(x, y);
    for (let k = 0; k < 3; k++) raw[y * (size * 3 + 1) + 1 + x * 3 + k] = Math.max(0, Math.min(255, Math.round(rgb[k])));
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(size); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const noise = (x, y) => {
  let n = Math.imul(x + 7919, 374761393) ^ Math.imul(y + 104729, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const maps = new Map();
function surface(kind, channel) {
  const key = `${kind}:${channel}`;
  if (maps.has(key)) return maps.get(key);
  const bytes = png(256, (x, y) => {
    const fine = noise(x, y), coarse = noise(Math.floor(x / 16), Math.floor(y / 16));
    if (channel === 'normal') {
      const strength = kind === 'floor' ? 14 : kind === 'carton' ? 9 : 4;
      return [128 + (fine - .5) * strength, 128 + (noise(x + 1, y) - .5) * strength, 254];
    }
    if (channel === 'roughness') return [255, kind === 'steel' ? 140 + noise(0, y) * 80 : 205 + fine * 40, 255];
    const n = kind === 'floor' ? 218 + (fine - .5) * 27 + (coarse - .5) * 14
      : kind === 'steel' ? 217 + noise(0, y) * 25 + fine * 9
      : kind === 'carton' ? 213 + fine * 32 + Math.sin(y * 2.8) * 5
      : 233 + (fine - .5) * 15;
    return [n, n, n];
  });
  maps.set(key, bytes); return bytes;
}
export function embedSurfaceTextures(input) {
  const jsonLength = input.readUInt32LE(12);
  const doc = JSON.parse(input.subarray(20, 20 + jsonLength));
  const binaryLength = input.readUInt32LE(20 + jsonLength);
  const parts = [input.subarray(28 + jsonLength, 28 + jsonLength + binaryLength)];
  let length = parts[0].length;
  doc.images = []; doc.textures = []; doc.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  const indices = new Map();
  function texture(kind, channel) {
    const key = `${kind}:${channel}`;
    if (indices.has(key)) return indices.get(key);
    const bytes = surface(kind, channel), pad = Buffer.alloc((4 - length % 4) % 4);
    parts.push(pad); length += pad.length;
    const view = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    parts.push(bytes); length += bytes.length;
    const index = doc.textures.length;
    doc.images.push({ bufferView: view, mimeType: 'image/png', name: key });
    doc.textures.push({ sampler: 0, source: doc.images.length - 1 }); indices.set(key, index); return index;
  }
  for (const material of doc.materials) {
    const kind = ['floor', 'steel', 'carton'].includes(material.name) ? material.name
      : ['ivory', 'orange', 'blue', 'dark', 'yellow'].includes(material.name) ? 'paint' : null;
    if (!kind) continue;
    const uv = kind === 'floor' ? { extensions: { KHR_texture_transform: { scale: [12, 12] } } } : {};
    material.pbrMetallicRoughness.baseColorTexture = { index: texture(kind, 'color'), ...uv };
    material.pbrMetallicRoughness.metallicRoughnessTexture = { index: texture(kind, 'roughness'), ...uv };
    material.normalTexture = { index: texture(kind, 'normal'), scale: kind === 'floor' ? .45 : .25, ...uv };
  }
  doc.extensionsUsed = [...new Set([...(doc.extensionsUsed ?? []), 'KHR_texture_transform'])];
  const pad = Buffer.alloc((4 - length % 4) % 4); parts.push(pad); length += pad.length;
  doc.buffers[0].byteLength = length;
  const json = Buffer.from(JSON.stringify(doc)), jsonPad = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + jsonPad.length + length, 8);
  header.writeUInt32LE(json.length + jsonPad.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(length); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, jsonPad, binHeader, ...parts]);
}
