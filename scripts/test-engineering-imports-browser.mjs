import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const parent = process.env.ENGINEERING_TEST_OUTPUT_DIR ? resolve(process.env.ENGINEERING_TEST_OUTPUT_DIR) : tmpdir();
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'engineering-imports-browser-'));
await chmod(output, 0o700);
const cacheDir = await mkdtemp(join(tmpdir(), 'engineering-imports-cache-'));
const audit = { status: 'running', scope: 'isolated in-memory API; actual ResourcesPage, engineering wizard, shared request and GLB preview; converter verified separately', checks: [], pageErrors: [], unexpectedRequests: [] };
const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
const mark = async name => { audit.checks.push(name); console.log('PASS ' + name); await persist(); };
const id = 'engineering-fixture';
const project = { id, name: '工程导入验收', projectRole: 'owner' };
const jobs = [];
const writes = [];
const uploads = [];
let networkFailures = 0, capabilityFailures = 0, failPermission = false, completed = false, modelListReads = 0;
let capabilityMode = 'missing', taskReads = 0, missingTask = false;
let releaseUpload, receivedUpload;
const uploadReceived = new Promise(resolve => { receivedUpload = resolve; });
const privateMessage = 'PRIVATE_CONVERTER_TRACE_MUST_NOT_RENDER';
const root = `/api/v1/projects/${id}`;
// Only a renderer fixture: these bytes are never presented as converter verification.
const positions = new Float32Array([-1,0,0,1,0,0,0,2,0]);
const bin = Buffer.from(positions.buffer);
let gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'fixture_triangle', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteLength: bin.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1,0,0], max: [1,2,0] }] };
const raw = Buffer.from(JSON.stringify(gltf));
const json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
let glb = Buffer.alloc(28 + json.length + bin.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(glb, 28 + json.length);
if (process.env.ENGINEERING_TEST_GLB_PATH) {
  glb = await readFile(resolve(process.env.ENGINEERING_TEST_GLB_PATH));
  assert.equal(glb.readUInt32LE(0), 0x46546c67); assert.equal(glb.readUInt32LE(4), 2); assert.equal(glb.readUInt32LE(8), glb.length);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  audit.rendererModel = { source: 'supplied GLB; task API remains isolated in-memory fixture', path: resolve(process.env.ENGINEERING_TEST_GLB_PATH), byteSize: glb.length };
} else audit.rendererModel = { source: 'minimal triangle renderer fixture; not a conversion result', byteSize: glb.length };
const nodeNames = (gltf.nodes ?? []).map(node => node.name).filter(Boolean);
const asset = { id: 'converted-model', projectId: id, originalFilename: '工程验收.glb', format: 'glb', contentType: 'model/gltf-binary', byteSize: glb.length, sha256: 'fixture', source: 'upload', sourceImageAssetId: null, generation: null, sourceModelAssetId: null, compression: null, usage: { references: [], count: 0 }, createdAt: new Date().toISOString(), inspection: { format: 'glb', gltfVersion: '2.0', sceneCount: gltf.scenes?.length ?? 0, nodeCount: gltf.nodes?.length ?? 0, meshCount: gltf.meshes?.length ?? 0, materialCount: gltf.materials?.length ?? 0, textureCount: gltf.textures?.length ?? 0, imageCount: gltf.images?.length ?? 0, animationCount: gltf.animations?.length ?? 0, namedNodeCount: nodeNames.length, duplicateNodeNames: [...new Set(nodeNames.filter((name, index) => nodeNames.indexOf(name) !== index))], externalResourceCount: 0 } };
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
const respond = (res, body, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const server = await createServer({ configFile: false, cacheDir,
  root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(process.env.ENGINEERING_TEST_PORT || 5301), strictPort: true },
  plugins: [{ name: 'engineering-imports-browser-fixture',
    resolveId(value) { if (value === '/__engineering-entry.js') return '\0engineering-entry'; },
    load(value) { if (value === '\0engineering-entry') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url, 'http://fixture.invalid').pathname;
      if (path === '/__engineering') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/__engineering-entry.js"></script></html>'); return; }
      if (!path.startsWith('/api/')) return next();
      if (path === '/api/v1/capabilities') return respond(res, { sceneBackgroundGeneration: false });
      if (path === '/api/v1/engineering-imports/capabilities') {
        if (capabilityMode === 'missing') return respond(res, { error: 'not_found', message: privateMessage }, 404);
        if (capabilityMode === 'forbidden') return respond(res, { error: 'forbidden', message: privateMessage }, 403);
        return respond(res, { available: capabilityMode === 'ready', reason: capabilityMode === 'unavailable' ? 'engineering_not_configured' : null, formats: ['ifc','dxf'], maxSourceBytes: 104857600, maxOutputBytes: 26214400 });
      }
      if (path === root + '/model-assets') { modelListReads++; return respond(res, { modelAssets: completed ? [asset] : [] }); }
      if (path === root + '/image-assets') return respond(res, { imageAssets: [] });
      if (path === root + '/media-assets') return respond(res, { mediaAssets: [] });
      if (path === root + '/model-assets/converted-model/content') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(glb); return; }
      if (path === root + '/engineering-imports' && req.method === 'GET') {
        taskReads++;
        if (capabilityMode === 'missing' || missingTask) return respond(res, { error: 'engineering_import_not_found', message: privateMessage }, 404);
        if (failPermission) return respond(res, { error: 'forbidden', message: privateMessage }, 403);
        return respond(res, { imports: jobs });
      }
      if (path === root + '/engineering-imports' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        uploads.push({ contentType: req.headers['content-type'], body });
        const ifc = body.includes('filename="building.ifc"');
        const createdAt = new Date().toISOString();
        const job = { id: `job-${jobs.length + 1}`, projectId: id, name: ifc ? 'IFC验收' : 'CAD验收', fileName: ifc ? 'building.ifc' : 'layout.dxf', format: ifc ? 'ifc' : 'dxf', status: 'inspecting', stage: 'reading', message: privateMessage, progress: 5, createdAt, updatedAt: createdAt };
        jobs.unshift(job);
        if (jobs.length === 1) { await new Promise(resolve => { releaseUpload = resolve; receivedUpload(); }); }
        return respond(res, { import: job }, 202);
      }
      if (path.endsWith('/convert') && req.method === 'POST') {
        const job = jobs.find(job => path === root + '/engineering-imports/' + job.id + '/convert');
        assert.ok(job);
        let body = ''; for await (const chunk of req) body += chunk;
        const options = JSON.parse(body); writes.push({ id: job.id, options });
        Object.assign(job, { options, status: 'converting', stage: 'geometry', error: null, updatedAt: new Date().toISOString() });
        return respond(res, { import: job }, 202);
      }
      audit.unexpectedRequests.push(req.method + ' ' + path); return respond(res, { error: 'unexpected_fixture_request' }, 404);
    }); },
  }],
});
let browser, page;
console.log('OUTPUT ' + output);
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) { audit.unexpectedRequests.push(route.request().url()); await route.abort('blockedbyclient'); }
    else if (new URL(route.request().url()).pathname === '/api/v1/engineering-imports/capabilities' && capabilityFailures > 0) { capabilityFailures--; await route.abort('internetdisconnected'); }
    else if (new URL(route.request().url()).pathname === root + '/engineering-imports' && route.request().method() === 'GET' && networkFailures > 0) { networkFailures--; await route.abort('internetdisconnected'); }
    else await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => audit.pageErrors.push(error.message));
  const open = async () => { await page.getByRole('button', { name: /^AI 场景底座/ }).click(); await page.getByRole('button', { name: /工程底座.*IFC/s }).click(); await page.getByRole('heading', { name: '工程底座 · BIM / CAD 转 GLB' }).waitFor(); };
  const choose = async (label, option) => { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
  const convertButton = () => page.getByRole('button', { name: '开始生成 GLB', exact: true });
  const requirementsCheck = () => page.getByRole('checkbox', { name: /我已了解上述要求/ });
  const confirmCheck = () => page.getByRole('checkbox', { name: /已确认单位、图层和生成参数/ });
  const task = name => page.getByRole('button', { name: new RegExp('^' + name) });
  const refreshTasks = async () => { await page.getByRole('button', { name: '关闭工程底座' }).click(); await open(); };
  const uploadButton = () => page.getByRole('button', { name: '上传并检查文件', exact: true });
  await page.goto(base + '__engineering'); await open();
  assert.ok(await page.getByRole('region', { name: '创建前文件要求' }).isVisible());
  assert.match(await page.locator('.engineering-import-requirements').innerText(), /DWG 请先导出 DXF/);
  assert.equal(await page.getByRole('link', { name: '下载 CAD 规范示例' }).getAttribute('href'), '/samples/engineering-layout.dxf');
  await page.getByText('工程转换接口尚未启用', { exact: true }).waitFor();
  assert.ok(await page.getByText('当前后端未提供工程转换接口，请更新后端服务后重新检查。', { exact: true }).isVisible());
  assert.equal(await page.locator('.engineering-import-wizard [role="alert"]').count(), 1);
  assert.equal(await page.locator('.engineering-import-wizard .engineering-import-notice').count(), 1);
  assert.equal(await page.getByText('任务状态读取失败', { exact: true }).count(), 0);
  assert.equal((await page.locator('.engineering-import-wizard').innerText()).includes('内容不存在'), false);
  assert.equal((await page.locator('body').innerText()).includes(privateMessage), false);
  assert.equal(await uploadButton().isEnabled(), false);
  await page.waitForTimeout(3200); // Beyond one poll interval: capability 404 must never start dependent requests.
  assert.equal(taskReads, 0);
  await page.evaluate(() => { document.documentElement.dataset.uiTheme = 'light'; });
  await page.screenshot({ path: join(output, 'legacy-backend-desktop.png') });
  await page.setViewportSize({ width: 360, height: 780 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, 'legacy-backend-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mark('legacy capability 404 shows one compact backend-update notice, retains upfront requirements and starts zero task requests');
  capabilityMode = 'unavailable';
  const previousTaskTime = new Date().toISOString();
  jobs.push({ id: 'existing-service-task', projectId: id, name: '已有工程任务', fileName: 'existing.ifc', format: 'ifc', status: 'needs_configuration', stage: 'complete', progress: 100, createdAt: previousTaskTime, updatedAt: previousTaskTime, inspection: { schemaVersion: 1, format: 'ifc', units: 'm', layers: [], objectCount: 1, warnings: [] } });
  await page.getByRole('button', { name: '重新检查转换服务', exact: true }).click();
  await page.getByText('工程转换暂不可用', { exact: true }).waitFor();
  await task('已有工程任务').waitFor(); assert.ok(taskReads > 0);
  await page.getByLabel('选择 IFC 或 DXF').setInputFiles({ name: 'layout.dxf', mimeType: 'application/dxf', buffer: Buffer.from('fixture') });
  await requirementsCheck().check(); assert.equal(await uploadButton().isEnabled(), false);
  await task('已有工程任务').click(); await confirmCheck().check(); assert.equal(await convertButton().isEnabled(), false);
  assert.equal(await page.getByText('工程转换接口尚未启用', { exact: true }).count(), 0);
  assert.equal(uploads.length, 0); assert.equal(writes.length, 0);
  await mark('existing capability endpoint with unavailable converter still reads historical jobs while preventing uploads and conversion');
  capabilityMode = 'forbidden';
  const readsBeforeCapabilityFailure = taskReads;
  await page.getByRole('button', { name: '重新检查转换服务', exact: true }).click();
  await page.getByText('转换服务检查失败', { exact: true }).waitFor();
  assert.ok(await page.getByText('你没有操作权限，请联系管理员。', { exact: true }).isVisible());
  assert.equal(await page.getByText('工程转换接口尚未启用', { exact: true }).count(), 0);
  assert.equal(taskReads, readsBeforeCapabilityFailure);
  assert.equal((await page.locator('body').innerText()).includes(privateMessage), false);
  capabilityMode = 'ready'; jobs.length = 0;
  await page.getByRole('button', { name: '重新检查转换服务', exact: true }).click();
  await page.getByText('暂无任务。先阅读文件要求，再上传源文件。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '＋ 导入 BIM / CAD', exact: true }).click();
  await page.getByLabel('选择 IFC 或 DXF').setInputFiles([]);
  await mark('capability permissions remain a genuine visible error; successful recheck enables ordinary workflow');
  assert.equal(await uploadButton().isEnabled(), false);
  await page.getByLabel('选择 IFC 或 DXF').setInputFiles({ name: 'unsupported.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('fixture') });
  await requirementsCheck().check(); assert.equal(await uploadButton().isEnabled(), false); assert.equal(uploads.length, 0);
  await page.getByLabel('选择 IFC 或 DXF').setInputFiles({ name: 'layout.dxf', mimeType: 'application/dxf', buffer: Buffer.from('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n') });
  await page.getByLabel('模型名称', { exact: true }).fill('CAD验收');
  await uploadButton().click(); await uploadReceived;
  await page.getByRole('progressbar', { name: '源文件上传中' }).waitFor();
  await refreshTasks(); await page.getByRole('progressbar', { name: '源文件上传中' }).waitFor();
  releaseUpload(); await page.getByText('任务编号：job-1').waitFor();
  assert.match(uploads[0].contentType, /^multipart\/form-data; boundary=/); assert.match(uploads[0].body, /name="file"; filename="layout.dxf"/); assert.match(uploads[0].body, /name="name"/);
  assert.ok(await page.getByRole('progressbar').isVisible()); assert.match(await page.locator('.engineering-import-progress').innerText(), /任务已创建/);
  await mark('requirements precede creation; unsupported DWG blocked; browser creates multipart boundary; upload remains responsive and finishes after closing/reopening its panel');
  const cad = jobs[0];
  cad.inspection = { schemaVersion: 1, format: 'dxf', units: 'mm', objectCount: 3, warnings: ['cad_paperspace_excluded'], layers: [{ name: 'WALL', entityCount: 1, types: ['LWPOLYLINE'] }, { name: 'EQUIPMENT', entityCount: 1, types: ['CIRCLE'] }, { name: 'ANNOTATION', entityCount: 1, types: ['TEXT'] }] };
  cad.status = 'needs_configuration'; cad.stage = 'complete';
  await page.getByRole('heading', { name: '确认生成配置' }).waitFor();
  assert.match(await page.getByRole('combobox', { name: '图纸坐标单位', exact: true }).innerText(), /请选择单位/);
  assert.equal(await convertButton().isEnabled(), false); assert.equal(await confirmCheck().isEnabled(), false);
  await choose('图纸坐标单位', '毫米'); await choose('WALL 用途', '墙体');
  await page.getByLabel('WALL 高度或厚度（米）', { exact: true }).fill('3');
  await choose('EQUIPMENT 用途', '设备简化体'); await page.getByLabel('EQUIPMENT 高度或厚度（米）', { exact: true }).fill('2');
  assert.equal(await confirmCheck().isEnabled(), false);
  await choose('ANNOTATION 用途', '忽略此层');
  await page.getByLabel('WALL 高度或厚度（米）', { exact: true }).fill('0'); assert.equal(await confirmCheck().isEnabled(), false);
  await page.getByLabel('WALL 高度或厚度（米）', { exact: true }).fill('3');
  await page.getByLabel('WALL 基准标高（米）', { exact: true }).fill('10001'); assert.equal(await confirmCheck().isEnabled(), false);
  await page.getByLabel('WALL 基准标高（米）', { exact: true }).fill('0');
  await confirmCheck().check(); await convertButton().click(); await page.getByText('生成构件几何', { exact: true }).waitFor();
  assert.equal(writes.length, 1); assert.equal(writes[0].options.units, 'mm'); assert.deepEqual(writes[0].options.layers.map(row => row.role), ['wall','equipment','ignore']); assert.equal(writes[0].options.layers[2].height, 0);
  await refreshTasks(); await task('CAD验收').click(); await page.getByText('生成构件几何', { exact: true }).waitFor();
  await page.reload(); await open(); await task('CAD验收').click(); await page.getByText('生成构件几何', { exact: true }).waitFor(); assert.equal(writes.length, 1);
  await mark('explicit units, all-layer mapping, height/base limits and confirmation required; durable conversion resumes after close and reload without duplicate POST');
  networkFailures = 2;
  await page.getByText('🔴 网络异常／正在重连', { exact: true }).waitFor();
  await page.getByText('重试次数：1', { exact: true }).waitFor();
  await page.getByText('🔴 网络异常／正在重连', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
  await mark('network failures show reconnection state and retry count, then recover without losing active task');
  Object.assign(cad, { status: 'failed', error: { code: 'engineering_unsupported_entity', message: privateMessage, details: { issues: [{ code: 'engineering_unsupported_entity', layer: 'ANNOTATION', handle: 'AB12', entityType: 'TEXT', message: privateMessage }] } } });
  await page.getByText(/图元：AB12/).waitFor(); assert.equal((await page.locator('body').innerText()).includes(privateMessage), false);
  await page.getByRole('heading', { name: '确认生成配置' }).waitFor();
  assert.match(await page.getByRole('combobox', { name: '图纸坐标单位', exact: true }).innerText(), /毫米/);
  await page.setViewportSize({ width: 360, height: 780 });
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.uiTheme = theme; }, theme);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Small-screen document must not overflow horizontally');
    assert.ok(await page.evaluate(() => { const panel = document.querySelector('.engineering-import-wizard'); return panel.getBoundingClientRect().width <= innerWidth; }));
    assert.ok(await page.evaluate(() => { const footer = document.querySelector('.engineering-import-wizard .scene-background-footer'); return footer.getBoundingClientRect().bottom <= innerHeight; }), 'Close action stays within viewport');
    await page.waitForTimeout(200); // Finish the existing 160ms button color transition before visual evidence.
    await page.screenshot({ path: join(output, `mobile-${theme}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await confirmCheck().check(); await convertButton().click(); await page.getByText('生成构件几何', { exact: true }).waitFor(); assert.equal(writes.length, 2);
  await mark('structured failed-task diagnostics reveal layer and entity, hide raw converter messages, preserve options for retry, and fit 360px light/dark');
  const reads = modelListReads;
  completed = true; Object.assign(cad, { status: 'completed', stage: 'complete', resourceId: asset.id, error: null, result: { schemaVersion: 1, format: 'dxf', objectCount: 2, triangleCount: 24, warnings: ['cad_ignored_layers', 'cad_simplified_equipment', privateMessage] } });
  await page.getByText('GLB 已加入本项目资源库', { exact: true }).waitFor();
  assert.ok(await page.getByText('实际生成 2 个对象 · 24 个三角面', { exact: true }).isVisible());
  assert.match(await page.locator('.engineering-import-success').innerText(), /明确选择“忽略”的图层不生成模型/);
  assert.match(await page.locator('.engineering-import-success').innerText(), /设备按轮廓生成简化体/);
  assert.equal((await page.locator('body').innerText()).includes(privateMessage), false);
  await page.screenshot({ path: join(output, 'completed-summary.png') });
  await page.waitForFunction(() => document.querySelector('.resource-card'));
  assert.ok(modelListReads > reads);
  await page.getByRole('button', { name: '预览生成的模型', exact: true }).click();
  await page.locator('.resource-preview-dialog .model-3d-renderer canvas').waitFor();
  await page.locator('.resource-preview-dialog [data-cover-state="ready"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.resource-preview-dialog').getByRole('heading', { name: '工程验收.glb', exact: true }).count(), 1);
  await page.screenshot({ path: join(output, 'converted-model-preview.png') });
  await page.getByRole('button', { name: '关闭资源预览' }).click();
  await mark('completion displays actual geometry counts and reviewed conversion warnings, refreshes ordinary resource library and opens actual GLB model preview');
  await open(); await page.getByRole('button', { name: '＋ 导入 BIM / CAD', exact: true }).click();
  await page.getByLabel('选择 IFC 或 DXF').setInputFiles({ name: 'building.ifc', mimeType: 'application/octet-stream', buffer: Buffer.from('ISO-10303-21;fixture') });
  await requirementsCheck().check(); await uploadButton().click(); await page.getByText('任务编号：job-2').waitFor();
  const ifc = jobs[0]; Object.assign(ifc, { status: 'needs_configuration', stage: 'complete', inspection: { schemaVersion: 1, format: 'ifc', units: 'm', layers: [], objectCount: 5, warnings: ['ifc_openings_applied'] } });
  await page.getByRole('heading', { name: '确认生成配置' }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '图纸坐标单位', exact: true }).count(), 0);
  await confirmCheck().check(); await convertButton().click(); await page.getByText('生成构件几何', { exact: true }).waitFor();
  assert.deepEqual(writes.at(-1).options.layers, []); assert.equal(Object.hasOwn(writes.at(-1).options, 'units'), false);
  failPermission = true; await page.getByText('任务状态读取失败', { exact: true }).waitFor();
  assert.ok(await page.getByText('你没有操作权限，请联系管理员。', { exact: true }).isVisible()); assert.equal((await page.locator('body').innerText()).includes(privateMessage), false);
  failPermission = false; await page.getByRole('button', { name: '重新读取任务', exact: true }).click(); await page.getByText('任务状态读取失败', { exact: true }).waitFor({ state: 'hidden' });
  capabilityFailures = 1; await refreshTasks();
  await page.getByText('🔴 网络异常 · 重试次数：0（服务检查需手动重试）', { exact: true }).waitFor();
  const readsDuringCapabilityNetworkFailure = taskReads;
  await page.waitForTimeout(3200); // A failed capability recheck must not continue the old task polling loop.
  assert.equal(taskReads, readsDuringCapabilityNetworkFailure);
  await page.getByRole('button', { name: '重新检查转换服务', exact: true }).click();
  await page.getByText('🔴 网络异常 · 重试次数：0（服务检查需手动重试）', { exact: true }).waitFor({ state: 'hidden' });
  await mark('IFC confirms native units/geometry without CAD mappings; permission and capability network errors remain visible and can be retried explicitly');
  missingTask = true; await refreshTasks();
  await page.getByText('任务状态读取失败', { exact: true }).waitFor();
  assert.ok(await page.getByText('转换任务不存在，请重新读取任务列表。', { exact: true }).isVisible());
  assert.equal(await page.getByText('工程转换接口尚未启用', { exact: true }).count(), 0);
  assert.equal((await page.locator('body').innerText()).includes(privateMessage), false);
  missingTask = false; await page.getByRole('button', { name: '重新读取任务', exact: true }).click();
  await page.getByText('任务状态读取失败', { exact: true }).waitFor({ state: 'hidden' });
  await mark('task endpoint 404 after capability success remains a genuine missing-task error rather than being misclassified as unsupported backend');
  assert.deepEqual(audit.pageErrors, []); assert.deepEqual(audit.unexpectedRequests, []);
  audit.status = 'passed'; audit.uploads = uploads.length; audit.conversions = writes.length; await persist();
  console.log('PASS engineering imports browser workflow');
} catch (error) {
  audit.status = 'failed'; audit.error = error.stack; await persist(); await page?.screenshot({ path: join(output, 'failure.png') }); throw error;
} finally { await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
