// Isolated real-component browser regression. No application API or credentials.
// Optional: DTWIN_PLAYWRIGHT_MODULE, DTWIN_BROWSER_CHANNEL, DTWIN_NOTIFICATION_TEST_OUTPUT_DIR, DTWIN_NOTIFICATION_TEST_PORT.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createServer } = await import(web.resolve("vite"));
const modulePath = process.env.DTWIN_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE_PATH
  || "/Users/doudou/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const parent = process.env.DTWIN_NOTIFICATION_TEST_OUTPUT_DIR ? resolve(process.env.DTWIN_NOTIFICATION_TEST_OUTPUT_DIR) : tmpdir();
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, "dtwin-notifications-"));
await chmod(output, 0o700);
const cacheDir = await mkdtemp(join(tmpdir(), "dtwin-notifications-cache-"));
const audit = { scope: "isolated real NotificationProvider; no backend calls", status: "running", checks: [], screenshots: [], pageErrors: [], unexpectedRequests: [] };
const persist = () => writeFile(join(output, "results.json"), JSON.stringify(audit, null, 2) + "\n", { mode: 0o600 });
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiRequestError, UserFacingError } from '/src/api.ts';
import { NotificationProvider, useNotifications, notifications } from '/src/components/NotificationProvider.tsx';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
const h = React.createElement;
const makeError = () => new ApiRequestError('internal_error', 'fixture-trace-123',
  'private-password=fixture-secret; SQLSTATE private-host; body=private-body',
  {status: 500, method: 'POST', path: '/api/v1/fixture?token=private-query'});
const repeated = makeError();
function Actions() {
  const notify = useNotifications();
  const button = (id, text, onClick) => h('button', {id, type:'button', onClick}, text);
  return h('main', {id:'fixture'}, h('h1', null, '通知组件测试'),
    button('repeat', '同一次失败', () => notifications.error(repeated)),
    button('new-error', '新的失败', () => notify.error(makeError())),
    button('success', '成功提示', () => notify.success('保存成功。')),
    button('info', '信息提示', () => notify.info('预览已打开。')),
    button('warning', '提醒提示', () => notify.warning('有未保存的修改，请先保存。')),
    button('same-warning', '同文案提醒', () => notify.warning('保存成功。')),
    button('operation-error', '操作失败', () => notify.error(makeError(), {key:'fixture-operation'})),
    button('operation-success', '操作成功', () => notify.success('更新完成。', {key:'fixture-operation'})),
    button('local', '本地提示', () => notify.error(new UserFacingError('请先选择一个组件。'))),
    button('open-dialog', '打开弹窗', () => document.getElementById('fixture-dialog').showModal()),
    h('dialog', {id:'fixture-dialog', 'aria-label':'通知测试弹窗'},
      h('h2', null, '弹窗内操作'),
      button('dialog-error', '弹窗中失败', () => notify.error(makeError())),
      button('close-dialog', '关闭弹窗', () => document.getElementById('fixture-dialog').close())),
    button('fullscreen', '进入全屏', async () => {
      try { await document.getElementById('fixture').requestFullscreen(); }
      catch (error) { window.fixtureFullscreenError = String(error); }
    }));
}
createRoot(document.getElementById('root')).render(h(React.StrictMode, null, h(NotificationProvider, null, h(Actions))));
`;
const server = await createServer({ configFile: false, cacheDir,
  root: fileURLToPath(new URL("../apps/web", import.meta.url)),
  server: { host: "127.0.0.1", port: Number(process.env.DTWIN_NOTIFICATION_TEST_PORT || 5297), strictPort: true },
  plugins: [{ name: "notification-browser-fixture",
    resolveId(id) { if (id === "/__notification-entry.js") return "\0notification-entry"; },
    load(id) { if (id === "\0notification-entry") return fixture; },
    configureServer(instance) {
      instance.middlewares.use((req, res, next) => {
        if (req.url !== "/__notifications") return next();
        res.setHeader("Content-Type", "text/html");
        res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
          <style>#fixture{padding:240px 18px 30px;max-width:100%;box-sizing:border-box}#fixture h1{font-size:20px}#fixture button{margin:4px;padding:6px}#fixture:fullscreen{background:var(--ui-bg);overflow:auto}#fixture-dialog{width:280px;max-width:calc(100vw - 48px);padding:16px;box-sizing:border-box;background:var(--ui-bg);color:var(--ui-text);border:1px solid var(--ui-border)}*,*::before,*::after{animation:none!important;transition:none!important}</style>
          </head><body><div id="root"></div><script type="module" src="/__notification-entry.js"></script></body></html>`);
      });
    },
  }],
});
let browser;
console.log(`OUTPUT ${output}`);
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || "chrome", headless: true });
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 360, height: 900 }, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.addInitScript(theme => {
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.uiTheme = theme; });
      window.notificationDiagnostics = [];
      const original = console.error;
      console.error = (...args) => {
        if (args[0] === "[DTwin] 操作失败") window.notificationDiagnostics.push(args[1]);
        original.apply(console, args);
      };
    }, theme);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin || /^\/api\//.test(url.pathname) || route.request().method() !== "GET") {
        audit.unexpectedRequests.push(`${route.request().method()} ${url.pathname}`);
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on("pageerror", error => audit.pageErrors.push(error.message));
    await page.goto(`${base}__notifications`);
    await page.locator("#repeat").waitFor();
    await page.clock.install();
    const region = page.getByRole("region", { name: "通知", exact: true });
    const items = region.locator(".notification");
    const item = kind => region.locator(`.notification[data-kind="${kind}"]`);
    const click = async id => { await page.locator(`#${id}`).click(); await page.clock.runFor(20); };
    const check = async (name, run) => {
      await run(); audit.checks.push({ theme, name }); console.log(`PASS ${theme}/${name}`); await persist();
    };
    const clear = async () => { while (await items.count()) await items.first().getByRole("button", { name: "关闭通知", exact: true }).click(); };
    const count = async expected => assert.equal(await items.count(), expected);
    await check("safe-visible-error-and-traceable-console", async () => {
      await click("repeat");
      await item("error").waitFor();
      assert.equal(await item("error").getAttribute("role"), "alert");
      assert.equal(await item("error").getAttribute("aria-atomic"), "true");
      assert.match(await item("error").innerText(), /服务.*异常.*请/);
      assert.equal(await item("error").locator("details, summary, dl").count(), 0);
      assert.doesNotMatch(await region.innerText(), /internal_error|fixture-|private-|500|api\/v1|SQLSTATE|查看错误详情/);
      const diagnostics = await page.evaluate(() => window.notificationDiagnostics);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].requestId, "fixture-trace-123");
      assert.equal(diagnostics[0].path, "/api/v1/fixture");
      assert.equal(diagnostics[0].status, 500);
      assert.doesNotMatch(JSON.stringify(diagnostics), /private-|fixture-secret|password|SQLSTATE|body|stack|cause/);
    });
    await check("duplicates-have-one-notice-and-one-diagnostic", async () => {
      await click("repeat"); await click("repeat"); await count(1);
      assert.equal(await page.evaluate(() => window.notificationDiagnostics.length), 1);
      await click("new-error"); await count(1);
      assert.equal(await page.evaluate(() => window.notificationDiagnostics.length), 2);
    });
    await check("360px-both-theme-layout", async () => {
      const layout = await region.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return { width: innerWidth, right: bounds.right, left: bounds.left,
          overflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > innerWidth + 1,
          itemOverflow: [...element.children].some(item => item.scrollWidth > item.clientWidth + 1),
          background: getComputedStyle(element.firstElementChild).backgroundColor };
      });
      assert.equal(layout.width, 360); assert.equal(layout.overflow, false); assert.equal(layout.itemOverflow, false);
      assert.ok(layout.left >= -1 && layout.right <= 361);
      const path = join(output, `${theme}-notification.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" }); await chmod(path, 0o600);
      audit.screenshots.push({ path, theme, layout });
    });
    await check("keyboard-dismiss", async () => {
      await item("error").getByRole("button", { name: "关闭通知", exact: true }).focus();
      await page.keyboard.press("Enter"); await count(0);
    });
    await check("hook-and-global-api-share-one-queue", async () => {
      await click("success"); await click("info"); await click("warning");
      await count(3);
      for (const kind of ["success", "info", "warning"]) assert.equal(await item(kind).getAttribute("role"), "status");
      await clear();
    });
    await check("deduplicate-kind-and-message-without-merging-different-kinds", async () => {
      await click("success"); await click("success"); await count(1);
      await click("same-warning"); await count(2); await clear();
    });
    await check("operation-success-replaces-previous-failure", async () => {
      await click("operation-error"); await click("operation-success"); await count(1);
      assert.equal(await item("error").count(), 0); assert.match(await item("success").innerText(), /更新完成/); await clear();
    });
    await check("reviewed-local-guidance", async () => {
      await click("local"); assert.match(await item("error").innerText(), /请先选择一个组件/); await clear();
    });
    await check("automatic-lifetimes", async () => {
      await click("success"); await click("info"); await click("warning"); await click("repeat");
      await page.mouse.move(0, 899); await page.clock.fastForward(4100);
      assert.equal(await item("success").count(), 0); assert.equal(await item("info").count(), 0); await count(2);
      await page.clock.fastForward(4100); await count(0);
    });
    await check("duplicate-refreshes-expiry", async () => {
      await click("success"); await page.clock.fastForward(3000); await click("success");
      await page.clock.fastForward(2000); await count(1); await page.clock.fastForward(2100); await count(0);
    });
    await check("hover-and-keyboard-focus-preserve-reading-time", async () => {
      await click("repeat"); await item("error").hover(); await page.clock.runFor(20);
      await page.clock.fastForward(9000); await count(1);
      await item("error").getByRole("button", { name: "关闭通知", exact: true }).focus();
      await page.mouse.move(0, 899); await page.clock.runFor(20); await page.clock.fastForward(9000); await count(1);
      await page.locator("#repeat").focus(); await page.clock.runFor(20); await page.clock.fastForward(8100); await count(0);
    });
    await check("modal-notice-remains-visible-and-interactive", async () => {
      await click("open-dialog");
      await page.waitForFunction(() => document.querySelector('dialog:modal .notification-region'));
      await click("dialog-error");
      assert.equal(await item("error").isVisible(), true);
      assert.doesNotMatch(await item("error").innerText(), /private-|internal_error|fixture-|500|api\/v1/);
      assert.equal(await region.evaluate(element => element.parentElement.matches('dialog:modal')), true);
      await item("error").getByRole("button", { name: "关闭通知", exact: true }).click();
      await count(0);
      await click("dialog-error");
      const path = join(output, `${theme}-modal-notification.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" }); await chmod(path, 0o600);
      audit.screenshots.push({ path, theme, surface: "modal" });
    });
    await check("closing-modal-restores-visible-body-notice", async () => {
      await click("close-dialog");
      await page.waitForFunction(() => document.querySelector('.notification-region')?.parentElement === document.body);
      assert.equal(await item("error").isVisible(), true);
      await item("error").getByRole("button", { name: "关闭通知", exact: true }).focus();
      await page.keyboard.press("Enter"); await count(0);
    });
    await check("visible-inside-fullscreen", async () => {
      await click("fullscreen");
      await page.waitForFunction(() => document.fullscreenElement || window.fixtureFullscreenError);
      assert.equal(await page.evaluate(() => window.fixtureFullscreenError), undefined);
      await click("repeat");
      assert.equal(await page.evaluate(() => document.fullscreenElement.contains(document.querySelector('.notification-region'))), true);
      assert.equal(await item("error").isVisible(), true);
      await page.evaluate(() => document.exitFullscreen()); await clear();
    });
    await check("fullscreen-modal-takes-priority-and-restores-fullscreen-then-body", async () => {
      await click("fullscreen");
      await page.waitForFunction(() => document.fullscreenElement);
      await click("open-dialog");
      await page.waitForFunction(() => document.querySelector('dialog:modal .notification-region'));
      await click("dialog-error");
      assert.equal(await item("error").isVisible(), true);
      await item("error").getByRole("button", { name: "关闭通知", exact: true }).click(); await count(0);
      await click("dialog-error"); await click("close-dialog");
      await page.waitForFunction(() => document.querySelector('.notification-region')?.parentElement === document.fullscreenElement);
      assert.equal(await item("error").isVisible(), true);
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => document.querySelector('.notification-region')?.parentElement === document.body);
      assert.equal(await item("error").isVisible(), true); await clear();
    });
    await context.close();
  }
  assert.deepEqual(audit.unexpectedRequests, []); assert.deepEqual(audit.pageErrors, []);
  assert.notEqual(audit.screenshots.find(item => item.theme === "light" && item.layout).layout.background,
    audit.screenshots.find(item => item.theme === "dark" && item.layout).layout.background,
    "Light and dark themes must render distinct notification surfaces");
  audit.status = "passed";
} catch (error) {
  audit.status = "failed"; audit.error = error instanceof Error ? error.message : String(error);
  console.error(`FAIL ${audit.error}`); process.exitCode = 1;
} finally {
  try { if (browser) await browser.close(); }
  finally { await server.close(); await rm(cacheDir, { recursive: true, force: true }); await persist(); }
  console.log(`${audit.status === "passed" ? "PASS" : "FAIL"} ${audit.checks.length}/30 notification checks`);
  console.log(`AUDIT ${join(output, "results.json")}`);
}
