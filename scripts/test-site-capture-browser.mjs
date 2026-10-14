import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const mod = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = await import(isAbsolute(mod) ? pathToFileURL(mod).href : mod);
const output = await mkdtemp(join(tmpdir(), 'site-capture-browser-'));
const cacheDir = await mkdtemp(join(tmpdir(), 'site-capture-vite-'));
const checks = [], errors = [], requests = [], jobs = [], uploaded = [];
const root = '/api/v1/projects/capture-fixture/site-captures';
let available = false, oldBackend = false, networkFailures = 0, failSlot = 2, uncertainDraft = false, hold, holdList, capabilityOverrides = {}, listFailure = 0;
const caps = () => ({ available, reason: available ? null : 'no_worker', minImages: 8, maxImages: 120, maxImageBytes: 8388608, maxVideoBytes: 104857600, maxTotalBytes: 524288000, maxOutputBytes: 209715200, ...capabilityOverrides });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBc8AAAAASUVORK5CYII=', 'base64');
const photos = Array.from({ length: 8 }, (_, index) => ({ name: `view-${index}.png`, mimeType: 'image/png', buffer: png }));
const privateMessage = 'PRIVATE_SERVER_TEXT_MUST_NOT_APPEAR';
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
const body = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); };
const handle = async (req, res, next) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  if (path === '/__capture') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/__capture-entry.js"></script>'); return; }
  if (!path.startsWith('/api/')) return next();
  requests.push({ method: req.method, path });
  if (path === '/api/v1/site-captures/capabilities') return oldBackend ? json(res, { error: 'not_found', message: privateMessage }, 404) : json(res, caps());
  if (path === root && req.method === 'GET') {
    if (listFailure) return json(res, { error: listFailure === 403 ? 'forbidden' : 'site_capture_not_found', message: privateMessage }, listFailure);
    const snapshot = structuredClone(jobs);
    if (holdList) { const gate = holdList; holdList = null; gate.arrive(); await gate.promise; }
    return json(res, { captures: snapshot });
  }
  if (path === root && req.method === 'POST') {
    const input = JSON.parse(await body(req)); let job = jobs.find(item => item.requestId === input.clientRequestId);
    if (!job) { job = { id: `capture-${jobs.length}`, requestId: input.clientRequestId, name: input.name, inputKind: input.inputKind, status: 'uploading', stage: 'uploading', completed: 0, total: input.files.length, files: input.files.map((file, index) => ({ ...file, index, uploaded: false })), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorCode: null, errorMessage: null, result: null }; jobs.unshift(job); }
    if (uncertainDraft) { uncertainDraft = false; json(res, { error: 'network_error', message: privateMessage }, 503); return; }
    return json(res, { capture: job });
  }
  if (path.startsWith(root + '/')) {
    const [id, action, slot] = path.slice(root.length + 1).split('/'); const job = jobs.find(item => item.id === id);
    if (!job) return json(res, { error: 'site_capture_not_found' }, 404);
    if (req.method === 'GET') return json(res, { capture: job });
    if (action === 'sources' && req.method === 'PUT') {
      const bytes = await body(req); uploaded.push({ id, index: +slot, bytes: bytes.length });
      if (hold) { const gate = hold; hold = null; gate.arrive(); await gate.promise; }
      if (+slot === failSlot) return json(res, { error: 'site_capture_source_signature', message: privateMessage, requestId: 'failure-upload-2' }, 400);
      job.files[+slot].uploaded = true; job.completed++; return json(res, { capture: job });
    }
    if (action === 'start' || action === 'retry') { assert.ok(available); assert.ok(job.files.every(file => file.uploaded)); job.status = 'queued'; job.stage = 'queued'; job.completed = 0; job.total = 0; return json(res, { capture: job }); }
    if (action === 'cancel') { job.status = 'canceled'; job.stage = 'canceled'; return json(res, { capture: job }); }
    if (req.method === 'DELETE') { jobs.splice(jobs.indexOf(job), 1); res.statusCode = 204; res.end(); return; }
  }
  errors.push('Unexpected request ' + req.method + ' ' + path); return json(res, { error: 'unexpected_request' }, 404);
};
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {SiteCaptureWizard} from '/src/pages/SiteCaptureWizard.tsx'; import '/src/styles.css'; import '/src/theme/theme-palette.css'; function App(){const [open,setOpen]=React.useState(true);return React.createElement(React.Fragment,null,React.createElement("button",{onClick:()=>setOpen(true)},"打开任务测试"),React.createElement(SiteCaptureWizard,{open,projectId:"capture-fixture",projectName:"现场测试",onClose:()=>setOpen(false),onBack:()=>setOpen(false)}))};createRoot(document.getElementById('root')).render(React.createElement(App));`;
const server = await createServer({ configFile: false, cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 5314, strictPort: true }, plugins: [{ name: 'capture-fixture', resolveId: id => id === '/__capture-entry.js' ? '\0capture-entry.jsx' : null, load: id => id === '\0capture-entry.jsx' ? fixture : null, configureServer(vite) { vite.middlewares.use((req, res, next) => { void handle(req, res, next).catch(error => { errors.push(error.stack); if (!res.headersSent) json(res, { error: 'fixture_error' }, 500); else res.destroy(); }); }); } }] });
let browser, page;
const mark = text => { checks.push(text); console.log('PASS ' + text); };
try {
  await server.listen(); const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async route => { const url = new URL(route.request().url()); if (url.origin !== new URL(base).origin) { errors.push('External URL: ' + url.origin); await route.abort(); } else if (url.pathname === '/api/v1/site-captures/capabilities' && networkFailures) { networkFailures--; await route.abort('internetdisconnected'); } else await route.continue(); });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(base + '__capture');
  const workspace = page.locator('.capture-workspace'); const input = () => page.locator('.capture-form input[type=file]');
  await page.getByText('GPU 重建服务尚未就绪', { exact: true }).waitFor();
  for (const width of [1440, 1366, 360]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 780 }); await page.evaluate(theme => { document.documentElement.dataset.uiTheme = theme; }, theme);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    assert.ok(await page.locator('.capture-footer').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight));
    await page.screenshot({ path: join(output, `requirements-${width}-${theme}.png`) });
  }
  mark('No GPU is explicit; requirements and highlighted limits precede upload; dark/light desktop/mobile layouts fit');
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => { document.documentElement.dataset.uiTheme = 'dark'; });
  for (const invalid of [photos.slice(0, 7), [{ ...photos[0], buffer: Buffer.alloc(0) }, ...photos.slice(1)], [photos[0], { ...photos[1], name: 'VIEW-0.PNG' }, ...photos.slice(2)], [{ name: 'mixed.mp4', mimeType: 'video/mp4', buffer: png }, photos[0]]]) {
    await input().setInputFiles(invalid); assert.equal(await page.getByRole('button', { name: '上传并保存素材', exact: true }).isEnabled(), false);
  }
  assert.equal(jobs.length, 0); mark('Bad counts, empty files, duplicate filenames, and mixed video/photos are blocked');
  capabilityOverrides = { minImages: 3, maxImages: 5, maxImageBytes: 256 };
  await page.reload(); await page.getByText('3–5 张', { exact: true }).waitFor();
  await input().setInputFiles(photos.slice(0, 3)); await page.getByRole('checkbox').check();
  assert.equal(await page.getByRole('button', { name: '上传并保存素材', exact: true }).isEnabled(), true);
  await input().setInputFiles([{ ...photos[0], buffer: Buffer.alloc(257) }, ...photos.slice(1, 3)]);
  await page.getByText('单张图片不能超过 256 B。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '上传并保存素材', exact: true }).isEnabled(), false);
  capabilityOverrides = {}; await page.reload(); await page.getByText('GPU 重建服务尚未就绪', { exact: true }).waitFor();
  mark('Capability count and byte limits drive both requirements display and pre-upload validation');
  await input().setInputFiles(photos); await page.getByRole('checkbox').check();
  uncertainDraft = true;
  await page.getByRole('button', { name: '上传并保存素材', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '连接失败' }).waitFor();
  assert.equal(jobs.length, 1); await page.getByRole('button', { name: '上传并保存素材', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '素材内容与文件格式不符' }).waitFor();
  assert.equal(jobs.length, 1); assert.deepEqual(jobs[0].files.map(file => file.uploaded), [true, true, false, false, false, false, false, false]);
  assert.ok(!(await workspace.innerText()).includes(privateMessage));
  mark('Uncertain draft response retries with the same idempotency key; partial upload exposes controlled failure and preserves stored slots');
  failSlot = -1; await page.reload(); await page.getByRole('button', { name: /现场测试写实漫游/ }).click();
  await page.getByLabel('继续上传原始素材').setInputFiles(photos);
  let arrive, release; const arrived = new Promise(resolve => { arrive = resolve; }); const promise = new Promise(resolve => { release = resolve; }); hold = { arrive, promise };
  await page.getByRole('button', { name: '继续上传', exact: true }).click(); await arrived;
  await page.getByText(/正在上传 2\/8 个素材/).waitFor();
  const ticks = await page.evaluate(async () => { let ticks = 0; await new Promise(resolve => { const timer = setInterval(() => { if (++ticks === 3) { clearInterval(timer); resolve(); } }, 20); }); return ticks; }); assert.equal(ticks, 3);
  await page.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.getByRole('button', { name: '打开任务测试', exact: true }).click();
  await page.getByText(/正在上传 2\/8 个素材/).waitFor(); release();
  await page.getByRole('button', { name: '开始生成漫游', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '开始生成漫游', exact: true }).isEnabled(), false);
  assert.equal(uploaded.filter(item => item.index === 0).length, 1); assert.equal(uploaded.filter(item => item.index === 1).length, 1);
  assert.ok(jobs[0].files.every(file => file.uploaded)); assert.ok(uploaded.every(file => file.bytes === png.length));
  mark('Reload resumes only missing slots; upload stays responsive and survives panel close; no GPU prevents start');
  available = true; await page.getByRole('button', { name: '重新检查服务', exact: true }).click();
  await page.getByText('● GPU 重建服务已就绪', { exact: true }).waitFor();
  await page.getByRole('button', { name: '开始生成漫游', exact: true }).click(); await page.getByText(/等待 GPU 工作节点/).waitFor();
  jobs[0].status = 'running'; jobs[0].stage = 'training'; jobs[0].completed = 200; jobs[0].total = 1000;
  await page.getByText('🟡 优化写实场景', { exact: true }).waitFor(); await page.getByText('200 / 1000', { exact: true }).waitFor();
  await page.getByRole('button', { name: '返回功能中心', exact: true }).click(); await page.getByRole('button', { name: '打开任务测试', exact: true }).click(); await page.getByText('200 / 1000', { exact: true }).waitFor();
  mark('GPU heartbeat enables explicit start; server stage/counts render and persist across reopening');
  networkFailures = 1; await page.getByText(/🔴 网络异常／正在重连/).waitFor(); assert.ok(await page.getByText('200 / 1000', { exact: true }).isVisible());
  await page.getByRole('button', { name: '重新检查服务', exact: true }).click(); await page.getByText(/🔴 网络异常／正在重连/).waitFor({ state: 'hidden' });
  jobs[0].status = 'failed'; jobs[0].errorCode = 'site_capture_coverage_insufficient'; jobs[0].errorMessage = privateMessage;
  await page.getByRole('alert').filter({ hasText: '相机定位或空间覆盖不足' }).waitFor(); assert.ok(!(await workspace.innerText()).includes(privateMessage));
  await page.getByRole('button', { name: '重新生成', exact: true }).click(); await page.getByText(/等待 GPU 工作节点/).waitFor();
  let pollArrive, pollRelease;
  const pollArrived = new Promise(resolve => { pollArrive = resolve; });
  holdList = { arrive: pollArrive, promise: new Promise(resolve => { pollRelease = resolve; }) };
  await pollArrived;
  await page.getByRole('button', { name: '取消任务', exact: true }).click(); await page.locator('.capture-detail .capture-state').filter({ hasText: '已取消' }).waitFor();
  pollRelease(); await page.waitForTimeout(250);
  assert.equal(await page.locator('.capture-detail .capture-state').innerText(), '已取消');
  mark('A delayed list snapshot cannot revert a newer cancellation');
  jobs[0].status = 'succeeded'; jobs[0].result = { format: 'ply', gaussianCount: 100, warnings: null };
  await page.getByText('任务状态读取失败', { exact: true }).waitFor();
  assert.equal(await page.locator('.capture-detail .capture-state').innerText(), '已取消');
  assert.equal(await page.getByRole('button', { name: '进入写实漫游' }).count(), 0);
  jobs[0].status = 'canceled'; jobs[0].result = null;
  await page.getByRole('button', { name: '重新检查服务', exact: true }).click();
  await page.getByText('任务状态读取失败', { exact: true }).waitFor({ state: 'hidden' });
  mark('Malformed succeeded-result metadata is visible as a read error and cannot replace last confirmed tasks');
  await page.clock.install();
  for (const status of [403, 404]) {
    listFailure = status; await page.getByRole('button', { name: '重新检查服务', exact: true }).click();
    await page.getByText('任务状态读取失败', { exact: true }).waitFor();
    assert.equal(await page.getByText('当前后端尚未提供写实重建接口', { exact: true }).count(), 0);
    assert.equal(await page.locator('.capture-detail .capture-state').innerText(), '已取消');
    assert.ok(!(await workspace.innerText()).includes(privateMessage));
    const requestCount = requests.length; await page.clock.fastForward(60_000); assert.equal(requests.length, requestCount);
    listFailure = 0; await page.getByRole('button', { name: '重新检查服务', exact: true }).click();
    await page.getByText('任务状态读取失败', { exact: true }).waitFor({ state: 'hidden' });
  }
  await page.clock.resume();
  mark('Task-list permission and missing-project failures retain confirmed tasks, stop automatic retry, and never masquerade as a missing backend');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '删除任务及文件', exact: true }).click(); await page.getByText('暂无任务。先查看采集要求，再上传现场素材。', { exact: true }).waitFor();
  mark('Network failures retain tasks and show retries; failed tasks support retry, cancellation and explicit deletion');
  oldBackend = true; await page.reload(); await page.getByText('当前后端尚未提供写实重建接口', { exact: true }).waitFor(); assert.ok(!(await workspace.innerText()).includes('内容不存在')); assert.equal(await page.getByRole('button', { name: '上传并保存素材', exact: true }).isEnabled(), false);
  mark('Old backend 404 is a compact upgrade notice, never missing user content');
  assert.deepEqual(errors, []); await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', scope: 'UI/API fixtures only, not GPU reconstruction quality acceptance', checks, requests, uploaded }, null, 2)); console.log('OUTPUT ' + output);
} catch (error) { await page?.screenshot({ path: join(output, 'failure.png') }); await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'failed', error: error.stack, errors, checks }, null, 2)); console.error('OUTPUT ' + output); throw error; }
finally { await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
