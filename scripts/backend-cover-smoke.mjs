// Local-only PNG transport/authorization checks. This fixture is not a visual screenshot test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

export function createCoverPng(width = 960, height = 540) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels[offset] = Math.floor(x * 255 / width);
      pixels[offset + 1] = Math.floor(y * 255 / height);
      pixels[offset + 2] = 120;
      pixels[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function run() {
  const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:18080';
  assert.equal(base, 'http://127.0.0.1:18080', 'Cover smoke is limited to the local deployment.');
  const admin = JSON.parse(readFileSync(join(root, 'deploy/local/.local/admin.json')));
  const projects = [], users = [], cleanupErrors = [];
  let cookie = '', passed = 0, testError;
  const png = createCoverPng();
  const ok = (message) => { passed++; console.log(`PASS ${message}`); };

  async function call(path, {method = 'GET', body, status = 200, as = cookie, headers = {}} = {}) {
    const binary = Buffer.isBuffer(body);
    const response = await fetch(base + '/api/v1' + path, {
      method,
      headers: {Origin: base, ...(as ? {Cookie: as} : {}), ...(body !== undefined && !binary ? {'Content-Type': 'application/json'} : {}), ...headers},
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const value = response.headers.get('content-type')?.includes('application/json')
      ? await response.json() : Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, status, `${method} ${path}: HTTP ${response.status}, error=${value?.error ?? 'non-JSON response'}, requestId=${response.headers.get('x-request-id')}`);
    assert.ok(response.headers.get('x-request-id'), `${method} ${path}: missing request ID`);
    return {response, value};
  }
  const metadata = async (id) => (await call(`/projects/${id}`)).value.project;
  const upload = (id, sourceRevision, expectedCoverRevision, options = {}) => call(`/projects/${id}/cover?sourceRevision=${sourceRevision}&expectedCoverRevision=${expectedCoverRevision}`, {
    method: 'PUT', body: png, headers: {'Content-Type': 'image/png'}, ...options,
  });
  const expectPending = async (id, hasPreviousPng = false) => {
    const project = await metadata(id);
    assert.equal(project.coverStatus, 'pending');
    if (!hasPreviousPng) {
      assert.equal(project.coverUrl, null);
      assert.equal((await call(`/projects/${id}/cover.png`, {status: 404})).value.error, 'project_cover_pending');
    } else {
      assert.match(project.coverUrl, /\/cover\.png\?revision=\d+$/);
      assert.deepEqual((await call(project.coverUrl.replace('/api/v1', ''))).value, png);
    }
    return project;
  };
  const expectReady = async (id, sourceRevision) => {
    const before = await metadata(id);
    const result = await upload(id, sourceRevision, before.coverRevision);
    const project = result.value.project;
    assert.equal(project.coverStatus, 'ready');
    assert.equal(project.documentRevision, sourceRevision);
    assert.equal(project.coverSourceRevision, sourceRevision);
    assert.match(project.coverUrl, /\/cover\.png\?revision=\d+$/);
    const read = await call(project.coverUrl.replace('/api/v1', ''));
    assert.match(read.response.headers.get('content-type'), /^image\/png/);
    assert.match(read.response.headers.get('cache-control'), /private/);
    assert.match(read.response.headers.get('cache-control'), /no-cache/);
    assert.deepEqual(read.value, png);
    const etag = read.response.headers.get('etag');
    assert.ok(etag);
    await call(`/projects/${id}/cover.png`, {headers: {'If-None-Match': etag}, status: 304});
    await call(`/projects/${id}/cover.png`, {as: '', headers: {'If-None-Match': etag}, status: 401});
    return {project, etag};
  };

  try {
    const login = await call('/auth/login', {method: 'POST', body: admin});
    const session = login.response.headers.get('set-cookie');
    assert.ok(session, 'Local admin login must issue a session cookie.');
    cookie = session.split(';')[0];
    for (const projectType of ['2d', '3d']) {
      const created = (await call('/projects', {method: 'POST', status: 201, body: {name: `Cover smoke ${projectType} ${Date.now()}`, projectType}})).value.project;
      projects.push(created.id);
      const initial = await expectPending(created.id);
      assert.equal(initial.coverUrl, null);
      await call(`/projects/${created.id}/cover.png`, {as: '', status: 401});
      const first = await expectReady(created.id, initial.documentRevision);
      assert.equal((await upload(created.id, initial.documentRevision, initial.coverRevision, {status: 409})).value.error, 'cover_revision_conflict');
      ok(`${projectType}: pending → PNG ready, byte integrity, private cache and authenticated 304`);

      const invalid = await upload(created.id, initial.documentRevision, first.project.coverRevision, {body: Buffer.from('not PNG'), status: 400});
      assert.equal(invalid.value.error, 'invalid_project_cover_png');
      const dimensions = await upload(created.id, initial.documentRevision, first.project.coverRevision, {body: createCoverPng(480, 270), status: 400});
      assert.equal(dimensions.value.error, 'invalid_project_cover_png');
      const oversized = await upload(created.id, initial.documentRevision, first.project.coverRevision, {body: Buffer.alloc(2097153), status: 413});
      assert.ok(['project_cover_too_large', 'request_too_large'].includes(oversized.value.error));
      assert.equal((await metadata(created.id)).coverRevision, first.project.coverRevision);
      assert.deepEqual((await call(`/projects/${created.id}/cover.png`)).value, png);
      ok(`${projectType}: invalid PNG, wrong dimensions and oversize rejected without replacing cover`);

      const documentPath = `/projects/${created.id}/${projectType === '2d' ? 'canvas' : 'scene'}`;
      const document = (await call(documentPath)).value[projectType === '2d' ? 'canvas' : 'scene'];
      const patch = projectType === '2d'
        ? {expectedRevision: document.revision, theme: document.theme, upsertNodes: [], deleteNodeIds: []}
        : {expectedRevision: document.revision, settings: {...document.settings, showGrid: !document.settings.showGrid}, upsertInstances: [], deleteInstanceIds: []};
      await call(documentPath, {method: 'PATCH', body: patch});
      const pending = await expectPending(created.id, true);
      assert.ok(pending.documentRevision > initial.documentRevision);
      assert.ok(pending.coverRevision > first.project.coverRevision);
      assert.equal((await upload(created.id, initial.documentRevision, pending.coverRevision, {status: 409})).value.error, 'revision_conflict');
      await expectPending(created.id, true);
      const next = await expectReady(created.id, pending.documentRevision);
      assert.ok(next.project.coverRevision > first.project.coverRevision);
      assert.notEqual(next.etag, first.etag);
      await call(`/projects/${created.id}`, {method: 'PATCH', body: {name: `Renamed cover smoke ${projectType}`}});
      const renamed = await metadata(created.id);
      assert.equal(renamed.coverStatus, 'ready');
      assert.equal(renamed.coverRevision, next.project.coverRevision);
      ok(`${projectType}: save invalidates cover, stale upload conflicts, refreshed PNG survives rename`);
    }

    const canvasId = projects[0], sceneId = projects[1];
    const canvas = (await call(`/projects/${canvasId}/canvas`)).value.canvas;
    const embeddedNode = {
      id: 'cover-smoke-embedded-scene', type: 'scene-3d', x: 0, y: 0, width: 980, height: 620, zIndex: 1,
      props: {sceneProjectId: sceneId, interactionEnabled: true}, resourceRefs: [], dataBindingRefs: [],
    };
    const embeddedCanvas = (await call(`/projects/${canvasId}/canvas`, {method: 'PATCH', body: {
      expectedRevision: canvas.revision, upsertNodes: [embeddedNode], deleteNodeIds: [],
    }})).value.canvas;
    const beforeSceneChange = await expectReady(canvasId, embeddedCanvas.revision);
    const sceneDocument = (await call(`/projects/${sceneId}/scene`)).value.scene;
    await call(`/projects/${sceneId}/scene`, {method: 'PATCH', body: {
      expectedRevision: sceneDocument.revision, settings: {...sceneDocument.settings, showGrid: !sceneDocument.settings.showGrid}, upsertInstances: [], deleteInstanceIds: [],
    }});
    const invalidatedReference = await expectPending(canvasId, true);
    assert.equal(invalidatedReference.documentRevision, embeddedCanvas.revision);
    assert.ok(invalidatedReference.coverRevision > beforeSceneChange.project.coverRevision);
    assert.equal((await upload(canvasId, embeddedCanvas.revision, beforeSceneChange.project.coverRevision, {status: 409})).value.error, 'cover_revision_conflict');
    await expectPending(canvasId, true);
    await expectReady(canvasId, embeddedCanvas.revision);
    ok('referenced 3D save invalidates 2D screenshot without changing its document and rejects stale capture generation');

    const loginName = `coversmoke${Date.now()}`;
    const viewer = (await call('/users', {method: 'POST', status: 201, body: {
      loginName, email: `${loginName}@local.test`, displayName: 'Temporary cover smoke viewer', password: admin.password, role: 'viewer',
    }})).value.user;
    users.push(viewer.id);
    const viewerLogin = await call('/auth/login', {method: 'POST', body: {identifier: loginName, password: admin.password}});
    const viewerSession = viewerLogin.response.headers.get('set-cookie');
    assert.ok(viewerSession);
    const viewerCookie = viewerSession.split(';')[0], id = projects[0];
    const project = await metadata(id);
    assert.equal((await call(`/projects/${id}/cover.png`, {as: viewerCookie, status: 404})).value.error, 'project_not_found');
    assert.equal((await upload(id, project.documentRevision, project.coverRevision, {as: viewerCookie, status: 404})).value.error, 'project_not_found');
    await call(`/projects/${id}/members/${viewer.id}`, {method: 'PUT', body: {role: 'viewer'}});
    assert.deepEqual((await call(`/projects/${id}/cover.png`, {as: viewerCookie})).value, png);
    assert.equal((await upload(id, project.documentRevision, project.coverRevision, {as: viewerCookie, status: 403})).value.error, 'project_write_forbidden');
    await call(`/projects/${id}/members/${viewer.id}`, {method: 'PUT', body: {role: 'editor'}});
    assert.equal((await upload(id, project.documentRevision, project.coverRevision, {as: viewerCookie})).value.project.coverStatus, 'ready');
    ok('non-member isolation, viewer read-only access and editor PNG upload');
  } catch (reason) {
    testError = reason;
  } finally {
    // Delete only the temporary projects and account recorded by this run. No existing data is reset.
    // The 2D project was created first and may reference the 3D project; remove the owner first.
    for (const id of projects) {
      try {
        assert.equal((await call(`/projects/${id}`, {method: 'DELETE'})).value.deletedProjectId, id);
      } catch (reason) { cleanupErrors.push(new Error(`Could not clean temporary cover project ${id}`, {cause: reason})); }
    }
    for (const id of users) {
      try {
        assert.match(id, /^[a-zA-Z0-9-]+$/);
        execFileSync('docker', ['compose', '--env-file', 'deploy/local/.env', '-f', 'deploy/local/compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'twin', '-d', 'factory_twin', '-v', 'ON_ERROR_STOP=1', '-At'], {
          cwd: root, input: `DELETE FROM users WHERE id='${id}' AND login_name LIKE 'coversmoke%';`, encoding: 'utf8',
        });
      } catch (reason) { cleanupErrors.push(new Error(`Could not clean temporary cover user ${id}`, {cause: reason})); }
    }
  }
  if (testError || cleanupErrors.length) throw new AggregateError([...(testError ? [testError] : []), ...cleanupErrors], 'Backend cover smoke failed; inspect individual failures and cleanup context.');
  console.log(`Backend cover checks passed: ${passed}. Temporary projects/accounts were removed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await run();
