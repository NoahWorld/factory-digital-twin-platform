// Real App, routes, authentication UI and landing page with isolated in-memory API fixtures.
// No business writes, live accounts, conversion workers or reconstruction services are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const output = await mkdtemp(join(tmpdir(), 'scene-foundation-entry-browser-'));
await chmod(output, 0o700);
const cacheDir = await mkdtemp(join(tmpdir(), 'scene-foundation-entry-cache-'));
const audit = { status: 'running', scope: 'Real App and public landing; isolated API fixtures; route/permission/layout regression, not conversion verification', checks: [], requests: [], writes: [], unexpectedRequests: [], fixtureErrors: [], pageErrors: [], reactErrors: [], layouts: [] };
const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
const mark = async name => { audit.checks.push(name); console.log('PASS ' + name); await persist(); };
let phase = 'startup';
let authenticated = false;
let completed = false;
let delayedPreview = null;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const now = '2026-10-14T00:00:00.000Z';
const project = (id, name, projectRole = 'owner') => ({ id, name, projectRole, projectType: '3d', status: 'draft', createdAt: now, updatedAt: now, coverStatus: 'ready', coverUrl: null, documentRevision: 0, coverRevision: 0, coverSourceRevision: 0 });
let projects = [project('foundation-first', '工程验收项目一'), project('foundation-second', '工程验收项目二')];
const user = { id: 'fixture-owner', email: 'fixture@example.invalid', loginName: 'fixture', displayName: '入口验收账号', roles: ['delivery_manager'], modules: ['2d', '3d'], capabilities: { canCreateProject: true, canManageUsers: false, canAccess2D: true, canAccess3D: true } };

// A renderer-only triangle verifies the completed-task preview route; it is not a converter result.
const bin = Buffer.from(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0]).buffer);
const raw = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'fixture_triangle', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteLength: bin.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 2, 0] }] }));
const json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
const glb = Buffer.alloc(28 + json.length + bin.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(glb, 28 + json.length);
const asset = id => ({ id: 'entry-preview-model', projectId: id, originalFilename: '入口预览验收.glb', format: 'glb', contentType: 'model/gltf-binary', byteSize: glb.length, sha256: 'fixture', source: 'upload', sourceImageAssetId: null, generation: null, sourceModelAssetId: null, compression: null, usage: { references: [], count: 0 }, createdAt: now, inspection: { format: 'glb', gltfVersion: '2.0', sceneCount: 1, nodeCount: 1, meshCount: 1, materialCount: 0, textureCount: 0, imageCount: 0, animationCount: 0, namedNodeCount: 1, duplicateNodeNames: [], externalResourceCount: 0 } });
const job = id => ({ id: 'entry-completed-job', projectId: id, name: '已完成任务入口验收', fileName: 'fixture.dxf', format: 'dxf', status: 'completed', stage: 'completed', resourceId: 'entry-preview-model', createdAt: now, updatedAt: now, inspection: null, error: null, result: { objectCount: 1, triangleCount: 1, warnings: [] } });
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '/src/App.tsx';
import {ThemeProvider} from '/src/theme/ThemeProvider.tsx';
import {NotificationProvider} from '/src/components/NotificationProvider.tsx';
import {initializeUiTheme} from '/src/theme/ui-theme.ts';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
 React.createElement(ThemeProvider, {initialState: initializeUiTheme()},
 React.createElement(NotificationProvider, null, React.createElement(App)))));
`;
const respond = (res, body, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const handle = async (req, res, next) => {
  const path = new URL(req.url, 'http://fixture.invalid').pathname;
  if (path === '/__foundation-entry') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/__foundation-entry.js"></script></html>'); return;
  }
  if (!path.startsWith('/api/')) return next();
  audit.requests.push({ phase, method: req.method, path });
  if (req.method !== 'GET') audit.writes.push({ phase, method: req.method, path });
  if (path === '/api/v1/auth/bootstrap-status' && req.method === 'GET') return respond(res, { setupRequired: false });
  if (path === '/api/v1/auth/me' && req.method === 'GET') return authenticated ? respond(res, { user }) : respond(res, { error: 'unauthenticated' }, 401);
  if (path === '/api/v1/auth/login' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    assert.equal(data.identifier, 'fixture'); assert.equal(data.password, 'Fixture-Only-2026!');
    authenticated = true; return respond(res, { user });
  }
  if (!authenticated) return respond(res, { error: 'unauthenticated' }, 401);
  if (path === '/api/v1/projects' && req.method === 'GET') return respond(res, { projects, nextOffset: null });
  if (path === '/api/v1/capabilities' && req.method === 'GET') return respond(res, { sceneBackgroundGeneration: false });
  if (path === '/api/v1/engineering-imports/capabilities' && req.method === 'GET') return respond(res, { available: true, reason: null, formats: ['ifc', 'dxf'], maxSourceBytes: 104857600, maxOutputBytes: 26214400 });
  const match = path.match(/^\/api\/v1\/projects\/([^/]+)\/(model-assets|image-assets|media-assets|engineering-imports)(\/entry-preview-model\/content)?$/);
  if (match && req.method === 'GET') {
    const [, id, kind, content] = match;
    if (!projects.some(item => item.id === id)) throw new Error('Fixture received unknown project: ' + id);
    if (content && kind === 'model-assets') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(glb); return; }
    if (kind === 'model-assets') {
      const gate = delayedPreview;
      if (gate && !gate.claimed) { gate.claimed = true; gate.arrived.resolve(); await gate.release.promise; }
      respond(res, { modelAssets: completed ? [asset(id)] : [] });
      if (gate?.claimed) gate.finished.resolve();
      return;
    }
    if (kind === 'image-assets') return respond(res, { imageAssets: [] });
    if (kind === 'media-assets') return respond(res, { mediaAssets: [] });
    if (kind === 'engineering-imports') return respond(res, { imports: completed ? [job(id)] : [] });
  }
  audit.unexpectedRequests.push({ phase, method: req.method, path });
  return respond(res, { error: 'unexpected_fixture_request' }, 500);
};
const server = await createServer({ configFile: false, cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)), define: { 'import.meta.env.VITE_API_BASE_URL': '""' }, server: { host: '127.0.0.1', port: Number(process.env.SCENE_FOUNDATION_ENTRY_TEST_PORT || 5326), strictPort: true, hmr: false }, plugins: [{ name: 'foundation-entry-fixture', resolveId(id) { if (id === '/__foundation-entry.js') return '\0foundation-entry-fixture'; }, load(id) { if (id === '\0foundation-entry-fixture') return fixture; }, configureServer(vite) { vite.middlewares.use((req, res, next) => void handle(req, res, next).catch(error => { audit.fixtureErrors.push(error.stack); respond(res, { error: 'fixture_error' }, 500); })); } }] });

let browser, page, deadline;
console.log('OUTPUT ' + output);
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const base = origin + '__foundation-entry';
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome' }) });
  deadline = setTimeout(() => { audit.deadline = 'Exceeded 180 second browser verification deadline'; console.error(audit.deadline); void browser.close(); }, 180000); deadline.unref();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== new URL(origin).origin) { audit.unexpectedRequests.push({ phase, external: route.request().url() }); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => audit.pageErrors.push({ phase, message: error.message }));
  page.on('console', message => { if (message.type() === 'error' && /Each child|same key|Encountered two children|React has detected/i.test(message.text())) audit.reactErrors.push({ phase, message: message.text() }); });
  const hub = () => page.locator('.scene-background-wizard.is-hub');
  const banner = () => page.locator('.scene-foundation-banner');
  const launcher = () => banner().getByRole('button', { name: /^AI 场景底座/ });
  const nav = () => page.locator('.scene-foundation-nav-link');
  const scope = () => page.locator('.resource-project-select').getByRole('combobox');
  const deepLink = '#/resources?tool=scene-foundation';
  const hashIs = async hash => { await page.waitForFunction(value => location.hash === value, hash); };
  const closeHub = async () => { await page.getByRole('button', { name: '关闭场景底座向导', exact: true }).click(); await hub().waitFor({ state: 'hidden' }); await hashIs('#/resources'); };
  const openHub = async () => { await launcher().click(); await hub().waitFor(); };
  const openEngineering = async () => { await hub().getByRole('button', { name: /工程底座.*IFC/s }).click(); await page.locator('.engineering-import-wizard').waitFor(); };
  const setTheme = async theme => { if (await page.locator('html').getAttribute('data-ui-theme') !== theme) await page.getByRole('button', { name: new RegExp(`^切换到${theme === 'light' ? '浅色' : '深色'}模式`) }).click(); await page.waitForFunction(value => document.documentElement.dataset.uiTheme === value, theme); };
  const layout = async (name, locator) => {
    const result = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, theme: document.documentElement.dataset.uiTheme }));
    audit.layouts.push({ name, ...result });
    assert.ok(result.width <= result.viewport + 1, `${name}: document width ${result.width} exceeds viewport ${result.viewport}`);
    if (locator) assert.ok(await locator.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= -1 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1; }), `${name}: target overflows horizontally`);
    await page.screenshot({ path: join(output, `${name}-${result.viewport}-${result.theme}.png`), animations: 'disabled' });
  };

  phase = 'anonymous-landing';
  await page.goto(base + '#/');
  await page.locator('.delivery-landing').waitFor();
  await page.locator('#industrial-foundation').waitFor();
  const landingNav = page.locator('.delivery-header').getByRole('button', { name: 'AI 场景底座', exact: true });
  assert.equal(await landingNav.count(), 1);
  const promotion = page.locator('#industrial-foundation');
  assert.match(await promotion.innerText(), /IFC/); assert.match(await promotion.innerText(), /DXF/); assert.match(await promotion.innerText(), /GLB/);
  const cadMode = promotion.getByRole('button', { name: /二维 CAD/ });
  const bimMode = promotion.getByRole('button', { name: /BIM 模型/ });
  assert.match(await promotion.innerText(), /DWG/);
  await bimMode.click(); assert.equal(await bimMode.getAttribute('aria-pressed'), 'true'); assert.match(await promotion.innerText(), /RVT/);
  await cadMode.click(); assert.equal(await cadMode.getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(await promotion.innerText(), /写实漫游|单图生成|极速背景/);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 360, height: 780 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      if (viewport.width > 800) await landingNav.click();
      else await page.getByRole('button', { name: /从工程文件到 3D/ }).click();
      await promotion.scrollIntoViewIfNeeded(); await layout('landing-foundation', promotion);
    }
  }
  assert.equal(audit.requests.length, 0, 'Public landing must make no API request, including auth probes');
  await mark('anonymous public landing promotes IFC/DXF→GLB, explains source formats, fits desktop/mobile themes and makes zero API requests');

  phase = 'landing-login';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await promotion.locator(`a[href="${deepLink}"]`).click();
  await page.getByRole('heading', { name: '登录', exact: true }).waitFor(); await hashIs(deepLink);
  await page.getByLabel('账号', { exact: true }).fill('fixture');
  await page.getByLabel('密码', { exact: true }).fill('Fixture-Only-2026!');
  await page.getByRole('button', { name: '登录平台', exact: true }).click();
  await hub().waitFor(); await hashIs(deepLink);
  assert.equal(await nav().getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.topbar-nav [aria-current="page"]').count(), 1, 'Exactly one navigation link is current');
  assert.equal(await hub().locator('.foundation-module').count(), 2);
  assert.doesNotMatch(await hub().innerText(), /写实漫游|GPU/);
  await closeHub();
  assert.equal(await page.locator('.resource-upload-actions').getByRole('button', { name: /^AI 场景底座/ }).count(), 0, 'Old upload-toolbar launcher is removed');
  await mark('promotion CTA preserves deep link through login; only released modules open; closing returns to resource route');

  phase = 'navigation-reopen';
  await page.locator('.topbar-nav').getByRole('link', { name: '项目', exact: true }).click();
  await page.locator('#projects').waitFor();
  await nav().click(); await hub().waitFor(); await hashIs(deepLink);
  await page.reload(); await hub().waitFor(); await hashIs(deepLink);
  await openEngineering();
  await page.getByRole('region', { name: '创建前文件要求' }).waitFor();
  await page.getByRole('button', { name: '返回功能中心', exact: true }).click(); await hub().waitFor(); await hashIs(deepLink);
  await openEngineering();
  await page.getByRole('button', { name: '关闭工程底座', exact: true }).click();
  await page.locator('.engineering-import-wizard').waitFor({ state: 'hidden' }); await hashIs('#/resources');
  await openHub(); await closeHub();
  await mark('global navigation and refresh open the center; engineering back retains intent, closing consumes it, and launcher reopens');

  phase = 'history';
  await nav().click(); await hub().waitFor();
  await page.goBack(); await hub().waitFor({ state: 'hidden' }); await hashIs('#/resources');
  await page.goForward(); await hub().waitFor(); await hashIs(deepLink); await closeHub();
  await mark('browser back closes the deep-linked center and forward reopens it');

  phase = 'project-selection';
  await scope().click(); await page.getByRole('option', { name: '工程验收项目二', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.resource-project-select [role="combobox"]')?.textContent?.includes('工程验收项目二'));
  await nav().click(); await hub().waitFor();
  assert.match(await hub().innerText(), /工程验收项目二/);
  await closeHub(); assert.match(await scope().innerText(), /工程验收项目二/);
  await mark('entering and closing the feature preserves the current resource project');

  phase = 'completed-preview';
  completed = true;
  await nav().click(); await hub().waitFor();
  await openEngineering();
  await page.getByRole('button', { name: /已完成任务入口验收/ }).click();
  await page.getByRole('button', { name: '预览生成的模型', exact: true }).click();
  await page.locator('.resource-preview-dialog').waitFor(); await hashIs('#/resources');
  await page.getByRole('button', { name: '关闭资源预览', exact: true }).click();
  await page.locator('.resource-preview-dialog').waitFor({ state: 'hidden' });
  assert.equal(await hub().count(), 0); assert.match(await scope().innerText(), /工程验收项目二/);
  await openHub(); await closeHub();
  await mark('completed-task preview consumes deep link and returns to the same resource project without reopening the center');

  phase = 'delayed-preview';
  await nav().click(); await hub().waitFor(); await openEngineering();
  await page.getByRole('button', { name: /已完成任务入口验收/ }).click();
  await page.waitForLoadState('networkidle');
  delayedPreview = { claimed: false, arrived: deferred(), release: deferred(), finished: deferred() };
  await page.getByRole('button', { name: '预览生成的模型', exact: true }).click();
  let gateTimeout;
  try {
    await Promise.race([delayedPreview.arrived.promise, new Promise((_, reject) => { gateTimeout = setTimeout(() => reject(new Error('Preview did not request model assets within 10 seconds')), 10000); })]);
  } finally { clearTimeout(gateTimeout); }
  await page.goBack(); await hashIs('#/resources');
  await page.locator('.engineering-import-wizard').waitFor({ state: 'hidden' });
  const projectNav = page.locator('.topbar-nav').getByRole('link', { name: '项目', exact: true });
  const projectRoute = await projectNav.getAttribute('href');
  await projectNav.click();
  await page.locator('#projects').waitFor(); await hashIs(projectRoute);
  delayedPreview.release.resolve(); await delayedPreview.finished.promise;
  await page.waitForLoadState('networkidle');
  await hashIs(projectRoute); assert.equal(await hub().count(), 0); assert.equal(await page.locator('.resource-preview-dialog').count(), 0);
  delayedPreview = null; completed = false;
  await mark('a delayed engineering preview cannot reopen the center or navigate away after browser back and project navigation');
  await page.locator('.topbar-nav').getByRole('link', { name: '资源库', exact: true }).click();
  await banner().waitFor();

  phase = 'layouts';
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 360, height: 780 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await setTheme(theme); await banner().scrollIntoViewIfNeeded(); await layout('resource-banner', banner());
      await openHub(); await layout('function-center', hub()); await closeHub();
    }
  }
  await mark('resource banner and function center fit 1440px/360px layouts in light and dark modes');

  await page.waitForLoadState('networkidle');
  phase = 'readonly';
  projects = [project('foundation-readonly', '只读项目', 'viewer'), project('foundation-editable', '可编辑项目')];
  // A distinct document URL loads the new fixture identity atomically. A hash-only goto
  // would first open the old editable project's center before the subsequent reload.
  await page.goto(base + '?fixture=readonly' + deepLink);
  await banner().waitFor(); await scope().waitFor();
  await page.waitForFunction(() => document.querySelector('.resource-project-select [role="combobox"]')?.textContent?.includes('只读项目'));
  assert.match(await scope().innerText(), /只读项目/); assert.equal(await launcher().isDisabled(), true);
  assert.match(await banner().innerText(), /只读|编辑权限/); assert.equal(await hub().count(), 0);
  assert.equal(audit.requests.filter(item => item.phase === phase && /engineering-imports|site-captures|\/capabilities$/.test(item.path)).length, 0, 'Readonly deep link must not initialize creation workflows or choose an editable project');
  await scope().click(); await page.getByRole('option', { name: '可编辑项目', exact: true }).click();
  await hub().waitFor(); assert.match(await scope().innerText(), /可编辑项目/); await closeHub();
  await mark('readonly project has a clear disabled entry; no silent project change or task requests; explicitly choosing editable project enables deep-link entry');

  await page.waitForLoadState('networkidle');
  phase = 'empty-projects';
  projects = [];
  await page.goto(base + '?fixture=empty-projects' + deepLink); await banner().waitFor();
  assert.equal(await launcher().isDisabled(), true); assert.match(await banner().innerText(), /创建|加入|项目/); assert.equal(await hub().count(), 0);
  assert.equal(audit.requests.filter(item => item.phase === phase && /engineering-imports|site-captures|\/capabilities$/.test(item.path)).length, 0);
  await layout('empty-project-banner', banner());
  await mark('no-project state retains visible feature introduction, disables creation and requests no conversion services');

  await page.waitForLoadState('networkidle');
  phase = 'module-denied';
  user.modules = [];
  await page.goto(base + '?fixture=module-denied' + deepLink);
  await page.getByRole('heading', { name: /没有.*访问权限/ }).waitFor();
  assert.equal(await nav().count(), 0); assert.equal(await banner().count(), 0); assert.equal(await hub().count(), 0);
  assert.equal(audit.requests.filter(item => item.phase === phase && /engineering-imports|site-captures|\/capabilities$/.test(item.path)).length, 0);
  await mark('accounts without module access cannot enter the feature through a deep link');

  assert.equal(audit.requests.filter(item => item.path.includes('/site-captures')).length, 0, 'Hidden photorealistic feature is never requested');
  assert.deepEqual(audit.writes.map(({ method, path }) => ({ method, path })), [{ method: 'POST', path: '/api/v1/auth/login' }], 'Only isolated login is submitted; no business mutations are permitted');
  assert.deepEqual(audit.unexpectedRequests, []); assert.deepEqual(audit.fixtureErrors, []); assert.deepEqual(audit.pageErrors, []); assert.deepEqual(audit.reactErrors, []);
  audit.status = 'passed'; await persist(); console.log('PASS scene foundation entry browser regression');
} catch (error) {
  audit.status = 'failed'; audit.phase = phase; audit.error = error.stack;
  if (page && !page.isClosed()) {
    audit.url = page.url(); audit.visibleText = (await page.locator('body').innerText()).slice(0, 6000);
    await page.screenshot({ path: join(output, 'failure.png') });
  }
  await persist(); console.error('FAILED phase:', phase); throw error;
} finally {
  clearTimeout(deadline); delayedPreview?.release.resolve(); await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true });
}
