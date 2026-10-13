import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, modelFixture, projectId, targetPickerFixtureEntry, wallFixture } from './twin-target-picker-fixture.mjs';

// Developer/CI supplies existing tooling; this regression never downloads it,
// starts a business connection, or saves real project data.
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cacheDir = await mkdtemp(join(tmpdir(), 'twin-target-picker-cache-'));
const screenshotDir = process.env.TWIN_TARGET_PICKER_SCREENSHOT_DIR || await mkdtemp(join(tmpdir(), 'twin-target-picker-browser-'));
await mkdir(screenshotDir, { recursive: true });
const server = await createServer({
  configFile: false, cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
  server: { host: '127.0.0.1', port: Number(process.env.TWIN_TARGET_PICKER_TEST_PORT || 5208), strictPort: true, hmr: false },
  plugins: [{ name: 'twin-target-picker-browser-fixture',
    resolveId(id) { if (id === '/__twin-target-picker-entry.js') return '\0twin-target-picker-entry'; },
    load(id) { if (id === '\0twin-target-picker-entry') return targetPickerFixtureEntry(); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/__twin-target-picker-test') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body,#root{margin:0;width:100%;height:100%;min-height:0}</style></head><body><div id="root"></div><script type="module" src="/__twin-target-picker-entry.js"></script></body></html>');
      });
    },
  }],
});

let browser, page, deadline;
const errors = [], unexpectedRequests = [], modelRequests = [];
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(10000);
  deadline = setTimeout(() => { console.error('Twin target picker exceeded 120 seconds'); void browser.close(); }, 120000);
  deadline.unref();
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    window.fixtureWebGLContexts = new Set();
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      const context = getContext.call(this, kind, ...args);
      if (context && (kind === 'webgl2' || kind === 'webgl')) window.fixtureWebGLContexts.add(context);
      return context;
    };
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!req.url().startsWith(origin)) { unexpectedRequests.push(req.url()); return route.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const match = url.pathname.match(new RegExp(`^/api/v1/projects/${projectId}/model-assets/(picker-model|picker-wall)/content$`));
    if (match && req.method() === 'GET') {
      modelRequests.push(match[1]);
      return route.fulfill({ status: 200, contentType: 'model/gltf+json', body: match[1] === 'picker-model' ? modelFixture : wallFixture });
    }
    unexpectedRequests.push(`${req.method()} ${url.pathname}`);
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unexpected fixture request"}' });
  });
  const dialog = () => page.getByRole('dialog', { name: '选择模型部件', exact: true });
  const choose = async (scope, label, option) => {
    await scope.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
  };
  const bindings = () => page.locator('nav').getByRole('button', { name: /绑定动作/ });
  const openPicker = async () => {
    await bindings().click();
    await page.getByRole('button', { name: '在模型中选择', exact: true }).click();
    await dialog().waitFor();
    await page.waitForFunction(() => {
      const stage = document.querySelector('.is-twin-target-picking');
      const slot = document.querySelector('.twin-picker-viewport');
      if (!stage || !slot || getComputedStyle(stage).visibility !== 'visible') return false;
      const a = stage.getBoundingClientRect(), b = slot.getBoundingClientRect();
      return a.width > 100 && a.height > 100 && ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key]-b[key]) < 1);
    });
  };
  const focus = async (id, label) => {
    await choose(dialog(), '模型', label);
    await page.waitForFunction(id => {
      const owner = document.querySelector('[data-scene-diagnostics]');
      const diagnostics = owner && JSON.parse(owner.dataset.sceneDiagnostics);
      return diagnostics && Math.abs(diagnostics.cameraTarget[0] - (id === 'second' ? 2 : -2)) < .001;
    }, id);
  };
  const clickWorld = async coordinates => {
    const point = await page.evaluate(coordinates => window.fixtureProject(coordinates), coordinates);
    const rect = await page.locator('.is-twin-target-picking canvas').boundingBox();
    assert.ok(rect && point.x > rect.x && point.x < rect.x+rect.width && point.y > rect.y && point.y < rect.y+rect.height,
      `Projected mesh must be inside the retained viewport: ${JSON.stringify({point,rect})}`);
    await page.mouse.click(point.x, point.y);
  };
  const frontCamera = async () => {
    await page.waitForFunction(() => {
      const owner = document.querySelector('[data-scene-diagnostics]');
      if (!owner) return false;
      const { cameraPosition: p, cameraTarget: t } = JSON.parse(owner.dataset.sceneDiagnostics);
      return Math.abs(p[0]-t[0]) < .01 && p[2]-t[2] > 1 && Math.abs((p[1]-t[1])/(p[2]-t[2])-.12) < .01;
    });
  };
  const readDraft = async () => {
    await page.locator('nav').getByRole('button', { name: '高级配置', exact: true }).click();
    return JSON.parse(await page.getByRole('textbox', { name: '完整配置 JSON', exact: true }).inputValue());
  };
  const assertRendererRetained = async () => {
    assert.equal(await page.locator('canvas').count(), 1, 'Picking must reuse the only scene canvas');
    assert.equal(await page.evaluate(() => window.fixtureFirstCanvas === document.querySelector('canvas')), true, 'Picking must keep the same canvas mounted');
    assert.equal(await page.evaluate(() => window.fixtureWebGLContexts.size), 1, 'Picking must not create another WebGL renderer');
    assert.equal(modelRequests.filter(id => id === 'picker-model').length, 1, 'Both instances must share one resource load');
    assert.equal(modelRequests.filter(id => id === 'picker-wall').length, 1, 'Wall visibility changes must not reload the resource');
  };

  await page.goto(`${origin}__twin-target-picker-test`);
  await page.waitForFunction(() => window.fixtureCatalog?.filter(item => item.drivable).length >= 7 && document.querySelector('[data-cover-state="ready"]'));
  await page.waitForFunction(() => document.querySelector('[data-scene-diagnostics]')?.dataset.sceneDiagnostics);
  await page.evaluate(() => { window.fixtureFirstCanvas = document.querySelector('canvas'); });
  assert.deepEqual((await readDraft()).bindings[0].target, config.bindings[0].target);
  await openPicker();
  assert.equal(await page.getByTestId('underlying-tool').isVisible(), false, 'The ordinary editing toolbar must be hidden during picking');
  assert.equal(await dialog().getByRole('button', { name: /^部件 \d+/ }).count() >= 2, true, 'Opaque internal identifiers need neutral part labels');
  assert.equal(await dialog().getByRole('button', { name: /^007$|^008$|^parent_7$/ }).count(), 0, 'Opaque node identifiers must not become visible part labels');
  const beyondLimit = await page.evaluate(() => window.fixtureCatalog.filter(node => node.instanceId === 'first')[209]);
  assert.ok(beyondLimit?.drivable, 'The fixture must contain a selectable part beyond the initial 200 rows');
  await dialog().getByRole('textbox', { name: '按名称查找', exact: true }).fill('部件 210');
  await dialog().locator('.twin-picker-parts').getByRole('button', { name: /^部件 210/ }).click();
  await page.waitForFunction(name => window.fixturePickerTarget?.nodeName === name, beyondLimit.nodeName);
  assert.equal((await page.evaluate(() => window.fixturePickerTarget)).nodeName, beyondLimit.nodeName,
    'Searching the visible neutral part label must find a node beyond the 200-row limit');
  await dialog().getByRole('textbox', { name: '按名称查找', exact: true }).fill('');
  await focus('second', '第二台设备');
  await frontCamera();
  await clickWorld([1.5, 0, 0]);
  await dialog().getByRole('heading', { name: '点选位置的部件', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixtureLastPick), [
    { instanceId: 'second', modelAssetId: 'picker-model', nodeName: '007' },
    { instanceId: 'second', modelAssetId: 'picker-model', nodeName: 'parent_7' },
  ], 'Clicking the second physical instance must select its own leaf and ancestor, never the first clone');
  assert.equal(await page.evaluate(() => window.fixtureOrdinaryPicks || 0), 0, 'Target picking must not call ordinary scene selection');
  assert.match(await dialog().locator('footer strong').textContent(), /第二台设备 · 部件 \d+/);
  assert.deepEqual(await page.evaluate(() => window.fixtureDocument.config.bindings[0].target), config.bindings[0].target, 'A mesh click must not mutate the saved document');
  await page.screenshot({ path: join(screenshotDir, 'second-instance-leaf.png') });
  await dialog().getByRole('button', { name: '使用这个部件', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  assert.deepEqual((await readDraft()).bindings[0].target, { instanceId: 'second', modelAssetId: 'picker-model', nodeName: '007' }, 'Confirmation must update only the configuration draft');
  assert.deepEqual(await page.evaluate(() => window.fixtureDocument.config.bindings[0].target), config.bindings[0].target, 'Confirming a target cannot save it automatically');
  await assertRendererRetained();
  console.log('Twin picker: actual second-instance mesh click, leaf/ancestor choices, draft-only confirmation and retained renderer passed');

  await openPicker();
  await page.mouse.move(1260, 850);
  // Diagnostics sample every 2 seconds. Wait for a fresh render sample so a
  // stale pre-close camera cannot conceal an unended OrbitControls gesture.
  await page.waitForTimeout(2100);
  await frontCamera();
  await dialog().locator('.twin-picker-parts').getByRole('button', { name: '升降部件组', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.fixturePickerTarget), { instanceId: 'second', modelAssetId: 'picker-model', nodeName: 'parent_7' });
  await page.screenshot({ path: join(screenshotDir, 'second-instance-group.png') });
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await readDraft()).bindings[0].target.nodeName, '007', 'Cancel must not apply the selected group');
  await openPicker();
  await dialog().locator('.twin-picker-parts').getByRole('button', { name: '升降部件组', exact: true }).click();
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
  assert.equal((await readDraft()).bindings[0].target.nodeName, '007', 'Escape must cancel, without changing the draft');
  console.log('Twin picker: group highlight selection, cancel and Escape preserve the previous draft');

  await openPicker();
  await page.evaluate(() => window.fixtureSetWall(true));
  await page.waitForFunction(() => window.fixtureWallVisible === true);
  await page.waitForTimeout(150);
  await clickWorld([1.5, 0, 0]);
  await page.waitForFunction(() => window.fixtureLastPick?.[0]?.instanceId === 'wall');
  assert.deepEqual(await page.evaluate(() => window.fixtureLastPick), [{ instanceId: 'wall', modelAssetId: 'picker-wall', nodeName: '遮挡墙' }],
    'The closest wall must own the mesh click; picking cannot raycast through it to the hidden model');
  await page.screenshot({ path: join(screenshotDir, 'occluding-wall.png') });
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await readDraft()).bindings[0].target.instanceId, 'second', 'Canceling an occluder selection must preserve the draft');
  await page.evaluate(() => window.fixtureSetWall(false));
  await assertRendererRetained();
  console.log('Twin picker: nearest visible mesh occlusion and ordinary-selection isolation passed');

  await openPicker();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const a = document.querySelector('.is-twin-target-picking').getBoundingClientRect();
    const b = document.querySelector('.twin-picker-viewport').getBoundingClientRect();
    return a.width > 100 && a.height > 100 && ['left','top','width','height'].every(key => Math.abs(a[key]-b[key]) < 1);
  });
  const confirm = await dialog().getByRole('button', { name: '使用这个部件', exact: true }).boundingBox();
  assert.ok(confirm && confirm.x >= 0 && confirm.y >= 0 && confirm.x+confirm.width <= 391 && confirm.y+confirm.height <= 845,
    'Mobile confirmation must remain inside the browser viewport');
  await page.screenshot({ path: join(screenshotDir, 'mobile-picker.png') });
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await assertRendererRetained();
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole('button', { name: /返回场景|返回模型/ }).click();
  await page.getByRole('button', { name: '放弃修改并返回', exact: true }).click();
  await page.getByRole('button', { name: '重新打开配置', exact: true }).waitFor();
  await assertRendererRetained();
  assert.equal(await page.getByTestId('underlying-tool').isVisible(), true, 'Returning must restore ordinary scene controls');
  console.log('Twin picker: mobile resize keeps the canvas aligned and returning restores the same scene');

  for (const variant of ['missing', 'hidden']) {
    await page.goto(`${origin}__twin-target-picker-test?${variant}`);
    await page.waitForFunction(() => window.fixtureCatalog?.length > 400 && document.querySelector('[data-cover-state="ready"]'));
    await openPicker();
    assert.equal(await page.evaluate(() => window.fixturePickerFocus), null, `${variant} targets must not send an invalid camera focus request`);
    assert.equal(await page.locator('[data-cover-state="error"]').count(), 0, `${variant} targets cannot put the retained scene into an error state`);
    assert.equal(await dialog().getByRole('button', { name: '使用这个部件', exact: true }).isDisabled(), true);
    assert.match(await dialog().locator('footer').textContent(), variant === 'missing' ? /原模型已移除/ : /该模型已隐藏/);
    if (variant === 'hidden') {
      await dialog().getByRole('combobox', { name: '模型', exact: true }).click();
      assert.equal(await page.getByRole('listbox').getByRole('option', { name: '第一台设备（已隐藏）', exact: true }).getAttribute('aria-disabled'), 'true');
      await page.keyboard.press('Escape');
    }
    await dialog().getByRole('button', { name: '取消', exact: true }).click();
    const unchanged = (await readDraft()).bindings[0].target;
    assert.equal(unchanged.instanceId, variant === 'missing' ? 'deleted-model' : 'first', `${variant} target cancellation must preserve the old draft`);
    assert.equal(unchanged.nodeName, '007');
  }
  console.log('Twin picker: missing/hidden model notices prevent invalid focus and preserve old bindings');

  await page.goto(`${origin}__twin-target-picker-test?readonly`);
  await page.waitForFunction(() => window.fixtureCatalog?.filter(item => item.drivable).length >= 7);
  await bindings().click();
  assert.equal(await page.getByRole('button', { name: '在模型中选择', exact: true }).isDisabled(), true, 'Read-only users cannot open the binding target picker');
  assert.deepEqual(errors, [], 'All browser errors must be visible and fail the regression');
  assert.deepEqual(unexpectedRequests, [], 'No business request, save or non-fixture API call is allowed');
  console.log(`Twin target picker browser regression passed. Screenshots: ${screenshotDir}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(screenshotDir, 'failure.png') });
  if (page && !page.isClosed()) console.error('Fixture diagnostics:', await page.evaluate(() => ({
    pick: window.fixtureLastPick, target: window.fixturePickerTarget, wall: window.fixtureWallVisible,
    scene: document.querySelector('[data-scene-diagnostics]')?.dataset.sceneDiagnostics,
    state: document.querySelector('[data-cover-state]')?.dataset.coverState,
  })));
  console.error(`Twin target picker failed. Screenshots: ${screenshotDir}`);
  console.error('Browser errors:', errors);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
