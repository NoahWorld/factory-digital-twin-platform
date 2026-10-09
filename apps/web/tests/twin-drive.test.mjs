import assert from 'node:assert/strict';
import { Group, Matrix4, Vector3 } from 'three';
import { TwinDriveRuntime } from '../src/scene/twin-drive-runtime';
import { emptyTwinDriveConfig, twinDriveErrors, twinApiConnectionErrors, twinSourcePathValid } from '../../../shared/twin-drive';
import { readTwinSnapshot } from '../src/twin/point-stream';
import './twin-binding-remap.test.mjs';

const time = Date.parse('2026-09-21T08:00:00Z');
const target = nodeName => ({ instanceId: 'instance', modelAssetId: 'asset', nodeName });
const point = (id, initialValue = 0) => ({ id, label: id, assetId: '', metricKey: id, sourcePath: id, unit: 'm', min: -360, max: 360, initialValue, maxSpeed: 1, staleAfterMs: 1000 });
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
  const feed = (values, now = time, frameNow = now) => {
    state.snapshot = { type: 'snapshot', source: config.source, projectId: 'project', revision: 1, sequence: ++sequence, timestamp: new Date(now).toISOString(), status: 'running', procedure: null,
      points: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, target: 123, quality: 'good', timestamp: new Date(now).toISOString() }])) };
    runtime.tick(now, false, frameNow);
  };
  return { runtime, state, reports, feed };
}
const config = () => ({ ...emptyTwinDriveConfig(), enabled: true, connection: { ...emptyTwinDriveConfig().connection, url: '/api/v1/test-business/handling-cell/state' } });
const legacyConfig = () => { const { connection, ...base } = config(); return { ...base, source: 'simulator' }; };
const position = node => new Vector3().setFromMatrixPosition(node.matrix).toArray();
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < epsilon, `${actual} != ${expected}`));

// Real interface ranges do not depend on the retired simulator's hidden initial value.
{
  const c = config(); c.points = [{ ...point('distance'), min: 10, max: 20, initialValue: 0, maxSpeed: 0 }]; c.bindings = [binding('distance', 'carriage')];
  assert.deepEqual(twinDriveErrors(c), []);
  c.points[0].min = 20;
  assert.match(twinDriveErrors(c).join(), /数据范围或过期时间无效/);
  const legacy = legacyConfig(); legacy.points = [{ ...point('distance'), assetId: 'device', min: 10, max: 20, initialValue: 0 }];
  assert.match(twinDriveErrors(legacy).join(), /量程、初值/);
}

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
  const c = legacyConfig(); c.points = [{ ...point('distance'), assetId: 'device', topic: 'device/distance' }]; c.bindings = [binding('distance', 'carriage')];
  c.procedures = [{ id: 'inspect', label: 'inspect', steps: [{ id: 'step', label: 'step', targets: [{ pointId: 'distance', value: 1 }], tolerance: 0.01, timeoutMs: 30000 }] }];
  c.simulation = { enabled: true, procedureId: 'inspect', repeat: true };
  const { runtime } = setup(c, [record]); runtime.tick(time);
  assert.equal(runtime.diagnostics.status, 'waiting');
  assert.equal(runtime.diagnostics.message, '等待业务接口的数据反馈');
  runtime.dispose();
}

// Received observations bound motion. An isolated first sample cannot generate movement by itself.
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
  state.snapshot.status = 'error'; state.snapshot.error = 'source_timeout'; runtime.tick(time + 1501); assert.equal(runtime.diagnostics.status, 'error'); assert.match(runtime.diagnostics.message, /业务接口响应超时/); near(position(nodes.carriage), [1, 0, 0]);
  runtime.dispose(); assert.equal(nodes.carriage.matrixAutoUpdate, true); near(position(nodes.carriage), [2, 0, 0]);
}
// Low-frequency feedback is displayed each frame, uses a monotonic render clock, and never extrapolates.
{
  const { record, nodes } = fixture({ carriage: [2, 0, 0] });
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'carriage')];
  const { runtime, reports, feed } = setup(c, [record]);
  feed({ distance: 0 }, time, 0);
  feed({ distance: 10 }, time + 500, 500); near(position(nodes.carriage), [2, 0, 0]);
  runtime.tick(time + 625, false, 625); near(position(nodes.carriage), [4.5, 0, 0]);
  runtime.tick(time + 750, false, 750); near(position(nodes.carriage), [7, 0, 0]);
  // Wall-clock corrections affect freshness only; they do not reverse display interpolation.
  runtime.tick(time + 700, false, 875); near(position(nodes.carriage), [9.5, 0, 0]);
  runtime.tick(time + 1000, false, 1000); near(position(nodes.carriage), [12, 0, 0]);
  const completedReports = reports.length;
  for (let frame = 1016; frame <= 1450; frame += 16) {
    runtime.tick(time + frame, false, frame); near(position(nodes.carriage), [12, 0, 0]);
  }
  assert.equal(reports.length, completedReports, 'stable feedback must not cause repeated React diagnostics updates');
  runtime.dispose(); near(position(nodes.carriage), [2, 0, 0]);
}
// Packet jitter retargets from the current displayed pose without jumping to the previous endpoint.
{
  const { record, nodes } = fixture({ carriage: [0, 0, 0] });
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'carriage')];
  const { runtime, feed } = setup(c, [record]);
  feed({ distance: 0 }, time, 0); feed({ distance: 10 }, time + 500, 500);
  runtime.tick(time + 625, false, 625); near(position(nodes.carriage), [2.5, 0, 0]);
  feed({ distance: 20 }, time + 750, 750); near(position(nodes.carriage), [5, 0, 0]);
  runtime.tick(time + 875, false, 875); near(position(nodes.carriage), [12.5, 0, 0]);
  runtime.tick(time + 1000, false, 1000); near(position(nodes.carriage), [20, 0, 0]);
  feed({ distance: 0 }, time + 1250, 1250);
  runtime.tick(time + 1500, false, 1500); near(position(nodes.carriage), [10, 0, 0]);
  // A bad new endpoint freezes the last displayed pose before even advancing the old transition.
  feed({ distance: 361 }, time + 1550, 1550); assert.equal(runtime.diagnostics.status, 'error');
  near(position(nodes.carriage), [10, 0, 0]); runtime.tick(time + 1750, false, 1750);
  near(position(nodes.carriage), [10, 0, 0]); runtime.dispose();
}
// Every unavailable state cancels an unfinished transition; only fresh recovery may move again.
for (const condition of ['disconnected', 'stale', 'missing', 'error', 'idle', 'paused']) {
  const { record, nodes } = fixture({ carriage: [0, 0, 0] });
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'carriage')];
  const { runtime, state, feed } = setup(c, [record]);
  feed({ distance: 0 }, time, 0); feed({ distance: 10 }, time + 500, 500);
  runtime.tick(time + 750, false, 750); near(position(nodes.carriage), [5, 0, 0]);
  if (condition === 'disconnected') state.connected = false;
  if (condition === 'stale') state.snapshot.points.distance.quality = 'stale';
  if (condition === 'missing') delete state.snapshot.points.distance;
  if (['error', 'idle', 'paused'].includes(condition)) state.snapshot.status = condition;
  runtime.tick(time + 800, false, 800); near(position(nodes.carriage), [5, 0, 0]);
  runtime.tick(time + 1100, false, 1100); near(position(nodes.carriage), [5, 0, 0]);
  nodes.carriage.matrix.identity(); runtime.invalidate(); runtime.tick(time + 1150, false, 1150);
  near(position(nodes.carriage), [5, 0, 0]);
  state.connected = true; feed({ distance: 2 }, time + 1200, 1200); near(position(nodes.carriage), [2, 0, 0]);
  runtime.dispose();
}
// Reconnecting to a static, still-good observation reaches that actual endpoint, even without a new sequence.
{
  const { record, nodes } = fixture({ carriage: [0, 0, 0] });
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'carriage')];
  const { runtime, state, feed } = setup(c, [record]);
  feed({ distance: 0 }, time, 0); feed({ distance: 10 }, time + 500, 500);
  runtime.tick(time + 750, false, 750); near(position(nodes.carriage), [5, 0, 0]);
  state.connected = false; runtime.tick(time + 800, false, 800); near(position(nodes.carriage), [5, 0, 0]);
  state.connected = true; runtime.tick(time + 900, false, 900);
  near(position(nodes.carriage), [10, 0, 0]); assert.equal(runtime.diagnostics.status, 'live'); runtime.dispose();
}
// Data expiration cancels the tween at the last rendered value, including after a background-tab gap.
{
  const { record, nodes } = fixture({ carriage: [0, 0, 0] });
  const c = config(); c.points = [{ ...point('distance'), staleAfterMs: 500 }]; c.bindings = [binding('distance', 'carriage')];
  const { runtime, feed } = setup(c, [record]);
  feed({ distance: 0 }, time, 0); feed({ distance: 10 }, time + 400, 500);
  runtime.tick(time + 650, false, 750); near(position(nodes.carriage), [5, 0, 0]);
  runtime.tick(time + 901, false, 1001); assert.equal(runtime.diagnostics.status, 'stale');
  near(position(nodes.carriage), [5, 0, 0]);
  feed({ distance: 3 }, time + 2500, 2500); near(position(nodes.carriage), [3, 0, 0]); runtime.dispose();
}
// Interpolation is capped at one second, and same-time corrections are applied directly.
{
  const { record, nodes } = fixture({ carriage: [0, 0, 0] });
  const c = config(); c.points = [{ ...point('distance'), staleAfterMs: 10000 }]; c.bindings = [binding('distance', 'carriage')];
  const { runtime, feed } = setup(c, [record]);
  feed({ distance: 0 }, time, 0); feed({ distance: 10 }, time + 3000, 3000);
  runtime.tick(time + 3500, false, 3500); near(position(nodes.carriage), [5, 0, 0]);
  runtime.tick(time + 4000, false, 4000); near(position(nodes.carriage), [10, 0, 0]);
  feed({ distance: 4 }, time + 3000, 4100); near(position(nodes.carriage), [4, 0, 0]);
  feed({ distance: 5 }, time + 2999, 4200); assert.equal(runtime.diagnostics.status, 'error');
  near(position(nodes.carriage), [4, 0, 0]); runtime.dispose();
}
// All FK joints share a frame progress; visibility remains discrete even on a shared point.
{
  const { record, nodes } = fixture({ arm: [0, 0, 0], tool: [0, 0, 0], light: [0, 0, 0] });
  const c = config(); c.points = [point('joint'), point('slide')];
  c.bindings = [
    { ...binding('joint', 'arm', 'rotation'), axis: [0, 0, 1], useNodeRestPose: false },
    { ...binding('slide', 'tool'), parentBindingId: 'joint', useNodeRestPose: false },
    { ...binding('light', 'light', 'visibility'), pointId: 'slide' },
  ];
  const { runtime, feed } = setup(c, [record]);
  feed({ joint: 0, slide: 0 }, time, 0); assert.equal(nodes.light.visible, false);
  feed({ joint: 90, slide: 2 }, time + 500, 500); assert.equal(nodes.light.visible, true);
  near(position(nodes.tool), [0, 0, 0]);
  runtime.tick(time + 750, false, 750); near(position(nodes.tool), [Math.SQRT1_2, Math.SQRT1_2, 0]);
  assert.equal(nodes.light.visible, true);
  runtime.tick(time + 1000, false, 1000); near(position(nodes.tool), [0, 2, 0]); runtime.dispose();
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
// A driven parent with an unwritable endpoint is rejected BEFORE any child/parent interpolation starts.
{
  const { record, nodes } = fixture({ parent: [0, 0, 0], child: [0, 0, 0] });
  nodes.parent.add(nodes.child);
  const c = config(); c.points = [point('parent'), point('child')]; c.bindings = [
    { ...binding('parent', 'parent', 'pose'), useNodeRestPose: false, poses: [
      { value: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { value: 1, position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
    ] },
    { ...binding('child', 'child'), parentBindingId: 'parent' },
  ];
  const { runtime, feed } = setup(c, [record]);
  feed({ parent: 0, child: 0 }, time, 0);
  const parentBefore = nodes.parent.matrix.clone(), childBefore = nodes.child.matrix.clone();
  feed({ parent: 1, child: 1 }, time + 500, 500); assert.equal(runtime.diagnostics.status, 'error');
  runtime.tick(time + 750, false, 750);
  assert.deepEqual(nodes.parent.matrix.elements, parentBefore.elements); assert.deepEqual(nodes.child.matrix.elements, childBefore.elements);
  runtime.dispose();
}
// Displayed collision events include intermediate poses, not just the two received endpoints.
{
  const { record } = fixture({ moving: [0, 0, 0], fixed: [5, 0, 0] });
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'moving')];
  c.colliders = ['moving', 'fixed'].map(id => ({ id, label: id, target: target(id), center: [0, 0, 0], size: [.2, .2, .2] }));
  c.collisionRules = [{ id: 'contact', label: 'contact', first: 'moving', second: 'fixed', severity: 'warning', enabled: true }];
  const { runtime, feed } = setup(c, [record]);
  feed({ distance: 0 }, time, 0); feed({ distance: 10 }, time + 500, 500);
  assert.deepEqual(runtime.diagnostics.activeCollisions, []);
  runtime.tick(time + 750, false, 750); assert.deepEqual(runtime.diagnostics.activeCollisions, ['contact']);
  runtime.tick(time + 900, false, 900); assert.deepEqual(runtime.diagnostics.activeCollisions, []);
  assert.deepEqual(runtime.diagnostics.events.map(e => [e.phase, e.sequence, e.timestamp]), [
    ['enter', 2, new Date(time + 500).toISOString()], ['exit', 2, new Date(time + 500).toISOString()],
  ]); runtime.dispose();
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
  const c = legacyConfig(); c.points = [{ ...point('p'), assetId: 'device', topic: 'plant/motor/position' }]; c.bindings = [binding('p', 'axis')];
  c.procedures = [{ id: 'inspect', label: 'inspect', steps: [{ id: 'move', label: 'move', targets: [{ pointId: 'p', value: 1 }], tolerance: .001, timeoutMs: 1000 }] }];
  c.simulation = { enabled: true, procedureId: 'inspect', repeat: true };
  assert.deepEqual(twinDriveErrors(c), []);
  for (const topic of ['', 'plant/+', 'plant/#', 'plant/a b', 'x'.repeat(201)]) {
    c.points[0].topic = topic; assert.match(twinDriveErrors(c).join(), /topic/);
  }
  delete c.points[0].topic; assert.match(twinDriveErrors(c).join(), /topic/);
  c.points[0].topic = 'plant/motor/position';
  c.points.push({ ...point('q'), assetId: 'device', topic: c.points[0].topic }); assert.match(twinDriveErrors(c).join(), /topic/); c.points.pop();
  c.simulation.procedureId = 'unknown'; assert.match(twinDriveErrors(c).join(), /工序/);
  c.simulation.procedureId = 'inspect'; c.enabled = false; assert.match(twinDriveErrors(c).join(), /启用/);
  c.enabled = true; c.bindings = []; assert.match(twinDriveErrors(c).join(), /绑定/);
  c.simulation.enabled = false; c.simulation.procedureId = ''; assert.deepEqual(twinDriveErrors(c), []);
}
// API configuration rejects ambiguous/private credential paths before taking node ownership.
{
  const c = config(); c.points = [point('distance')]; c.bindings = [binding('distance', 'axis')];
  assert.deepEqual(twinDriveErrors(c), []);
  for (const path of ['constructor.value', 'a.__proto__.value', 'a[1000]', 'a+b', 'a.b.c.d.e.f.g.h.i', 'a..b', '$']) assert.equal(twinSourcePathValid(path), false, path);
  for (const path of ['agv.positionM', '$.robot.angleDeg', 'items[0].state', 'items[999].value']) assert.equal(twinSourcePathValid(path), true, path);
  for (const url of ['/internal/private', 'https://user:password@example.test/state', 'https://example.test/state?api_key=hidden', 'https://example.test/state#part', 'ws://example.test/state']) {
    assert.ok(twinApiConnectionErrors({ ...c.connection, url }).length, url);
  }
  for (const protocol of ['rest', 'websocket']) {
    const connection = { ...c.connection, protocol, url: `/api/v1/test-business/handling-cell/${protocol === 'rest' ? 'state' : 'live'}` };
    assert.deepEqual(twinApiConnectionErrors(connection), []);
    assert.deepEqual(twinApiConnectionErrors({ ...connection, url: '', redacted: true }), [], 'authorized read projection does not require private upstream URL');
    assert.ok(twinApiConnectionErrors({ ...connection, redacted: true }).length, 'redacted projection cannot also expose an upstream address');
    assert.ok(twinApiConnectionErrors({ ...connection, intervalMs: 199 }).length);
    assert.ok(twinApiConnectionErrors({ ...connection, timeoutMs: 30001 }).length);
  }
  c.points[0].sourcePath = 'agv.positionM'; c.points[0].topic = 'platform/axis';
  assert.match(twinDriveErrors(c).join(), /不需要 Topic/); delete c.points[0].topic;
  c.procedures = [{ id: 'old', label: 'old', steps: [] }]; assert.match(twinDriveErrors(c).join(), /不使用平台模拟流程/);
}
console.log('PASS twin-drive: bounded per-frame interpolation, monotonic clock/jitter/recovery, coherent FK/discrete visibility, stale/disconnected freeze, endpoint hierarchy validation, intermediate OBB events, atomic rollback and API feedback validation');
