// Real local UI/API/database/object-store checks. No reconstruction or GPU is simulated.
// Only this run's temporary project and session are mutated and cleaned up.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCoverPng } from './backend-cover-smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'http://127.0.0.1:5173';
const mod = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = await import(isAbsolute(mod) ? pathToFileURL(mod).href : mod);
const runId = `capture-integrity-${randomUUID()}`;
const output = join(root, 'deploy/local/.local/site-capture-tests', runId);
await mkdir(output, { recursive: true, mode: 0o700 });
const report = { runId, startedAt: new Date().toISOString(), origin, checks: [], requests: [], pageErrors: [], reactErrors: [], cleaned: false,
  scope: 'Real local source upload, persistence and task controls without GPU. Synthetic media is not a photogrammetry data set; no reconstruction or visual quality claim.' };
const persist = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const mark = async message => { report.checks.push(message); await persist(); console.log('PASS ' + message); };
let browser, context, page, projectId, loggedIn = false, failure;
const cleanupErrors = [];
const taskPrefix = `完整性验收-${runId.slice(-8)}`;
const capturePath = id => `/api/v1/projects/${projectId}/site-captures${id ? '/' + id : ''}`;
async function call(path, { method = 'GET', data, status = 200, headers = {} } = {}) {
  assert.ok(path.startsWith('/api/v1/'));
  if (method !== 'GET') assert.ok(path === '/api/v1/auth/login' || path === '/api/v1/auth/logout' || path === '/api/v1/projects' && method === 'POST' || projectId && path.startsWith(`/api/v1/projects/${projectId}/`), 'Refuse writes outside this test project/session.');
  const response = await context.request.fetch(origin + path, { method, data, headers: { Origin: origin, ...headers }, maxRedirects: 0, timeout: 30000 });
  assert.equal(response.status(), status, `${method} ${path}: HTTP ${response.status()}, requestId=${response.headers()['x-request-id'] ?? 'none'}`);
  assert.ok(response.headers()['x-request-id']);
  return status === 204 ? null : response.json();
}
async function openCapture() {
  await page.getByRole('button', { name: /^AI 场景底座/ }).click();
  const entry = page.getByRole('button', { name: /打开写实漫游/ });
  assert.equal(await entry.count(), 1, '写实漫游入口当前未开放；真实上传专项验收需要先恢复公开入口。');
  await entry.click();
  await page.getByText('GPU 重建服务尚未就绪', { exact: true }).waitFor();
}
async function selectProject() {
  const picker = page.getByRole('combobox', { name: '资源所属项目', exact: true });
  await picker.click(); await page.getByRole('option', { name: runId, exact: true }).click();
}
async function newForm(name, paths) {
  await page.getByRole('button', { name: /新建写实漫游/ }).click();
  await page.getByLabel('漫游名称', { exact: true }).fill(name);
  await page.getByLabel('选择一组照片或一个连续视频', { exact: true }).setInputFiles(paths);
  await page.getByRole('checkbox', { name: /我已阅读采集要求/ }).check();
}
async function uploadForm(total) {
  const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === origin + capturePath());
  await page.getByRole('button', { name: '上传并保存素材', exact: true }).click();
  const response = await responsePromise; assert.equal(response.status(), 201);
  const job = (await response.json()).capture;
  await page.getByText(`已保存 ${total}/${total} 个文件。保存后由你决定何时开始生成。`, { exact: true }).waitFor({ timeout: 60000 });
  assert.ok(await page.getByRole('button', { name: '开始生成漫游', exact: true }).isDisabled());
  return job.id;
}
async function deleteSelected(id) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除任务及文件', exact: true }).click();
  await page.locator('.capture-detail').waitFor({ state: 'hidden' });
  await call(capturePath(id), { status: 404 });
}
try {
  // Resolutions/durations satisfy published numeric limits; patterns are transport fixtures only.
  const sources = [];
  for (let i = 0; i < 8; i++) {
    const pngPath = join(output, `view-${i}.png`);
    await writeFile(pngPath, createCoverPng(640 + i * 2, 480), { mode: 0o600 });
    let path = pngPath, mime = 'image/png';
    if (i === 6) {
      path = join(output, 'view-6.jpg'); mime = 'image/jpeg';
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', pngPath, '-frames:v', '1', path], { stdio: ['ignore', 'ignore', 'pipe'] });
    } else if (i === 7) {
      path = join(output, 'view-7.webp'); mime = 'image/webp';
      execFileSync('cwebp', ['-quiet', pngPath, '-o', path], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
    const bytes = await readFile(path);
    sources.push({ path, filename: path.split('/').at(-1), contentType: mime, byteSize: bytes.length, bytes });
  }
  const videos = [];
  for (const [ext, codec] of [['mp4', 'libx264'], ['webm', 'libvpx-vp9']]) {
    const path = join(output, `capture.${ext}`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=10', '-t', '4', '-an', '-c:v', codec, '-pix_fmt', 'yuv420p', path], { stdio: ['ignore', 'ignore', 'pipe'] });
    videos.push(path);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const admin = JSON.parse(await readFile(join(root, 'deploy/local/.local/admin.json'), 'utf8'));
  await call('/api/v1/auth/login', { method: 'POST', data: admin }); loggedIn = true;
  const caps = await call('/api/v1/site-captures/capabilities');
  assert.equal(caps.available, false, 'This local test is explicitly for the environment without a GPU.');
  report.capabilities = caps;
  const project = (await call('/api/v1/projects', { method: 'POST', status: 201, data: { name: runId, projectType: '3d' } })).project;
  projectId = project.id; report.projectId = projectId; await persist();
  const beforeModels = (await call(`/api/v1/projects/${projectId}/model-assets`)).modelAssets;
  const beforeScene = (await call(`/api/v1/projects/${projectId}/scene`)).scene;
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Each child|same key|Encountered two children|React has detected/i.test(message.text())) report.reactErrors.push(message.text()); });
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) report.requests.push({ method: request.method(), path: url.pathname }); });
  await page.goto(origin + '/#/resources'); await selectProject(); await openCapture();
  assert.ok(await page.getByRole('heading', { name: '先确定范围，再采集现场' }).isVisible());
  await newForm(taskPrefix + '-格式拒绝', [sources[0].path, videos[0]]);
  await page.getByText('一次任务不能混合视频和图片，请选择其中一种采集方式。', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: '上传并保存素材', exact: true }).isDisabled());
  await newForm(taskPrefix + '-数量拒绝', sources.slice(0, 7).map(s => s.path));
  assert.ok(await page.getByRole('button', { name: '上传并保存素材', exact: true }).isDisabled());
  assert.equal((await call(capturePath())).captures.length, 0);
  await mark('Upfront requirements are visible; mixed photo/video and fewer than eight photos are blocked before creating any task.');
  await newForm(taskPrefix + '-照片', sources.map(s => s.path));
  const decoded = await page.locator('.capture-form input[type=file]').evaluate(async input => Promise.all(Array.from(input.files).map(async file => { const bitmap = await createImageBitmap(file); const result = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return result; })));
  assert.ok(decoded.every(s => s.width >= 640 && s.height === 480));
  const photoId = await uploadForm(8);
  const photos = (await call(capturePath(photoId))).capture;
  assert.ok(photos.files.every(s => s.uploaded)); assert.equal(photos.result, null);
  assert.deepEqual(photos.files.map(s => s.contentType), sources.map(s => s.contentType));
  const unavailable = await call(capturePath(photoId) + '/start', { method: 'POST', status: 503 });
  assert.equal(unavailable.error, 'site_capture_unavailable');
  assert.equal((await call(capturePath(photoId))).capture.status, 'uploading');
  await page.screenshot({ path: join(output, 'photos-uploaded.png') });
  await mark('Eight real PNG/JPEG/WebP files upload via UI; all slots persist. Direct start is also rejected with 503 when GPU is absent, without changing task state.');
  await page.reload(); await selectProject(); await openCapture();
  await page.locator('.capture-task-list').getByRole('button', { name: new RegExp(taskPrefix + '-照片') }).click();
  await page.getByText('已保存 8/8 个文件。保存后由你决定何时开始生成。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  await page.locator('.capture-detail .capture-state').filter({ hasText: '已取消' }).waitFor();
  assert.equal((await call(capturePath(photoId))).capture.status, 'canceled');
  assert.equal(await page.getByRole('button', { name: '开始生成漫游', exact: true }).count(), 0);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '删除任务及文件', exact: true }).click();
  assert.equal((await call(capturePath(photoId))).capture.status, 'canceled');
  await deleteSelected(photoId);
  await mark('Reload restores the saved task; cancel persists and disables generation. Dismissing delete keeps the task; confirming deletes it and API returns 404.');
  // Save three genuine slots, then use a fresh page to exercise missing-file recovery.
  const partialName = taskPrefix + '-补传';
  const partial = (await call(capturePath(), { method: 'POST', status: 201, data: { name: partialName, inputKind: 'images', clientRequestId: randomUUID(), files: sources.map(({ filename, byteSize, contentType }) => ({ filename, byteSize, contentType })) } })).capture;
  for (let i = 0; i < 3; i++) await call(capturePath(partial.id) + '/sources/' + i, { method: 'PUT', data: sources[i].bytes, headers: { 'Content-Type': sources[i].contentType } });
  await page.reload(); await selectProject(); await openCapture();
  await page.locator('.capture-task-list').getByRole('button', { name: new RegExp(partialName) }).click();
  await page.getByText('已保存 3/8 个文件。保存后由你决定何时开始生成。', { exact: true }).waitFor();
  await page.getByLabel('继续上传原始素材', { exact: true }).setInputFiles(sources.map(s => s.path));
  await page.getByRole('button', { name: '继续上传', exact: true }).click();
  await page.getByText('已保存 8/8 个文件。保存后由你决定何时开始生成。', { exact: true }).waitFor({ timeout: 60000 });
  const puts = report.requests.filter(r => r.method === 'PUT' && r.path.startsWith(capturePath(partial.id) + '/sources/'));
  assert.deepEqual(puts.map(r => Number(r.path.split('/').at(-1))), [3, 4, 5, 6, 7]);
  await deleteSelected(partial.id);
  await mark('Fresh browser page resumes a genuinely partial 3/8 task by uploading only the five missing slots, with no duplicate task or saved-slot upload.');
  for (const path of videos) {
    const ext = path.split('.').at(-1);
    await newForm(taskPrefix + '-' + ext, [path]);
    const id = await uploadForm(1);
    const job = (await call(capturePath(id))).capture;
    assert.equal(job.inputKind, 'video'); assert.equal(job.files.length, 1); assert.equal(job.files[0].uploaded, true);
    await page.screenshot({ path: join(output, `video-${ext}-uploaded.png`) });
    await deleteSelected(id);
    await mark(`Playable four-second ${ext.toUpperCase()} video uploads and persists via the actual UI; explicit deletion removes the task.`);
  }
  await page.getByRole('button', { name: '返回功能中心', exact: true }).click();
  await page.getByRole('button', { name: /打开工程底座/ }).click();
  await page.getByRole('button', { name: '返回功能中心', exact: true }).click();
  await page.getByRole('button', { name: /打开写实漫游/ }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.uiTheme = theme; }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.getByRole('button', { name: '返回功能中心', exact: true }).isVisible());
    await page.screenshot({ path: join(output, `mobile-${theme}.png`) });
  }
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await call(capturePath())).captures.length, 0);
  assert.deepEqual((await call(`/api/v1/projects/${projectId}/model-assets`)).modelAssets, beforeModels);
  assert.deepEqual((await call(`/api/v1/projects/${projectId}/scene`)).scene, beforeScene);
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.reactErrors, []);
  assert.equal(report.requests.filter(r => r.path.endsWith('/start')).length, 0, 'UI must never start reconstruction without GPU.');
  await mark('Feature-center navigation, engineering return, Escape and 390px light/dark views work. No browser/React errors, fabricated model or scene changes.');
} catch (error) {
  failure = error; report.failure = error.message;
  if (page) try { await page.screenshot({ path: join(output, 'failure.png') }); } catch (screenshotError) { report.screenshotFailure = screenshotError.message; }
} finally {
  if (page) await page.close();
  if (projectId) {
    try {
      assert.equal((await call(`/api/v1/projects/${projectId}`)).project.name, runId, 'Refuse deletion of renamed/unrelated project.');
      assert.ok((await call(capturePath())).captures.every(c => c.name.startsWith(taskPrefix)), 'Refuse deletion if another task was added.');
      const response = await context.request.delete(origin + `/api/v1/projects/${projectId}`, { headers: { Origin: origin }, timeout: 30000 });
      assert.equal(response.status(), 200); const result = await response.json(); assert.equal(result.deletedProjectId, projectId); assert.equal(result.warning, null);
      await call(`/api/v1/projects/${projectId}`, { status: 404 }); report.cleaned = true;
    } catch (error) { cleanupErrors.push(error); }
  }
  if (loggedIn) try { await call('/api/v1/auth/logout', { method: 'POST', status: 204 }); report.loggedOut = true; } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) report.cleanupErrors = cleanupErrors.map(e => e.message);
  report.finishedAt = new Date().toISOString(); report.status = failure || cleanupErrors.length ? 'failed' : 'passed';
  await persist(); await browser?.close();
}
if (failure || cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors].filter(Boolean), `Real local browser test failed; evidence: ${join(output, 'report.json')}`);
console.log(`PASS ${report.checks.length} groups; own project removed and session revoked. Evidence: ${join(output, 'report.json')}`);
