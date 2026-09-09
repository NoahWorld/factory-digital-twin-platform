import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
// Browser tooling is optional and supplied by the developer/CI; never downloaded at runtime.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cacheDir = await mkdtemp(join(tmpdir(), 'scene-browser-cache-'));
const server = await createServer({ cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: "127.0.0.1", port: Number(process.env.SCENE_TEST_PORT || 5199), strictPort: true }, plugins: [{ name: 'scene-test-page', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== '/__scene-test') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><body style="margin:0"><div id="scene" style="width:800px;height:600px"></div></body></html>');
  });
} } ] });
let browser;
try {
  await server.listen();
  console.log("Test server ready", server.resolvedUrls.local);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const deadline = setTimeout(() => { console.error("Browser test exceeded 60 seconds"); void browser.close(); }, 60000);
  deadline.unref();
  page.on("console", (message) => { if (message.type() === "error") console.error("Browser:", message.text()); });
  page.on("requestfailed", (request) => console.error("Request failed:", request.url(), request.failure()));
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const requests = []; page.on('request', (request) => requests.push(request.url()));
  // A self-contained glTF triangle fixture; requests never touch the backend or project data.
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const bytes = Buffer.from(positions.buffer);
  const fixture = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'equipment', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }], bufferViews: [{ buffer: 0, byteLength: bytes.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1,-1,0], max: [1,1,0] }] });
  await page.route('**/api/v1/projects/test/model-assets/*/content', (route) => route.fulfill({ status: route.request().url().includes('/broken/') ? 500 : 200, contentType: 'model/gltf+json', body: fixture }));
  await page.goto(`${server.resolvedUrls.local[0]}__scene-test`);
  console.log("Test page ready");
  await page.evaluate(async () => {
    const { createSceneRuntime } = await import('/src/scene/scene-runtime.ts');
    const { createCanvasNode, parseModel3DProps } = await import('/src/canvas/types.ts');
    const settings = parseModel3DProps(createCanvasNode('model-3d', 0, 0, 1).props).value;
    settings.autoRotate = false; settings.cameraView = 'front'; settings.presentation.lighting = 'standard';
    const instance = (id, assetId = 'same') => ({ id, assetId, label: id, visible: true, transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } });
    window.input = { settings, instances: [instance('a')], appearanceOverrides: {}, selectedPath: null, selectedInstanceId: null, controlsEnabled: true };
    window.instance = instance;
    window.runtime = createSceneRuntime({ container: document.querySelector('#scene'), projectId: 'test', canvasNodeId: 'fixture', initial: window.input, onStatus: (status) => { window.statusResult = status; }, onSnapshot: (snapshot) => { window.snapshot = snapshot; } });
    await window.runtime.update(window.input);
    window.firstCanvas = document.querySelector('canvas');
  });
  console.log('Runtime status', await page.evaluate(() => window.statusResult));
  assert.equal(await page.evaluate(() => window.statusResult.status), 'ready');
  await page.waitForFunction(() => window.runtime.diagnostics()?.drawCalls > 0);
  assert.equal(await page.evaluate(() => window.runtime.pickSceneTarget(400, 300)?.instanceId), 'a');
  await page.mouse.move(400, 300); await page.mouse.wheel(0, -150);
  await page.waitForTimeout(2500);
  const pose = await page.evaluate(() => window.runtime.diagnostics().cameraPosition);
  await page.evaluate(async () => { window.input = { ...window.input, instances: [window.instance('a'), window.instance('b')] }; await window.runtime.update(window.input); });
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => window.firstCanvas === document.querySelector('canvas')), true);
  assert.deepEqual(await page.evaluate(() => window.runtime.diagnostics().cameraPosition), pose);
  assert.equal(requests.filter((url) => url.endsWith('/same/content')).length, 1);
  await page.evaluate(async () => { document.querySelector('#scene').style.width = '700px'; window.input = { ...window.input, settings: { ...window.input.settings, backgroundColor: '#112233' } }; await window.runtime.update(window.input); });
  await page.waitForTimeout(2200);
  assert.deepEqual(await page.evaluate(() => window.runtime.diagnostics().cameraPosition), pose);
  await page.evaluate(async () => { await window.runtime.update({ ...window.input, instances: [window.instance('bad', 'broken')] }); });
  assert.equal(await page.evaluate(() => window.statusResult.status), 'error');
  await page.evaluate(async () => { await window.runtime.update(window.input); });
  console.log('Runtime status', await page.evaluate(() => window.statusResult));
  assert.equal(await page.evaluate(() => window.statusResult.status), 'ready');
  // Exercise local decoder WASM compilation, not only HTTP 200 / SPA fallback responses.
  const decoderChecks = await page.evaluate(async () => {
    const paths = ['/decoders/basis/basis_transcoder.wasm', '/decoders/draco/draco_decoder.wasm'];
    return Promise.all(paths.map(async (path) => { const response = await fetch(path); if (!response.ok) throw new Error(`${path}: ${response.status}`); const bytes = await response.arrayBuffer(); return { mime: response.headers.get('Content-Type'), valid: WebAssembly.validate(bytes) }; }));
  });
  assert.ok(decoderChecks.every((item) => item.mime === 'application/wasm' && item.valid));
  await page.evaluate(async () => { await window.runtime.update({ ...window.input, instances: [], selectedPath: null }); });
  assert.equal(await page.evaluate(() => window.statusResult.status), 'empty');
  await page.evaluate(() => window.runtime.dispose());
  assert.equal(await page.locator('canvas').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Browser scene runtime tests passed: real WebGL, shared fetch/canvas, BVH click, camera preservation on add/resize/settings, visible failure/recovery, local decoder WASM and disposal.');
} finally { await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
