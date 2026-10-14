import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

function colouredPixels(png) {
  let at = 8, width, height, channels;
  const chunks = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at), kind = png.toString('ascii', at + 4, at + 8), data = png.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); assert.ok([2, 6].includes(data[9])); channels = data[9] === 2 ? 3 : 4; }
    if (kind === 'IDAT') chunks.push(data);
    at += length + 12;
  }
  const inflated = inflateSync(Buffer.concat(chunks)), stride = width * channels, counts = { red: 0, green: 0, blue: 0 };
  let previous = Buffer.alloc(stride), offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[offset++], line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0, up = previous[x], diagonal = x >= channels ? previous[x - channels] : 0;
      const estimate = left + up - diagonal, dl = Math.abs(estimate - left), du = Math.abs(estimate - up), dd = Math.abs(estimate - diagonal);
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : dl <= du && dl <= dd ? left : du <= dd ? up : diagonal;
      line[x] = (inflated[offset++] + predictor) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      const [r, g, b] = line.subarray(x, x + 3);
      if (r > 100 && r > g * 1.5 && r > b * 1.5) counts.red++;
      if (g > 100 && g > r * 1.5 && g > b * 1.1) counts.green++;
      if (b > 100 && b > r * 1.5 && b > g * 1.2) counts.blue++;
    }
    previous = line;
  }
  return counts;
}

// This is a renderer/transport fixture, not photographic reconstruction evidence.
// The coloured floor, back wall, and three blocks are mathematically generated SH0 Gaussians.
const properties = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
const rows = [];
function point(x, y, z, color, radius = 0.055) {
  rows.push([x, y, z, 0, 0, 0, ...color.map(value => (value - 0.5) / 0.28209479177387814), 5, ...Array(3).fill(Math.log(radius)), 1, 0, 0, 0]);
}
for (let x = -2; x <= 2; x += 0.09) for (let z = -1.5; z <= 1.5; z += 0.09) point(x, 0, z, [0.24, 0.42, 0.50]);
for (let x = -2; x <= 2; x += 0.09) for (let y = 0; y <= 1.8; y += 0.09) point(x, y, -1.5, [0.47, 0.54, 0.62]);
for (const [center, height, color] of [[-1, 0.65, [0.98, 0.3, 0.14]], [0, 1.3, [0.1, 0.84, 0.64]], [1, 0.9, [0.15, 0.5, 0.98]]]) {
  for (let x = center - 0.32; x <= center + 0.32; x += 0.065) for (let y = 0; y <= height; y += 0.065) {
    point(x, y, 0.12, color, 0.045); point(x, y, -0.4, color, 0.045);
  }
  for (let z = -0.4; z <= 0.12; z += 0.065) for (let y = 0; y <= height; y += 0.065) {
    point(center - 0.32, y, z, color, 0.045); point(center + 0.32, y, z, color, 0.045);
  }
  for (let x = center - 0.32; x <= center + 0.32; x += 0.065) for (let z = -0.4; z <= 0.12; z += 0.065) point(x, height, z, color, 0.045);
}
const header = Buffer.from(`ply\nformat binary_little_endian 1.0\ncomment Synthetic renderer fixture only; not reconstructed from photographs\nelement vertex ${rows.length}\n${properties.map(name => `property float ${name}`).join('\n')}\nend_header\n`);
const body = Buffer.alloc(rows.length * properties.length * 4);
rows.forEach((row, index) => row.forEach((value, column) => body.writeFloatLE(value, (index * properties.length + column) * 4)));
const ply = Buffer.concat([header, body]);
const result = { byteSize: ply.length, gaussianCount: rows.length, bounds: { min: [-2, 0, -1.5], max: [2, 1.8, 1.5] }, initialCamera: { position: [3.4, 2.4, 5.2], target: [0, 0.65, 0], up: [0, 1, 0] } };
const contentPath = '/api/v1/projects/viewer-fixture/site-captures/synthetic/content';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const parent = process.env.SITE_CAPTURE_VIEWER_OUTPUT_DIR ? resolve(process.env.SITE_CAPTURE_VIEWER_OUTPUT_DIR) : tmpdir();
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'site-capture-viewer-'));
const cacheDir = await mkdtemp(join(tmpdir(), 'site-capture-viewer-vite-'));
const audit = { status: 'running', scope: 'Synthetic SH0 PLY renderer fixture only. No real reconstruction, GPU training, or scene-quality acceptance.', checks: [], pageErrors: [], externalRequests: [], screenshots: [], counts: { gaussians: rows.length, bytes: ply.length } };
const persist = () => writeFile(join(output, 'results.json'), JSON.stringify(audit, null, 2) + '\n');
const mark = async name => { audit.checks.push(name); console.log('PASS ' + name); await persist(); };
let responseMode = 'valid';
let progressStream;
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SiteCaptureViewer} from '/src/pages/SiteCaptureViewer.tsx';
import '/src/theme/theme-palette.css';
const result = ${JSON.stringify(result)};
function Fixture() {
  const [open, setOpen] = React.useState(true);
  return React.createElement(React.Fragment, null,
    React.createElement('h1', null, 'Synthetic Gaussian renderer fixture — not a reconstruction'),
    React.createElement('button', {onClick: () => setOpen(true)}, '打开测试漫游'),
    open && React.createElement(SiteCaptureViewer, {title: '合成渲染测试 · 非实拍重建', contentUrl: '${contentPath}', result, onClose: () => setOpen(false)}));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const server = await createServer({
  configFile: false, cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(process.env.SITE_CAPTURE_VIEWER_TEST_PORT || 5317), strictPort: true },
  plugins: [{ name: 'site-capture-viewer-fixture',
    resolveId(value) { if (value === '/__capture-viewer-entry.js') return '\0capture-viewer-entry'; },
    load(value) { if (value === '\0capture-viewer-entry') return entry; },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        const path = new URL(req.url, 'http://fixture.invalid').pathname;
        if (path === '/__capture-viewer') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/__capture-viewer-entry.js"></script></html>'); return; }
        if (path !== contentPath) return next();
        if (responseMode === 'forbidden') { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"forbidden","message":"PRIVATE_SERVER_TEXT_MUST_NOT_RENDER"}'); return; }
        if (responseMode === 'network') { req.socket.destroy(); return; }
        if (responseMode === 'stalled-headers') return;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', responseMode === 'wrong-length' ? ply.length + 1 : ply.length);
        if (responseMode === 'stalled') { res.write(ply.subarray(0, 1024)); return; }
        if (responseMode === 'progressing') { progressStream = res; res.write(ply.subarray(0, 1024)); return; }
        if (responseMode === 'slow') { res.write(ply.subarray(0, 1024)); const timer = setTimeout(() => res.end(ply.subarray(1024)), 2000); res.on('close', () => clearTimeout(timer)); return; }
        if (responseMode === 'invalid') { const invalid = Buffer.from(ply); invalid.writeFloatLE(NaN, header.length); res.end(invalid); return; }
        res.end(ply);
      });
    },
  }],
});
let browser;
try {
  console.log('OUTPUT ' + output);
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) { audit.externalRequests.push(url.origin); await route.abort('blockedbyclient'); return; }
    await route.continue();
  });
  await context.addInitScript(() => {
    window.__captureAudit = { workers: 0, frames: 0, requests: 0, credentials: [] };
    const WorkerBase = window.Worker;
    window.Worker = class extends WorkerBase {
      constructor(...args) { super(...args); window.__captureAudit.workers++; this.__ended = false; }
      terminate() { if (!this.__ended) { window.__captureAudit.workers--; this.__ended = true; } return super.terminate(); }
    };
    const nativeRequest = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => nativeRequest(time => { window.__captureAudit.frames++; callback(time); });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (url, options) => { if (String(url).includes('/site-captures/')) { window.__captureAudit.requests++; window.__captureAudit.credentials.push(options?.credentials); } return nativeFetch(url, options); };
  });
  const page = await context.newPage();
  page.on('pageerror', error => audit.pageErrors.push(error.message));
  const open = () => page.getByRole('button', { name: '打开测试漫游' }).click();
  const close = () => page.getByRole('button', { name: '关闭写实漫游' }).click();
  const ready = () => page.getByRole('button', { name: '回到初始视角' }).waitFor({ state: 'visible' }).then(() => page.waitForFunction(() => !document.querySelector('button:disabled') && !!document.querySelector('.site-capture-viewer-navigation')));
  await page.goto(base + '__capture-viewer');
  await ready();
  const canvas = page.locator('.site-capture-viewer canvas');
  await page.screenshot({ path: join(output, 'desktop-dark.png') }); audit.screenshots.push('desktop-dark.png');
  assert.ok(await canvas.evaluate(node => node.width > 100 && node.height > 100));
  const credentials = await page.evaluate(() => window.__captureAudit.credentials);
  assert.deepEqual(credentials, ['include']);
  await mark('Real WebGL2 + Spark initializes SH0 fixture without runtime external requests; project content uses authenticated fetch');
  const original = await canvas.screenshot();
  const pixels = colouredPixels(original);
  assert.ok(pixels.red > 1000 && pixels.green > 1000 && pixels.blue > 1000, `Synthetic blocks must actually render: ${JSON.stringify(pixels)}`);
  audit.colouredPixels = pixels;
  await canvas.click({ position: { x: 300, y: 200 } });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW');
  const moved = await canvas.screenshot(); assert.notDeepEqual(original, moved);
  await page.getByRole('button', { name: '回到初始视角' }).click(); await page.waitForTimeout(300);
  assert.deepEqual(await canvas.screenshot(), original);
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + 400, rect.y + 250); await page.mouse.down(); await page.mouse.move(rect.x + 460, rect.y + 230, { steps: 6 }); await page.mouse.up();
  assert.notDeepEqual(await canvas.screenshot(), original);
  await page.getByRole('button', { name: '回到初始视角' }).click(); await page.waitForTimeout(300);
  await page.getByRole('slider', { name: '漫游速度' }).focus();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up('KeyW');
  assert.deepEqual(await canvas.screenshot(), original);
  await mark('Keyboard movement, drag look, deterministic reset, and focused input isolation');
  await close();
  await page.waitForFunction(() => window.__captureAudit.workers === 0);
  const framesAfterClose = await page.evaluate(() => window.__captureAudit.frames);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__captureAudit.frames), framesAfterClose);
  assert.equal(await page.locator('canvas').count(), 0);
  await mark('Closing disposes canvas, animation loop, and every viewer worker');
  responseMode = 'slow'; await open();
  await page.getByText(/已读取 1.0 KB/).waitFor(); await close();
  await page.waitForTimeout(2100); assert.equal(await page.locator('canvas').count(), 0);
  responseMode = 'valid'; await open(); await ready(); await close();
  await page.waitForFunction(() => window.__captureAudit.workers === 0);
  await mark('Closing during streamed download aborts cleanly and repeated opening still works');
  for (const [mode, expected] of [['forbidden', '本次操作被拒绝'], ['wrong-length', '长度与任务记录不一致'], ['invalid', '文件结构已损坏'], ['network', '🔴 网络异常']]) {
    responseMode = mode; await open(); await page.getByRole('alert').filter({ hasText: expected }).waitFor();
    assert.equal(await page.getByText('PRIVATE_SERVER_TEXT_MUST_NOT_RENDER').count(), 0);
    responseMode = 'valid'; await page.getByRole('button', { name: '重新加载漫游' }).click(); await ready(); await close();
    await page.waitForFunction(() => window.__captureAudit.workers === 0);
  }
  await mark('Permission, mismatched length, invalid PLY and network errors are visible, safe, and manually retryable');
  await page.clock.install();
  for (const mode of ['stalled-headers', 'stalled']) {
    responseMode = mode; await open();
    await page.getByText(mode === 'stalled' ? /已读取 1.0 KB/ : /正在读取漫游文件/).waitFor();
    await page.clock.fastForward(30_001);
    await page.getByRole('alert').filter({ hasText: '🔴 网络异常' }).waitFor({ timeout: 5000 });
    await page.clock.resume();
    assert.equal(await page.locator('canvas').count(), 0);
    responseMode = 'valid'; await page.getByRole('button', { name: '重新加载漫游' }).click(); await ready(); await close();
    await page.waitForFunction(() => window.__captureAudit.workers === 0);
  }
  await mark('Stalled headers or a stopped content stream time out, dispose graphics, and can be retried without reopening the task');
  responseMode = 'progressing'; await open(); await page.getByText(/已读取 1.0 KB/).waitFor();
  await page.clock.fastForward(20_000); progressStream.write(ply.subarray(1024, 2048));
  await page.getByText(/已读取 2.0 KB/).waitFor(); await page.clock.fastForward(20_000);
  assert.equal(await page.getByRole('alert').count(), 0);
  progressStream.end(ply.subarray(2048)); await page.clock.resume(); await ready(); await close();
  responseMode = 'valid';
  await mark('A progressing download may exceed 30 seconds overall without a false timeout');
  await open(); await ready();
  await canvas.evaluate(node => node.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.getByRole('alert').filter({ hasText: '图形上下文已丢失' }).waitFor();
  await page.getByRole('button', { name: '重新加载漫游' }).click(); await ready(); await close();
  await mark('WebGL context loss pauses visibly and recovers only after explicit retry');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.documentElement.dataset.uiTheme = 'light');
  await open(); await ready();
  assert.ok(await page.locator('dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  const beforeTouch = await canvas.screenshot();
  const forward = page.getByRole('button', { name: '前进', exact: true });
  // Native touch input supplies a valid pointer id; use CDP to test the actual browser event path.
  const cdp = await context.newCDPSession(page);
  const buttonBox = await forward.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: buttonBox.x + buttonBox.width / 2, y: buttonBox.y + buttonBox.height / 2 }] });
  await page.waitForTimeout(300);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.notDeepEqual(await canvas.screenshot(), beforeTouch);
  await page.getByRole('button', { name: '回到初始视角' }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'mobile-light.png') }); audit.screenshots.push('mobile-light.png');
  await close(); await page.waitForFunction(() => window.__captureAudit.workers === 0);
  await mark('Narrow light layout fits and native touch controls navigate');
  const noWebglPage = await context.newPage();
  noWebglPage.on('pageerror', error => audit.pageErrors.push(error.message));
  await noWebglPage.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(name, ...args) { return name === 'webgl2' ? null : getContext.call(this, name, ...args); };
  });
  await noWebglPage.goto(base + '__capture-viewer');
  await noWebglPage.getByRole('alert').filter({ hasText: '浏览器无法启动 WebGL 2' }).waitFor();
  assert.equal(await noWebglPage.evaluate(() => window.__captureAudit.requests), 0);
  await noWebglPage.getByRole('button', { name: '关闭写实漫游' }).click();
  assert.equal(await noWebglPage.locator('dialog').count(), 0);
  await noWebglPage.close();
  await mark('Missing WebGL 2 gives a clear closeable error before downloading any content');
  assert.deepEqual(audit.pageErrors, []); assert.deepEqual(audit.externalRequests, []);
  audit.status = 'passed'; await persist();
} catch (error) {
  audit.status = 'failed'; audit.failure = error.stack; await persist(); throw error;
} finally {
  await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true });
}
