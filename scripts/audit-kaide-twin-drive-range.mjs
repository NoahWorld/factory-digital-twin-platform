/** Offline calibration only: recover engineering observations from the original baked poses,
 * then compare configurable kinematics against them. Never export the original clock/curves.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from '../apps/web/node_modules/three/build/three.module.js';
import { inspectModel, buildCaseConfig, evaluateBindings, nodeMatrix } from './configure-kaide-twin-drive.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'deploy/local/.local/cases/kaide');
const json = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const verification = json('verification.json');
const model = inspectModel(verification.originalPath), gltf = model.gltf;
const config = buildCaseConfig(json('manifest.json'), gltf);
const source = readFileSync(verification.originalPath);
const binary = source.subarray(28 + source.readUInt32LE(12));
const types = { SCALAR: 1, VEC3: 3, VEC4: 4 };
function accessor(index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  assert.equal(a.componentType, 5126);
  assert(!a.sparse && !view.extensions, 'Calibration requires original uncompressed float accessors.');
  const width = types[a.type]; assert(width, `Unsupported calibration accessor ${a.type}`);
  const stride = view.byteStride ?? width * 4;
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) => binary.readFloatLE((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride + j * 4)));
}
const tracks = new Map();
const animation = gltf.animations[0];
let frameCount = null;
for (const channel of animation.channels) {
  const name = gltf.nodes[channel.target.node].name;
  if (!config.bindings.some(binding => binding.target.nodeName === name)) continue;
  const sampler = animation.samplers[channel.sampler];
  assert(['LINEAR', 'CUBICSPLINE'].includes(sampler.interpolation));
  const count = gltf.accessors[sampler.input].count;
  if (frameCount === null) frameCount = count;
  assert.equal(count, frameCount, 'Source channels have unequal sample counts.');
  if (!tracks.has(name)) tracks.set(name, {});
  const output = accessor(sampler.output);
  assert.equal(output.length, count * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1));
  tracks.get(name)[channel.target.path] = sampler.interpolation === 'CUBICSPLINE' ? output.filter((_, i) => i % 3 === 1) : output;
}
function nativeMatrix(name, frame) {
  const node = gltf.nodes.find(node => node.name === name), track = tracks.get(name);
  return nodeMatrix({ ...node, translation: track?.translation?.[frame] ?? node.translation, rotation: track?.rotation?.[frame] ?? node.rotation, scale: track?.scale?.[frame] ?? node.scale });
}
const error = (a, b) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
const pos = matrix => new Vector3().setFromMatrixPosition(matrix);
function angle(matrix, axis) {
  const q = new Quaternion().setFromRotationMatrix(matrix).normalize();
  let degrees = 2 * Math.atan2(q.x * axis[0] + q.y * axis[1] + q.z * axis[2], q.w) * 180 / Math.PI;
  if (degrees > 180) degrees -= 360;
  if (degrees < -180) degrees += 360;
  return degrees;
}
function pathDistance(binding, delta) {
  let nearest = null;
  for (let i = 1; i < binding.poses.length; i++) {
    const a = binding.poses[i - 1], b = binding.poses[i];
    const start = new Vector3(...a.position), segment = new Vector3(...b.position).sub(start);
    const t = Math.min(1, Math.max(0, delta.clone().sub(start).dot(segment) / segment.lengthSq()));
    const distance = delta.distanceTo(start.addScaledVector(segment, t));
    if (nearest === null || distance < nearest.error) nearest = { error: distance, value: a.value + (b.value - a.value) * t };
  }
  assert(nearest.error < .00001, `${binding.id} is outside the configured mechanical path: ${nearest.error} m`);
  return nearest;
}
const perBinding = new Map(config.bindings.map(binding => [binding.id, { id: binding.id, nodeName: binding.target.nodeName, maxMatrixElementError: 0, comparedFrames: 0 }]));
const ranges = new Map(config.points.map(point => [point.id, { min: Infinity, max: -Infinity }]));
let maxPathProjectionErrorMetres = 0, maxLaserScanOffsetMetres = 0;
for (let frame = 0; frame < frameCount; frame++) {
  const native = new Map(config.bindings.map(binding => [binding.id, nativeMatrix(binding.target.nodeName, frame)]));
  const values = {};
  for (const binding of config.bindings) {
    const matrix = native.get(binding.id);
    if (binding.id.startsWith('robot-j')) {
      const relative = binding.parentBindingId ? native.get(binding.parentBindingId).clone().invert().multiply(matrix) : matrix;
      values[binding.pointId] = angle(relative, binding.axis);
    } else if (binding.id === 'finger-r') values[binding.pointId] = pos(native.get('robot-j6').clone().invert().multiply(matrix)).x;
    else if (binding.id.startsWith('pallet-')) {
      const original = nodeMatrix(gltf.nodes.find(node => node.name === binding.target.nodeName));
      const projection = pathDistance(binding, pos(matrix).sub(pos(original)));
      values[binding.pointId] = projection.value;
      maxPathProjectionErrorMetres = Math.max(maxPathProjectionErrorMetres, projection.error);
    } else if (binding.id === 'hoist-z') values[binding.pointId] = pos(matrix).y;
    else if (binding.id === 'hoist-y') values[binding.pointId] = -pos(matrix).z;
    else if (binding.id === 'hoist-jaw-r') values[binding.pointId] = angle(native.get('hoist-y').clone().invert().multiply(matrix), binding.axis);
    else if (binding.id === 'receiving-lift') values[binding.pointId] = pos(matrix).y;
    else if (binding.id === 'laser') {
      const scale = new Vector3().setFromMatrixScale(matrix);
      values[binding.pointId] = scale.length() > 0 ? 1 : 0;
      if (values[binding.pointId]) maxLaserScanOffsetMetres = Math.max(maxLaserScanOffsetMetres, pos(matrix).distanceTo(new Vector3(-1.73275, 1.0345, .76047)));
    }
  }
  const reconstructed = evaluateBindings(config, gltf, values);
  for (const binding of config.bindings) {
    if (binding.id === 'laser') continue; // Explicit on/off indicator only; native raster scan is intentionally not rebound.
    const row = perBinding.get(binding.id), mismatch = error(native.get(binding.id), reconstructed.get(binding.id));
    assert(mismatch < .00001, `${binding.id}, source sample ${frame}: kinematic mismatch ${mismatch}`);
    row.maxMatrixElementError = Math.max(row.maxMatrixElementError, mismatch);
    row.comparedFrames++;
  }
  for (const [id, value] of Object.entries(values)) {
    const range = ranges.get(id), point = config.points.find(point => point.id === id);
    assert(value >= point.min - .00001 && value <= point.max + .00001, `${id} source observation ${value} exceeds configured engineering range`);
    range.min = Math.min(range.min, value); range.max = Math.max(range.max, value);
  }
}

// Include every configured point endpoint and intermediate position, independently of archive time.
let engineeringSamples = 0;
for (const point of config.points) for (let sample = 0; sample <= 32; sample++) {
  const matrices = evaluateBindings(config, gltf, { [point.id]: point.min + (point.max - point.min) * sample / 32 });
  for (const [id, matrix] of matrices) {
    assert(matrix.elements.every(Number.isFinite), `${id} non-finite transform at ${point.id} sample ${sample}`);
    if (id !== 'laser') assert(Math.abs(matrix.determinant() - 1) < .00001, `${id} is not a rigid transform`);
  }
  engineeringSamples++;
}
const meshNodeCount = gltf.nodes.filter(node => node.mesh !== undefined).length;
assert(verification.outputBytes <= 150 * 1024 * 1024);
assert(meshNodeCount <= 6000);
assert(config.points.length <= 128 && config.bindings.length <= 128 && config.colliders.length <= 64);
const report = {
  version: 1, verifiedAt: new Date().toISOString(), sourceSha256: model.sha256,
  purpose: 'Offline verification against original baked matrices only. No source clock, frame sequence or animation curve is installed into the simulator/runtime.',
  nativeFrames: frameCount, mechanicalControllersCompared: 17, mechanicalMatrixComparisons: frameCount * 17,
  engineeringSamples, sampledEngineeringValues: [...ranges].map(([pointId, range]) => ({ pointId, ...range })),
  nodes: [...perBinding.values()].filter(row => row.comparedFrames), maxPathProjectionErrorMetres,
  laser: { configured: '0/1 light indicator at calibrated scan center', sourceMaxScanOffsetMetres: maxLaserScanOffsetMetres, nativeRasterScanReproduced: false, engravingProduced: false },
  resourceBudget: { sourceBytes: model.bytes, displayedLosslessBytes: verification.outputBytes, sceneLimitBytes: 150 * 1024 * 1024, nodeCount: gltf.nodes.length, uniqueMeshes: gltf.meshes.length, estimatedMeshInstances: meshNodeCount, meshInstanceLimit: 6000, imageCount: gltf.images.length, extraWebGLContexts: 0, extraModelDownloadsForDrive: 0, configuredCollisionProxies: config.colliders.length },
  limitations: ['Matrix and budget checks do not certify arbitrary joint combinations or continuous collision safety.', 'Original animation samples are calibration evidence, not live clock values or commands.', 'Pallet paths cover geometry; automatic queue scheduling, load ownership and station interlocks are not configured.', 'Laser raster scanning and eight material/engraving controllers are not reproduced.'],
};
const output = resolve(directory, 'twin-drive-full-range-audit.json');
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ passed: true, reportPath: output, nativeFrames: frameCount, mechanicalMatrixComparisons: report.mechanicalMatrixComparisons, maxMatrixElementError: Math.max(...report.nodes.map(row => row.maxMatrixElementError)), engineeringSamples, maxPathProjectionErrorMetres, resourceBudget: report.resourceBudget, laser: report.laser }, null, 2));
