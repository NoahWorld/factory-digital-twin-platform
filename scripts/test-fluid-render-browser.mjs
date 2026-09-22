import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cacheDir = await mkdtemp(join(tmpdir(), 'fluid-render-browser-'));
const server = await createServer({ cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: Number(process.env.FLUID_RENDER_PORT || 5196), strictPort: true }, plugins: [{ name: 'fluid-render-test', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== '/__fluid-render') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0;background:#101827;color:#dbe8f7;font:15px sans-serif"><div style="position:absolute;top:16px;left:20px">气体 / 液体 / 熔融体<br>左：连续流动　右：沿路径扩散</div></body></html>');
  });
} }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`); });
  await page.goto(`${server.resolvedUrls.local[0]}__fluid-render`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { FluidManager } = await import('/src/scene/fluid-manager.ts');
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#101827');
    const parent = new THREE.Group(); scene.add(parent);
    const runtime = new FluidManager(parent);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(1100, 820); renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(42, 1100 / 820, .01, 200);
    camera.position.set(0, 5.5, 24); camera.lookAt(0, 5.5, 0);
    const fluids = [];
    ['gas', 'liquid', 'molten'].forEach((kind, row) => ['stream', 'diffuse'].forEach((mode, column) => {
      const x = -8 + column * 9, y = 10 - row * 4.5;
      fluids.push({ id: `${kind}-${mode}`, label: `${kind} ${mode}`, kind, mode,
        points: [[x, y, 0], [x + 2, y + .5, -1], [x + 4, y - .4, 0], [x + 6, y, 1]],
        color: kind === 'gas' ? '#cbd5e1' : kind === 'liquid' ? '#38bdf8' : '#ff6b20',
        radius: .27, speed: 1.5, spread: 2.5, opacity: kind === 'gas' ? .7 : .9,
        direction: 'forward', visible: true, playing: true,
      });
    }));
    runtime.reconcile(fluids);
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const before = new Uint8Array(1100 * 820 * 4);
    gl.readPixels(0, 0, 1100, 820, gl.RGBA, gl.UNSIGNED_BYTE, before);
    runtime.update(.6, true, 1);
    renderer.render(scene, camera);
    const after = new Uint8Array(before.length);
    gl.readPixels(0, 0, 1100, 820, gl.RGBA, gl.UNSIGNED_BYTE, after);
    let changedPixels = 0;
    for (let index = 0; index < before.length; index += 4) if (Math.abs(before[index] - after[index]) + Math.abs(before[index + 1] - after[index + 1]) + Math.abs(before[index + 2] - after[index + 2]) > 10) changedPixels++;
    window.fluidRenderTest = { runtime, renderer, scene, camera };
    return { changedPixels, diagnostics: runtime.diagnostics(), glError: gl.getError(), programs: renderer.info.programs.length, drawCalls: renderer.info.render.calls };
  });
  assert.equal(result.glError, 0);
  assert.equal(result.diagnostics.fluidCount, 6);
  assert.ok(result.changedPixels > 500, JSON.stringify(result));
  assert.ok(result.drawCalls >= 8, JSON.stringify(result));
  assert.deepEqual(errors, []);
  if (process.env.FLUID_RENDER_SCREENSHOT) {
    // The production renderer need not retain the drawing buffer; capture immediately after render.
    await page.evaluate(() => { const { renderer, scene, camera } = window.fluidRenderTest; renderer.render(scene, camera); });
    await page.screenshot({ path: process.env.FLUID_RENDER_SCREENSHOT });
  }
  const remaining = await page.evaluate(() => {
    const { runtime, renderer, scene, camera } = window.fluidRenderTest;
    runtime.dispose(); renderer.render(scene, camera);
    const geometries = renderer.info.memory.geometries;
    renderer.dispose();
    return geometries;
  });
  assert.equal(remaining, 0);
  console.log('PASS: all six fluid kind/mode shaders compile and render; motion changes pixels; GPU geometry disposal.', JSON.stringify(result));

  const pathEditing = await page.evaluate(async () => {
    const { createSceneRuntime } = await import('/src/scene/scene-runtime.ts');
    const { createCanvasNode, parseModel3DProps } = await import('/src/canvas/types.ts');
    const parsed = parseModel3DProps(createCanvasNode('model-3d', 0, 0, 1).props);
    if (!parsed.ok) throw new Error(parsed.message);
    const settings = { ...parsed.value, autoRotate: true, rotationSpeed: 5, cameraView: 'top',
      presentation: { ...parsed.value.presentation, lighting: 'standard' } };
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;width:1000px;height:800px';
    document.body.append(container);
    let input = { settings, instances: [], fluids: [], appearanceOverrides: {}, selectedPath: null,
      selectedInstanceId: null, selectionStyle: 'editor', controlsEnabled: true, instanceTransformMode: null };
    const statuses = [], checks = [];
    const runtime = createSceneRuntime({ container, projectId: 'fluid-test', canvasNodeId: 'path-test', initial: input,
      onStatus: status => statuses.push(status), onSnapshot: () => {} });
    const update = async patch => { input = { ...input, ...patch }; await runtime.update(input); };
    const frames = async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); };
    const sample = () => [runtime.pickFluidPoint(650, 330), runtime.pickFluidPoint(450, 500)];
    const editor = points => ({ points, plane: 'xz', offset: 0, active: true, selectedPointIndex: null, direction: 'forward' });
    const definition = points => ({ id: 'path', label: 'path', kind: 'liquid', mode: 'stream', points,
      color: '#38bdf8', radius: .25, speed: 1, spread: 1, opacity: .9, direction: 'forward', visible: true, playing: true });
    const preview = async points => update({ fluids: points.length >= 2 ? [definition(points)] : [], fluidEditor: editor(points) });
    try {
      await runtime.update(input);
      await frames(); // Accumulate presentation rotation before the very first path.
      await preview([]);
      const initialPoints = sample();
      await preview(initialPoints);
      checks.push({ name: 'first two points', before: initialPoints, after: sample() });
      const thirdPoint = runtime.pickFluidPoint(700, 550);
      await preview([...initialPoints, thirdPoint]);
      checks.push({ name: 'growing initial path', before: initialPoints, after: sample() });
      await preview([]);
      checks.push({ name: 'clear initial draft', before: initialPoints, after: sample() });
      await preview([initialPoints[0]]);
      await preview(initialPoints);
      checks.push({ name: 'rebuild after one point', before: initialPoints, after: sample() });

      // Pausing may resume presentation rotation; restarting picking must use its
      // latest transform, and subsequent edits cannot move existing local points.
      await update({ fluidEditor: { ...input.fluidEditor, active: false } });
      await frames();
      await update({ fluidEditor: { ...input.fluidEditor, active: true } });
      const resumedPoints = sample();
      await preview([...initialPoints, thirdPoint]);
      checks.push({ name: 'resume paused picking', before: resumedPoints, after: sample() });

      await update({ fluidEditor: null });
      await frames();
      await update({ fluidEditor: editor(input.fluids[0].points) });
      const existingPoints = sample();
      // Exercise even a host that removes an invalid edited preview entirely.
      await preview([]);
      await preview([initialPoints[0]]);
      await preview(initialPoints);
      checks.push({ name: 'rebuild a rotated existing path', before: existingPoints, after: sample() });

      await update({ fluidEditor: null, fluids: [] });
      await frames();
      await preview([]);
      const afterCancel = sample();
      await preview(afterCancel);
      checks.push({ name: 'cancel and create again', before: afterCancel, after: sample() });
      await preview([[100, 0, -5], [100, 0, 5]]);
      await update({ fluidEditor: null });
      const orbitPicks = [runtime.pickSceneObject(500, 400)];
      await frames();
      orbitPicks.push(runtime.pickSceneObject(500, 400));
      await frames();
      orbitPicks.push(runtime.pickSceneObject(500, 400));
      return { checks, orbitPicks, errors: statuses.filter(status => status.status === 'error'), status: statuses.at(-1) };
    } finally { runtime.dispose(); container.remove(); }
  });
  for (const check of pathEditing.checks) assert.deepEqual(check.after, check.before, `Stable scene coordinates: ${check.name}`);
  assert.deepEqual(pathEditing.errors, []);
  assert.deepEqual(pathEditing.orbitPicks, [{ fluidId: 'path' }, { fluidId: 'path' }, { fluidId: 'path' }], 'A path far from the origin rotates around its own fitted center');
  assert.equal(pathEditing.status.status, 'ready');
  assert.deepEqual(errors, []);
  console.log('PASS: real runtime path coordinates survive initial auto-rotation, growing/cleared drafts, pause/resume, apply, cancel and rebuilding a rotated path.');

  const tinyPaths = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { FluidManager } = await import('/src/scene/fluid-manager.ts');
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
    const root = new THREE.Group(); scene.add(root);
    const manager = new FluidManager(root);
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256);
    const camera = new THREE.PerspectiveCamera(42, 1, .01, 10);
    const gl = renderer.getContext();
    const results = [];
    try {
      for (const distance of [1e-8, 1e-10]) for (const kind of ['gas', 'liquid', 'molten']) for (const mode of ['stream', 'diffuse']) {
        const captures = [];
        for (const origin of [0, 9999]) {
          manager.reconcile([{ id: 'tiny', label: 'tiny', kind, mode, color: '#38bdf8',
            points: [[origin, 0, 0], [origin + distance, 0, 0]], radius: .25, speed: 1,
            spread: 1, opacity: .8, direction: 'forward', visible: true, playing: true }]);
          camera.position.set(origin - 1, .2, .3); camera.lookAt(origin, 0, 0);
          manager.update(1 / 60, true, 1);
          renderer.render(scene, camera);
          const pixels = new Uint8Array(256 * 256 * 4);
          gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let visiblePixels = 0;
          for (let index = 0; index < pixels.length; index += 4) if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) visiblePixels++;
          captures.push({ pixels, visiblePixels, glError: gl.getError() });
        }
        results.push({ distance, kind, mode, pixels: captures.map(capture => capture.visiblePixels), errors: captures.map(capture => capture.glError) });
      }
      manager.dispose(); renderer.render(scene, camera);
      return { results, geometriesAfterDispose: renderer.info.memory.geometries };
    } finally { manager.dispose(); renderer.dispose(); }
  });
  for (const result of tinyPaths.results) {
    assert.deepEqual(result.errors, [0, 0], JSON.stringify(result));
    assert.ok(result.pixels.every(count => count > 100), `Tiny paths must produce visible pixels near and far from zero: ${JSON.stringify(result)}`);
  }
  assert.equal(tinyPaths.geometriesAfterDispose, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: all six styles render finite short positive paths at 0 and 9999 with real GPU pixels and no GL errors.');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
