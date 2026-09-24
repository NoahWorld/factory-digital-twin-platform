/** Local customer-model calibration tests; no network writes and no timeline playback. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3, Matrix4 } from '../apps/web/node_modules/three/build/three.module.js';
import { OBB } from '../apps/web/node_modules/three/examples/jsm/math/OBB.js';
import { twinDriveErrors } from '../shared/twin-drive.ts';
import { inspectModel, buildCaseConfig, calibrate, evaluateBindings, businessAssets, CASE_NOTES } from './configure-kaide-twin-drive.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'deploy/local/.local/cases/kaide');
const json = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const manifest = json('manifest.json');
const model = inspectModel(json('verification.json').originalPath);
const config = buildCaseConfig(manifest, model.gltf);
const report = calibrate(config, model);
const matrixError = (a, b) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
assert.equal(config.points.length, 16);
assert.equal(config.bindings.length, 18);
assert.deepEqual(twinDriveErrors(config), []);
assert(report.maxHomeMatrixElementError < 1e-6);
assert.equal(report.unboundAnimatedNodes.length, 8);
assert(CASE_NOTES.some(note => note.includes('不是完整生产流程')));
assert.equal(businessAssets(config).length, 5);
assert(config.points.every(point => businessAssets(config).some(asset => asset.assetId === point.assetId)));

// Duplicate/moved controller identities cannot silently bind another piece of geometry.
const duplicate = structuredClone(model.gltf);
duplicate.nodes.push({ name: 'ANIM_ROBOT_J1' });
assert.throws(() => buildCaseConfig(manifest, duplicate), /exactly one stable node/);
const missing = structuredClone(model.gltf);
missing.nodes.find(node => node.name === 'ANIM_ROBOT_J1').name = 'renamed-j1';
assert.throws(() => buildCaseConfig(manifest, missing), /exactly one stable node/);
const wrongCalibration = structuredClone(config);
wrongCalibration.bindings[0].pivot[0] += .1;
assert.throws(() => calibrate(wrongCalibration, model), /home mismatch/);

// Finger commands retain J6 ownership and represent a real 8 mm/finger stroke.
const open = evaluateBindings(config, model.gltf);
const closed = evaluateBindings(config, model.gltf, { 'gripper-opening': .0154 });
assert(matrixError(open.get('robot-j6'), closed.get('robot-j6')) === 0);
for (const side of ['r', 'l']) {
  const a = new Vector3().setFromMatrixPosition(open.get(`finger-${side}`));
  const b = new Vector3().setFromMatrixPosition(closed.get(`finger-${side}`));
  assert(Math.abs(a.distanceTo(b) - .008) < 1e-12);
}
const joint = evaluateBindings(config, model.gltf, { 'robot-j1': 35 });
const inheritedDelta = joint.get('robot-j1').clone().multiply(open.get('robot-j1').clone().invert());
assert(matrixError(joint.get('robot-j6'), inheritedDelta.clone().multiply(open.get('robot-j6'))) < 1e-12);

// Pallet pose keys are cumulative physical path length; queuing plate 02 advances toward 01.
for (const binding of config.bindings.filter(binding => binding.id.startsWith('pallet-'))) {
  for (let i = 1; i < binding.poses.length; i++) {
    const a = binding.poses[i - 1], b = binding.poses[i];
    const distance = new Vector3(...a.position).distanceTo(new Vector3(...b.position));
    assert(Math.abs(b.value - a.value - distance) < 1e-12);
  }
}
const advance = evaluateBindings(config, model.gltf, { 'pallet-02-distance': .2 });
const delta = advance.get('pallet-02').clone().multiply(open.get('pallet-02').clone().invert());
assert(matrixError(delta, new Matrix4().makeTranslation(-.2, 0, 0)) < 1e-12);
assert.throws(() => evaluateBindings(config, model.gltf, { 'pallet-02-distance': -1 }), /outside configured pose path/);

// Use the same OBB implementation as the runtime, rather than claiming AABB-only proof.
function obb(id, values) {
  const collider = config.colliders.find(c => c.id === id);
  const binding = config.bindings.find(b => b.target.nodeName === collider.target.nodeName);
  return new OBB(new Vector3(...collider.center), new Vector3(...collider.size).multiplyScalar(.5)).applyMatrix4(evaluateBindings(config, model.gltf, values).get(binding.id));
}
const first = obb('pallet-01-box', {});
assert(!first.intersectsOBB(obb('pallet-02-box', {})));
assert(first.intersectsOBB(obb('pallet-02-box', { 'pallet-02-distance': .2 })));
assert(!first.intersectsOBB(obb('pallet-02-box', { 'pallet-02-distance': 0 })));
for (const rule of config.collisionRules) assert(!obb(rule.first, {}).intersectsOBB(obb(rule.second, {})), `${rule.id} overlaps at home`);

// Overhead composition stays mechanical: a Z-stage move carries Y and both jaws together.
const hoist = evaluateBindings(config, model.gltf, { 'hoist-height': -.2, 'hoist-travel': .1 });
assert(matrixError(hoist.get('hoist-y'), new Matrix4().makeTranslation(0, -.2, -.1)) < 1e-12);
for (const side of ['r', 'l']) assert(matrixError(hoist.get(`hoist-jaw-${side}`), hoist.get('hoist-y')) < 1e-12);
assert.equal(config.procedures.length, 4);
assert.equal(new Set(config.points.map(point => point.topic)).size, 16);
assert(config.points.every(point => point.topic === `kaide/${point.assetId}/${point.id}`));
assert.deepEqual(config.simulation, { enabled: true, procedureId: 'automatic-mechanism-inspection', repeat: true });
const automatic = config.procedures.find(p => p.id === config.simulation.procedureId);
assert.equal(automatic.steps.length, 2);
for (const target of automatic.steps.at(-1).targets) assert.equal(target.value, config.points.find(point => point.id === target.pointId).initialValue, 'Repeat must return through feedback, not teleport/reset.');
assert(!automatic.steps.some(step => step.targets.some(target => target.pointId.startsWith('pallet-'))), 'Collision demo must not run as the default automatic inspection.');
console.log(JSON.stringify({ passed: true, controllers: config.bindings.length, points: config.points.length, homeMaxMatrixError: report.maxHomeMatrixElementError, tested: ['schema', 'all-18-home-matrices', 'node-identity', 'FK-inheritance', '8mm-finger-stroke', 'metre-path-distance', 'hoist-inheritance', 'OBB-enter-exit', 'incomplete-material-scope-visible'] }, null, 2));
