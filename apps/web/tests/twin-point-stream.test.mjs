import assert from 'node:assert/strict';
import { TwinPointStream, readTwinSnapshot } from '../src/twin/point-stream.ts';
import { parseTwinDriveConfig } from '../src/twin/twin-config-json.ts';
import { withTwinDriveEnabled } from '../src/twin/twin-config-state.ts';
import { emptyTwinDriveConfig } from '../../../shared/twin-drive.ts';

const stamp = new Date().toISOString();
const point = { id: 'axis', label: 'Axis', assetId: 'robot', metricKey: 'axis', topic: 'factory/robot/axis', unit: 'deg', min: 0, max: 100, initialValue: 0, maxSpeed: 1, staleAfterMs: 3000 };
const snapshot = (patch = {}) => ({ type: 'snapshot', projectId: 'project', revision: 1, sequence: 1, timestamp: stamp, source: 'simulator', status: 'idle', points: {}, procedure: null, ...patch });
assert.deepEqual(readTwinSnapshot(snapshot(), 'project').points, {}, 'idle must not invent zero point values');
for (const patch of [{ revision: -1 }, { sequence: 1.5 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }, { projectId: 'other' }, { timestamp: 'invalid' }, { source: 'invented' }, { procedure: {} }, { points: { x: { value: null, target: 1, timestamp: stamp, quality: 'good' } } }]) {
  assert.throws(() => readTwinSnapshot(snapshot(patch), 'project'));
}
assert.deepEqual(parseTwinDriveConfig(emptyTwinDriveConfig()), emptyTwinDriveConfig());
for (const patch of [{ unknown: 'not ignored' }, { points: {} }, { enabled: 'true' }, { source: 'invented' }, { description: [] }, { bindings: [{}] }, { procedures: [{ id: 'x', label: 'x', steps: [{}] }] }]) {
  assert.throws(() => parseTwinDriveConfig({ ...emptyTwinDriveConfig(), ...patch }));
}
const automaticConfig = parseTwinDriveConfig({
  ...emptyTwinDriveConfig(), enabled: true, points: [point],
  bindings: [{ id: 'binding', label: 'Axis binding', pointId: point.id, target: { instanceId: 'instance', modelAssetId: 'model', nodeName: 'Axis' }, parentBindingId: null, useNodeRestPose: true, kind: 'rotation', axis: [0, 1, 0], pivot: [0, 0, 0], valueScale: 1, valueOffset: 0, poses: [] }],
  procedures: [{ id: 'cycle', label: 'Cycle', steps: [{ id: 'home', label: 'Home', targets: [{ pointId: point.id, value: 0 }], tolerance: 0.01, timeoutMs: 3000 }] }],
  simulation: { enabled: true, procedureId: 'cycle', repeat: true },
});
const savedAutomaticConfig = structuredClone(automaticConfig);
const editorRenderConfig = withTwinDriveEnabled(automaticConfig, false);
assert.doesNotThrow(() => parseTwinDriveConfig(editorRenderConfig), 'render-only disabled editor attachment must remain schema-valid');
assert.equal(editorRenderConfig.enabled, false);
assert.deepEqual(editorRenderConfig.simulation, { enabled: false, procedureId: 'cycle', repeat: true });
assert.deepEqual(automaticConfig, savedAutomaticConfig, 'editor render-only clone must not disable the saved backend producer');
assert.equal(withTwinDriveEnabled(editorRenderConfig, true).simulation.enabled, false, 're-enabling data drive must not silently restart the automatic source');
assert.equal(withTwinDriveEnabled(emptyTwinDriveConfig(), false).simulation, undefined, 'legacy config must not acquire an automatic source');

class Socket {
  static OPEN = 1;
  static all = [];
  readyState = 0;
  sent = [];
  constructor(url) { this.url = url; Socket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
}
const originals = { WebSocket: globalThis.WebSocket, setTimeout, clearTimeout, setInterval, clearInterval };
const timers = new Map(); let timerId = 0;
globalThis.WebSocket = Socket;
globalThis.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; };
globalThis.clearTimeout = (key) => timers.delete(key);
globalThis.setInterval = (fn, ms) => { timers.set(++timerId, { fn, ms, interval: true }); return timerId; };
globalThis.clearInterval = (key) => timers.delete(key);
const fireTimeout = (ms) => {
  const entry = [...timers].find(([, timer]) => timer.ms === ms && !timer.interval);
  assert.ok(entry, `expected ${ms}ms timer`); timers.delete(entry[0]); entry[1].fn();
};

try {
  let reloads = 0;
  const source = new TwinPointStream('ws://local/api/v1/twin-drive?projectId=project', 'project', () => reloads++);
  source.setRevision(1); source.connect();
  let socket = Socket.all.at(-1); socket.open();
  assert.equal(source.getState().connected, false, 'opening a socket is not a data-ready connection');
  socket.message(snapshot()); assert.equal(source.getState().connected, true);
  const command = source.command({ expectedRevision: 1, operation: 'reset' });
  const sent = socket.sent.at(-1);
  assert.equal(sent.operation, 'reset');
  socket.message({ type: 'command_ack', commandId: sent.commandId, sequence: 2 }); await command;
  await assert.rejects(source.command({ expectedRevision: 2, operation: 'reset' }), /配置已变化/);
  const rejected = source.command({ expectedRevision: 1, operation: 'move', values: [{ pointId: 'x', value: 3 }] });
  socket.message({ type: 'error', commandId: socket.sent.at(-1).commandId, error: 'bad_point', message: 'Unknown point' });
  await assert.rejects(rejected, /bad_point/);
  const timedOut = source.command({ expectedRevision: 1, operation: 'pause' });
  const before = socket.sent.length; fireTimeout(10000); await assert.rejects(timedOut, /不会自动重发/);
  assert.equal(socket.sent.length, before);
  const interrupted = source.command({ expectedRevision: 1, operation: 'pause' });
  socket.close(1006); await assert.rejects(interrupted, /不会自动重发/);
  assert.equal(source.getState().retryCount, 1); fireTimeout(1000);
  socket = Socket.all.at(-1); socket.open(); socket.message(snapshot({ sequence: 2 }));
  assert.equal(source.getState().connected, true);
  assert.equal(socket.sent.length, 0, 'reconnect must not replay old commands');
  socket.message({ type: 'config_changed', revision: 2 });
  assert.equal(source.getState().connected, false); assert.equal(reloads, 1);
  socket.message(snapshot({ revision: 2, sequence: 3 }));
  assert.equal(source.getState().snapshot, null, 'new-version packets cannot re-enable old config');
  source.setRevision(2); source.connect(); socket = Socket.all.at(-1); socket.open();
  socket.message(snapshot({ revision: 3 })); assert.equal(reloads, 2); assert.equal(source.getState().connected, false);
  source.setRevision(2); source.connect(); socket = Socket.all.at(-1); socket.open(); socket.message(snapshot({ revision: 2, sequence: 10 }));
  socket.close(1006); fireTimeout(1000); socket = Socket.all.at(-1); socket.open(); socket.message(snapshot({ revision: 2, sequence: 1 }));
  assert.equal(source.getState().phase, 'error'); assert.match(source.getState().error, /序号发生回退/);
  source.close();
  source.connect();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 16000]) { Socket.all.at(-1).close(1006); fireTimeout(delay); }
  Socket.all.at(-1).close(1006);
  assert.equal(source.getState().phase, 'error'); assert.equal(source.getState().retryCount, 6);
  source.close();
  assert.equal(timers.size, 0, 'closing must clean all timers');
  const subscriber = new TwinPointStream('ws://local/api/v1/twin-drive?projectId=project', 'project', () => reloads++);
  subscriber.setConfiguration(8, [point]); subscriber.connect();
  socket = Socket.all.at(-1); socket.open();
  socket.message({ type: 'hello', protocolVersion: 1 });
  assert.deepEqual(socket.sent, [{ type: 'subscribe', expectedRevision: 8, topics: [point.topic] }]);
  socket.message({ type: 'subscribed', revision: 8, topics: [point.topic] });
  const topicSnapshot = (topic = point.topic, sequence = 100) => snapshot({ revision: 8, sequence, status: 'running', points: { axis: { value: 25, target: 40, timestamp: stamp, quality: 'good', topic } } });
  socket.message(topicSnapshot());
  assert.equal(subscriber.getState().connected, true);
  [...timers.values()].filter((timer) => timer.interval && timer.ms === 10000).forEach((timer) => timer.fn());
  assert.deepEqual(socket.sent.map((message) => message.type), ['subscribe', 'ping'], 'preview only subscribes and heartbeats, never starts/resets/commands');
  socket.message(topicSnapshot('unconfigured/axis', 101));
  assert.equal(subscriber.getState().connected, false); assert.match(subscriber.getState().error, /topic/);
  subscriber.close(); subscriber.connect(); socket = Socket.all.at(-1); socket.open();
  socket.message(topicSnapshot());
  assert.equal(subscriber.getState().connected, false); assert.match(subscriber.getState().error, /订阅确认前/);
  subscriber.close(); subscriber.connect(); socket = Socket.all.at(-1); socket.open(); socket.message({ type: 'hello' });
  socket.message({ type: 'subscribed', revision: 8, topics: ['wrong'] });
  assert.match(subscriber.getState().error, /订阅不一致/);
  subscriber.close(); subscriber.connect(); socket = Socket.all.at(-1); socket.open(); socket.message({ type: 'hello' });
  fireTimeout(10000); assert.match(subscriber.getState().error, /订阅在 10 秒内未确认/);
  subscriber.close(); assert.equal(timers.size, 0);
  assert.deepEqual(parseTwinDriveConfig({ ...emptyTwinDriveConfig(), points: [point] }).points[0].topic, point.topic);
  assert.throws(() => parseTwinDriveConfig({ ...emptyTwinDriveConfig(), points: [{ ...point, topic: 'bad/*' }] }), /topic|Topic/);
  assert.throws(() => parseTwinDriveConfig({ ...emptyTwinDriveConfig(), simulation: { enabled: true, procedureId: '', repeat: true } }));
  console.log('Topic subscriptions: exact ACK, sample topic rejection, no pre-ACK feedback, subscription timeout, preview subscribe/ping only and cleanup passed.');
  console.log('Twin point stream: snapshot validation, revision fencing, ACK/errors, timeout, bounded retry state, no replay and sequence rollback passed.');
} finally { Object.assign(globalThis, originals); }
