/** Explicit local-only simulator acceptance test. This changes temporary point feedback.
 * Preview: node scripts/smoke-kaide-twin-websocket.mjs
 * Execute: node scripts/smoke-kaide-twin-websocket.mjs --run [--origin http://127.0.0.1:5174]
 * Requires the case seed already applied. Finally resets points and pauses the simulator.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let run = false, origin = 'http://127.0.0.1:5174';
for (let i = 0; i < process.argv.slice(2).length; i++) {
  const argument = process.argv.slice(2)[i];
  if (argument === '--run') run = true;
  else if (argument === '--origin') {
    origin = process.argv.slice(2)[++i];
    assert(origin && !origin.startsWith('--'), '--origin requires a value.');
  } else throw new Error(`Unknown option: ${argument}`);
}
const base = new URL(origin);
assert.equal(base.protocol, 'http:', 'Only the local HTTP test environment is allowed.');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Credentials may only be sent to loopback.');
assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Expected a plain local origin.');
origin = base.origin;
const stages = ['reset', 'feedback-move', 'pause-freezes-values', 'resume-to-target', 'command-deduplication', 'invalid-range-rejected', 'revision-conflict-rejected', 'observer-consistency', 'feedback-procedures-complete', 'reset-and-pause'];
if (!run) {
  console.log(JSON.stringify({ run: false, origin, stages, note: 'No requests were made. --run changes the existing local case simulator, not scene configuration, credentials, model or production equipment.' }, null, 2));
  process.exit(0);
}

// Use the installed workspace toolchain rather than adding a browser or production dependency.
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const wranglerRequire = createRequire(apiRequire.resolve('wrangler'));
const miniflareRequire = createRequire(wranglerRequire.resolve('miniflare'));
const WebSocket = miniflareRequire('ws');
const directory = resolve(root, 'deploy/local/.local/cases/kaide');
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const expectedConfig = JSON.parse(readFileSync(resolve(directory, 'twin-drive-config.json'), 'utf8'));
const credentials = JSON.parse(readFileSync(resolve(root, 'deploy/local/.local/admin.json'), 'utf8'));
assert(typeof credentials.identifier === 'string' && typeof credentials.password === 'string', 'Local admin credentials are missing.');
let cookie;
async function request(path, body) {
  const response = await fetch(new URL(`/api/v1${path}`, base), { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert(response.ok, `${path}: HTTP ${response.status}, requestId=${response.headers.get('x-request-id') ?? 'unavailable'}`);
  if (path === '/auth/login') { cookie = response.headers.get('set-cookie')?.split(';')[0]; assert(cookie, 'Login returned no session cookie.'); }
  return response.json();
}
await request('/auth/login', { identifier: credentials.identifier, password: credentials.password });
const document = await request(`/projects/${encodeURIComponent(manifest.projectId)}/twin-drive`);
assert(document.editable && document.config.enabled && document.revision > 0, 'Apply the editable case seed before this smoke test.');
assert(isDeepStrictEqual(document.config, expectedConfig), 'Saved configuration differs from the calibrated local seed. Refusing to change point feedback.');
const config = document.config;
assert(!config.simulation?.enabled && config.points.every(point => point.topic === undefined), 'This legacy manual-command smoke requires a manual/no-topic configuration. Use smoke-kaide-topic-stream.mjs for the autonomous source.');
assert.equal(config.points.length, 16);
assert.equal(config.bindings.length, 18);
const opening = config.points.find(point => point.id === 'gripper-opening');
assert(opening, 'Missing expected gripper point.');
const url = new URL('/api/v1/twin-drive', base);
url.protocol = 'ws:';
url.searchParams.set('projectId', manifest.projectId);

function connect(name) {
  const events = new EventEmitter(), queue = [], snapshots = new Map();
  const socket = new WebSocket(url, { headers: { Origin: origin, Cookie: cookie }, handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024 });
  let failure, closed = false, latest = null;
  socket.on('message', bytes => {
    try {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'snapshot') {
        assert.equal(message.projectId, manifest.projectId);
        assert.equal(message.revision, document.revision);
        assert(Number.isSafeInteger(message.sequence) && (!latest || message.sequence >= latest.sequence), `${name}: sequence regressed.`);
        latest = message; snapshots.set(message.sequence, message);
        if (snapshots.size > 1000) snapshots.delete(snapshots.keys().next().value);
      }
      queue.push(message);
      assert(queue.length <= 2000, `${name}: unexpected message backlog.`);
    } catch (error) { failure = error; }
    events.emit('change');
  });
  socket.on('error', error => { failure = new Error(`${name}: ${error.message}`); events.emit('change'); });
  socket.on('close', () => { closed = true; events.emit('change'); });
  const heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })); }, 10000);
  function wait(predicate, timeout = 10000) {
    return new Promise((resolveWait, reject) => {
      const timer = setTimeout(() => finish(new Error(`${name}: expected WebSocket message did not arrive in ${timeout} ms.`)), timeout);
      function finish(error, message) { clearTimeout(timer); events.off('change', check); error ? reject(error) : resolveWait(message); }
      function check() {
        if (failure) return finish(failure);
        const index = queue.findIndex(predicate);
        if (index >= 0) return finish(null, queue.splice(index, 1)[0]);
        if (closed) finish(new Error(`${name}: WebSocket closed.`));
      }
      events.on('change', check); check();
    });
  }
  return { name, snapshots, wait, latest: () => latest,
    send: message => { assert.equal(socket.readyState, WebSocket.OPEN, `${name}: socket is not open.`); socket.send(JSON.stringify(message)); },
    close: () => { clearInterval(heartbeat); socket.terminate(); },
  };
}

const clients = [], passed = [];
let controller, mainError, cleanupError, touched = false;
const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
const command = (operation, extra = {}) => ({ type: 'command', commandId: randomUUID(), expectedRevision: document.revision, operation, ...extra });
async function send(message, expectedError) {
  controller.send(message);
  const answer = await controller.wait(item => item.commandId === message.commandId && ['command_ack', 'error'].includes(item.type));
  if (expectedError) { assert.equal(answer.type, 'error'); assert.equal(answer.error, expectedError); }
  else assert.equal(answer.type, 'command_ack', `${message.operation}: ${answer.error ?? answer.type} ${answer.message ?? ''}`);
  return answer;
}
const snapshotAfter = (sequence, predicate, timeout) => controller.wait(message => message.type === 'snapshot' && message.sequence >= sequence && predicate(message), timeout);
const atInitial = snapshot => config.points.every(point => snapshot.points[point.id]?.value === point.initialValue && snapshot.points[point.id]?.target === point.initialValue);
try {
  controller = connect('controller'); clients.push(controller);
  const observer = connect('observer'); clients.push(observer);
  await Promise.all(clients.map(client => client.wait(message => message.type === 'hello')));
  await Promise.all(clients.map(client => client.wait(message => message.type === 'snapshot')));

  touched = true;
  let ack = await send(command('reset'));
  await snapshotAfter(ack.sequence, snapshot => snapshot.status === 'running' && atInitial(snapshot));
  pass('reset');
  ack = await send(command('move', { values: [{ pointId: opening.id, value: opening.min }] }));
  const moving = await snapshotAfter(ack.sequence, snapshot => snapshot.points[opening.id].value < opening.initialValue && snapshot.points[opening.id].value > opening.min);
  assert.equal(moving.points[opening.id].target, opening.min);
  pass('feedback-move');
  ack = await send(command('pause'));
  const paused = await snapshotAfter(ack.sequence, snapshot => snapshot.status === 'paused');
  const later = await snapshotAfter(paused.sequence + 3, snapshot => snapshot.status === 'paused');
  for (const point of config.points) assert.equal(later.points[point.id].value, paused.points[point.id].value, `Paused point moved: ${point.id}`);
  pass('pause-freezes-values');
  ack = await send(command('resume'));
  await snapshotAfter(ack.sequence, snapshot => snapshot.points[opening.id].value === opening.min);
  pass('resume-to-target');

  const duplicate = command('set', { values: [{ pointId: opening.id, value: opening.initialValue }] });
  const first = await send(duplicate), second = await send(duplicate);
  assert.deepEqual(second, first, 'Identical command ID must return the original ACK.');
  await send({ ...duplicate, values: [{ pointId: opening.id, value: opening.min }] }, 'twin_command_id_conflict');
  pass('command-deduplication');
  await send(command('set', { values: [{ pointId: opening.id, value: opening.max + 1 }] }), 'invalid_input');
  pass('invalid-range-rejected');
  await send(command('pause', { expectedRevision: document.revision + 1 }), 'twin_revision_conflict');
  pass('revision-conflict-rejected');

  for (const procedure of config.procedures) {
    ack = await send(command('reset'));
    await snapshotAfter(ack.sequence, snapshot => atInitial(snapshot));
    ack = await send(command('run-procedure', { procedureId: procedure.id }));
    const complete = await snapshotAfter(ack.sequence, snapshot => snapshot.procedure?.id === procedure.id && ['completed', 'error'].includes(snapshot.procedure.status), 45000);
    assert.equal(complete.procedure.status, 'completed', `${procedure.id}: ${complete.procedure.message}`);
    const last = procedure.steps.at(-1);
    for (const target of last.targets) assert(Math.abs(complete.points[target.pointId].value - target.value) <= last.tolerance, `${procedure.id} completed before feedback arrived.`);
    pass(`feedback-procedure:${procedure.id}`);
  }
  let comparisons = 0;
  for (const [sequence, snapshot] of controller.snapshots) if (observer.snapshots.has(sequence)) {
    assert.deepEqual(observer.snapshots.get(sequence), snapshot, `Observers received different values for sequence ${sequence}.`);
    comparisons++;
  }
  assert(comparisons >= 5, `Insufficient shared observer sequences: ${comparisons}`);
  pass(`observer-consistency:${comparisons}-shared-snapshots`);
} catch (error) { mainError = error; }
finally {
  if (touched && controller) {
    try {
      const reset = await send(command('reset'));
      await snapshotAfter(reset.sequence, snapshot => atInitial(snapshot));
      const pause = await send(command('pause'));
      await snapshotAfter(pause.sequence, snapshot => snapshot.status === 'paused' && atInitial(snapshot));
      pass('reset-and-pause');
    } catch (error) { cleanupError = error; console.error(`CLEANUP FAILED: ${error.message}. The local simulator final state is not confirmed.`); }
  }
  clients.forEach(client => client.close());
}
if (mainError && cleanupError) throw new AggregateError([mainError, cleanupError], 'Smoke validation and final simulator reset/pause failed.');
if (mainError) throw mainError;
if (cleanupError) throw cleanupError;
console.log(JSON.stringify({ passed: true, projectId: manifest.projectId, revision: document.revision, checks: passed, finalState: 'initial point values, paused', scope: 'Actual local HTTP/WebSocket protocol only; no browser rendering, GPU or hardware safety claim.' }, null, 2));
