// Upgrade only the retained, unedited local example. No broad project/data migration.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, 'deploy/local/.local/business-api-example');
const origin = 'http://127.0.0.1:5173';
const owner = 'backend-business-example-smoke/v1';
const baseline = JSON.parse(await readFile(join(directory, 'before-realistic-upgrade.json'), 'utf8'));
const receipt = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'));
assert.equal(receipt.owner, owner);
assert.equal(receipt.projectId, baseline.receipt.projectId);
assert.equal(receipt.name, baseline.receipt.name);
const projectId = receipt.projectId;
const scenePath = `/api/v1/projects/${projectId}/scene`;
const drivePath = `/api/v1/projects/${projectId}/twin-drive`;
const progressPath = join(directory, 'realistic-upgrade.json');
let progress;
try { progress = JSON.parse(await readFile(progressPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (progress) {
  assert.equal(progress.owner, owner); assert.equal(progress.projectId, projectId);
  assert.deepEqual(progress.baseline, baseline, 'Upgrade baseline must not change between retries.');
} else progress = { owner, projectId, baseline, stage: 'before', expectedScene: baseline.scene, expectedDrive: baseline.drive };
const save = async () => {
  progress.updatedAt = new Date().toISOString();
  await writeFile(progressPath, JSON.stringify(progress, null, 2) + '\n', { mode: 0o600 });
  await chmod(progressPath, 0o600);
};
// requestId identifies each HTTP request, not the persisted document revision/content.
const driveDocument = ({ requestId, ...document }) => document;
const web = createRequire(join(root, 'apps/web/package.json'));
const { build } = createRequire(web.resolve('vite'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'kingdom-owned-example-upgrade-'));
let cookie;
const writes = [];
const call = async (path, method = 'GET', data) => {
  if (method !== 'GET') {
    assert.ok(path === '/api/v1/auth/login' || path === '/api/v1/auth/logout' || path === scenePath || path === drivePath,
      `Refuse unrelated write: ${method} ${path}`);
    writes.push({ method, path });
  }
  const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}) });
  if (path.endsWith('/login') && response.ok) {
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.length, 'Login did not establish a session.'); cookie = cookies.map(value => value.split(';')[0]).join('; ');
  }
  if (path === '/api/v1/auth/logout' && response.status === 204) return;
  const responseText = await response.text();
  let body;
  try { body = JSON.parse(responseText); }
  catch (cause) { throw new Error(`${method} ${path}: HTTP ${response.status} returned invalid JSON, requestId=${response.headers.get('x-request-id')}`, { cause }); }
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}, error=${body.error}, requestId=${body.requestId ?? response.headers.get('x-request-id')}`);
  return body;
};
try {
  const output = join(temporary, 'definitions.mjs');
  await build({ stdin: { contents: `export * from './apps/web/src/twin/business-api-example';export {emptyTwinDriveConfig} from './shared/twin-drive';`, resolveDir: root },
    outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning' });
  const { businessApiExampleConfig, businessApiExampleInstances, businessApiExampleSettings, emptyTwinDriveConfig } = await import(pathToFileURL(output).href);
  const definitions = { instances: businessApiExampleInstances, settings: businessApiExampleSettings, rest: businessApiExampleConfig(), websocket: businessApiExampleConfig('websocket') };
  if (progress.definitions) assert.deepEqual(progress.definitions, definitions, 'Upgrade code changed during a partial migration. Review before continuing.');
  else progress.definitions = definitions;
  await call('/api/v1/auth/login', 'POST', JSON.parse(await readFile(join(root, 'deploy/local/.local/admin.json'), 'utf8')));
  const { project } = await call(`/api/v1/projects/${projectId}`);
  assert.equal(project.name, receipt.name); assert.equal(project.projectType, '3d');
  const feedback = await call('/api/v1/test-business/handling-cell/state');
  assert.equal(feedback.geometryVersion, 1, 'New backend geometry contract must be active before upgrading.');
  for (const point of definitions.rest.points) {
    const value = point.sourcePath.split('.').reduce((current, key) => current?.[key], feedback);
    assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= point.min && value <= point.max, `Invalid actual backend feedback: ${point.sourcePath}`);
  }
  const guard = async () => {
    assert.deepEqual((await call(scenePath)).scene, progress.expectedScene, 'Example scene changed since the guarded baseline. Refuse overwrite.');
    assert.deepEqual(driveDocument(await call(drivePath)), driveDocument(progress.expectedDrive), 'Example drive changed since the guarded baseline. Refuse overwrite.');
  };
  await guard();
  await save();
  if (progress.stage === 'before') {
    progress.expectedDrive = await call(drivePath, 'PUT', { expectedRevision: progress.expectedDrive.revision, config: emptyTwinDriveConfig() });
    progress.stage = 'disabled'; await save();
  }
  if (progress.stage === 'disabled') {
    await guard();
    const previous = progress.expectedScene;
    const saved = (await call(scenePath, 'PATCH', { expectedRevision: previous.revision, upsertInstances: definitions.instances,
      deleteInstanceIds: previous.instances.map(instance => instance.id), settings: definitions.settings })).scene;
    assert.deepEqual(saved.instances, definitions.instances); assert.deepEqual(saved.settings, definitions.settings);
    for (const key of ['fluids', 'decorations', 'roomAlarms', 'staticMap', 'linked2dProjectId']) assert.deepEqual(saved[key], previous[key], `Unrelated scene field changed: ${key}`);
    progress.expectedScene = saved; progress.stage = 'scene-saved'; await save();
  }
  if (progress.stage === 'scene-saved') {
    await guard();
    progress.expectedDrive = await call(drivePath, 'PUT', { expectedRevision: progress.expectedDrive.revision, config: definitions.rest });
    assert.deepEqual(progress.expectedDrive.config, definitions.rest);
    progress.stage = 'complete'; await save();
  }
  assert.equal(progress.stage, 'complete'); await guard();
  await writeFile(join(directory, 'project.json'), JSON.stringify({ ...receipt, state: 'configured', protocol: 'rest', geometryVersion: 1,
    sceneRevision: progress.expectedScene.revision, driveRevision: progress.expectedDrive.revision,
    previewUrl: `${origin}/#/projects/${projectId}/scene-preview`, updatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  await chmod(join(directory, 'project.json'), 0o600);
  console.log(JSON.stringify({ projectId, stage: progress.stage, sceneRevision: progress.expectedScene.revision, driveRevision: progress.expectedDrive.revision, writes }));
} catch (error) {
  console.error(`Local example upgrade failed at stage ${progress.stage}; guarded backup and progress retained in ${directory}.`);
  throw error;
} finally {
  try { if (cookie) await call('/api/v1/auth/logout', 'POST', {}); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
