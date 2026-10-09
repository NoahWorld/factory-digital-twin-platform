import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
// Use existing developer/CI tooling only. This test never downloads a browser or contacts a real API.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cacheDir = await mkdtemp(join(tmpdir(), 'twin-workspace-browser-cache-'));
const screenshotDir = process.env.TWIN_WORKSPACE_SCREENSHOT_DIR || await mkdtemp(join(tmpdir(), 'twin-workspace-browser-'));
await mkdir(screenshotDir, { recursive: true });

const projectId = 'workspace-browser-fixture';
const config = {
  version: 1, enabled: false, source: 'api',
  connection: { protocol: 'rest', url: '/api/v1/test-business/handling-cell/state', timestampPath: 'timestamp', intervalMs: 500, timeoutMs: 5000 },
  points: [{ id: 'point-lift', label: '升降高度', assetId: '', metricKey: 'height',
    sourcePath: 'agv.positionM', unit: 'm', min: 0, max: 10, initialValue: 0, maxSpeed: 1, staleAfterMs: 3000 }],
  bindings: [{ id: 'binding-lift', label: '升降台移动', pointId: 'point-lift',
    target: { instanceId: 'model-original', modelAssetId: 'builtin:fixture-original', nodeName: 'LiftArm' },
    parentBindingId: null, useNodeRestPose: true, kind: 'translation', axis: [0, 1, 0],
    pivot: [0, 0, 0], valueScale: 1, valueOffset: 0, poses: [] }],
  colliders: [{ id: 'collider-lift', label: '升降台边界',
    target: { instanceId: 'model-original', modelAssetId: 'builtin:fixture-original', nodeName: 'SafetyBody' },
    center: [0, 0, 0], size: [1, 1, 1] }],
  collisionRules: [], procedures: [],
};
const initialDocument = { projectId, revision: 1, editable: true, config };
const timestamp = '2026-09-21T00:00:00.000Z';
const instances = [
  ['model-original', '原升降模型', 'builtin:fixture-original'],
  ['model-replacement', '替换升降模型', 'builtin:fixture-replacement'],
].map(([id, label, modelAssetId], sortOrder) => ({ id, label, modelAssetId, sortOrder,
  assetId: 'lift-01', visible: true, renderMode: 'interactive',
  animation: { enabled: false, speed: 1 },
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
}));
const scene = { projectId, revision: 1, instances, linked2dProjectId: null, updatedAt: timestamp,
  settings: { animationSpeed: 1, autoRotate: false, backgroundColor: '#ffffff', backgroundOpacity: 1,
    cameraFov: 45, cameraView: 'isometric', preventBottomView: true,
    environmentLightColor: '#ffffff', environmentLightIntensity: 1,
    keyLightColor: '#ffffff', keyLightIntensity: 1, modelScale: 1,
    playAnimations: false, rotationSpeed: 1, showGrid: true } };
const catalog = [
  ['model-original', 'builtin:fixture-original', 'LiftArm'],
  ['model-original', 'builtin:fixture-original', 'SafetyBody'],
  ['model-replacement', 'builtin:fixture-replacement', 'LiftArmV2'],
  ['model-replacement', 'builtin:fixture-replacement', 'SafetyBody'],
].map(([instanceId, modelAssetId, nodeName]) => ({ instanceId, modelAssetId, nodeName, unique: true, drivable: true }));

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TwinDriveEditor } from '/src/twin/TwinDriveEditor.tsx';
import { ThemeProvider } from '/src/theme/ThemeProvider.tsx';
import { NotificationProvider } from '/src/components/NotificationProvider.tsx';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
import '/src/twin/twin-drive.css';
const h = React.createElement;
const initialDocument = ${JSON.stringify(initialDocument)};
const scene = ${JSON.stringify(scene)};
const catalog = ${JSON.stringify(catalog)};
function App() {
  const [document, setDocument] = useState(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('legacy')) return { ...initialDocument, editable: !params.has('readonly') && !params.has('redacted'),
      config: params.has('redacted') ? { ...initialDocument.config, connection: { ...initialDocument.config.connection, url: '', redacted: true } } : initialDocument.config };
    const { connection, ...old } = initialDocument.config;
    return { ...initialDocument, config: { ...old, source: 'simulator', points: old.points.map(point => {
      const { sourcePath, ...legacyPoint } = point;
      return { ...legacyPoint, assetId: 'lift-01', topic: 'fixture/lift/height' };
    }) }, editable: true };
  });
  const [open, setOpen] = useState(true);
  const [testing, setTesting] = useState(false);
  window.fixtureDocument = document;
  window.fixtureTesting = testing;
  return h('main', { className: 'standalone-3d-editor' + (open ? ' is-configuring-twin' : '') },
    h('div', { 'data-testid': 'scene-marker', style: { position: 'absolute', inset: 0 },
      onClick: () => { window.fixtureSceneClicks = (window.fixtureSceneClicks || 0) + 1; } },
      h('button', { type: 'button', style: { position: 'absolute', left: '50%', top: '50%' } }, '底层场景操作')),
    open ? h(TwinDriveEditor, {
    document, scene, catalog, onSaved: setDocument,
    onClose: () => { window.fixtureClosed = true; setOpen(false); },
    onTestChange: setTesting,
    connectionTest: h('p', { 'data-testid': 'connection-test' }, '隔离测试：仅检查界面，不建立设备连接'),
  }) : h('p', { 'data-testid': 'closed' }, '配置工作区已关闭'));
}
document.documentElement.dataset.uiTheme = 'light';
createRoot(document.getElementById('root')).render(h(React.StrictMode, null,
  h(ThemeProvider, { initialState: { preference: 'light', systemTheme: 'light', storageIssue: null } }, h(NotificationProvider, null, h(App)))));
`;

const server = await createServer({
  configFile: false, cacheDir,
  root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
  server: { host: '127.0.0.1', port: Number(process.env.TWIN_WORKSPACE_TEST_PORT || 5203), strictPort: true, hmr: false },
  plugins: [{
    name: 'twin-workspace-browser-fixture',
    resolveId(id) { if (id === '/__twin-workspace-test-entry.js') return '\0twin-workspace-test-entry'; },
    load(id) { if (id === '\0twin-workspace-test-entry') return fixture; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/__twin-workspace-test') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="icon" href="data:,"><style>html,body,#root { margin:0; width:100%; height:100%; min-height:0; }</style>
          </head><body><div id="root"></div><script type="module" src="/__twin-workspace-test-entry.js"></script></body></html>`);
      });
    },
  }],
});

let browser;
let page;
let deadline;
const errors = [];
const requests = [];
const saves = [];
const unexpectedRequests = [];
const expectedSourceDiagnostics = [];
let malformedInspection = false;
let savedDocument = structuredClone(initialDocument);
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(7000);
  deadline = setTimeout(() => { console.error('Twin workspace browser regression exceeded 120 seconds'); void browser.close(); }, 120000);
  deadline.unref();
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser page error:', error.message); });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (malformedInspection && message.text().startsWith('[DTwin] 操作失败')) {
      expectedSourceDiagnostics.push(message.args()[1].jsonValue());
    } else { errors.push(message.text()); console.error('Browser console error:', message.text()); }
  });
  page.on('request', request => requests.push(request.url()));
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (!req.url().startsWith(origin)) {
      unexpectedRequests.push(req.url());
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === `/api/v1/projects/${projectId}/twin-drive/test-source` && req.method() === 'POST') {
      const input = req.postDataJSON();
      assert.deepEqual(input.connection, savedDocument.config.connection, 'Source inspection must use the current configured connection through the project gateway');
      if (malformedInspection) return json({ timestamp: new Date().toISOString(), fields: [{ path: 'robot.running', type: 'boolean', value: 'invalid-type' }] });
      return json({ timestamp: new Date().toISOString(), fields: [
        { path: 'agv.positionM', type: 'number', value: 2.5 },
        { path: 'robot.angleDeg', type: 'number', value: -30 },
        { path: 'robot.running', type: 'boolean', value: true },
        { path: 'cycle.phase', type: 'string', value: 'loading' },
      ] });
    }
    if (url.pathname === `/api/v1/projects/${projectId}/twin-drive`) {
      if (req.method() === 'GET') return json(savedDocument);
      if (req.method() === 'PUT') {
        const input = req.postDataJSON();
        saves.push(input);
        assert.equal(input.expectedRevision, savedDocument.revision, 'The editor must save against its current revision');
        savedDocument = { ...savedDocument, revision: savedDocument.revision + 1, config: input.config };
        return json(savedDocument);
      }
    }
    unexpectedRequests.push(`${req.method()} ${url.pathname}`);
    return route.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: 'unexpected_fixture_request', message: 'Unexpected request in isolated browser fixture.' }) });
  });

  const steps = [/连接接口/, /绑定动作/, /检查效果/];
  const step = index => page.locator('nav').getByRole('button', { name: steps[index] });
  const save = () => page.locator('footer').getByRole('button', { name: /^保存/ });
  const returnButton = () => page.getByRole('button', { name: /返回模型|返回场景/ });
  const setTheme = async theme => {
    if (await page.locator('html').getAttribute('data-ui-theme') !== theme)
      await page.getByRole('button', { name: new RegExp(`切换到${theme === 'light' ? '浅色' : '深色'}模式`) }).click();
    assert.equal(await page.locator('html').getAttribute('data-ui-theme'), theme);
  };
  const choose = async (name, option) => {
    await page.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('listbox').getByRole('option', { name: option }).click();
  };
  const assertInsideViewport = async (locator, label) => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box && box.width > 0 && box.height > 0, `${label} must be visible`);
    assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
      `${label} must stay inside the viewport: ${JSON.stringify({ box, viewport })}`);
  };
  const assertNoHorizontalOverflow = async () => {
    const overflowing = await page.evaluate(() => {
      const elements = [document.documentElement, document.body, document.getElementById('root'),
        ...document.querySelectorAll('.twin-workspace, .twin-editor-body, .twin-workspace-content, footer')].filter(Boolean);
      return elements.filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ tag: el.tagName, className: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    });
    assert.deepEqual(overflowing, [], 'The configuration workspace must not overflow horizontally');
  };
  const openFixture = async (readonly = false, legacy = false, redacted = false) => {
    savedDocument = structuredClone(initialDocument);
    await page.goto(`${origin}__twin-workspace-test${legacy ? '?legacy' : redacted ? '?redacted' : readonly ? '?readonly' : ''}`);
    await step(0).waitFor();
    assert.equal(await page.locator('dialog').count(), 0, 'The configuration workspace must not be a dialog');
    assert.equal(await page.getByTestId('scene-marker').count(), 1, 'The underlying scene stays mounted');
    assert.equal(await page.getByTestId('scene-marker').isVisible(), false, 'The underlying scene must be hidden');
    assert.equal(await page.getByTestId('scene-marker').evaluate(el => getComputedStyle(el).pointerEvents), 'none',
      'The underlying scene cannot receive pointer events');
    await page.evaluate(() => { window.fixtureSceneNode = document.querySelector('[data-testid="scene-marker"]'); });
    await page.getByRole('heading', { name: '数据与模型配置', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureSceneClicks || 0), 0, 'Workspace clicks must not reach the scene');
  };

  await openFixture();
  assert.equal(await page.getByRole('button', { name: '填写 REST 示例', exact: true }).isDisabled(), false);
  assert.equal(await page.getByRole('button', { name: '填写 WebSocket 示例', exact: true }).isDisabled(), false);
  assert.equal(await page.getByText('平台模拟数据', { exact: true }).count(), 0);
  assert.equal(await page.locator('nav').getByRole('button', { name: '模拟流程', exact: true }).count(), 0);
  await page.getByRole('button', { name: '检查接口并读取字段', exact: true }).click();
  await page.getByText(/已读取接口/).waitFor();
  await step(1).click();
  await choose('数据字段', /robot.running/);
  assert.equal(await page.getByRole('textbox', { name: '手动数据字段', exact: true, includeHidden: true }).inputValue(), 'robot.running');
  await page.getByText(/这个字段是开关值：false = 0，true = 1/).waitFor();
  await choose('数据字段', /robot.angleDeg/);
  await page.getByRole('alert').filter({ hasText: /已读取当前值 -30 超出数据范围 0～10/ }).waitFor();
  assert.equal(await page.getByLabel('最小值', { exact: true }).inputValue(), '0', 'Selecting an out-of-range field must not implicitly change the configured minimum');
  assert.equal(await page.getByLabel('最大值', { exact: true }).inputValue(), '10', 'Selecting an out-of-range field must not implicitly change the configured maximum');
  assert.equal(saves.length, 0, 'Choosing a field cannot write the saved configuration');
  await choose('数据字段', /agv.positionM/);
  assert.equal(await page.getByRole('alert').filter({ hasText: /已读取当前值/ }).count(), 0, 'A field inside the configured range must not retain an obsolete warning');
  assert.equal(await page.getByLabel('模拟初始值', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('所属设备', { exact: true }).count(), 0);
  console.log('Twin workspace: real source inspection uses the project gateway and supplies numeric/boolean motion fields');
  await step(0).click();
  malformedInspection = true;
  await page.getByRole('button', { name: '检查接口并读取字段', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '接口检查返回了无效字段' }).waitFor();
  await step(1).click();
  assert.equal(await page.getByRole('combobox', { name: '数据字段', exact: true }).count(), 0, 'A failed fresh inspection must clear the old field choices');
  assert.equal(await page.getByRole('textbox', { name: '数据字段', exact: true }).inputValue(), 'agv.positionM', 'A failed inspection must retain the configured field without changing the document');
  assert.equal(saves.length, 0, 'Source inspection cannot write the saved configuration');
  assert.equal(expectedSourceDiagnostics.length, 1, 'The failed inspection must produce one deduplicated diagnostic');
  const [sourceDiagnostic] = await Promise.all(expectedSourceDiagnostics);
  assert.equal(sourceDiagnostic.name, 'UserFacingError');
  assert.equal(sourceDiagnostic.operation, 'inspect_twin_source');
  assert.equal(sourceDiagnostic.projectId, projectId);
  assert.equal(sourceDiagnostic.message, undefined, 'Diagnostic output cannot include arbitrary response contents');
  malformedInspection = false;
  await step(0).click();
  await page.getByRole('button', { name: '检查接口并读取字段', exact: true }).click();
  await page.getByText(/已读取接口/).waitFor();
  await step(1).click();
  assert.equal(await page.getByRole('combobox', { name: '数据字段', exact: true }).count(), 1, 'A successful retry must restore actual source fields');
  console.log('Twin workspace: failed inspection clears stale fields, preserves the saved configuration, and records project/operation diagnostics');
  const themeColors = [];
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      for (let index = 0; index < steps.length; index++) {
        await step(index).click();
        assert.equal(await step(index).evaluate(el => getComputedStyle(el).display), 'flex',
          'Step navigation must receive its workspace styling rather than browser-default button styling');
        const numberBounds = await step(index).locator('.twin-step-number').boundingBox();
        const labelBounds = await step(index).locator(':scope > span:not(.twin-step-number)').boundingBox();
        const numberSize = viewport.width <= 760 ? 22 : 28;
        assert.ok(numberBounds && Math.abs(numberBounds.width - numberSize) <= 1 && Math.abs(numberBounds.height - numberSize) <= 1,
          `The step number must be a ${numberSize}px circle, not an unstyled ellipse`);
        assert.ok(labelBounds && labelBounds.x >= numberBounds.x + numberBounds.width - 1,
          'The step number and label must stay side by side');
        await assertInsideViewport(save(), `Save button at ${viewport.width} × ${viewport.height}, ${theme}, step ${index + 1}`);
        await assertNoHorizontalOverflow();
        if (index === 0 || index === 2) await page.screenshot({ path: join(screenshotDir, `${viewport.width}x${viewport.height}-${theme}-step-${index + 1}.png`) });
      }
      if (viewport.width === 1366) themeColors.push(await page.locator('footer').evaluate(el => getComputedStyle(el).backgroundColor));
    }
    console.log(`Twin workspace: ${viewport.width} × ${viewport.height}, light/dark, all three steps and fixed save controls passed`);
  }
  assert.notEqual(themeColors[0], themeColors[1], 'The footer must respond to light/dark theme changes');

  await page.setViewportSize({ width: 1366, height: 768 });
  await setTheme('light');
  await step(1).click();
  const pointName = () => page.getByLabel(/^数据名称$/);
  const openDataSettings = async () => {
    const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '数据范围与高级设置' }) });
    if (!(await details.evaluate(el => el.open))) await details.locator('summary').click();
  };
  await openDataSettings();
  await pointName().fill('修改后的升降高度');
  await step(0).click();
  await step(1).click();
  await openDataSettings();
  assert.equal(await pointName().inputValue(), '修改后的升降高度', 'Switching steps must preserve point edits');
  await save().click();
  await page.waitForFunction(() => window.fixtureDocument?.revision === 2);
  assert.equal(saves.at(-1).config.points[0].label, '修改后的升降高度');
  assert.equal(saves.at(-1).config.source, 'api');
  assert.equal(saves.at(-1).config.points[0].sourcePath, 'agv.positionM');
  assert.equal(saves.at(-1).config.bindings[0].target.nodeName, 'LiftArm');
  assert.equal(saves.at(-1).expectedRevision, 1);

  await openDataSettings();
  const minimum = page.getByLabel(/^最小值$/);
  await minimum.fill('');
  assert.equal(await save().isDisabled(), true, 'Empty numeric input must block saving, not become zero');
  assert.equal(await minimum.inputValue(), '', 'An empty numeric draft must remain visibly empty');
  const savesBeforeInvalid = saves.length;
  await save().click({ force: true });
  assert.equal(saves.length, savesBeforeInvalid, 'Invalid drafts must not issue a PUT');
  for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertInsideViewport(save(), 'Save control with validation errors');
    await assertNoHorizontalOverflow();
    await page.screenshot({ path: join(screenshotDir, `${viewport.width}x${viewport.height}-invalid-number.png`) });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await minimum.fill('0');
  assert.equal(await save().isDisabled(), false);

  await pointName().fill('尚未保存的名称');
  await returnButton().click();
  assert.equal(await page.getByTestId('closed').count(), 0, 'Returning with edits must not close immediately');
  await page.getByText(/未保存/).first().waitFor();
  await assertInsideViewport(save(), 'Save control while confirming unsaved return');
  for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertInsideViewport(save(), 'Save control while confirming unsaved return on small screens');
    await assertInsideViewport(page.getByRole('button', { name: /继续编辑/ }), 'Continue editing confirmation');
    await assertInsideViewport(page.getByRole('button', { name: /放弃修改并返回/ }), 'Discard changes confirmation');
    await assertNoHorizontalOverflow();
    await page.screenshot({ path: join(screenshotDir, `${viewport.width}x${viewport.height}-unsaved-return.png`) });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: /继续编辑/ }).click();
  assert.equal(await pointName().inputValue(), '尚未保存的名称', 'Canceling return must preserve the draft');
  console.log('Twin workspace: step changes preserve drafts, PUT payload/revision, empty numbers and unsaved return passed');

  await page.locator('nav').getByRole('button', { name: /更换模型/ }).click();
  await choose('原模型', /原升降模型/);
  await choose('新模型', '替换升降模型');
  const applyRemap = page.getByRole('button', { name: '应用到草稿', exact: true });
  assert.equal(await applyRemap.isDisabled(), true, 'Missing renamed nodes must prevent an incomplete remap');
  assert.match(await page.getByRole('combobox', { name: '升降台边界对应的新部件', exact: true }).textContent(), /SafetyBody/,
    'Unique same-name collision nodes should be suggested');
  await choose('升降台移动对应的新部件', 'LiftArmV2');
  assert.equal(await applyRemap.isDisabled(), false);
  await page.screenshot({ path: join(screenshotDir, '1366x768-light-model-remap.png') });
  await applyRemap.click();
  await page.getByText(/已将 2 项绑定应用到草稿/).waitFor();
  await save().click();
  await page.waitForFunction(() => window.fixtureDocument?.revision === 3);
  assert.deepEqual(saves.at(-1).config.bindings[0].target,
    { instanceId: 'model-replacement', modelAssetId: 'builtin:fixture-replacement', nodeName: 'LiftArmV2' });
  assert.deepEqual(saves.at(-1).config.colliders[0].target,
    { instanceId: 'model-replacement', modelAssetId: 'builtin:fixture-replacement', nodeName: 'SafetyBody' });
  assert.equal(saves.at(-1).config.points[0].id, 'point-lift', 'Rebinding must retain the point identity');
  assert.equal(saves.at(-1).config.points[0].label, '尚未保存的名称', 'Rebinding must retain other unsaved edits');
  assert.equal(saves.at(-1).config.bindings[0].valueScale, 1, 'Rebinding must retain motion parameters');
  assert.equal(saves.at(-1).expectedRevision, 2);
  console.log('Twin workspace: real UI model remap requires missing node selection and preserves data/motion configuration');

  await step(1).click();
  await choose('选择模型', '替换升降模型');
  assert.match(await page.getByRole('combobox', { name: '选择模型部件', exact: true }).textContent(), /LiftArmV2/,
    'Selecting the current model again must not clear its selected part');
  await choose('部件如何变化', '沿方向移动');
  assert.match(await page.getByRole('combobox', { name: '选择模型部件', exact: true }).textContent(), /LiftArmV2/);
  await choose('部件如何变化', '在多个姿态间变化');
  const poseX = page.getByRole('spinbutton', { name: '位置（米） X', exact: true });
  await poseX.fill('2.5');
  await choose('部件如何变化', '在多个姿态间变化');
  assert.equal(await poseX.inputValue(), '2.5', 'Reselecting the current motion type must preserve edited poses');
  await choose('部件如何变化', '沿方向移动');
  await page.getByRole('button', { name: '保留当前姿态', exact: true }).click();
  assert.equal(await poseX.inputValue(), '2.5', 'Canceling a motion change must retain all pose edits');
  await choose('部件如何变化', '沿方向移动');
  await page.getByRole('button', { name: '清除姿态并切换', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '关键姿态', exact: true }).count(), 0);
  await save().click();
  await page.waitForFunction(() => window.fixtureDocument?.revision === 4);
  assert.equal(saves.at(-1).config.bindings[0].kind, 'translation');
  assert.deepEqual(saves.at(-1).config.bindings[0].poses, []);
  assert.equal(saves.at(-1).config.bindings[0].target.nodeName, 'LiftArmV2');
  console.log('Twin workspace: same model/motion selection retains configuration; clearing poses requires explicit confirmation');

  const advanced = () => page.locator('nav').getByRole('button', { name: '高级配置', exact: true });
  await advanced().click();
  const jsonEditor = page.getByRole('textbox', { name: '完整配置 JSON', exact: true });
  const appliedJson = await jsonEditor.inputValue();
  const jsonConfig = JSON.parse(appliedJson);
  jsonConfig.points[0].label = 'JSON中尚未应用的数据名称';
  const unappliedJson = JSON.stringify(jsonConfig, null, 2);
  await jsonEditor.fill(unappliedJson);
  await step(0).click();
  assert.equal(await save().isDisabled(), true, 'Unapplied JSON must block saving from every step');
  await advanced().click();
  assert.equal(await jsonEditor.inputValue(), unappliedJson, 'JSON drafts must survive switching steps');
  await returnButton().click();
  assert.equal(await page.getByTestId('closed').count(), 0, 'Unapplied JSON must trigger the unsaved-return confirmation');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await jsonEditor.inputValue(), unappliedJson);
  await page.getByRole('button', { name: '放弃 JSON 修改并载入表单', exact: true }).click();
  assert.equal(await jsonEditor.inputValue(), appliedJson, 'Discarding JSON changes must restore the current form');
  console.log('Twin workspace: unapplied JSON persists across steps and blocks both saving and unconfirmed exit');

  await step(0).click();
  await page.getByRole('button', { name: '填写 WebSocket 示例', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '接口地址', exact: true }).inputValue(), '/api/v1/test-business/handling-cell/live');
  await step(1).click();
  assert.equal(await page.getByRole('combobox', { name: '数据字段', exact: true }).count(), 0, 'Changing the connection must clear previously inspected fields');
  assert.equal(await page.getByRole('textbox', { name: '数据字段', exact: true }).inputValue(), 'agv.positionM');
  await step(0).click();
  await page.locator('summary').filter({ hasText: '连接高级设置' }).click();
  await page.getByRole('textbox', { name: '订阅消息（可选 JSON）', exact: true }).fill('{"subscribe":"handling"}');
  await save().click();
  await page.waitForFunction(() => window.fixtureDocument?.revision === 5);
  assert.equal(saves.at(-1).config.connection.protocol, 'websocket');
  assert.equal(saves.at(-1).config.connection.subscribeMessage, '{"subscribe":"handling"}');
  assert.deepEqual(saves.at(-1).config.procedures, []);
  console.log('Twin workspace: protocol examples and real WebSocket subscription settings save without platform procedures');

  await openFixture(true);
  assert.equal(await save().isDisabled(), true, 'Read-only users cannot save');
  assert.equal(await page.getByLabel(/启用数据驱动/).isDisabled(), true, 'Read-only users cannot enable motion');
  await step(1).click();
  await openDataSettings();
  assert.equal(await pointName().isDisabled(), true, 'Read-only users cannot edit point fields');
  await step(1).click();
  const enabledFormInputs = await page.locator('fieldset input, fieldset textarea, fieldset [role="combobox"]').evaluateAll(elements =>
    elements.filter(element => !element.matches(':disabled')).map(element => element.outerHTML));
  assert.deepEqual(enabledFormInputs, [], 'Read-only binding fields must remain disabled');
  await page.locator('nav').getByRole('button', { name: /更换模型/ }).click();
  assert.equal(await page.getByRole('combobox', { name: '原模型', exact: true }).isDisabled(), true,
    'Read-only users cannot remap model bindings');
  await returnButton().click();
  await page.getByTestId('closed').waitFor();
  assert.equal(await page.evaluate(() => window.fixtureClosed), true, 'A clean return must call onClose');
  assert.equal(await page.getByTestId('scene-marker').isVisible(), true, 'Returning must reveal the scene');
  assert.equal(await page.getByTestId('scene-marker').evaluate(el => window.fixtureSceneNode === el), true,
    'Returning must not remount the underlying scene');

  await openFixture(false, false, true);
  await page.getByText(/接口地址与订阅信息由数据网关保护/).waitFor();
  assert.equal(await page.getByRole('button', { name: '检查接口并读取字段', exact: true }).count(), 0, 'Projected source information cannot be inspected');
  assert.equal(await page.getByRole('button', { name: /填写 .* 示例/ }).count(), 0, 'Projected source information must not show editable examples');
  assert.equal(await page.getByRole('textbox', { name: '接口地址', exact: true }).count(), 0, 'The protected URL must not be exposed');
  assert.equal(await save().isDisabled(), true);
  await advanced().click();
  assert.equal(JSON.parse(await jsonEditor.inputValue()).connection.redacted, true);
  console.log('Twin workspace: redacted viewer projection protects source details and prevents edits or inspection');

  await openFixture();
  const savesBeforeEmptyForms = saves.length;
  for (const name of ['更换模型', '碰撞提示', '高级配置']) {
    await page.locator('nav').getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await assertInsideViewport(save(), `Save control in ${name}`);
  }
  await step(1).click();
  await page.getByRole('button', { name: /添加动作/ }).click();
  assert.equal(await page.getByRole('textbox', { name: '数据字段', exact: true }).inputValue(), '', 'A new action contains its own empty interface field');
  assert.equal(await page.getByRole('textbox', { name: '动作名称', exact: true }).inputValue(), '新部件动作');
  assert.match(await page.getByRole('combobox', { name: '选择模型', exact: true }).textContent(), /请选择模型/,
    'New bindings must render before a model has been selected');
  assert.equal(await save().isDisabled(), true, 'An incomplete binding cannot be saved');
  await page.locator('nav').getByRole('button', { name: '碰撞提示', exact: true }).click();
  await page.getByRole('button', { name: /添加碰撞部件/ }).click();
  assert.equal(await page.getByRole('textbox', { name: '碰撞部件名称', exact: true }).inputValue(), '新碰撞部件');
  assert.match(await page.getByRole('combobox', { name: '选择模型', exact: true }).textContent(), /请选择模型/,
    'New collision parts must render before a model has been selected');
  assert.equal(await save().isDisabled(), true, 'An incomplete collision part cannot be saved');
  assert.equal(saves.length, savesBeforeEmptyForms, 'Empty-form smoke tests must not issue a PUT');
  console.log('Twin workspace: all secondary pages and new action/collision forms render with empty selections');

  await openFixture(false, true);
  await page.getByRole('heading', { name: '旧版平台模拟配置已停用', exact: true }).waitFor();
  assert.equal(await save().isDisabled(), true, 'Legacy simulator configuration must not be saved or started');
  assert.equal(await page.evaluate(() => window.fixtureDocument.config.source), 'simulator', 'Legacy configuration must remain unchanged until explicit migration');
  const savesBeforeMigration = saves.length;
  await page.getByRole('button', { name: '重新接入接口', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '接口地址', exact: true }).inputValue(), '');
  await advanced().click();
  const migrated = JSON.parse(await jsonEditor.inputValue());
  assert.equal(migrated.source, 'api');
  assert.deepEqual(migrated.points, []);
  assert.deepEqual(migrated.bindings, []);
  assert.equal(saves.length, savesBeforeMigration, 'Migration must only create a draft and never write the scene or configuration automatically');
  await returnButton().click();
  await page.getByRole('button', { name: '放弃修改并返回', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureDocument.config.source), 'simulator', 'Discarding migration must retain the old persisted configuration');
  console.log('Twin workspace: legacy migration is explicit, draft-only, and can be discarded');

  assert.deepEqual(errors, [], 'Browser errors must be reported and fail the regression');
  assert.deepEqual(unexpectedRequests, [], 'No real or unexpected API request is permitted');
  assert.ok(requests.every(url => url.startsWith(origin)), 'All browser requests must remain on the isolated fixture server');
  console.log(`Twin workspace browser regression passed. Screenshots: ${screenshotDir}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(screenshotDir, 'failure.png') });
  console.error(`Twin workspace regression failed. Screenshots: ${screenshotDir}`);
  console.error('Browser errors:', errors);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
