/** Read-only local acceptance test for the saved, autonomous Kaide simulator.
 * Preview: node scripts/smoke-kaide-topic-stream.mjs
 * Execute: node scripts/smoke-kaide-topic-stream.mjs --run [--origin http://127.0.0.1:5174]
 * Never resets, pauses, moves or saves the case. One resume command must be rejected.
 * The disconnected interval closes this script's clients, not other browser observers.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectId = '31266844-7b5f-43b3-95a3-b15581119ee4';
const observationMs = 12000, disconnectedMs = 2750;
let run = false, origin = 'http://127.0.0.1:5174';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--run') run = true;
  else if (args[i] === '--origin') {
    origin = args[++i];
    assert(origin && !origin.startsWith('--'), '--origin requires a value.');
  } else throw new Error(`Unknown option: ${args[i]}`);
}
const base = new URL(origin);
assert.equal(base.protocol, 'http:', 'Only the local HTTP test environment is allowed.');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Credentials may only be sent to loopback.');
assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Expected a plain local origin.');
origin = base.origin;
const stages = ['saved-topics-and-model-bindings', 'explicit-topic-subscription', 'autonomous-feedback-without-commands', 'observer-consistency', 'unknown-topic-rejected', 'automatic-mode-command-rejected', 'disconnect-test-clients-and-reconnect'];
if (!run) {
  console.log(JSON.stringify({ run: false, origin, projectId, observationMs, disconnectedMs, stages,
    note: 'No requests were made. --run observes the saved local automatic simulator, without modifying configuration or point feedback. A resume command is sent only to verify mandatory automatic-mode rejection. Other browser observers are not closed.' }, null, 2));
  process.exit(0);
}

// Reuse the installed workspace WebSocket package; do not add a production dependency.
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const wranglerRequire = createRequire(apiRequire.resolve('wrangler'));
const miniflareRequire = createRequire(wranglerRequire.resolve('miniflare'));
const WebSocket = miniflareRequire('ws');
const credentials = JSON.parse(readFileSync(resolve(root, 'deploy/local/.local/admin.json'), 'utf8'));
assert(typeof credentials.identifier === 'string' && typeof credentials.password === 'string', 'Local admin credentials are missing.');
let cookie;
async function request(path, body) {
  const response = await fetch(new URL(`/api/v1${path}`, base), {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `${path}: HTTP ${response.status}, requestId=${response.headers.get('x-request-id') ?? 'unavailable'}`);
  if (path === '/auth/login') {
    cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert(cookie, 'Login returned no session cookie.');
  }
  return response.json();
}
await request('/auth/login', { identifier: credentials.identifier, password: credentials.password });
const document = await request(`/projects/${projectId}/twin-drive`);
const config = document.config;
assert.equal(document.projectId, projectId);
assert(Number.isSafeInteger(document.revision) && document.revision > 0, 'Save the case configuration before testing.');
assert(config?.enabled && config.source === 'simulator' && config.simulation?.enabled && config.simulation.repeat, 'The saved case must explicitly enable a repeating background simulator.');
assert.equal(config.points.length, 16, 'Unexpected Kaide point count.');
assert.equal(config.bindings.length, 18, 'Unexpected Kaide binding count.');
const topics = config.points.map(point => point.topic);
assert(topics.every(topic => typeof topic === 'string' && topic.length > 0), 'Every case point must have an explicit topic.');
assert.equal(new Set(topics).size, topics.length, 'Case topics must be unique.');
const pointIds = new Set(config.points.map(point => point.id));
assert.equal(pointIds.size, config.points.length, 'Case point IDs must be unique.');
const manifest = JSON.parse(readFileSync(resolve(root, 'deploy/local/.local/cases/kaide/manifest.json'), 'utf8'));
assert.equal(manifest.projectId, projectId, 'The local import manifest belongs to another project.');
const boundNodes = new Set();
for (const binding of config.bindings) {
  assert(pointIds.has(binding.pointId), `${binding.id}: unconfigured point.`);
  assert.equal(binding.target.instanceId, manifest.instanceId, `${binding.id}: wrong case instance.`);
  assert.equal(binding.target.modelAssetId, manifest.displayId, `${binding.id}: wrong case model.`);
  assert(typeof binding.target.nodeName === 'string' && binding.target.nodeName.length > 0, `${binding.id}: missing stable node name.`);
  assert(!boundNodes.has(binding.target.nodeName), `${binding.id}: duplicate driven model node.`);
  boundNodes.add(binding.target.nodeName);
}
assert(config.points.every(point => config.bindings.some(binding => binding.pointId === point.id)), 'Each case point must drive a configured model binding.');
const procedure = config.procedures.find(item => item.id === config.simulation.procedureId);
assert(procedure?.steps.length > 1, 'The automatic simulator must select a saved multi-step feedback procedure.');
const url = new URL('/api/v1/twin-drive', base);
url.protocol = 'ws:';
url.searchParams.set('projectId', projectId);

function validateSnapshot(snapshot, name, previous) {
  assert.equal(snapshot.projectId, projectId, `${name}: wrong project.`);
  assert.equal(snapshot.revision, document.revision, `${name}: configuration changed during the test.`);
  assert.equal(snapshot.source, 'simulator', `${name}: simulation provenance is missing.`);
  assert(Number.isSafeInteger(snapshot.sequence) && snapshot.sequence > 0 && (!previous || snapshot.sequence >= previous.sequence), `${name}: invalid or regressed sequence.`);
  assert.equal(snapshot.status, 'running', `${name}: background source is not running (${snapshot.status}).`);
  assert.equal(snapshot.procedure?.id, procedure.id, `${name}: unexpected automatic procedure.`);
  assert(['running', 'completed'].includes(snapshot.procedure.status), `${name}: automatic procedure failed: ${snapshot.procedure.message}`);
  assert(Number.isInteger(snapshot.procedure.stepIndex) && snapshot.procedure.stepIndex >= 0 && snapshot.procedure.stepIndex < procedure.steps.length, `${name}: invalid procedure step.`);
  assert.deepEqual(Object.keys(snapshot.points).sort(), [...pointIds].sort(), `${name}: the subscribed point set is incomplete.`);
  for (const point of config.points) {
    const sample = snapshot.points[point.id];
    assert.equal(sample.topic, point.topic, `${name}/${point.id}: topic does not match saved binding.`);
    assert.equal(sample.quality, 'good', `${name}/${point.id}: bad sample quality.`);
    for (const key of ['value', 'target']) assert(Number.isFinite(sample[key]) && sample[key] >= point.min && sample[key] <= point.max, `${name}/${point.id}: ${key} is outside its configured range.`);
    const timestamp = Date.parse(sample.timestamp), age = Date.now() - timestamp;
    assert(Number.isFinite(timestamp) && age >= -1000 && age <= point.staleAfterMs, `${name}/${point.id}: stale or invalid sample timestamp (${age} ms).`);
  }
  if (previous?.sequence === snapshot.sequence) assert.deepEqual(snapshot, previous, `${name}: one sequence has multiple snapshots.`);
}

function connect(name) {
  const events = new EventEmitter(), queue = [], snapshots = new Map();
  const socket = new WebSocket(url, { headers: { Origin: origin, Cookie: cookie }, handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024 });
  let failure, closed = false, subscribed = false, latest = null;
  socket.on('message', bytes => {
    try {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'subscribed') {
        assert.equal(message.revision, document.revision, `${name}: wrong subscription revision.`);
        assert.deepEqual([...message.topics].sort(), [...topics].sort(), `${name}: wrong acknowledged topics.`);
        subscribed = true;
      }
      if (message.type === 'snapshot') {
        assert(subscribed, `${name}: a snapshot arrived before the topic subscription was acknowledged.`);
        validateSnapshot(message, name, latest);
        latest = message; snapshots.set(message.sequence, message);
        if (snapshots.size > 1000) snapshots.delete(snapshots.keys().next().value);
      }
      if (message.type === 'config_changed') throw new Error(`${name}: saved configuration changed during observation.`);
      queue.push(message);
      assert(queue.length <= 2000, `${name}: unexpected message backlog.`);
    } catch (error) { failure = error; }
    events.emit('change');
  });
  socket.on('error', error => { failure = new Error(`${name}: ${error.message}`); events.emit('change'); });
  socket.on('close', () => { closed = true; events.emit('change'); });
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
  }, 10000);
  function wait(predicate, timeout = 10000) {
    return new Promise((resolveWait, reject) => {
      const timer = setTimeout(() => finish(new Error(`${name}: expected WebSocket message did not arrive in ${timeout} ms.`)), timeout);
      function finish(error, message) { clearTimeout(timer); events.off('change', check); error ? reject(error) : resolveWait(message); }
      function check() {
        if (failure) return finish(failure);
        const index = queue.findIndex(predicate);
        if (index >= 0) return finish(null, queue.splice(index, 1)[0]);
        const rejected = queue.find(message => message.type === 'error');
        if (rejected) return finish(new Error(`${name}: ${rejected.error}: ${rejected.message}`));
        if (closed) finish(new Error(`${name}: WebSocket closed.`));
      }
      events.on('change', check); check();
    });
  }
  return {
    name, snapshots, wait, latest: () => latest,
    healthy: () => { if (failure) throw failure; },
    send: message => { assert.equal(socket.readyState, WebSocket.OPEN, `${name}: socket is not open.`); socket.send(JSON.stringify(message)); },
    close: async () => {
      clearInterval(heartbeat);
      if (closed) return;
      await new Promise(resolveClose => {
        const timer = setTimeout(() => socket.terminate(), 1000);
        socket.once('close', () => { clearTimeout(timer); resolveClose(); });
        socket.close(1000, 'Local read-only acceptance complete');
      });
    },
  };
}
const clients = [], passed = [];
const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
const newClient = name => { const client = connect(name); clients.push(client); return client; };
async function subscribe(client) {
  await client.wait(message => message.type === 'hello');
  client.send({ type: 'subscribe', expectedRevision: document.revision, topics });
  await client.wait(message => message.type === 'subscribed');
  return client.wait(message => message.type === 'snapshot');
}
const motionSignature = snapshot => JSON.stringify({ values: config.points.map(point => snapshot.points[point.id].value), step: snapshot.procedure.stepIndex });
let evidence;
try {
  pass('saved-topics-and-model-bindings');
  const first = newClient('observer-a'), second = newClient('observer-b');
  const [start] = await Promise.all([subscribe(first), subscribe(second)]);
  pass('explicit-topic-subscription');
  const observationStarted = Date.now(), changed = new Set(), steps = new Set([start.procedure.stepIndex]);
  let latest = start;
  while (Date.now() - observationStarted < observationMs) {
    latest = await first.wait(message => message.type === 'snapshot' && message.sequence > latest.sequence, 5000);
    for (const point of config.points) if (latest.points[point.id].value !== start.points[point.id].value) changed.add(point.id);
    steps.add(latest.procedure.stepIndex);
    second.healthy();
  }
  const observedMs = Date.now() - observationStarted;
  assert(latest.sequence - start.sequence >= 20, 'Insufficient fresh snapshots for autonomous observation.');
  assert(changed.size > 0, 'No point moved while observing without any commands.');
  assert(steps.size > 1, 'The configured feedback procedure did not advance during observation.');
  pass(`autonomous-feedback-without-commands:${observedMs}ms:${changed.size}-moving-points`);
  let comparisons = 0;
  for (const [sequence, snapshot] of first.snapshots) if (second.snapshots.has(sequence)) {
    assert.deepEqual(second.snapshots.get(sequence), snapshot, `Observers received different data for sequence ${sequence}.`);
    comparisons++;
  }
  assert(comparisons >= 5, `Insufficient common observer sequences: ${comparisons}.`);
  pass(`observer-consistency:${comparisons}-shared-snapshots`);

  const invalid = newClient('invalid-topic');
  await invalid.wait(message => message.type === 'hello');
  const unknownTopic = `smoke/unknown/${randomUUID()}`;
  invalid.send({ type: 'subscribe', expectedRevision: document.revision, topics: [...topics.slice(1), unknownTopic] });
  const subscriptionError = await invalid.wait(message => ['error', 'subscribed', 'snapshot'].includes(message.type));
  assert.equal(subscriptionError.type, 'error', 'An unknown topic was accepted.');
  assert.equal(subscriptionError.error, 'twin_topic_subscription_invalid');
  assert.equal(invalid.latest(), null, 'Unsubscribed client received point data.');
  await invalid.close();
  pass('unknown-topic-rejected');

  // Resume is deliberately chosen to minimize disturbance if the automatic-mode guard regresses.
  // An unexpected ACK is a failure; do not send a compensating reset/pause or conceal the bug.
  const commandId = randomUUID();
  first.send({ type: 'command', commandId, expectedRevision: document.revision, operation: 'resume' });
  const rejection = await first.wait(message => message.commandId === commandId && ['error', 'command_ack'].includes(message.type));
  assert.equal(rejection.type, 'error', 'Automatic source accepted a manual command. Test stopped; no compensating command was sent.');
  assert.equal(rejection.error, 'twin_automatic_mode');
  pass('automatic-mode-command-rejected');

  const beforeDisconnect = first.latest();
  await Promise.all(clients.map(client => client.close()));
  const disconnectedAt = Date.now();
  await delay(disconnectedMs);
  const reconnected = newClient('reconnected-observer');
  const afterReconnect = await subscribe(reconnected);
  assert(afterReconnect.sequence - beforeDisconnect.sequence >= 5, 'Sequence did not continue advancing during the test-client disconnection.');
  assert.notEqual(motionSignature(afterReconnect), motionSignature(beforeDisconnect), 'Values and procedure step did not progress across the test-client disconnection.');
  pass(`disconnect-test-clients-and-reconnect:${Date.now() - disconnectedAt}ms`);
  evidence = { observedMs, changedPointIds: [...changed], observedStepCount: steps.size, commonSequences: comparisons,
    beforeDisconnectSequence: beforeDisconnect.sequence, afterReconnectSequence: afterReconnect.sequence };
  const finalDocument = await request(`/projects/${projectId}/twin-drive`);
  assert.equal(finalDocument.revision, document.revision, 'Configuration revision changed during the smoke test.');
  assert.deepEqual(finalDocument.config, config, 'Configuration changed during the smoke test.');
  clients.forEach(client => client.healthy());
} finally {
  await Promise.all(clients.map(client => client.close()));
}
console.log(JSON.stringify({ passed: true, projectId, revision: document.revision, checks: passed, evidence,
  finalState: 'Saved automatic source remains running; no configuration or point-feedback writes were accepted.',
  scope: 'Actual local HTTP/WebSocket observations. The test closes only its own clients; zero-browser-observer scheduling and model rendering require separate acceptance.' }, null, 2));
