import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
// Optional developer/CI tooling: this test never installs a browser or calls the application API.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cacheDir = await mkdtemp(join(tmpdir(), 'select-browser-cache-'));
const longLabel = '行业案例｜双列生化污水处理与再生水厂｜设备状态与业务数据总览看板（模拟数据，长项目名称完整展示）';
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from '/src/components/Select.tsx';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
const h = React.createElement;
const regularOptions = [
  ['alpha', 'Alpha'], ['bravo', 'Bravo'], ['disabled', 'Disabled', true],
  ['delta', 'Delta'], ['long', ${JSON.stringify(longLabel)}],
];
function Field({ id, options = regularOptions, initial = 'alpha', ...props }) {
  const [value, setValue] = useState(initial);
  return h('div', { className: 'test-field', 'data-field': id },
    h('label', { htmlFor: id }, id),
    h(Select, { id, value, onValueChange: setValue, ...props },
      options.map(([value, label, disabled]) => h('option', { key: value, value, disabled }, label))),
    h('output', { 'data-value': id }, value));
}
function App() {
  const [mounted, setMounted] = useState(true);
  const [fieldsetDisabled, setFieldsetDisabled] = useState(true);
  const [submits, setSubmits] = useState(0);
  return h(React.Fragment, null,
    h('main', { id: 'fixture' },
      h('h1', null, 'Select isolated browser fixture'),
      h(Field, { id: 'normal' }),
      h('button', { id: 'after-normal', type: 'button' }, 'Outside / next field'),
      h(Field, { id: 'disabled', disabled: true }),
      h('fieldset', { id: 'fieldset', disabled: fieldsetDisabled },
        h('legend', null, 'Disabled group'), h(Field, { id: 'fieldset-select' })),
      h('button', { id: 'toggle-fieldset', onClick: () => setFieldsetDisabled(value => !value) }, 'Toggle group'),
      h('form', { id: 'required-form', onSubmit: event => {
        event.preventDefault(); window.lastFormValue = new FormData(event.currentTarget).get('equipment');
        setSubmits(value => value + 1);
      } },
        h(Field, { id: 'required', name: 'equipment', required: true, initial: '', options: [['', '请选择'], ...regularOptions] }),
        h('button', { id: 'submit', type: 'submit' }, 'Submit'),
        h('output', { id: 'submits' }, submits)),
      h('button', { id: 'open-dialog', onClick: () => document.querySelector('#dialog').showModal() }, 'Open dialog'),
      h('dialog', { id: 'dialog' }, h(Field, { id: 'dialog-select' }),
        h('button', { id: 'close-dialog', onClick: () => document.querySelector('#dialog').close() }, 'Close dialog')),
      h('section', { id: 'fullscreen-root' },
        h('button', { id: 'enter-fullscreen', onClick: async () => {
          try { await document.querySelector('#fullscreen-root').requestFullscreen(); }
          catch (error) { window.fullscreenError = error.message; }
        } }, 'Enter fullscreen'), h(Field, { id: 'fullscreen-select' })),
      h('div', { id: 'scroller' }, h(Field, { id: 'scroll-select' }), h('div', { style: { height: 500 } })),
      mounted ? h(Field, { id: 'unmount-select' }) : null,
      h('button', { id: 'unmount', onClick: () => setMounted(false) }, 'Unmount select')),
    h('aside', { id: 'edge' }, h(Field, { id: 'edge-select', initial: 'item-0',
      options: Array.from({ length: 80 }, (_, i) => ['item-' + i, i === 0 ? ${JSON.stringify(longLabel)} : '设备选项 ' + i]) })),
  );
}
document.documentElement.dataset.uiTheme = 'light';
window.typeaheadShortcutCalls = 0;
window.addEventListener('keydown', event => {
  if (event.key === 'd') window.typeaheadShortcutCalls += 1;
});
createRoot(document.querySelector('#root')).render(h(React.StrictMode, null, h(App)));
`;
const server = await createServer({
  configFile: false,
  cacheDir,
  root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(process.env.SELECT_TEST_PORT || 5202), strictPort: true },
  plugins: [{
    name: 'select-browser-fixture',
    resolveId(id) { if (id === '/__select-test-entry.js') return '\0select-test-entry'; },
    load(id) { if (id === '\0select-test-entry') return fixture; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__select-test') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><meta charset="utf-8"><style>
          #fixture { padding: 20px; max-width: 470px; }
          .test-field { width: 310px; margin: 12px 0; }
          .test-field > label { display: block; margin-bottom: 4px; }
          .test-field > output { display: block; font-size: 11px; }
          #fixture button:not(.ui-select-trigger) { margin: 4px; }
          #edge { position: fixed; right: 2px; bottom: 2px; width: 160px; }
          #edge .test-field { width: 160px; margin: 0; }
          #scroller { height: 150px; overflow: auto; border: 1px solid; }
          #dialog { border: 1px solid; border-radius: 12px; padding: 20px; }
          #fullscreen-root:fullscreen { padding: 30px; background: var(--ui-bg); }
        </style></head><body><div id="root"></div>
        <script type="module" src="/__select-test-entry.js"></script></body></html>`);
      });
    },
  }],
});

let browser;
let deadline;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  page.setDefaultTimeout(6000);
  deadline = setTimeout(() => {
    console.error('Select browser test exceeded 60 seconds');
    void browser.close();
  }, 60000);
  deadline.unref();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text()); });
  await page.goto(`${server.resolvedUrls.local[0]}__select-test`);
  const trigger = id => page.locator(`#${id}[role="combobox"]`);
  const popup = page.getByRole('listbox');
  const value = id => page.locator(`[data-value="${id}"]`).textContent();
  const activeText = async id => trigger(id).evaluate(element => document.getElementById(element.getAttribute('aria-activedescendant'))?.textContent?.trim());
  const assertClosed = async id => {
    await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-expanded') === 'false', id);
    assert.equal(await popup.count(), 0);
  };
  const assertPopupInViewport = async () => {
    const bounds = await popup.boundingBox();
    assert.ok(bounds, 'The open menu must be visible');
    const viewport = page.viewportSize();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1,
      `The menu must stay inside the viewport: ${JSON.stringify({ bounds, viewport })}`);
  };

  await trigger('normal').waitFor();
  assert.equal(await page.locator('select:visible').count(), 0, 'No visible native select should remain');
  const backgrounds = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.uiTheme = theme; }, theme);
    await trigger('normal').click();
    assert.equal(await trigger('normal').getAttribute('aria-expanded'), 'true');
    assert.equal(await popup.getByRole('option', { name: 'Alpha', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await popup.getByRole('option', { name: 'Disabled', exact: true }).getAttribute('aria-disabled'), 'true');
    backgrounds.push(await popup.evaluate(element => getComputedStyle(element).backgroundColor));
    await assertPopupInViewport();
    const long = popup.getByRole('option', { name: longLabel, exact: true });
    assert.ok(await long.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Long Chinese labels must wrap instead of clipping');
    assert.notEqual(await long.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
    await popup.getByRole('option', { name: 'Bravo', exact: true }).click();
    assert.equal(await value('normal'), 'bravo');
    await assertClosed('normal');
    await trigger('normal').click();
    await popup.getByRole('option', { name: 'Alpha', exact: true }).click();
  }
  assert.notEqual(backgrounds[0], backgrounds[1], 'The portalled menu must inherit the active light/dark theme');
  console.log('Select: light/dark, selection, disabled options and long labels passed');

  await trigger('normal').focus();
  await page.keyboard.press('ArrowDown');
  await popup.waitFor();
  await page.keyboard.press('Home');
  assert.match(await activeText('normal'), /Alpha/);
  await page.keyboard.press('ArrowDown');
  assert.match(await activeText('normal'), /Bravo/);
  await page.keyboard.press('ArrowDown');
  assert.match(await activeText('normal'), /Delta/, 'Arrow navigation must skip disabled options');
  assert.equal(await value('normal'), 'alpha', 'Arrow navigation must not commit prematurely');
  await page.keyboard.press('Enter');
  assert.equal(await value('normal'), 'delta');
  await assertClosed('normal');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  assert.equal((await activeText('normal')).replace(/^[✓✔]\s*/, ''), longLabel);
  await page.keyboard.press('Enter');
  assert.equal(await value('normal'), 'long');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  assert.equal(await value('normal'), 'alpha');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('d');
  assert.match(await activeText('normal'), /Delta/, 'Typeahead must skip disabled matches');
  assert.equal(await page.evaluate(() => window.typeaheadShortcutCalls), 0, 'Typeahead must not trigger editor shortcuts');
  await page.keyboard.press('Escape');
  await assertClosed('normal');
  assert.equal(await trigger('normal').evaluate(element => document.activeElement === element), true);
  assert.equal(await value('normal'), 'alpha', 'Escape must preserve the previously committed value');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await assertClosed('normal');
  assert.equal(await page.locator('#after-normal').evaluate(element => document.activeElement === element), true, 'Tab must leave the combobox normally');
  await trigger('normal').click();
  await page.locator('#after-normal').click();
  await assertClosed('normal');
  console.log('Select: arrows, Home/End, Enter, typeahead, Escape, Tab and outside click passed');

  assert.equal(await trigger('disabled').isDisabled(), true);
  assert.equal(await trigger('fieldset-select').isDisabled(), true, 'Disabled fieldsets must disable the actual trigger');
  await trigger('fieldset-select').click({ force: true });
  assert.equal(await popup.count(), 0);
  await page.locator('#toggle-fieldset').click();
  assert.equal(await trigger('fieldset-select').isDisabled(), false);
  await trigger('fieldset-select').click();
  await popup.waitFor();
  await page.locator('#toggle-fieldset').click();
  await assertClosed('fieldset-select');
  await page.locator('#submit').click();
  assert.equal(await page.locator('#submits').textContent(), '0', 'A required empty selection must prevent form submission');
  await trigger('required').click();
  await popup.getByRole('option', { name: 'Delta', exact: true }).click();
  await page.locator('#submit').click();
  assert.equal(await page.locator('#submits').textContent(), '1');
  assert.equal(await page.evaluate(() => window.lastFormValue), 'delta');
  console.log('Select: disabled fieldsets and required form submission passed');

  await trigger('edge-select').click();
  await assertPopupInViewport();
  assert.equal(await popup.evaluate(element => element.scrollHeight > element.clientHeight), true, 'Long option lists must scroll');
  await page.keyboard.press('End');
  const last = popup.getByRole('option', { name: '设备选项 79', exact: true });
  assert.equal(await last.evaluate(element => {
    const option = element.getBoundingClientRect();
    const list = element.closest('[role="listbox"]').getBoundingClientRect();
    return option.top >= list.top - 1 && option.bottom <= list.bottom + 1;
  }), true, 'The active option must scroll into view');
  await page.keyboard.press('Enter');
  assert.equal(await value('edge-select'), 'item-79');
  await trigger('scroll-select').click();
  await page.locator('#scroller').evaluate(element => { element.scrollTop = 60; });
  // Implementations may close on ancestor scroll or reposition; both must avoid an orphaned menu.
  await page.waitForTimeout(50);
  if (await popup.count()) await assertPopupInViewport();
  await page.keyboard.press('Escape');
  await assertClosed('scroll-select');
  console.log('Select: viewport clamping, long-list scrolling and ancestor scrolling passed');

  await page.locator('#open-dialog').click();
  await trigger('dialog-select').click();
  assert.equal(await popup.evaluate(element => Boolean(element.closest('dialog[open]'))), true, 'A modal menu must stay in its dialog top layer');
  await popup.getByRole('option', { name: 'Delta', exact: true }).click();
  assert.equal(await value('dialog-select'), 'delta');
  await trigger('dialog-select').click();
  await page.keyboard.press('Escape');
  await assertClosed('dialog-select');
  assert.equal(await page.locator('#dialog').evaluate(element => element.open), true, 'Escape should dismiss the menu before its dialog');
  await page.locator('#close-dialog').click();
  await page.locator('#enter-fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement || window.fullscreenError);
  assert.equal(await page.evaluate(() => window.fullscreenError), undefined, 'The browser must permit fixture fullscreen');
  await trigger('fullscreen-select').click();
  assert.equal(await popup.evaluate(element => document.fullscreenElement.contains(element)), true, 'Fullscreen menus must render inside the fullscreen element');
  await popup.getByRole('option', { name: 'Bravo', exact: true }).click();
  assert.equal(await value('fullscreen-select'), 'bravo');
  await page.evaluate(() => document.exitFullscreen());
  console.log('Select: native dialog and real fullscreen passed');

  await trigger('unmount-select').click();
  await popup.waitFor();
  // Unmount without an outside pointer event, so this genuinely exercises portal/effect cleanup.
  await page.locator('#unmount').evaluate(element => element.click());
  await page.waitForFunction(() => !document.querySelector('#unmount-select'));
  assert.equal(await popup.count(), 0);
  await page.keyboard.press('ArrowDown');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  assert.deepEqual(errors, []);
  assert.ok(!requests.some(url => url.includes('/api/')), 'The fixture must not touch project data or an API');
  assert.ok(requests.every(url => url.startsWith(server.resolvedUrls.local[0])), 'The fixture must not request external resources');
  console.log('Select browser regression passed: themed custom menus, keyboard/accessibility, forms, portal positioning, dialog/fullscreen and disposal.');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
