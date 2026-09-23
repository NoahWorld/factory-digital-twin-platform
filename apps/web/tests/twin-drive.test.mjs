import assert from 'node:assert/strict';
import { Group, Matrix4, Vector3 } from 'three';
import { TwinDriveRuntime } from '../src/scene/twin-drive-runtime';
import { emptyTwinDriveConfig, twinDriveErrors } from '../../../shared/twin-drive';
import { readTwinSnapshot } from '../src/twin/point-stream';
import './twin-binding-remap.test.mjs';

const time = Date.parse('2026-09-21T08:00:00Z');
const target = nodeName => ({ instanceId: 'instance', modelAssetId: 'asset', nodeName });
const point = (id, initialValue = 0) => ({ id, label: id, assetId: 'device', metricKey: id, unit: 'm', min: -360, max: 360, initialValue, maxSpeed: 1, staleAfterMs: 1000 });
const binding = (id, node, kind = 'translation') => ({ id, label: id, pointId: id, target: target(node), parentBindingId: null, useNodeRestPose: true, kind, axis: [1, 0, 0], pivot: [0, 0, 0], valueScale: 1, valueOffset: 0, poses: [] });
function fixture(definitions) {
  const wrapper = new Group(), model = new Group(); wrapper.add(model);
  const originals = new Map(), objectsByName = new Map();
  const nodes = {};
  for (const [name, position] of Object.entries(definitions)) {
    const node = new Group(); node.name = name; node.position.set(...position); model.add(node);
    nodes[name] = node; objectsByName.set(name, [node]);
  }
  model.updateMatrixWorld(true);
  model.traverse(node => originals.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
  return { record: { id: 'instance', assetId: 'asset', model, wrapper, originals, objectsByName }, nodes };
}
function setup(config, records) {
  const state = { connected: true, snapshot: null }, reports = [];
  const runtime = new TwinDriveRuntime(records, { config, source: { getState: () => state, subscribe: () => () => {} }, onDiagnostics: report => reports.push(report) });
  let sequence = 0;
  const feed = (values, now = time) => {
    state.snapshot = { type: 'snapshot', source: 'simulator', projectId: 'project', revision: 1, sequence: ++sequence, timestamp: new Date(now).toISOString(), status: 'running', procedure: null,
      points: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, target: 123, quality: 'good', timestamp: new Date(now).toISOString() }])) };
    runtime.tick(now);
  };
  return { runtime, state, reports, feed };
}
const config = () => ({ ...emptyTwinDriveConfig(), enabled: true });
const position = node => new Vector3().setFromMatrixPosition(node.matrix).toArray();
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < epsilon, `${actual} != ${expected}`));

// Catalog drivable identity is derived from the actual object, not names; roots still support collision boxes.
{
  const { record } = fixture({ ordinary: [0, 0, 0] });
  record.model.name = 'named-root';
  record.objectsByName.set('named-root', [record.model]);
  record.objectsByName.set('duplicate', [new Group(), new Group()]);
  let catalog;
  const source = { getState: () => ({ connected: false, snapshot: null }), subscribe: () => () => {} };
  const disabled = new TwinDriveRuntime([record], { config: emptyTwinDriveConfig(), source, onCatalog: nodes => { catalog = nodes; } });
  assert.deepEqual(catalog, [
    { instanceId: 'instance', modelAssetId: 'asset', nodeName: 'ordinary', unique: true, drivable: true },
    { instanceId: 'instance', modelAssetId: 'asset', nodeName: 'named-root', unique: true, drivable: false },
    { instanceId: 'instance', modelAssetId: 'asset', nodeName: 'duplicate', unique: false, drivable: false },
  ]);
  disabled.dispose();
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'named-root')];
  assert.throws(() => setup(c, [record]), /不支持驱动资源根节点/);
  c.bindings = [binding('distance', 'ordinary')];
  c.colliders = [{ id: 'root-box', label: 'root-box', target: target('named-root'), center: [0, 0, 0], size: [1, 1, 1] }];
  const { runtime, feed } = setup(c, [record]); feed({ distance: 1 });
  assert.equal(runtime.diagnostics.status, 'live'); runtime.dispose();
}

// Automatic preview waits for the backend; it never asks users to start/reset a source in preview.
{
  const { record } = fixture({ carriage: [0, 0, 0] });
  const c = config(); c.points = [{ ...point('distance'), topic: 'device/distance' }]; c.bindings = [binding('distance', 'carriage')];
  c.procedures = [{ id: 'inspect', label: 'inspect', steps: [{ id: 'step', label: 'step', targets: [{ pointId: 'distance', value: 1 }], tolerance: 0.01, timeoutMs: 30000 }] }];
  c.simulation = { enabled: true, procedureId: 'inspect', repeat: true };
  const { runtime } = setup(c, [record]); runtime.tick(time);
  assert.equal(runtime.diagnostics.status, 'waiting');
  assert.equal(runtime.diagnostics.message, '等待后端自动模拟源的点位反馈');
  runtime.dispose();
}

// Observation, not target, time or frame count, determines motion. Stale/disconnected freezes atomically.
{
  const { record, nodes } = fixture({ carriage: [2, 0, 0] });
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'carriage')];
  const { runtime, state, feed } = setup(c, [record]);
  runtime.tick(time); assert.equal(runtime.diagnostics.status, 'waiting');
  feed({ distance: 3 }); near(position(nodes.carriage), [5, 0, 0]);
  for (let frame = 0; frame < 100; frame++) runtime.tick(time + frame * 5);
  near(position(nodes.carriage), [5, 0, 0]);
  runtime.tick(time + 1001); assert.equal(runtime.diagnostics.status, 'stale');
  state.connected = false; runtime.tick(time + 1002); assert.equal(runtime.diagnostics.status, 'disconnected');
  nodes.carriage.matrix.identity(); runtime.invalidate(); runtime.tick(time + 1003);
  near(position(nodes.carriage), [5, 0, 0]);
  state.connected = true; feed({ distance: -1 }, time + 1500); near(position(nodes.carriage), [1, 0, 0]);
  state.snapshot.status = 'paused'; runtime.tick(time + 1501); assert.equal(runtime.diagnostics.status, 'paused');
  runtime.dispose(); assert.equal(nodes.carriage.matrixAutoUpdate, true); near(position(nodes.carriage), [2, 0, 0]);
}
// Absolute calibrated FK for sibling GLB nodes; dependencies are explicit, not guessed from names.
{
  const { record, nodes } = fixture({ arm: [7, 1, 0], tool: [9, 1, 0] });
  const c = config(); c.points = [point('joint'), point('slide')];
  c.bindings = [{ ...binding('slide', 'tool'), parentBindingId: 'joint', useNodeRestPose: false }, { ...binding('joint', 'arm', 'rotation'), axis: [0, 0, 1], pivot: [1, 0, 0], useNodeRestPose: false }];
  const { runtime, feed } = setup(c, [record]); feed({ joint: 90, slide: 2 });
  near(position(nodes.arm), [1, -1, 0]); near(position(nodes.tool), [1, 1, 0]);
  // Scene-instance transform changes do not distort model-coordinate bindings.
  record.wrapper.scale.setScalar(4); record.wrapper.rotation.y = 1; runtime.invalidate(); runtime.tick(time + 100);
  near(position(nodes.tool), [1, 1, 0]); runtime.dispose();
}
// Pose curves use engineering point values; zero scales (laser/engraving) never produce NaN.
{
  const { record, nodes } = fixture({ laser: [0, 0, 0] });
  const c = config(); c.points = [point('laser')]; c.bindings = [{ ...binding('laser', 'laser', 'pose'), useNodeRestPose: false, poses: [
    { value: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
    { value: 10, position: [2, 4, 0], rotation: [0, 0, 180], scale: [1, 1, 1] },
  ] }];
  const { runtime, feed } = setup(c, [record]); feed({ laser: 0 }); assert.ok(nodes.laser.matrix.elements.every(Number.isFinite));
  feed({ laser: 5 }); near(position(nodes.laser), [1, 2, 0]);
  assert.ok(Math.abs(new Vector3().setFromMatrixColumn(nodes.laser.matrix, 0).length() - .5) < 1e-8); runtime.dispose();
}
// Configured OBB enter/exit, transforms and bounded event history (not a physics safety interlock).
{
  const { record, nodes } = fixture({ moving: [0, 0, 0], fixed: [3, 0, 0] });
  record.wrapper.rotation.y = .5; record.wrapper.scale.setScalar(4);
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'moving')];
  c.colliders = ['moving', 'fixed'].map(id => ({ id, label: id, target: target(id), center: [0, 0, 0], size: [1, 1, 1] }));
  c.collisionRules = [{ id: 'contact', label: 'contact', first: 'moving', second: 'fixed', severity: 'warning', enabled: true }];
  const { runtime, feed } = setup(c, [record]); feed({ distance: 0 }); assert.deepEqual(runtime.diagnostics.events, []);
  feed({ distance: 2.5 }); assert.deepEqual(runtime.diagnostics.activeCollisions, ['contact']);
  feed({ distance: 2.5 }); assert.equal(runtime.diagnostics.events.length, 1);
  feed({ distance: 0 }); assert.deepEqual(runtime.diagnostics.events.map(e => e.phase), ['enter', 'exit']);
  for (let index = 0; index < 110; index++) feed({ distance: index % 2 ? 0 : 2.5 });
  assert.equal(runtime.diagnostics.events.length, 100); assert.equal(runtime.diagnostics.events[0].provenance, 'browser-obb'); runtime.dispose();
}
// Invalid later mappings cannot contaminate the last coherent pose cache.
{
  const { record, nodes } = fixture({ first: [0, 0, 0], last: [0, 0, 0] });
  const c = config(); c.points = [point('first'), point('last')];
  c.bindings = [binding('first', 'first'), { ...binding('last', 'last', 'pose'), poses: [
    { value: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { value: 1, position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ] }];
  const { runtime, feed, state } = setup(c, [record]);
  feed({ first: 1, last: 1 });
  feed({ first: 2, last: 2 }); assert.equal(runtime.diagnostics.status, 'error');
  near(position(nodes.first), [1, 0, 0]);
  state.connected = false; nodes.first.matrix.identity(); runtime.invalidate(); runtime.tick(time);
  near(position(nodes.first), [1, 0, 0]); runtime.dispose();
}
// Singular hierarchy errors roll back ALL earlier writes and recover after fixing the parent.
{
  const { record, nodes } = fixture({ first: [0, 0, 0], parent: [0, 0, 0], child: [0, 0, 0] });
  nodes.parent.add(nodes.child);
  const c = config(); c.points = [point('first'), point('child')]; c.bindings = [binding('first', 'first'), binding('child', 'child')];
  const { runtime, feed } = setup(c, [record]); feed({ first: 1, child: 1 });
  nodes.parent.scale.setScalar(0);
  feed({ first: 2, child: 2 }); assert.equal(runtime.diagnostics.status, 'error');
  near(position(nodes.first), [1, 0, 0]); near(position(nodes.child), [1, 0, 0]);
  nodes.parent.scale.setScalar(1); runtime.invalidate(); runtime.tick(time);
  assert.equal(runtime.diagnostics.status, 'live'); near(position(nodes.first), [2, 0, 0]);
  runtime.dispose();
}
// Bad references/configuration must fail before taking ownership.
{
  const { record, nodes } = fixture({ valid: [1, 2, 3] });
  const c = config(); c.points = [point('p')]; c.bindings = [binding('p', 'missing')];
  assert.throws(() => setup(c, [record]), /不存在/);
  c.bindings[0].target.nodeName = 'valid'; record.objectsByName.set('valid', [nodes.valid, new Group()]);
  assert.throws(() => setup(c, [record]), /不唯一/); assert.equal(nodes.valid.matrixAutoUpdate, true);
  c.bindings[0].parentBindingId = 'p'; assert.match(twinDriveErrors(c).join(), /循环/);
  c.bindings[0].parentBindingId = null; c.bindings[0].axis = [2, 0, 0]; assert.match(twinDriveErrors(c).join(), /单位向量/);
  c.bindings[0].valueScale = Number.MAX_VALUE; assert.match(twinDriveErrors(c).join(), /量程经变换/);
  assert.throws(() => readTwinSnapshot({ type: 'snapshot' }, 'project'), /无效/);
}
// Automatic backend operation is explicit and cannot start with an ambiguous topic map.
{
  const c = config(); c.points = [{ ...point('p'), topic: 'plant/motor/position' }]; c.bindings = [binding('p', 'axis')];
  c.procedures = [{ id: 'inspect', label: 'inspect', steps: [{ id: 'move', label: 'move', targets: [{ pointId: 'p', value: 1 }], tolerance: .001, timeoutMs: 1000 }] }];
  c.simulation = { enabled: true, procedureId: 'inspect', repeat: true };
  assert.deepEqual(twinDriveErrors(c), []);
  for (const topic of ['', 'plant/+', 'plant/#', 'plant/a b', 'x'.repeat(201)]) {
    c.points[0].topic = topic; assert.match(twinDriveErrors(c).join(), /topic/);
  }
  delete c.points[0].topic; assert.match(twinDriveErrors(c).join(), /topic/);
  c.points[0].topic = 'plant/motor/position';
  c.points.push({ ...point('q'), topic: c.points[0].topic }); assert.match(twinDriveErrors(c).join(), /topic/); c.points.pop();
  c.simulation.procedureId = 'unknown'; assert.match(twinDriveErrors(c).join(), /工序/);
  c.simulation.procedureId = 'inspect'; c.enabled = false; assert.match(twinDriveErrors(c).join(), /启用/);
  c.enabled = true; c.bindings = []; assert.match(twinDriveErrors(c).join(), /绑定/);
  c.simulation.enabled = false; c.simulation.procedureId = ''; assert.deepEqual(twinDriveErrors(c), []);
}
console.log('PASS twin-drive: actual-feedback motion, calibrated FK, stale/disconnected freeze, pose/zero scale, OBB events, atomic rollback/recovery, config/reference/topic/automatic validation');
