import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// UI/transport regression only: the real ResourcesPage runs against an isolated,
// in-memory API. This does not validate storage, reconstruction, or a GPU service.
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const parent = process.env.SCENE_BACKGROUND_TEST_OUTPUT_DIR ? resolve(process.env.SCENE_BACKGROUND_TEST_OUTPUT_DIR) : tmpdir();
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'scene-background-browser-'));
await chmod(output, 0o700);
const cacheDir = await mkdtemp(join(tmpdir(), 'scene-background-vite-cache-'));
const audit = {
  status: 'running',
  scope: 'Actual ResourcesPage and wizard with isolated in-memory API fixtures; function center and single-image capability UI only. Capture tasks have a separate regression.',
  checks: [], pageErrors: [], reactErrors: [], fixtureErrors: [], unexpectedRequests: [], requests: [], layouts: [],
};
const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
const mark = async name => { audit.checks.push(name); console.log('PASS ' + name); await persist(); };
const id = 'scene-background-browser-fixture';
const project = { id, name: '场景底座浏览器验收', projectRole: 'owner' };
const root = `/api/v1/projects/${id}`;
const imageAssets = [], mediaAssets = [], uploads = [], contents = new Map(), gates = new Map();
let listReads = 0, failUploadNumber = null, imageGeneration = false, capabilityNetworkFailures = 0;
const privateMessage = 'PRIVATE_UPLOAD_ERROR_MUST_NOT_RENDER';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBc8AAAAASUVORK5CYII=', 'base64');
const photo = (name, buffer = png) => ({ name, mimeType: 'image/png', buffer });
const photos = prefix => Array.from({ length: 8 }, (_, index) => photo(`${prefix}-${index + 1}.png`));
function holdUpload(number) {
  let received, release;
  const arrived = new Promise(resolve => { received = resolve; });
  const unlocked = new Promise(resolve => { release = resolve; });
  gates.set(number, { received, unlocked, release });
  return { arrived, release };
}
async function waitForUpload(gate) {
  let timeout;
  try {
    await Promise.race([gate.arrived, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Expected source upload was not received within 15 seconds')), 15000);
    })]);
  } finally { clearTimeout(timeout); }
}
const respond = (res, body, status = 200) => {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ResourcesPage} from '/src/pages/ResourcesPage.tsx';
import {NotificationProvider} from '/src/components/NotificationProvider.tsx';
import {ThemeProvider} from '/src/theme/ThemeProvider.tsx';
import {initializeUiTheme} from '/src/theme/ui-theme.ts';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
createRoot(document.getElementById('root')).render(React.createElement(ThemeProvider, {initialState: initializeUiTheme()}, React.createElement(NotificationProvider, null, React.createElement(ResourcesPage, {isPlatformAdmin: true, loadingProjects: false, projectError: null, projects: [${JSON.stringify(project)}]}))));
`;
const handle = async (req, res, next) => {
  const url = new URL(req.url, 'http://fixture.invalid');
  const path = url.pathname;
  if (path === '/__scene-background') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/__scene-background-entry.js"></script></html>');
    return;
  }
  if (!path.startsWith('/api/')) return next();
  audit.requests.push({ method: req.method, path });
  if (path === '/api/v1/capabilities') return respond(res, { sceneBackgroundGeneration: imageGeneration });
  if (req.method === 'GET' && path === root + '/model-assets') { listReads++; return respond(res, { modelAssets: [] }); }
  if (req.method === 'GET' && path === root + '/image-assets') { listReads++; return respond(res, { imageAssets }); }
  if (req.method === 'GET' && path === root + '/media-assets') { listReads++; return respond(res, { mediaAssets }); }
  if (req.method === 'GET' && contents.has(path)) {
    const content = contents.get(path); res.setHeader('Content-Type', content.type); res.end(content.bytes); return;
  }
  if (path === '/api/v1/engineering-imports/capabilities') {
    return respond(res, { available: true, reason: null, formats: ['ifc', 'dxf'], maxSourceBytes: 104857600, maxOutputBytes: 26214400 });
  }
  if (req.method === 'GET' && path === root + '/engineering-imports') return respond(res, { imports: [] });
  if (path === '/api/v1/site-captures/capabilities') return respond(res, { available: false, reason: 'worker_unavailable', minImages: 8, maxImages: 120, maxImageBytes: 8388608, maxVideoBytes: 104857600, maxTotalBytes: 524288000, maxOutputBytes: 209715200 });
  if (req.method === 'GET' && path === root + '/site-captures') return respond(res, { captures: [] });
  if (req.method === 'POST' && (path === root + '/image-assets' || path === root + '/media-assets')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), name = url.searchParams.get('filename'), type = req.headers['content-type'];
    const number = uploads.length + 1;
    const upload = { number, name, path, contentType: type, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), status: 'received' };
    uploads.push(upload);
    const gate = gates.get(number);
    if (gate) { gate.received(); await gate.unlocked; }
    if (number === failUploadNumber) {
      upload.status = 'failed';
      return respond(res, { error: 'forbidden', message: privateMessage, requestId: 'fixture-upload-failure' }, 403);
    }
    const media = path.endsWith('/media-assets');
    const asset = {
      id: `fixture-${number}`, projectId: id, originalFilename: name, format: media ? 'webm' : 'png',
      contentType: type, byteSize: bytes.length, sha256: upload.sha256, source: 'upload',
      usage: { references: [], count: 0 }, createdAt: new Date().toISOString(),
      ...(media ? { mediaType: 'video' } : {}),
    };
    (media ? mediaAssets : imageAssets).push(asset);
    contents.set(`${path}/${asset.id}/content`, { type, bytes }); upload.status = 'stored';
    return respond(res, media ? { mediaAsset: asset } : { imageAsset: asset }, 201);
  }
  audit.unexpectedRequests.push(req.method + ' ' + path);
  return respond(res, { error: 'unexpected_fixture_request' }, 404);
};
const server = await createServer({
  configFile: false, cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(process.env.SCENE_BACKGROUND_TEST_PORT || 5312), strictPort: true },
  plugins: [{ name: 'scene-background-browser-fixture',
    resolveId(value) { if (value === '/__scene-background-entry.js') return '\0scene-background-entry'; },
    load(value) { if (value === '\0scene-background-entry') return fixture; },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        void handle(req, res, next).catch(error => {
          audit.fixtureErrors.push(error.stack);
          if (!res.headersSent) return respond(res, { error: 'fixture_error' }, 500);
          res.destroy(error);
        });
      });
    },
  }],
});
let browser, page;
console.log('OUTPUT ' + output);
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) {
      audit.unexpectedRequests.push(route.request().url()); await route.abort('blockedbyclient');
    } else if (url.pathname === '/api/v1/capabilities' && capabilityNetworkFailures > 0) {
      capabilityNetworkFailures--; await route.abort('internetdisconnected');
    } else await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => audit.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /Each child|same key|Encountered two children|React has detected/i.test(message.text())) audit.reactErrors.push(message.text());
  });
  const wizard = () => page.locator('.scene-background-wizard');
  const open = async () => { await page.getByRole('button', { name: /^AI 场景底座/ }).click(); await wizard().waitFor(); };
  const input = () => wizard().locator('input[type="file"]');
  const close = () => page.getByRole('button', { name: '关闭场景底座向导', exact: true }).click();
  const assertFits = async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Document must not overflow horizontally');
    assert.ok(await wizard().evaluate(element => element.getBoundingClientRect().width <= innerWidth), 'Wizard must fit viewport width');
    assert.ok(await wizard().evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Wizard must not contain horizontal overflow');
    assert.ok(await page.locator('.scene-background-footer').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight + 1), 'Footer stays within viewport');
  };
  await page.goto(base + '__scene-background'); await open();
  const entryNames = [/极速背景/, /工程底座.*IFC/s];
  for (const name of entryNames) assert.equal(await wizard().getByRole('button', { name }).count(), 1);
  assert.equal(await wizard().locator('.foundation-module').count(), 2);
  assert.doesNotMatch(await wizard().innerText(), /写实漫游|GPU|三种能力/);
  assert.equal(await wizard().getByRole('button', { name: '添加素材', exact: true }).count(), 0);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }, { width: 360, height: 780 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.uiTheme = theme; }, theme);
      await assertFits();
      audit.layouts.push(await wizard().evaluate((element, theme) => {
        const body = element.querySelector('.scene-background-body').getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, theme, entryActions: Array.from(element.querySelectorAll('.foundation-module button')).map(button => {
          const bounds = button.getBoundingClientRect();
          return { name: button.getAttribute('aria-label'), top: bounds.top, bottom: bounds.bottom, inInitialView: bounds.top >= body.top && bounds.bottom <= body.bottom };
        }) };
      }, theme));
      if (viewport.width >= 1000) {
        assert.ok(audit.layouts.at(-1).entryActions.every(action => action.inInitialView), 'Desktop module actions must all appear without scrolling');
      }
      await page.screenshot({ path: join(output, `foundation-${viewport.width}-${theme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.uiTheme = 'dark'; });
  await wizard().getByRole('button', { name: /极速背景/ }).click();
  await page.getByRole('heading', { name: '添加极速背景素材', exact: true }).waitFor();
  await wizard().getByText('当前服务尚未开放单图背景生成', { exact: true }).waitFor();
  assert.equal(await input().isEnabled(), false);
  assert.equal(await wizard().getByRole('button', { name: '检查配置', exact: true }).isEnabled(), false);
  await wizard().getByRole('button', { name: '返回功能中心', exact: true }).click();
  await wizard().getByRole('button', { name: /工程底座.*IFC/s }).click();
  await page.getByRole('heading', { name: '工程底座 · BIM / CAD 转 GLB', exact: true }).waitFor();
  await page.getByRole('region', { name: '创建前文件要求' }).waitFor();
  await page.getByRole('button', { name: '关闭工程底座', exact: true }).click();
  await page.getByRole('heading', { name: '工程底座 · BIM / CAD 转 GLB', exact: true }).waitFor({ state: 'hidden' });
  await open();
  await wizard().getByRole('button', { name: /工程底座.*IFC/s }).click();
  await page.getByRole('region', { name: '创建前文件要求' }).waitFor();
  await page.getByRole('button', { name: '返回功能中心', exact: true }).click();
  assert.equal(await page.locator('.capture-workspace').count(), 0);
  assert.equal(audit.requests.filter(request => request.path.includes('/site-captures')).length, 0);
  await close();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await mark('only image and engineering entries are visible; capture workspace is not mounted or requested; dark/light 1440px, 1366px and 360px layouts fit; both desktop actions appear without scrolling');

  capabilityNetworkFailures = 1;
  await open();
  await wizard().getByRole('alert').filter({ hasText: /🔴 网络异常/ }).waitFor();
  assert.match(await wizard().getByRole('alert').innerText(), /重试次数：0/);
  await wizard().getByRole('button', { name: '重新检查背景服务', exact: true }).click();
  await wizard().getByRole('alert').waitFor({ state: 'hidden' });
  await wizard().getByRole('button', { name: /极速背景/ }).click();
  await wizard().getByText('当前服务尚未开放单图背景生成', { exact: true }).waitFor();
  assert.equal(await input().isEnabled(), false);
  await close();
  imageGeneration = true;
  await open(); await wizard().getByRole('button', { name: /极速背景/ }).click();
  await input().waitFor();
  await page.waitForFunction(() => !document.querySelector('.scene-background-wizard input[type="file"]')?.disabled);
  await input().setInputFiles(photo('background.png'));
  await wizard().getByRole('button', { name: '检查配置', exact: true }).click();
  assert.equal(await wizard().getByRole('radio', { name: '固定视角', exact: true }).isEnabled(), true);
  assert.equal(await wizard().getByRole('radio', { name: '小范围移动', exact: true }).isEnabled(), false);
  assert.equal(await wizard().getByRole('radio', { name: '自由漫游', exact: true }).isEnabled(), false);
  await close();
  await mark('generation capability false disables unavailable single-image upload; network failure exposes retry count and recovers manually; true capability permits only fixed-view image setup');

  assert.deepEqual(audit.pageErrors, []); assert.deepEqual(audit.reactErrors, []); assert.deepEqual(audit.fixtureErrors, []); assert.deepEqual(audit.unexpectedRequests, []);
  audit.status = 'passed'; audit.uploads = uploads; audit.resourceListReads = listReads; await persist();
  console.log('PASS scene background browser workflow (isolated API fixtures; no reconstruction service)');
} catch (error) {
  audit.status = 'failed'; audit.error = error.stack; audit.uploads = uploads; await persist();
  await page?.screenshot({ path: join(output, 'failure.png') }); throw error;
} finally {
  for (const gate of gates.values()) gate.release();
  await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true });
}
