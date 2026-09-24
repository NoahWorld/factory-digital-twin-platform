import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cacheDir = await mkdtemp(join(tmpdir(), 'fluid-editor-browser-'));
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FluidEditor, FluidLayers, useFluidEditor } from '/src/scene/FluidEditor.tsx';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
const h = React.createElement;
function App() {
  const [fluids, setFluids] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const editor = useFluidEditor({ fluids, onChange: setFluids, enabled });
  return h('main', { className: 'fixture' },
    h('aside', { className: 'standalone-3d-library' }, h(FluidLayers, { editor, onAdd: editor.start, onSelect: editor.select })),
    h('section', { className: 'fixture-canvas' },
      h('button', { id: 'point-surface', onClick: event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        editor.onPoint([Number(((event.clientX - bounds.left) / 10).toFixed(2)), editor.session?.offset ?? 0, Number(((event.clientY - bounds.top) / 10).toFixed(2))]);
      } }, '鼠标路径回调测试平面'),
      h('button', { id: 'permission', onClick: () => setEnabled(value => !value) }, 'Toggle editing permission'),
      h('pre', { id: 'saved' }, JSON.stringify(fluids)),
      h('pre', { id: 'preview' }, JSON.stringify(editor.previewFluids)),
      h('pre', { id: 'draft' }, JSON.stringify(editor.session)),
      h('output', { id: 'invalid' }, String(editor.hasInvalidFields))),
    h('aside', { className: 'standalone-3d-inspector' }, h(FluidEditor, { editor })));
}
createRoot(document.getElementById('root')).render(h(React.StrictMode, null, h(App)));
`;
const server = await createServer({
  configFile: false, cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(process.env.FLUID_EDITOR_TEST_PORT || 5218), strictPort: true },
  plugins: [{
    name: 'fluid-editor-browser-fixture',
    resolveId(id) { if (id === '/__fluid-editor-entry.js') return '\0fluid-editor-entry'; },
    load(id) { if (id === '\0fluid-editor-entry') return fixture; },
    configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url !== '/__fluid-editor-test') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html data-ui-theme="light"><head><meta charset="utf-8"><style>
      .fixture { display: grid; grid-template-columns: 235px minmax(260px,1fr) 320px; min-height:100vh; }
      .fixture > aside { padding:16px; overflow:auto; }
      .fixture-canvas { min-width:0; padding:20px; }
      #point-surface { width:240px; height:180px; margin-bottom:20px; border:2px solid #167eac; }
      pre { max-width:100%; overflow:auto; font-size:10px; }
      @media(max-width:760px) { .fixture { grid-template-columns:minmax(0,1fr); } .fixture > aside { width:100%; } }
      </style></head><body><div id="root"></div><script type="module" src="/__fluid-editor-entry.js"></script></body></html>`);
    }); },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1220, height: 1000 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
  await page.goto(`${server.resolvedUrls.local[0]}__fluid-editor-test`);
  const saved = async () => JSON.parse(await page.locator('#saved').textContent());
  const draft = async () => JSON.parse(await page.locator('#draft').textContent());
  const preview = async () => JSON.parse(await page.locator('#preview').textContent());
  const select = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const point = (x, y) => page.locator('#point-surface').click({ position: { x, y } });
  const apply = () => page.getByRole('button', { name: '应用流体', exact: true }).click();

  await page.getByRole('button', { name: '＋ 气体', exact: true }).click();
  assert.equal((await draft()).fluid.kind, 'gas');
  assert.equal((await saved()).length, 0);
  assert.equal((await preview()).length, 0);
  await point(20, 30);
  assert.equal((await draft()).fluid.points.length, 1);
  assert.equal((await saved()).length, 0, 'One point must stay in the temporary session');
  assert.equal(await page.getByRole('button', { name: '应用流体', exact: true }).isDisabled(), true);
  await point(120, 60);
  assert.equal((await preview()).length, 1, 'Valid paths should preview without persistence');
  assert.equal((await saved()).length, 0);
  await page.getByRole('button', { name: '取消路径修改', exact: true }).click();
  assert.equal(await draft(), null);
  assert.equal((await preview()).length, 0);
  assert.equal((await saved()).length, 0);
  console.log('Fluid editor: independent zero/one-point state, live preview and cancellation passed');

  for (const [kind, name, color] of [['gas', '气体', '#aabbee'], ['liquid', '液体', '#1177ee'], ['molten', '熔融体', '#ee7722']]) {
    await page.getByRole('button', { name: `＋ ${name}`, exact: true }).click();
    await point(20, 30); await point(120, 60); await point(170, 130);
    await select('表现形态', '扩散流 · 沿流向扩散');
    await select('流动方向', '反向：末点 → 首点');
    await page.getByLabel('流体颜色', { exact: true }).fill(color);
    assert.equal((await preview()).at(-1).kind, kind);
    assert.equal((await preview()).at(-1).mode, 'diffuse');
    assert.equal((await preview()).at(-1).direction, 'reverse');
    assert.equal((await preview()).at(-1).color, color);
    await apply();
    assert.equal((await saved()).at(-1).kind, kind);
    assert.equal((await saved()).at(-1).color, color);
  }
  assert.equal((await saved()).length, 3);
  console.log('Fluid editor: all three fluid kinds, configurable colors and reverse diffuse previews passed');

  const original = (await saved()).at(-1);
  await page.getByRole('button', { name: '编辑路径', exact: true }).click();
  await select('鼠标绘制平面', 'XY 竖直面（固定 Z）');
  await page.getByLabel('平面位置 Z', { exact: true }).fill('3');
  await page.getByLabel('平面位置 Z', { exact: true }).press('Tab');
  assert.equal((await draft()).plane, 'xy');
  assert.equal((await draft()).offset, 3);
  await page.getByRole('button', { name: /^1 · 首点/ }).click();
  await page.getByLabel('X', { exact: true }).fill('7.5');
  await page.getByLabel('X', { exact: true }).press('Tab');
  assert.equal((await draft()).fluid.points[0][0], 7.5);
  await point(80, 70);
  assert.equal((await draft()).fluid.points.length, 3, 'Selected point callback replaces instead of appending');
  await page.getByRole('button', { name: '删除此点', exact: true }).click();
  assert.equal((await draft()).fluid.points.length, 2);
  await page.getByRole('button', { name: '撤销上一点', exact: true }).click();
  assert.equal((await draft()).fluid.points.length, 1);
  assert.deepEqual((await saved()).at(-1), original, 'Editing a path cannot mutate the committed fluid');
  await page.getByRole('button', { name: '取消路径修改', exact: true }).click();
  assert.deepEqual((await saved()).at(-1), original);

  await page.getByRole('button', { name: '编辑路径', exact: true }).click();
  await page.getByRole('button', { name: '清空路径', exact: true }).click();
  await point(40, 40); await point(40, 40);
  assert.match(await page.getByRole('alert').textContent(), /must differ/);
  assert.deepEqual((await saved()).at(-1), original);
  await page.getByRole('button', { name: '撤销上一点', exact: true }).click();
  await point(100, 100);
  await page.getByLabel('流体半径', { exact: true }).fill('-1');
  assert.equal(await page.locator('#invalid').textContent(), 'true');
  assert.equal(await page.getByRole('button', { name: '应用流体', exact: true }).isDisabled(), true);
  await page.getByLabel('流体半径', { exact: true }).fill('0.7');
  await page.getByLabel('流体半径', { exact: true }).press('Tab');
  await apply();
  assert.equal((await saved()).at(-1).radius, 0.7);
  assert.equal((await saved()).at(-1).points.length, 2);
  await page.getByLabel('播放流动效果', { exact: true }).uncheck();
  assert.equal((await saved()).at(-1).playing, false);
  await page.getByLabel('显示流体', { exact: true }).uncheck();
  assert.equal((await saved()).at(-1).visible, false);
  await select('表现形态', '连续流 · 沿路径流动');
  await select('流动方向', '正向：首点 → 末点');
  assert.equal((await saved()).at(-1).mode, 'stream');
  assert.equal((await saved()).at(-1).direction, 'forward');
  await page.getByRole('button', { name: '移除', exact: true }).click();
  assert.equal((await saved()).length, 2);
  await page.getByRole('button', { name: /^液体 2/ }).click();
  assert.equal(await page.getByLabel('流体名称', { exact: true }).inputValue(), '液体 2');
  console.log('Fluid editor: plane state, point replacement/XYZ/deletion/undo, validation and cancel preservation passed');

  const backgrounds = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.uiTheme = theme; }, theme);
    backgrounds.push(await page.getByLabel('流体名称', { exact: true }).evaluate(element => getComputedStyle(element).backgroundColor));
    await page.getByRole('combobox', { name: '流体类型', exact: true }).click();
    assert.equal(await page.getByRole('listbox').isVisible(), true);
    await page.keyboard.press('Escape');
  }
  assert.notEqual(backgrounds[0], backgrounds[1]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.standalone-3d-inspector').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Narrow inspector must not overflow horizontally');
  await page.locator('#permission').click();
  assert.equal(await page.getByLabel('流体名称', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '＋ 气体', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('select').count(), 0, 'Use the shared Select component');
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, [], 'Isolated test must not access project/customer APIs');
  console.log('Fluid editor: light/dark, shared Select, narrow layout and read-only permissions passed');
} finally {
  if (browser) await browser.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
