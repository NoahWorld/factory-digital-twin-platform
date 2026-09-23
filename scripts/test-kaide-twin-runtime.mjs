/** Regression against the real customer GLB node tree and the current shared runtime.
 * No API writes, native animation, WebGL context, geometry upload or GPU benchmark.
 * node scripts/test-kaide-twin-runtime.mjs [--case-dir path] [--model original.glb]
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Group, Matrix4 } from '../apps/web/node_modules/three/build/three.module.js';
import { buildCaseConfig, evaluateBindings, inspectModel, nodeMatrix } from './configure-kaide-twin-drive.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert(['--case-dir', '--model'].includes(args[i]), `Unknown option: ${args[i]}`);
  assert(args[i + 1] && !args[i + 1].startsWith('--'), `${args[i]} requires a value.`);
  assert(!options.has(args[i]), `Duplicate option: ${args[i]}`);
  options.set(args[i], args[i + 1]);
}
const directory = resolve(options.get('--case-dir') ?? resolve(root, 'deploy/local/.local/cases/kaide'));
const json = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const manifest = json('manifest.json');
const source = inspectModel(resolve(options.get('--model') ?? json('verification.json').originalPath));
const { gltf } = source;
const config = buildCaseConfig(manifest, gltf);
assert.equal(config.points.length, 16);
assert.equal(config.bindings.length, 18);

// Preserve every real node/parent/local transform. Meshes are intentionally only transform nodes.
const nodes = gltf.nodes.map(definition => {
  const object = new Group();
  object.name = definition.name ?? '';
  // Keep authored TRS, especially the laser's zero-scale rest pose: decomposing a singular
  // matrix loses its authored rotation and can manufacture NaNs in a synthetic fixture.
  if (definition.matrix) nodeMatrix(definition).decompose(object.position, object.quaternion, object.scale);
  else {
    if (definition.translation) object.position.fromArray(definition.translation);
    if (definition.rotation) object.quaternion.fromArray(definition.rotation);
    if (definition.scale) object.scale.fromArray(definition.scale);
  }
  return object;
});
gltf.nodes.forEach((definition, index) => (definition.children ?? []).forEach(child => nodes[index].add(nodes[child])));
const model = new Group(), wrapper = new Group();
wrapper.add(model);
gltf.scenes[gltf.scene ?? 0].nodes.forEach(index => model.add(nodes[index]));
wrapper.updateMatrixWorld(true);
const originals = new Map(), objectsByName = new Map();
model.traverse(object => {
  originals.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
  if (object.name) objectsByName.set(object.name, [...(objectsByName.get(object.name) ?? []), object]);
});
const record = { id: manifest.instanceId, assetId: manifest.displayId, model, wrapper, originals, objectsByName };
const objectFor = binding => {
  const matches = objectsByName.get(binding.target.nodeName);
  assert.equal(matches?.length, 1, `Non-unique controller ${binding.target.nodeName}`);
  return matches[0];
};
const homeMatrices = new Map(config.bindings.map(binding => [binding.id, objectFor(binding).matrix.clone()]));
const matrixError = (actual, expected) => Math.max(...actual.elements.map((value, index) => Math.abs(value - expected.elements[index])));

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { build } = createRequire(web.resolve('vite'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'kaide-twin-runtime-'));
let runtime;
try {
  const outfile = join(temporary, 'runtime.mjs');
  await build({ entryPoints: [resolve(root, 'apps/web/src/scene/twin-drive-runtime.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning' });
  const { TwinDriveRuntime } = await import(pathToFileURL(outfile).href);
  const state = { connected: true, snapshot: null };
  runtime = new TwinDriveRuntime([record], { config, source: { getState: () => state, subscribe: () => () => {} } });
  let sequence = 0, now = Date.now();
  const values = Object.fromEntries(config.points.map(point => [point.id, point.initialValue]));
  let maxRuntimeMatrixElementError = 0;
  const feed = (updates = {}) => {
    Object.assign(values, updates);
    const timestamp = new Date(now).toISOString();
    state.snapshot = { type: 'snapshot', source: 'simulator', projectId: manifest.projectId, revision: 1, sequence: ++sequence,
      timestamp, status: 'running', procedure: null,
      points: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, target: value, quality: 'good', timestamp }])) };
    runtime.tick(now);
    assert.equal(runtime.diagnostics.status, 'live', runtime.diagnostics.message);
    wrapper.updateMatrixWorld(true);
    const expected = evaluateBindings(config, gltf, values);
    for (const binding of config.bindings) {
      const object = objectFor(binding);
      assert(object.matrix.elements.every(Number.isFinite), `Non-finite transform for ${binding.id}`);
      const actual = new Matrix4().copy(model.matrixWorld).invert().multiply(object.matrixWorld);
      const error = matrixError(actual, expected.get(binding.id));
      assert(error < 1e-9, `${binding.id}: runtime/config matrix mismatch ${error}`);
      maxRuntimeMatrixElementError = Math.max(maxRuntimeMatrixElementError, error);
    }
  };
  feed();
  const maxHomeMatrixElementError = Math.max(...config.bindings.map(binding => matrixError(objectFor(binding).matrix, homeMatrices.get(binding.id))));
  assert(maxHomeMatrixElementError < 1e-6, `GLB home pose differs: ${maxHomeMatrixElementError}`);
  assert.deepEqual(runtime.diagnostics.activeCollisions, [], 'Home proxies must be separate.');

  let endpointSamples = 0;
  for (const point of config.points) {
    for (const value of [point.min, point.max]) { feed({ [point.id]: value }); endpointSamples++; }
    feed({ [point.id]: point.initialValue });
  }
  assert.equal(endpointSamples, 32);

  // One model-instance transform must apply exactly once to every calibrated FK controller.
  wrapper.position.set(12, 3, -7);
  wrapper.rotation.set(.1, .8, -.2);
  wrapper.scale.setScalar(4);
  runtime.invalidate();
  feed();
  wrapper.position.set(0, 0, 0); wrapper.rotation.set(0, 0, 0); wrapper.scale.setScalar(1);
  runtime.invalidate(); feed();

  // Collision events use the actual runtime OBB code and the geometry-derived case proxies.
  feed({ 'pallet-02-distance': .20 });
  assert(runtime.diagnostics.activeCollisions.includes('pallet-1-2'), 'Expected pallet contact at 0.20 m.');
  feed({ 'pallet-02-distance': 0 });
  assert.deepEqual(runtime.diagnostics.activeCollisions, []);
  assert.deepEqual(runtime.diagnostics.events.slice(-2).map(event => [event.ruleId, event.phase, event.provenance]), [
    ['pallet-1-2', 'enter', 'browser-obb'], ['pallet-1-2', 'exit', 'browser-obb'],
  ]);

  const frozen = new Map(config.bindings.map(binding => [binding.id, objectFor(binding).matrix.clone()]));
  const assertFrozen = () => config.bindings.forEach(binding => assert(matrixError(objectFor(binding).matrix, frozen.get(binding.id)) < 1e-12, `Frozen pose changed: ${binding.id}`));
  state.connected = false;
  now += 100;
  runtime.tick(now);
  assert.equal(runtime.diagnostics.status, 'disconnected');
  assertFrozen();
  state.connected = true;
  now += Math.max(...config.points.map(point => point.staleAfterMs)) + 1;
  runtime.tick(now);
  assert.equal(runtime.diagnostics.status, 'stale');
  assertFrozen();
  feed({ 'gripper-opening': .0154 });
  assert(matrixError(objectFor(config.bindings.find(binding => binding.id === 'finger-r')).matrix, frozen.get('finger-r')) > .001);
  feed({ 'gripper-opening': config.points.find(point => point.id === 'gripper-opening').initialValue });

  const started = performance.now();
  for (let index = 0; index < 10000; index++) runtime.tick(now);
  const stableTickMicroseconds = (performance.now() - started) * 1000 / 10000;
  runtime.dispose();
  for (const binding of config.bindings) {
    assert.equal(objectFor(binding).matrixAutoUpdate, true);
    assert(matrixError(objectFor(binding).matrix, homeMatrices.get(binding.id)) < 1e-12, `Dispose did not restore ${binding.id}`);
  }
  console.log(JSON.stringify({ passed: true, sourceSha256: source.sha256, realModelNodes: nodes.length, boundControllers: config.bindings.length,
    homeMatrices: 18, pointEndpointSamples: endpointSamples, maxHomeMatrixElementError, maxRuntimeMatrixElementError,
    tested: ['real-GLB-node-hierarchy', 'all-controller-home-matrices', 'all-point-min-max', 'model-instance-transform', 'OBB-enter-exit', 'disconnect-stale-freeze-and-recovery', 'dispose-restores-model'],
    performance: { scope: 'Node CPU only; no WebGL, geometry upload, rendering or GPU measurement', unchangedSnapshotTicks: 10000, meanTickMicroseconds: stableTickMicroseconds },
  }, null, 2));
} finally {
  runtime?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
