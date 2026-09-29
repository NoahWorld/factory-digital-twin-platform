// Isolated full editor regression with a real Three.js canvas and actual mouse gestures.
// All API state is in memory in this process; no credentials, local service, or business project is used.
// Developer/CI supplies installed Playwright, pngjs and Chrome; no dependencies are downloaded at runtime.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const browserTools = createRequire(isAbsolute(modulePath) ? modulePath : web.resolve(modulePath));
const { PNG } = browserTools('pngjs');
const outputParent = process.env.MODEL_LIBRARY_TEST_OUTPUT_DIR ? resolve(process.env.MODEL_LIBRARY_TEST_OUTPUT_DIR) : tmpdir();
await mkdir(outputParent, { recursive: true });
const output = await mkdtemp(join(outputParent, 'model-library-browser-'));
await chmod(output, 0o700);
const cacheDir = await mkdtemp(join(tmpdir(), 'model-library-cache-'));
const audit = { status: 'running', scope: 'isolated in-memory API; actual Standalone3DProjectPage and WebGL', checks: [], pageErrors: [], unexpectedRequests: [] };
const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
const mark = async name => { audit.checks.push(name); console.log('PASS ' + name); await persist(); };
const id = 'model-library-fixture';
const now = '2026-09-29T00:00:00.000Z';
const limits = { maximumInstances: 128, maximumUniqueModelAssets: 24, maximumUniqueModelBytes: 157286400, maximumEstimatedMeshInstances: 6000, maximumAnimatedInstances: 24, maximumPatchInstances: 100 };
const project = { id, name: '模型库隔离验收', projectType: '3d' };
const settings = { animationSpeed: 1, autoRotate: false, backgroundColor: '#e9edf3', backgroundOpacity: 1, cameraFov: 45, cameraView: 'front', preventBottomView: true, environmentLightColor: '#ffffff', environmentLightIntensity: 1, keyLightColor: '#ffffff', keyLightIntensity: 2, modelScale: 1, playAnimations: true, rotationSpeed: .3, showGrid: false };
const transform = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
let scene = { projectId: id, revision: 1, updatedAt: now, linked2dProjectId: null, instances: [{ id: 'legacy-instance', modelAssetId: 'legacy-model', label: '原有模型', assetId: null, visible: true, sortOrder: 0, renderMode: 'interactive', transform: transform() }], settings, decorations: [], roomAlarms: [], staticMap: null, fluids: [] };
const writes = [];
// A complete local GLB cube, so legacy resource loading and transform editing are exercised too.
const corners = [[-2,-2,-2],[2,-2,-2],[2,2,-2],[-2,2,-2],[-2,-2,2],[2,-2,2],[2,2,2],[-2,2,2]];
const indices = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,1,2,6,1,6,5,0,4,7,0,7,3];
const positions = new Float32Array(indices.flatMap(index => corners[index]));
const bin = Buffer.from(positions.buffer);
const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'legacy_box', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [.28,.4,.55,1], roughnessFactor: .9, metallicFactor: 0 } }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteLength: bin.length }], accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-2,-2,-2], max: [2,2,2] }] };
const rawJson = Buffer.from(JSON.stringify(gltf));
const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 32)]);
const glb = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(glb, 28 + json.length);
const asset = { id: 'legacy-model', projectId: id, originalFilename: '已有设备.glb', format: 'glb', contentType: 'model/gltf-binary', byteSize: glb.length, sha256: 'fixture', source: 'upload', sourceImageAssetId: null, generation: null, sourceModelAssetId: null, compression: null, usage: { references: [], count: 1 }, createdAt: now, inspection: { format: 'glb', gltfVersion: '2.0', sceneCount: 1, nodeCount: 1, meshCount: 1, materialCount: 1, textureCount: 0, imageCount: 0, animationCount: 0, namedNodeCount: 1, duplicateNodeNames: [], externalResourceCount: 0 } };
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Standalone3DProjectPage from '/src/pages/Standalone3DProjectPage.tsx';
import {NotificationProvider} from '/src/components/NotificationProvider.tsx';
import {ThemeProvider} from '/src/theme/ThemeProvider.tsx';
import {initializeUiTheme} from '/src/theme/ui-theme.ts';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
document.documentElement.dataset.uiTheme = 'light';
const query = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')).render(React.createElement(ThemeProvider, {initialState: initializeUiTheme()}, React.createElement(NotificationProvider, null,
  React.createElement(Standalone3DProjectPage, {projectId: query.has('readonly') ? '${id}-readonly' : '${id}', mode: query.has('preview') ? 'preview' : 'edit'}))));
`;
const jsonResponse = (res, body, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const server = await createServer({ configFile: false, cacheDir,
  root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(process.env.MODEL_LIBRARY_TEST_PORT || 5298), strictPort: true },
  plugins: [{ name: 'model-library-browser-fixture',
    resolveId(value) { if (value === '/__model-library-entry.js') return '\0model-library-entry'; },
    load(value) { if (value === '\0model-library-entry') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url, 'http://fixture.invalid').pathname;
      if (path === '/__model-library') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/__model-library-entry.js"></script></html>'); return; }
      if (!path.startsWith('/api/')) return next();
      const parts = path.split('/'); const requestedId = parts[4]; const editable = requestedId !== id + '-readonly';
      const sceneResponse = () => ({ sceneExtensionsVersion: 1, editable, limits, project: { ...project, id: requestedId }, requestId: 'fixture-request', scene: { ...scene, projectId: requestedId } });
      if (path === '/api/v1/projects' && req.method === 'GET') return jsonResponse(res, { projects: [project] });
      if (![id, id + '-readonly'].includes(requestedId)) { audit.unexpectedRequests.push(req.method + ' ' + path); return jsonResponse(res, { error: 'unknown_fixture_project' }, 404); }
      if (path.endsWith('/model-assets/legacy-model/content') && req.method === 'GET') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(glb); return; }
      if (path.endsWith('/model-assets') && req.method === 'GET') return jsonResponse(res, { modelAssets: [{ ...asset, projectId: requestedId }] });
      if (path.endsWith('/assets') && req.method === 'GET') return jsonResponse(res, { assets: [] });
      if (path.endsWith('/twin-drive') && req.method === 'GET') return jsonResponse(res, { projectId: requestedId, revision: 1, editable, config: { version: 1, enabled: false, source: 'simulator', points: [], bindings: [], colliders: [], collisionRules: [], procedures: [] } });
      if (path.endsWith('/scene') && req.method === 'GET') return jsonResponse(res, sceneResponse());
      if (path.endsWith('/scene') && req.method === 'PATCH') {
        if (!editable) return jsonResponse(res, { error: 'forbidden' }, 403);
        let body = ''; for await (const chunk of req) body += chunk;
        const patch = JSON.parse(body);
        if (patch.expectedRevision !== scene.revision) return jsonResponse(res, { error: 'revision_conflict' }, 409);
        const instances = new Map(scene.instances.map(item => [item.id, item]));
        for (const deleted of patch.deleteInstanceIds) instances.delete(deleted);
        for (const item of patch.upsertInstances) instances.set(item.id, item);
        const { expectedRevision, deleteInstanceIds, upsertInstances, ...rest } = patch;
        scene = { ...scene, ...rest, instances: [...instances.values()], revision: scene.revision + 1 };
        writes.push(structuredClone(patch)); return jsonResponse(res, sceneResponse());
      }
      audit.unexpectedRequests.push(req.method + ' ' + path); return jsonResponse(res, { error: 'unexpected_fixture_request' }, 404);
    }); },
  }],
});
let browser, page;
console.log('OUTPUT ' + output);
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  if (process.env.MODEL_LIBRARY_FIXTURE_ONLY === '1') { console.log('FIXTURE ' + base + '__model-library'); await new Promise(() => {}); }
  browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) { audit.unexpectedRequests.push(route.request().url()); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => audit.pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const canvas = page.locator('.model-3d-renderer canvas');
  const panel = page.getByRole('region', { name: '场景扩展属性' });
  const toolbar = page.getByRole('toolbar', { name: '模型变换工具' });
  const ready = async () => {
    await canvas.waitFor();
    await page.waitForFunction(() => { const raw = document.querySelector('[data-scene-diagnostics]')?.getAttribute('data-scene-diagnostics'); return raw && JSON.parse(raw).activeLoads === 0 && JSON.parse(raw).drawCalls > 0; }, null, { timeout: 45000 });
  };
  const save = async () => { await page.getByRole('button', { name: '保存场景', exact: true }).click(); await page.getByRole('button', { name: '已保存', exact: true }).waitFor(); };
  const library = async () => { await page.getByRole('button', { name: /^模型库/ }).click(); };
  const category = async name => { await page.getByRole('button', { name: new RegExp('^' + name + '\\s*\\d+$') }).click(); };
  const selectDecoration = async label => {
    await page.getByRole('button', { name: /^图层/ }).click();
    await page.locator('[data-decoration-id]').filter({ has: page.locator('strong', { hasText: new RegExp('^' + label + '$') }) }).locator('.standalone-layer-main').click();
    await panel.getByLabel('位置 X', { exact: true }).waitFor();
    await page.waitForFunction(label => [...document.querySelectorAll('.scene-extras label')].find(item => item.querySelector('span')?.textContent === '名称')?.querySelector('input')?.value === label, label);
  };
  const redHandle = async () => {
    await page.mouse.move(2, 2); // Hover changes an axis to yellow; remove it before measuring rendered pixels.
    await page.waitForTimeout(120);
    const png = PNG.sync.read(await canvas.screenshot());
    const bounds = await canvas.boundingBox();
    const overlay = await toolbar.boundingBox();
    const pixels = [];
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
      if (overlay && x + bounds.x >= overlay.x && x + bounds.x <= overlay.x + overlay.width && y + bounds.y >= overlay.y && y + bounds.y <= overlay.y + overlay.height) continue;
      const at = (y * png.width + x) * 4; const [r,g,b] = png.data.subarray(at, at + 3);
      if (r > 170 && g < 105 && b < 105 && r > g * 1.8 && r > b * 1.8) pixels.push({ x, y });
    }
    assert.ok(pixels.length >= 5, 'Selected object must render a visible red X transform handle');
    const end = Math.max(...pixels.map(item => item.x));
    const tip = pixels.filter(item => item.x >= end - 6);
    return { x: bounds.x + tip.reduce((sum, item) => sum + item.x, 0) / tip.length, y: bounds.y + tip.reduce((sum, item) => sum + item.y, 0) / tip.length };
  };
  const dragX = async (field, mode, distance = 45) => {
    await toolbar.getByRole('button', { name: mode === 'scale' ? /缩放/ : /移动/ }).click();
    const before = Number(await field.inputValue()); const start = await redHandle();
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + distance, start.y, { steps: 15 }); await page.mouse.up();
    await page.waitForFunction(({ label, previous }) => {
      const labels = [...document.querySelectorAll('label')]; const target = document.querySelector('input[aria-label="' + label + '"]') ?? labels.find(item => item.textContent.trim() === label)?.querySelector('input');
      return target && Math.abs(Number(target.value) - previous) > .0001;
    }, { label: mode === 'scale' ? '缩放 X' : '位置 X', previous: before });
    const after = Number(await field.inputValue()); assert.ok(Number.isFinite(after) && after !== before);
    return { before, after };
  };
  await page.goto(base + '__model-library'); await ready();
  assert.equal(await canvas.count(), 1);
  await library();
  for (const [group, names] of [['植物', ['乔木', '灌木']], ['水景', ['河流']], ['军事模型', ['运输车', '帐篷', '雷达', '装甲车']]]) {
    await category(group);
    const kinds = await page.locator('[data-decoration-kind]').count(); assert.equal(kinds, names.length);
    for (const name of names) assert.ok(await page.getByRole('button', { name: '加入场景 ' + name, exact: true }).isVisible());
  }
  await category('上传模型'); assert.ok(await page.getByRole('button', { name: '加入场景 已有设备.glb', exact: true }).isVisible());
  await mark('categorized plants, water, military and existing uploaded model');

  const names = ['乔木', '灌木', '河流', '运输车', '帐篷', '雷达', '装甲车'];
  await category('全部');
  for (const [index, name] of names.entries()) {
    await page.getByRole('button', { name: '加入场景 ' + name, exact: true }).click();
    await panel.getByLabel('名称', { exact: true }).fill('验收' + name);
    await panel.getByLabel('位置 X', { exact: true }).fill(String(index === 0 ? 0 : 20 + index * 12));
    assert.ok(await toolbar.getByRole('button', { name: /移动/ }).isVisible());
  }
  await save();
  assert.equal(scene.decorations.length, 7); assert.equal(new Set(scene.decorations.map(item => item.kind)).size, 7);
  assert.ok(scene.decorations.every(item => item.id && item.label.startsWith('验收')));
  assert.equal(scene.instances[0].id, 'legacy-instance');
  await mark('all seven library objects created as independent saved instances; existing GLB preserved');

  await selectDecoration('验收乔木');
  const cancelBefore = await panel.getByLabel('位置 X', { exact: true }).inputValue();
  const cancelledHandle = await redHandle();
  await page.mouse.move(cancelledHandle.x, cancelledHandle.y); await page.mouse.down(); await page.mouse.move(cancelledHandle.x + 32, cancelledHandle.y, { steps: 10 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
  assert.equal(await panel.getByLabel('位置 X', { exact: true }).inputValue(), cancelBefore, 'Losing window focus cancels an unfinished drag without committing it');
  await mark('interrupted drag cancels without changing the draft or leaving controls locked');
  const move = await dragX(panel.getByLabel('位置 X', { exact: true }), 'translate');
  assert.ok(Math.abs(move.after - move.before) > .01);
  const scale = await dragX(panel.getByLabel('缩放 X', { exact: true }), 'scale', 28);
  assert.ok(scale.after > 0 && scale.after <= 100);
  const treeBeforeSave = { position: Number(await panel.getByLabel('位置 X', { exact: true }).inputValue()), scale: Number(await panel.getByLabel('缩放 X', { exact: true }).inputValue()) };
  assert.equal(scene.decorations.find(item => item.label === '验收乔木').transform.position[0], 0, 'Dragging edits the draft, not persisted server state');
  await save();
  const savedTree = structuredClone(scene.decorations.find(item => item.label === '验收乔木'));
  assert.equal(savedTree.transform.position[0], treeBeforeSave.position); assert.equal(savedTree.transform.scale[0], treeBeforeSave.scale);
  await page.reload(); await ready(); await selectDecoration('验收乔木');
  assert.equal(Number(await panel.getByLabel('位置 X', { exact: true }).inputValue()), savedTree.transform.position[0]);
  assert.equal(Number(await panel.getByLabel('缩放 X', { exact: true }).inputValue()), savedTree.transform.scale[0]);
  await mark('real canvas translation and scale update inputs, require save and survive reload');

  await panel.getByLabel('位置 X', { exact: true }).fill('');
  assert.equal(await page.getByRole('button', { name: '保存场景', exact: true }).isEnabled(), false);
  assert.equal(scene.decorations.find(item => item.id === savedTree.id).transform.position[0], savedTree.transform.position[0]);
  await library(); await category('植物');
  assert.equal(await page.getByRole('button', { name: '加入场景 乔木', exact: true }).isEnabled(), false);
  assert.equal(await toolbar.getByRole('button', { name: /移动/ }).isEnabled(), false);
  assert.equal(await panel.getByLabel('位置 X', { exact: true }).inputValue(), '', 'Opening the library preserves incomplete input');
  await panel.getByLabel('位置 X', { exact: true }).fill(String(savedTree.transform.position[0]));
  assert.equal(await page.getByRole('button', { name: '加入场景 乔木', exact: true }).isEnabled(), true);
  await panel.getByRole('button', { name: '删除', exact: true }).click();
  await save(); assert.equal(scene.decorations.length, 6); assert.ok(!scene.decorations.some(item => item.id === savedTree.id));
  await mark('invalid numeric draft cannot save; deleting selected object clears selection and persists cleanly');

  await page.getByRole('button', { name: /^图层/ }).click();
  await page.locator('[data-instance-id="legacy-instance"] .standalone-layer-main').click();
  const oldPosition = page.getByLabel('位置 X', { exact: true });
  const legacyMove = await dragX(oldPosition, 'translate', 25);
  await save(); assert.equal(scene.instances[0].transform.position[0], legacyMove.after);
  await mark('legacy GLB still uses working canvas translation and existing save contract');
  await library(); await category('全部');
  await page.screenshot({ path: join(output, 'editor-model-library.png') });
  const beforeReadOnly = JSON.stringify(scene); const writesBeforeReadOnly = writes.length;
  await page.goto(base + '__model-library?readonly=1'); await ready();
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.locator('[data-decoration-id]').first().locator('.standalone-layer-main').click();
  assert.equal(await toolbar.count(), 0);
  assert.equal(await panel.getByLabel('位置 X', { exact: true }).isEnabled(), false);
  await library(); await category('植物');
  assert.equal(await page.getByRole('button', { name: '加入场景 乔木', exact: true }).isEnabled(), false);
  await page.goto(base + '__model-library?preview=1'); await ready();
  assert.equal(await toolbar.count(), 0); assert.equal(await panel.count(), 0);
  assert.equal(JSON.stringify(scene), beforeReadOnly); assert.equal(writes.length, writesBeforeReadOnly);
  await mark('read-only and preview cannot create or transform objects and never write scene state');
  assert.deepEqual(audit.pageErrors, []); assert.deepEqual(audit.unexpectedRequests, []);
  audit.status = 'PASS'; audit.writes = writes.length; await persist();
  console.log(JSON.stringify({ status: 'PASS', checks: audit.checks.length, output }));
} catch (error) {
  audit.status = 'FAIL'; audit.error = String(error.stack); await persist();
  if (page) { await page.screenshot({ path: join(output, 'failure.png') }); await writeFile(join(output, 'failure-body.txt'), await page.locator('body').innerText()); }
  console.error(error); process.exitCode = 1;
} finally { await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
