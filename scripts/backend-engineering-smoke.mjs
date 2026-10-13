// Real IFC/DXF -> PostgreSQL/S3 -> worker -> GLB verification in disposable containers.
// Requires preloaded images; the private Docker network has no external connectivity.
// Never reads local credentials or attaches to the existing development/production stack.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const backend = resolve(process.env.TWIN_BACKEND_DIR || fileURLToPath(new URL('../../factory-digital-twin-backend', import.meta.url)));
const fixture = join(backend, 'engineering', 'fixtures');
const image = process.env.ENGINEERING_TEST_IMAGE || 'factory-twin-backend:engineering-test';
const prefix = 'twin-engineering-test-' + randomBytes(5).toString('hex');
const secret = () => randomBytes(24).toString('hex');
const secrets = { DATABASE_PASSWORD: secret(), VALKEY_PASSWORD: secret(), S3_ACCESS_KEY: secret(), S3_SECRET_KEY: secret(), BOOTSTRAP_TOKEN: secret() };
const parent = process.env.ENGINEERING_TEST_OUTPUT_DIR ? resolve(process.env.ENGINEERING_TEST_OUTPUT_DIR) : tmpdir();
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'engineering-smoke-'));
const containers = [];
const checks = [];
let networkCreated = false, base, requestContainer, cookie = '';
async function dockerResult(...args) {
  try { return await exec('docker', args, { maxBuffer: 4 * 1024 * 1024, timeout: 120000 }); }
  catch (error) {
    // Docker command arguments contain disposable credentials; keep diagnostics but redact them.
    const redact = value => Object.values(secrets).reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value || ''));
    const failure = new Error(redact(error.message) + '\n' + redact(error.stderr));
    failure.code = error.code;
    throw failure;
  }
}
const docker = async (...args) => (await dockerResult(...args)).stdout.trim();
const delay = ms => new Promise(done => setTimeout(done, ms));
const mark = name => { checks.push(name); console.log('PASS ' + name); };
// Internal Docker networks deliberately expose no host ports on some engines.
// Run the HTTP client inside the API container too, so the whole flow stays offline.
async function offlineFetch(url, init = {}) {
  const encoded = new Request(url, { method: init.method || 'GET', headers: init.headers, body: init.body });
  const payload = { url, method: encoded.method, headers: Object.fromEntries(encoded.headers),
    body: encoded.body ? Buffer.from(await encoded.arrayBuffer()).toString('base64') : null,
    redirect: init.redirect || 'follow', timeoutMs: init.timeoutMs || 30000 };
  const program = `let raw = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => raw += s); process.stdin.on('end', async () => {
    const p = JSON.parse(raw);
    try { const r = await fetch(p.url, { method: p.method, headers: p.headers, body: p.body === null ? undefined : Buffer.from(p.body, 'base64'), redirect: p.redirect, signal: AbortSignal.timeout(p.timeoutMs) });
      process.stdout.write(JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()).toString('base64') }));
    } catch (error) { process.stdout.write(JSON.stringify({ networkError: error.message })); }
  });`;
  const pending = exec('docker', ['exec', '-i', requestContainer, 'node', '-e', program], { maxBuffer: 40 * 1024 * 1024, timeout: payload.timeoutMs + 10000 });
  pending.child.stdin.end(JSON.stringify(payload));
  const result = JSON.parse((await pending).stdout);
  if (result.networkError) throw new TypeError(result.networkError);
  return new Response(result.status === 204 ? null : Buffer.from(result.body, 'base64'), { status: result.status, headers: result.headers });
}
async function start(suffix, args) {
  const name = prefix + '-' + suffix;
  await docker('run', '-d', '--pull', 'never', '--name', name, '--network', prefix, '--network-alias', suffix, ...args);
  containers.push(name);
  return name;
}
async function waitFor(label, predicate, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await predicate()) return;
    await delay(500);
  }
  throw new Error('Timed out waiting for ' + label);
}
async function request(path, { method = 'GET', body, status = 200, anonymous = false, headers = {} } = {}) {
  const form = body instanceof FormData;
  const response = await offlineFetch(base + '/api/v1' + path, { method, headers: {
    Origin: base, ...(!anonymous && cookie ? { Cookie: cookie } : {}),
    ...(body && !form ? { 'Content-Type': 'application/json' } : {}), ...headers,
  }, body: body ? (form ? body : JSON.stringify(body)) : undefined, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  assert.equal(response.status, status, method + ' ' + path + ': ' + JSON.stringify(value));
  return { value, response };
}
async function upload(project, filename, name = filename, bytes) {
  const form = new FormData();
  form.append('name', name);
  form.append('file', new Blob([bytes || await readFile(join(fixture, filename))]), filename);
  return (await request(`/projects/${project}/engineering-imports`, { method: 'POST', body: form, status: 202 })).value.import;
}
async function waitJob(project, id, expected) {
  let result, previous;
  await waitFor('engineering job ' + id + ' -> ' + expected, async () => {
    result = (await request(`/projects/${project}/engineering-imports/${id}`)).value.import;
    if (previous !== result.stage) { console.log('STAGE ' + result.format + ': ' + result.stage); previous = result.stage; }
    if (result.status === 'failed' && expected !== 'failed') throw new Error('Conversion failed: ' + JSON.stringify(result.error));
    return result.status === expected;
  });
  return result;
}
try {
  // Confirm fixture files before starting any service.
  const dxfOptions = JSON.parse(await readFile(join(fixture, 'options.json'), 'utf8'));
  await readFile(join(fixture, 'sample.ifc'));
  await readFile(join(fixture, 'engineering-layout.dxf'));
  await docker('image', 'inspect', image);
  await docker('network', 'create', '--internal', prefix);
  networkCreated = true;
  const postgres = await start('postgres', ['--memory', '384m', '-e', 'POSTGRES_DB=factory_twin', '-e', 'POSTGRES_USER=twin', '-e', 'POSTGRES_PASSWORD=' + secrets.DATABASE_PASSWORD, process.env.ENGINEERING_POSTGRES_IMAGE || 'postgres:17-alpine']);
  await start('valkey', ['--memory', '192m', process.env.ENGINEERING_VALKEY_IMAGE || 'valkey/valkey:8.1.3-alpine', 'valkey-server', '--requirepass', secrets.VALKEY_PASSWORD, '--maxmemory', '96mb', '--maxmemory-policy', 'noeviction']);
  await start('storage', ['--memory', '512m', '-e', 'AWS_ACCESS_KEY_ID=' + secrets.S3_ACCESS_KEY, '-e', 'AWS_SECRET_ACCESS_KEY=' + secrets.S3_SECRET_KEY, process.env.ENGINEERING_STORAGE_IMAGE || 'chrislusf/seaweedfs:4.47', 'mini', '-dir=/data', '-ip=storage', '-ip.bind=0.0.0.0', '-bucket=factory-twin']);
  await waitFor('PostgreSQL', async () => { try { await docker('exec', postgres, 'pg_isready', '-U', 'twin', '-d', 'factory_twin'); return true; } catch (error) { if (error.code === 1 || error.code === 2) return false; throw error; } });
  base = 'http://api:8080';
  const env = { ...secrets, DATABASE_URL: 'jdbc:postgresql://postgres:5432/factory_twin', DATABASE_USER: 'twin', VALKEY_HOST: 'valkey', VALKEY_PORT: '6379', S3_ENDPOINT: 'http://storage:8333', S3_PUBLIC_ENDPOINT: 'http://storage:8333', S3_BUCKET: 'factory-twin', DEFAULT_TENANT: 'engineering-test', SECURE_COOKIE: 'false', ALLOWED_ORIGINS: base, JAVA_TOOL_OPTIONS: '-Xmx384m -XX:+ExitOnOutOfMemoryError', DB_POOL_SIZE: '4' };
  // The isolated API explicitly allows its actual request origin.
  const appArgs = ['--read-only', '--tmpfs', '/tmp:size=512m,mode=1777', '--security-opt', 'no-new-privileges:true', ...Object.entries(env).flatMap(([key, value]) => ['-e', key + '=' + value])];
  requestContainer = await start('api', ['--memory', '768m', ...appArgs, '-e', 'TWIN_MODE=api', image]);
  await waitFor('API health', async () => { try { return (await offlineFetch(base + '/health', { timeoutMs: 2000 })).ok; } catch (error) { if (error instanceof TypeError || error.name === 'TimeoutError') return false; throw error; } });
  await request('/engineering-imports/capabilities', { anonymous: true, status: 401 });
  const admin = { identifier: 'admin', email: 'admin@engineering.invalid', displayName: '隔离工程验收', password: secret() };
  const bootstrap = await request('/auth/bootstrap', { method: 'POST', body: admin, status: 201, headers: { 'X-Bootstrap-Token': secrets.BOOTSTRAP_TOKEN } });
  cookie = bootstrap.response.headers.get('set-cookie').split(';')[0];
  const caps = (await request('/engineering-imports/capabilities')).value;
  assert.equal(caps.available, true, JSON.stringify(caps));
  assert.deepEqual(caps.formats, ['ifc', 'dxf']);
  assert.equal(caps.maxSourceBytes, 100 * 1024 * 1024);
  mark('authenticated capability check and bundled native libraries available');
  const project = (await request('/projects', { method: 'POST', body: { name: '工程导入隔离验收', projectType: '3d' }, status: 201 })).value.project.id;
  const other = (await request('/projects', { method: 'POST', body: { name: '工程导入边界验收', projectType: '3d' }, status: 201 })).value.project.id;
  const imports = [];
  for (const name of ['engineering-layout.dxf', 'sample.ifc']) imports.push(await upload(project, name));
  assert.ok(imports.every(job => job.status === 'queued'));
  await request(`/projects/${project}`, { method: 'DELETE', status: 409 });
  await request(`/projects/${other}/engineering-imports/${imports[0].id}`, { status: 404 });
  await request(`/projects/${project}/engineering-imports`, { status: 401, anonymous: true });
  const dwg = new FormData(); dwg.append('name', 'unsupported'); dwg.append('file', new Blob(['drawing']), 'drawing.dwg');
  assert.equal((await request(`/projects/${project}/engineering-imports`, { method: 'POST', body: dwg, status: 415 })).value.error, 'engineering_format_unsupported');
  assert.equal((await request(`/projects/${project}/engineering-imports`)).value.imports.length, 2);
  mark('multipart persisted before worker starts; project scoping and active deletion fencing');
  const worker = await start('worker', ['--memory', '2g', ...appArgs, '-e', 'TWIN_MODE=worker', image]);
  // Finish both inspections before stopping the worker; this test exercises queued persistence,
  // not the separate two-minute lease recovery used for interrupted active conversions.
  const inspections = new Map();
  for (const job of imports) inspections.set(job.id, await waitJob(project, job.id, 'needs_configuration'));
  for (const job of imports) {
    const checked = inspections.get(job.id);
    assert.ok(checked.inspection.objectCount > 0);
    const options = job.format === 'dxf' ? dxfOptions : { schemaVersion: 1, name: 'IFC门洞验收', center: true, layers: [] };
    if (job.format === 'dxf') {
      await request(`/projects/${project}/engineering-imports/${job.id}/convert`, { method: 'POST', body: { ...options, layers: [] }, status: 400 });
      assert.equal((await request(`/projects/${project}/engineering-imports/${job.id}`)).value.import.status, 'needs_configuration');
    }
    // Stop only this disposable worker: submission survives and resumes after restart.
    await docker('stop', '--time', '10', worker);
    await request(`/projects/${project}/engineering-imports/${job.id}/convert`, { method: 'POST', body: options, status: 202 });
    await request(`/projects/${project}/engineering-imports/${job.id}/convert`, { method: 'POST', body: options, status: 409 });
    assert.equal((await request(`/projects/${project}/engineering-imports/${job.id}`)).value.import.status, 'queued');
    await docker('start', worker);
    const done = await waitJob(project, job.id, 'completed');
    assert.equal(done.progress, 100);
    assert.ok(done.result.triangleCount > 0);
    assert.ok(done.resourceId);
    const assets = (await request(`/projects/${project}/model-assets`)).value.modelAssets;
    const asset = assets.find(item => item.id === done.resourceId);
    assert.ok(asset && asset.byteSize > 0 && asset.inspection.nodeCount > 0);
    const response = await offlineFetch(base + `/api/v1/projects/${project}/model-assets/${done.resourceId}/content`, { headers: { Cookie: cookie }, timeoutMs: 15000 });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(gltf.meshes.length > 0);
    assert.equal(new Set(gltf.nodes.map(node => node.name)).size, gltf.nodes.length);
    await writeFile(join(output, job.format + '.glb'), bytes);
    await writeFile(join(output, job.format + '-result.json'), JSON.stringify(done, null, 2));
    mark(job.format.toUpperCase() + ' real geometry -> validated GLB resource; queued job survives worker restart');
  }
  const invalid = await upload(project, 'broken.dxf', '损坏文件验收', Buffer.from('not a DXF'));
  const failed = await waitJob(project, invalid.id, 'failed');
  assert.ok(failed.error.code);
  assert.equal(failed.resourceId, null);
  mark('damaged source yields a durable explicit failure and no fake resource');
  await request(`/projects/${other}`, { method: 'DELETE' });
  await request(`/projects/${project}`, { method: 'DELETE' });
  await request('/auth/logout', { method: 'POST', status: 204 });
  mark('completed and failed imports allow project cleanup; session logout succeeds');
  await writeFile(join(output, 'results.json'), JSON.stringify({ status: 'passed', scope: 'isolated containers on internal network; no existing data accessed', image, checks }, null, 2));
  console.log('OUTPUT ' + output);
} catch (error) {
  for (const name of containers) {
    try { const logs = await dockerResult('logs', '--tail', '1000', name); const safeLogs = Object.values(secrets).reduce((value, secret) => value.replaceAll(secret, '[redacted]'), logs.stdout + logs.stderr); await writeFile(join(output, name + '.log'), safeLogs, { mode: 0o600 }); }
    catch (logError) { console.error('Failed to collect diagnostic log:', name, logError.message); }
  }
  await writeFile(join(output, 'results.json'), JSON.stringify({ status: 'failed', image, checks, error: String(error) }, null, 2));
  console.error('FAILED; diagnostics: ' + output);
  throw error;
} finally {
  const failures = [];
  for (const name of containers.reverse()) {
    try { await docker('rm', '-f', '-v', name); } catch (error) { failures.push(name + ': ' + error.message); }
  }
  if (networkCreated) { try { await docker('network', 'rm', prefix); } catch (error) { failures.push(prefix + ': ' + error.message); } }
  if (failures.length) throw new Error('Isolated test cleanup failed: ' + failures.join('\n'));
}
