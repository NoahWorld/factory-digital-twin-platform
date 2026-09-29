// Run only for the private scene-extension acceptance fixture.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = process.env.SCENE_TEST_DIR;
assert.equal(dir, '/Users/inosaki/Documents/Codex/local/state/factory-scene-extensions-20260927');
const statePath = join(dir, 'source-state.json');
const pidPath = join(dir, 'source.pid');
const server = createServer((request, response) => {
  if (request.url !== '/rooms' || request.method !== 'GET') {
    response.writeHead(404); response.end(); return;
  }
  let state;
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); }
  catch { response.writeHead(503); response.end('fixture state unavailable'); return; }
  if (state.failure) { response.writeHead(503); response.end('simulated outage'); return; }
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ timestamp: state.oldTimestamp ? '2000-01-01T00:00:00Z' : new Date().toISOString(), rooms: { a: { fire: !!state.fire }, b: { fire: !!state.slowFire } }, simulated: true }));
});
server.listen(8791, '127.0.0.1', () => {
  writeFileSync(pidPath, String(process.pid) + '\n', { mode: 0o600 });
  console.log('Scene fixture source listening at http://127.0.0.1:8791/rooms (simulated data).');
});
