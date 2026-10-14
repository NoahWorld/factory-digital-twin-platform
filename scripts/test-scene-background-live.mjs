// Actual local Java API / object-storage verification, with no mocked responses.
// Requires the local stack, deploy/local/.local/admin.json, ffmpeg and cwebp on PATH.
// Creates and deletes only its own project, and revokes its own login session.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoverPng } from './backend-cover-smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:18080';
assert.equal(base, 'http://127.0.0.1:18080', 'This test is restricted to the existing local Java deployment.');
const runId = `scene-background-live-${randomUUID()}`;
const output = join(root, 'deploy/local/.local/scene-background-live', runId);
await mkdir(output, { recursive: true, mode: 0o700 });
const report = { runId, startedAt: new Date().toISOString(), base, checks: [], resources: [], findings: [], cleaned: false };
const persist = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let cookie = '', projectId, failure;
const cleanupErrors = [];
const mark = async message => { report.checks.push(message); console.log(`PASS ${message}`); await persist(); };

async function call(path, { method = 'GET', body, status = 200, headers = {}, as = cookie } = {}) {
  const binary = Buffer.isBuffer(body);
  const response = await fetch(base + '/api/v1' + path, {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { Origin: base, ...(as ? { Cookie: as } : {}), ...(body !== undefined && !binary ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  assert.equal(response.status, status, `${method} ${path}: HTTP ${response.status}, error=${value.error ?? 'non-json'}, requestId=${response.headers.get('x-request-id')}`);
  if (status !== 204) assert.ok(response.headers.get('x-request-id'), `${method} ${path} must be traceable.`);
  return { response, value };
}

async function uploadAndRead(kind, filename) {
  const bytes = await readFile(join(output, filename));
  const path = `/projects/${projectId}/${kind}-assets`;
  const asset = (await call(`${path}?filename=${encodeURIComponent(filename)}`, { method: 'POST', body: bytes, status: 201 })).value[`${kind}Asset`];
  assert.equal(asset.state, 'ready');
  assert.equal(asset.originalFilename, filename);
  assert.equal(asset.byteSize, bytes.length);
  assert.equal(asset.sha256, hash(bytes));
  report.resources.push({ id: asset.id, kind, filename, bytes: bytes.length, sha256: asset.sha256 });
  await persist();
  const { response } = await call(`${path}/${asset.id}/content`, { status: 302 });
  const downloadUrl = new URL(response.headers.get('location'), base);
  assert.ok(['127.0.0.1', 'localhost'].includes(downloadUrl.hostname), 'Local test must not download from a remote object store.');
  const download = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) });
  assert.equal(download.status, 200, `Download failed for ${filename}`);
  assert.equal(download.headers.get('content-type'), asset.contentType);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes, `Downloaded ${filename} must be byte-for-byte identical.`);
  return asset;
}

try {
  // Actual decodable media, not magic-byte-only fixture files. These exercise
  // transport and playback formats; they are not a photogrammetry data set.
  for (let index = 0; index < 6; index++) await writeFile(join(output, `capture-${index + 1}.png`), createCoverPng(320 + index, 180));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const render = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  render(['-i', join(output, 'capture-1.png'), '-frames:v', '1', join(output, 'capture-7.jpg')]);
  execFileSync(process.env.CWEBP_PATH || 'cwebp', ['-quiet', join(output, 'capture-2.png'), '-o', join(output, 'capture-8.webp')], { stdio: ['ignore', 'ignore', 'pipe'] });
  for (const [extension, codec] of [['mp4', 'libx264'], ['webm', 'libvpx-vp9']]) {
    render(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10', '-t', '1', '-an', '-c:v', codec, '-pix_fmt', 'yuv420p', join(output, `walkthrough.${extension}`)]);
  }
  await mark('Generated eight valid PNG/JPEG/WebP photos and playable MP4/WebM samples.');
  assert.equal((await fetch(base + '/health', { signal: AbortSignal.timeout(10000) })).status, 200);
  const admin = JSON.parse(await readFile(join(root, 'deploy/local/.local/admin.json'), 'utf8'));
  const login = await call('/auth/login', { method: 'POST', body: admin });
  cookie = login.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Login must issue a session cookie.');
  const capabilities = (await call('/capabilities')).value;
  assert.equal(capabilities.backend, 'java');
  report.capabilities = { backend: capabilities.backend, sceneBackgroundGeneration: capabilities.sceneBackgroundGeneration };
  const project = (await call('/projects', { method: 'POST', status: 201, body: { name: runId, projectType: '3d' } })).value.project;
  projectId = project.id;
  report.projectId = projectId;
  await persist();
  const projectPath = `/projects/${projectId}`;
  const beforeScene = (await call(`${projectPath}/scene`)).value.scene;
  const beforeModels = (await call(`${projectPath}/model-assets`)).value.modelAssets;
  await mark('Real Java API and object store are healthy; an isolated 3D test project was created.');
  for (const name of [...Array.from({ length: 6 }, (_, index) => `capture-${index + 1}.png`), 'capture-7.jpg', 'capture-8.webp']) await uploadAndRead('image', name);
  const images = (await call(`${projectPath}/image-assets`)).value.imageAssets.filter(asset => asset.source !== 'system');
  assert.equal(images.length, 8);
  await mark('Eight photos uploaded, listed and downloaded with identical bytes, sizes and SHA256.');
  for (const name of ['walkthrough.mp4', 'walkthrough.webm']) await uploadAndRead('media', name);
  const media = (await call(`${projectPath}/media-assets`)).value.mediaAssets;
  assert.equal(media.length, 2);
  assert.ok(media.every(asset => asset.mediaType === 'video'));
  await mark('MP4 and WebM uploaded, listed as videos and downloaded with identical bytes and SHA256.');
  for (const [kind, filename, bytes, status] of [
    ['image', 'invalid.png', Buffer.from('not an image'), 400],
    ['media', 'invalid.mp4', Buffer.from('not a video'), 400],
    ['image', 'empty.png', Buffer.alloc(0), 400],
    ['image', 'oversized.png', Buffer.alloc(8 * 1024 * 1024 + 1), 413],
    ['media', 'unsupported.avi', Buffer.from('not supported'), 415],
  ]) await call(`${projectPath}/${kind}-assets?filename=${filename}`, { method: 'POST', status, body: bytes });
  await call(`${projectPath}/uploads`, { method: 'POST', status: 400, body: { kind: 'media', filename: 'oversized.mp4', byteSize: 100 * 1024 * 1024 + 1 } });
  assert.equal((await call(`${projectPath}/image-assets`)).value.imageAssets.filter(asset => asset.source !== 'system').length, 8);
  assert.equal((await call(`${projectPath}/media-assets`)).value.mediaAssets.length, 2);
  await call(`${projectPath}/image-assets/${images[0].id}/content`, { status: 401, as: '' });
  await mark('Invalid signatures, empty/oversized images, unsupported video extension and oversized video declaration rejected; downloads require authentication.');
  assert.deepEqual((await call(`${projectPath}/model-assets`)).value.modelAssets, beforeModels);
  assert.deepEqual((await call(`${projectPath}/scene`)).value.scene, beforeScene);
  assert.ok(images.every(asset => !('quality' in asset) && !('movement' in asset) && !('knownScaleMeters' in asset) && !('captureTaskId' in asset)));
  report.findings.push('Site capture imports source resources only. No model or 3D scene was generated; there is no capture task/group in the current upload contract.');
  await mark('Photo/video import did not create any model or alter the 3D scene; upload responses contain no reconstruction parameters.');
  assert.equal(capabilities.sceneBackgroundGeneration, false, 'Update this current-capability check when Java background generation is implemented.');
  const unsupported = await call(`${projectPath}/scene-backgrounds`, { method: 'POST', status: 501, body: { sourceImageAssetId: images[0].id, name: 'Local background probe', quality: 'balanced', movement: 'fixed', knownScaleMeters: 10 } });
  assert.equal(unsupported.value.error, 'scene_background_not_implemented');
  report.findings.push('The current Java backend also returns 501 for single-image GLB generation; the historical Node implementation is not deployed here.');
  await mark('Java capability flag and actual single-image endpoint consistently report generation unavailable (501).');
} catch (error) {
  failure = error;
  report.failure = error.message;
} finally {
  if (projectId) {
    try {
      const current = (await call(`/projects/${projectId}`)).value.project;
      assert.equal(current.name, runId, 'Refuse to clean up a renamed or unrelated project.');
      const deleted = (await call(`/projects/${projectId}`, { method: 'DELETE' })).value;
      assert.equal(deleted.deletedProjectId, projectId);
      await call(`/projects/${projectId}`, { status: 404 });
      report.deletedObjects = { images: deleted.deletedImageObjectCount, media: deleted.deletedMediaObjectCount, models: deleted.deletedModelObjectCount };
      report.cleaned = true;
    } catch (error) { cleanupErrors.push(error); }
  }
  if (cookie) {
    try { await call('/auth/logout', { method: 'POST', status: 204 }); report.loggedOut = true; }
    catch (error) { cleanupErrors.push(error); }
  }
  report.completedAt = new Date().toISOString();
  if (cleanupErrors.length) report.cleanupErrors = cleanupErrors.map(error => error.message);
  await persist();
}
if (failure || cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors].filter(Boolean), `Local scene-background checks failed; evidence: ${join(output, 'report.json')}`);
console.log(`PASS ${report.checks.length} checks; isolated project and ${report.resources.length} uploaded objects deleted, session revoked.`);
console.log(`Evidence: ${join(output, 'report.json')}`);
