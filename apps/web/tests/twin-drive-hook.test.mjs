import assert from 'node:assert/strict';
import { hookLifecycle } from './helpers/hook-lifecycle.mjs';
import { useTwinDrive } from '../src/twin/useTwinDrive.ts';
import { emptyTwinDriveConfig } from '../../../shared/twin-drive.ts';

const originals = { window: globalThis.window, fetch, WebSocket: globalThis.WebSocket, setTimeout, clearTimeout, setInterval, clearInterval };
const timers = new Map(); let nextTimer = 0; let requestCount = 0;
class Socket {
  static OPEN = 1;
  static all = [];
  readyState = 0;
  sent = [];
  constructor(url) { this.url = url; Socket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
  send(value) { this.sent.push(JSON.parse(value)); }
}
const document = { projectId: 'scene', revision: 2, editable: true, config: emptyTwinDriveConfig() };
const snapshot = (sequence, revision = 2, status = 'idle') => ({ type: 'snapshot', projectId: 'scene', revision, sequence, timestamp: new Date().toISOString(), source: 'simulator', status, points: {}, procedure: null });
globalThis.window = { location: { href: 'http://local/' } };
globalThis.fetch = async () => { requestCount++; return new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } }); };
globalThis.WebSocket = Socket;
globalThis.setTimeout = (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; };
globalThis.setInterval = (fn, ms) => { timers.set(++nextTimer, { fn, ms, interval: true }); return nextTimer; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => timers.delete(id);
const lifecycle = hookLifecycle(() => useTwinDrive('scene'));
try {
  lifecycle.flush();
  for (let count = 0; count < 12; count++) await Promise.resolve();
  let twin = lifecycle.flush();
  assert.equal(twin.loading, false);
  assert.equal(twin.document.config.enabled, false);
  assert.equal(Socket.all.length, 0, 'disabled config never opens a socket');
  twin.acceptDocument({ ...document, config: { ...document.config, enabled: true } });
  twin = lifecycle.flush();
  const originalSource = twin.source;
  let socket = Socket.all.at(-1); socket.open(); socket.message(snapshot(90));
  socket.close(1006);
  const retry = [...timers].find(([, timer]) => !timer.interval && timer.ms === 1000);
  timers.delete(retry[0]); retry[1].fn();
  assert.equal(lifecycle.flush().source, originalSource, 'automatic reconnect must preserve runtime sequence fence');
  socket = Socket.all.at(-1); socket.open(); socket.message(snapshot(1));
  assert.equal(originalSource.getState().phase, 'error');
  twin.reconnect();
  twin = lifecycle.flush();
  assert.notEqual(twin.source, originalSource, 'explicit reconnect must recreate the runtime attachment source');
  assert.equal(originalSource.getState().connected, false);
  socket = Socket.all.at(-1); socket.open(); socket.message(snapshot(1));
  assert.equal(twin.source.getState().connected, true);
  assert.equal(twin.source.getState().snapshot.sequence, 1);
  assert.equal(requestCount, 1, 'manual reconnect does not silently reload or change configured document');
  const beforeSave = twin.source;
  socket.message(snapshot(90, 2, 'running'));
  twin.acceptDocument({ ...twin.document, revision: 3 });
  twin = lifecycle.flush();
  assert.notEqual(twin.source, beforeSave, 'saving identical JSON with a new revision must rebuild runtime sequence state');
  assert.equal(socket.readyState, 3, 'old revision socket closes before new observations are accepted');
  socket = Socket.all.at(-1); socket.open(); socket.message(snapshot(0, 3));
  assert.equal(twin.source.getState().snapshot.status, 'idle', 'new revision waits for explicit initialization');
  socket.message(snapshot(1, 3, 'running'));
  assert.equal(twin.source.getState().snapshot.sequence, 1);
  assert.equal(twin.source.getState().connected, true);
  const socketCount = Socket.all.length;
  twin.acceptDocument({ ...twin.document, revision: 4, config: { ...twin.document.config, enabled: false } });
  twin = lifecycle.flush();
  assert.equal(Socket.all.length, socketCount, 'disabling drive never opens another socket');
  assert.equal(socket.readyState, 3, 'disabling drive closes its active socket');
  assert.equal(twin.source.getState().snapshot, null);
  assert.equal(twin.source.getState().connected, false);
  lifecycle.unmount();
  assert.equal(socket.readyState, 3);
  assert.equal(timers.size, 0, 'unmount closes socket and clears every retry/UI/heartbeat timer');
  let live = false;
  const editor = hookLifecycle(() => useTwinDrive('scene', { live }));
  try {
    editor.flush(); for (let count = 0; count < 12; count++) await Promise.resolve();
    let editing = editor.flush();
    const points = [{ id: 'axis', topic: 'factory/axis' }];
    const beforeEditor = Socket.all.length;
    editing.acceptDocument({ ...document, config: { ...document.config, enabled: true, points } });
    editing = editor.flush();
    assert.equal(Socket.all.length, beforeEditor, 'editor configuration does not subscribe before connection test');
    assert.equal(timers.size, 0, 'inactive editor has no point polling or heartbeat timers');
    live = true; editing.acceptDocument({ ...editing.document }); editing = editor.flush();
    socket = Socket.all.at(-1); socket.open(); socket.message({ type: 'hello' });
    assert.deepEqual(socket.sent, [{ type: 'subscribe', expectedRevision: 2, topics: ['factory/axis'] }]);
    socket.message({ type: 'subscribed', revision: 2, topics: ['factory/axis'] });
    socket.message(snapshot(100, 2, 'running'));
    assert.equal(editing.source.getState().connected, true);
    editing.acceptDocument({ ...editing.document, revision: 3, config: { ...editing.document.config, points: [{ id: 'axis', topic: 'factory/renamed-axis' }] } });
    editing = editor.flush(); assert.equal(socket.readyState, 3);
    socket = Socket.all.at(-1); socket.open(); socket.message({ type: 'hello' });
    assert.deepEqual(socket.sent, [{ type: 'subscribe', expectedRevision: 3, topics: ['factory/renamed-axis'] }], 'saved revision renews exact topic subscription');
    live = false; editing.acceptDocument({ ...editing.document }); editing = editor.flush();
    assert.equal(socket.readyState, 3, 'leaving connection test closes the subscription');
    assert.equal(timers.size, 0, 'leaving test cleans UI and subscription timers');
    console.log('Editor connection test: inactive until requested, exact topic subscription, revision resubscribe and closing cleanup passed.');
  } finally { editor.unmount(); }
  console.log('Twin drive hook: disabled config, automatic rollback protection, explicit/revision source renewal, disable transition and cleanup passed.');
} finally { lifecycle.unmount(); Object.assign(globalThis, originals); }
