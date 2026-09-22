// Local-only fluid persistence and authorization checks. Creates and removes its own fixtures.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createCoverPng} from './backend-cover-smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function checkFluidDocument(call, projectId, ok) {
  const path = `/projects/${projectId}/scene`;
  const before = (await call(path)).value.scene;
  const project = (await call(`/projects/${projectId}`)).value.project;
  const ready = (await call(`/projects/${projectId}/cover?sourceRevision=${project.documentRevision}&expectedCoverRevision=${project.coverRevision}`, {
    method: 'PUT', body: createCoverPng(), raw: true, headers: {'Content-Type': 'image/png'},
  })).value.project;
  assert.equal(ready.coverStatus, 'ready');
  const base = JSON.parse(readFileSync(join(root, 'apps/backend/src/test/resources/fluid-validation-cases.json'), 'utf8')).base;
  const fluids = ['gas', 'liquid', 'molten'].map((kind, index) => ({
    ...base, id: `smoke-fluid-${kind}`, label: `Integration ${kind}`, kind,
    color: ['#cbd5e1', '#2563eb', '#ff6b20'][index], mode: index === 1 ? 'stream' : 'diffuse',
    direction: index === 2 ? 'reverse' : 'forward', points: [[0, index + 1, 0], [2, index + 1, 1], [4, index + 2, 3]],
  }));
  let scene = (await call(path, {method: 'PATCH', body: {expectedRevision: before.revision, fluids}})).value.scene;
  assert.equal(scene.revision, before.revision + 1);
  assert.deepEqual(scene.fluids, fluids);
  assert.deepEqual(scene.instances, before.instances);
  assert.deepEqual((await call(path)).value.scene.fluids, fluids);
  const manifest = (await call(`/projects/${projectId}/manifest`)).value;
  assert.deepEqual(manifest.fluids, fluids);
  assert.equal(Object.hasOwn(manifest.settings, 'fluids'), false);
  const saved = (await call(`/projects/${projectId}`)).value.project;
  assert.equal(saved.documentRevision, scene.revision);
  assert.equal(saved.coverStatus, 'pending');
  assert.ok(saved.coverRevision > ready.coverRevision);
  ok('three fluid types round-trip through scene and manifest; fluid-only saves advance revision and invalidate the ready cover');

  scene = (await call(path, {method: 'PATCH', body: {
    expectedRevision: scene.revision, settings: {...scene.settings, showGrid: !scene.settings.showGrid},
  }})).value.scene;
  assert.deepEqual(scene.fluids, fluids);
  assert.equal(Object.hasOwn(scene.settings, 'fluids'), false);
  assert.deepEqual((await call(path)).value.scene.fluids, fluids);
  const snapshot = structuredClone(scene);
  for (const invalid of [null, [{...fluids[0], kind: 'water'}], [{...fluids[0], points: [[0, 0, 0], [0, 0, 0]]}], [{...fluids[0], unexpected: true}], [fluids[0], fluids[0]]]) {
    await call(path, {method: 'PATCH', status: 400, body: {expectedRevision: scene.revision, fluids: invalid}});
  }
  await call(path, {method: 'PATCH', status: 400, body: {expectedRevision: scene.revision, settings: {...scene.settings, fluids}}});
  await call(path, {method: 'PATCH', status: 409, body: {expectedRevision: scene.revision - 1, fluids: []}});
  assert.deepEqual((await call(path)).value.scene, snapshot);
  ok('settings-only saves preserve fluids; malformed configurations and stale writes leave the entire scene unchanged');
  return {fluids, snapshot};
}

export async function checkFluidViewer(call, projectId, viewer, snapshot, ok) {
  const path = `/projects/${projectId}/scene`;
  assert.deepEqual((await call(path, {as: viewer})).value.scene.fluids, snapshot.fluids);
  assert.deepEqual((await call(`/projects/${projectId}/manifest`, {as: viewer})).value.fluids, snapshot.fluids);
  await call(path, {method: 'PATCH', as: viewer, status: 403, body: {expectedRevision: snapshot.revision, fluids: []}});
  assert.deepEqual((await call(path)).value.scene, snapshot);
  ok('scene viewers can read fluid configurations and manifests but cannot replace or remove fluids');
}

async function run() {
  const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:18080';
  assert.equal(base, 'http://127.0.0.1:18080', 'Fluid smoke is limited to the local deployment.');
  const admin = JSON.parse(readFileSync(join(root, 'deploy/local/.local/admin.json')));
  const projects = [], users = [], cleanupErrors = [];
  let cookie = '', passed = 0, testError;
  const ok = message => { passed++; console.log(`PASS ${message}`); };
  async function call(path, {method = 'GET', body, status = 200, as = cookie, headers = {}} = {}) {
    const binary = Buffer.isBuffer(body);
    const response = await fetch(base + '/api/v1' + path, {
      method, headers: {Origin: base, ...(as ? {Cookie: as} : {}), ...(body !== undefined && !binary ? {'Content-Type': 'application/json'} : {}), ...headers},
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, status, `${method} ${path}: HTTP ${response.status}, error=${value?.error ?? 'non-JSON response'}, message=${value?.message ?? ''}, requestId=${response.headers.get('x-request-id')}`);
    assert.ok(response.headers.get('x-request-id'));
    return {response, value};
  }
  try {
    assert.equal((await fetch(base + '/health', {signal: AbortSignal.timeout(15000)})).status, 200);
    const login = await call('/auth/login', {method: 'POST', body: admin});
    assert.ok(login.response.headers.get('set-cookie'));
    cookie = login.response.headers.get('set-cookie').split(';')[0];
    const project = (await call('/projects', {method: 'POST', status: 201, body: {name: `Temporary fluid smoke ${Date.now()}`, projectType: '3d'}})).value.project;
    projects.push(project.id);
    const initial = (await call(`/projects/${project.id}/scene`)).value.scene;
    assert.deepEqual(initial.fluids, []);
    assert.equal(Object.hasOwn(initial.settings, 'fluids'), false);
    const models = (await call(`/projects/${project.id}/model-assets`)).value.modelAssets;
    assert.ok(models.length > 0);
    const instance = {id: 'fluid-smoke-instance', assetId: null, label: 'Temporary fixture model', modelAssetId: models[0].id, renderMode: 'interactive', sortOrder: 0, transform: {position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]}, visible: true};
    await call(`/projects/${project.id}/scene`, {method: 'PATCH', body: {expectedRevision: initial.revision, upsertInstances: [instance], deleteInstanceIds: []}});
    ok('a new scene reads absent fluid storage as an empty public array and accepts independent model edits');
    const {snapshot} = await checkFluidDocument(call, project.id, ok);

    const loginName = `fluidsmoke${Date.now()}`;
    const user = (await call('/users', {method: 'POST', status: 201, body: {loginName, email: `${loginName}@local.test`, displayName: 'Temporary fluid smoke viewer', password: admin.password, role: 'viewer'}})).value.user;
    users.push({id: user.id, loginName});
    const viewerLogin = await call('/auth/login', {method: 'POST', body: {identifier: loginName, password: admin.password}});
    assert.ok(viewerLogin.response.headers.get('set-cookie'));
    const viewer = viewerLogin.response.headers.get('set-cookie').split(';')[0];
    await call(`/projects/${project.id}/scene`, {as: viewer, status: 404});
    await call(`/projects/${project.id}/members/${user.id}`, {method: 'PUT', body: {role: 'viewer'}});
    await checkFluidViewer(call, project.id, viewer, snapshot, ok);

    const cleared = (await call(`/projects/${project.id}/scene`, {method: 'PATCH', body: {expectedRevision: snapshot.revision, fluids: []}})).value.scene;
    assert.deepEqual(cleared.fluids, []);
    assert.deepEqual((await call(`/projects/${project.id}/scene`)).value.scene.fluids, []);
    assert.deepEqual(cleared.instances, snapshot.instances);
    assert.equal(cleared.revision, snapshot.revision + 1);
    ok('an explicit empty fluid array removes fluids without changing models');
  } catch (reason) {
    testError = reason;
  } finally {
    for (const id of projects) {
      try {
        assert.equal((await call(`/projects/${id}`, {method: 'DELETE'})).value.deletedProjectId, id);
      } catch (reason) { cleanupErrors.push(new Error(`Could not remove temporary fluid project ${id}`, {cause: reason})); }
    }
    for (const {id, loginName} of users) {
      try {
        assert.match(id, /^[a-zA-Z0-9-]+$/);
        assert.match(loginName, /^fluidsmoke\d+$/);
        const deleted = execFileSync('docker', ['compose', '--env-file', 'deploy/local/.env', '-f', 'deploy/local/compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'twin', '-d', 'factory_twin', '-v', 'ON_ERROR_STOP=1', '-At'], {
          cwd: root, input: `DELETE FROM users WHERE id='${id}' AND login_name='${loginName}' RETURNING id;`, encoding: 'utf8',
        });
        assert.ok(deleted.split('\n').includes(id), 'Temporary fluid viewer was not removed.');
      } catch (reason) { cleanupErrors.push(new Error(`Could not remove temporary fluid user ${id}`, {cause: reason})); }
    }
  }
  if (testError || cleanupErrors.length) throw new AggregateError([...(testError ? [testError] : []), ...cleanupErrors], 'Backend fluid smoke failed; inspect the individual errors.');
  console.log(`Backend fluid checks passed: ${passed}. Temporary projects/accounts were removed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await run();
