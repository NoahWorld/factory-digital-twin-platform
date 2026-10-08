import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createServer } = await import(web.resolve("vite"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const cacheDir = await mkdtemp(join(tmpdir(), "user-management-browser-"));
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { UsersPage } from '/src/pages/UsersPage.tsx';
import { NotificationProvider } from '/src/components/NotificationProvider.tsx';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
document.documentElement.dataset.uiTheme = 'light';
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
  React.createElement(NotificationProvider, null, React.createElement(UsersPage, { currentUserId: 'admin' }))));
`;
const server = await createServer({
  configFile: false,
  cacheDir,
  root: fileURLToPath(new URL("../apps/web", import.meta.url)),
  server: { host: "127.0.0.1", port: Number(process.env.USER_MANAGEMENT_TEST_PORT || 5204), strictPort: true },
  plugins: [{
    name: "user-management-browser-fixture",
    resolveId(id) { if (id === "/__user-management-entry.js") return "\0user-management-entry"; },
    load(id) { if (id === "\0user-management-entry") return fixture; },
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== "/__user-management-test") return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><div id=\"root\"></div><script type=\"module\" src=\"/__user-management-entry.js\"></script></html>");
      });
    },
  }],
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const users = [
    { id: "admin", email: "admin@example.invalid", loginName: "admin", displayName: "Admin",
      role: "platform_admin", modules: ["2d", "3d"], active: true },
    { id: "viewer", email: "viewer@example.invalid", loginName: "viewer", displayName: "Viewer",
      role: "viewer", modules: ["2d"], active: true },
  ];
  users.push(
    { id: "manager", email: "delivery@example.invalid", loginName: "delivery", displayName: "交付负责人", role: "delivery_manager", modules: ["2d", "3d"], active: true },
    { id: "designer", email: "designer@example.invalid", loginName: "designer", displayName: "场景设计师", role: "viewer", modules: ["3d"], active: true },
    { id: "pending", email: "pending@example.invalid", loginName: "pending", displayName: "待授权用户", role: "viewer", modules: [], active: true },
    { id: "long", email: "long-user-name-for-layout-validation@example.invalid", loginName: "long.username.for.layout.validation", displayName: "用于检查长名称显示的团队协作账号", role: "viewer", modules: ["2d", "3d"], active: true },
  );
  let failDetail = false;
  let failSave = false;
  let releaseDetail;
  let detailGate;
  let releaseSave;
  let saveGate;
  const writes = [];
  await page.route("**/api/v1/users**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const segments = path.split("/");
    const id = segments[4];
    const user = users.find((item) => item.id === id);
    const payload = method === "POST" && path.endsWith("/restore") ? null
      : ["POST", "PUT", "PATCH"].includes(method) ? request.postDataJSON() : null;
    let status = 200;
    let body;
    if (path === "/api/v1/users" && method === "GET") body = { users };
    else if (path === "/api/v1/users" && method === "POST") {
      const created = { id: `new-${users.length}`, email: payload.email, loginName: payload.loginName,
        displayName: payload.displayName, role: payload.role, modules: payload.modules, active: true };
      users.push(created);
      writes.push({ method, id: created.id, payload });
      status = 201;
      body = { user: { ...created, roles: [created.role] } };
    } else if (!user) { status = 404; body = { error: "user_not_found" }; }
    else if (method === "GET") {
      if (detailGate) await detailGate;
      if (failDetail) { status = 503; body = { error: "service_unavailable", message: "private diagnostic details" }; }
      else body = { user };
    }
    else if (method === "PUT" && failSave) { status = 503; body = { error: "service_unavailable" }; }
    else if (method === "PUT") {
      if (saveGate) await saveGate;
      Object.assign(user, { email: payload.email, loginName: payload.loginName,
        displayName: payload.displayName, role: payload.role, modules: payload.modules });
      writes.push({ method, id, payload });
      body = { user };
    } else if (method === "PATCH" && path.endsWith("/modules")) {
      user.modules = payload.modules;
      writes.push({ method, id, payload });
      body = { userId: id, modules: user.modules };
    } else if (method === "DELETE") {
      user.active = false;
      writes.push({ method, id });
      status = 204;
    } else if (method === "POST" && path.endsWith("/restore")) {
      user.active = true;
      writes.push({ method: "RESTORE", id });
      body = { user };
    } else { status = 404; body = { error: "not_found" }; }
    await route.fulfill(status === 204 ? { status }
      : { status, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${server.resolvedUrls.local[0]}__user-management-test`);
  await page.getByRole("region", { name: "用户管理", exact: true }).waitFor();
  const cards = page.locator(".user-card");
  const dialog = page.getByRole("dialog");
  const userCard = (name) => page.getByRole("button", { name: `设置用户 ${name}`, exact: true });
  const filter = (name) => page.getByRole("group", { name: "账号状态" }).getByRole("button", { name: new RegExp(`^${name}`) });
  const screenshot = async (suffix = "") => {
    if (process.env.USER_MANAGEMENT_SCREENSHOT) await page.screenshot({ path: process.env.USER_MANAGEMENT_SCREENSHOT.replace(/\.png$/, `${suffix}.png`), animations: "disabled" });
  };
  await userCard("Viewer").waitFor();
  assert.equal(await cards.count(), 6);
  assert.equal(await dialog.count(), 0, "settings should not occupy the list page");
  assert.equal(await cards.getByRole("checkbox").count(), 0, "cards display grants without writing them");
  await screenshot();

  // Keyboard opening, focus containment, canceling edits, and focus restoration.
  await userCard("Viewer").focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("显示名称").fill("Discarded change");
  await page.getByLabel("3D 场景", { exact: true }).check();
  assert.equal(writes.length, 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await userCard("Viewer").evaluate((element) => element === document.activeElement), true);
  await userCard("Viewer").click();
  await page.getByLabel("显示名称").waitFor();
  assert.equal(await page.getByLabel("显示名称").inputValue(), "Viewer");
  assert.equal(await page.getByLabel("3D 场景", { exact: true }).isChecked(), false);
  await page.getByLabel("显示名称").fill("Edited Viewer");
  await page.getByRole("combobox", { name: "全局角色" }).click();
  await page.getByRole("option", { name: "交付负责人" }).click();
  await page.getByLabel("3D 场景", { exact: true }).check();
  await screenshot("-settings");

  // Failed writes keep the draft, show the shared notification, and remain retryable.
  failSave = true;
  await page.getByRole("button", { name: "保存修改" }).click();
  await dialog.locator(".notification[data-kind=error]").waitFor();
  assert.equal(await page.getByLabel("显示名称").inputValue(), "Edited Viewer");
  assert.equal(writes.length, 0);
  await dialog.getByRole("button", { name: "关闭通知" }).click();
  failSave = false;
  saveGate = new Promise((resolve) => { releaseSave = resolve; });
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("button", { name: "正在保存…" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "关闭用户设置" }).isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  releaseSave();
  saveGate = undefined;
  await dialog.waitFor({ state: "detached" });
  await userCard("Edited Viewer").waitFor();
  assert.equal(writes.at(-1).method, "PUT");
  assert.equal(writes.at(-1).payload.role, "delivery_manager");
  assert.deepEqual(writes.at(-1).payload.modules, ["2d", "3d"]);
  assert.match(await userCard("Edited Viewer").innerText(), /交付负责人/);

  await userCard("Edited Viewer").click();
  await page.getByLabel("2D 看板", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存修改" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(writes.at(-1).payload.modules, ["3d"]);
  assert.equal(writes.at(-1).method, "PUT");

  await userCard("Edited Viewer").click();
  await page.getByRole("button", { name: "删除账号", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "保存修改" }).isDisabled(), true);
  await page.getByRole("button", { name: "确认删除 Edited Viewer" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(users.find((item) => item.id === "viewer").active, false);
  assert.equal(await userCard("Edited Viewer").count(), 0);
  assert.equal(await page.getByRole("button", { name: "新建用户", exact: true }).evaluate((element) => element === document.activeElement), true);
  await filter("已删除").click();
  await userCard("Edited Viewer").click();
  await page.getByRole("button", { name: "恢复账号" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(users.find((item) => item.id === "viewer").active, true);

  // Creating from a deleted/search view reveals the new card on success.
  await page.getByRole("searchbox", { name: "搜索用户" }).fill("no-match");
  await page.getByRole("button", { name: "新建用户", exact: true }).click();
  await page.getByLabel("显示名称").fill("New Operator");
  await page.getByLabel("登录账号").fill("newoperator");
  await page.getByLabel("邮箱", { exact: true }).fill("newoperator@example.invalid");
  await page.getByLabel("初始密码").fill("temporary-password-2026");
  await page.getByLabel("2D 看板", { exact: true }).check();
  await page.getByRole("button", { name: "创建账号" }).click();
  await dialog.waitFor({ state: "detached" });
  await userCard("New Operator").waitFor();
  assert.equal(writes.at(-1).method, "POST");
  assert.deepEqual(writes.at(-1).payload.modules, ["2d"]);
  await filter("全部").click();
  await page.getByRole("searchbox", { name: "搜索用户" }).fill("newoperator");
  assert.equal(await cards.count(), 1);
  assert.match(await cards.innerText(), /New Operator/);
  await page.getByRole("searchbox", { name: "搜索用户" }).fill("");

  await userCard("Admin").click();
  await page.getByRole("combobox", { name: "全局角色" }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "全局角色" }).isDisabled(), true);
  assert.equal(await page.getByLabel("2D 看板", { exact: true }).isDisabled(), true);
  assert.equal(await page.locator(".users-create-modules label").first().evaluate((element) => getComputedStyle(element).backgroundColor),
    await page.getByRole("combobox", { name: "全局角色" }).evaluate((element) => getComputedStyle(element).backgroundColor), "fixed administrator grants use the read-only surface");
  assert.equal(await page.getByRole("button", { name: "删除账号", exact: true }).count(), 0);
  await page.getByRole("button", { name: "关闭用户设置" }).click();

  // No editable stale form on read failure; retry loads the actual account.
  failDetail = true;
  await userCard("New Operator").click();
  await dialog.getByRole("button", { name: "重试" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "保存修改" }).count(), 0);
  assert.doesNotMatch(await dialog.innerText(), /private diagnostic details|503|service_unavailable/);
  failDetail = false;
  await dialog.getByRole("button", { name: "重试" }).click();
  await page.getByLabel("显示名称").waitFor();
  assert.equal(await page.getByLabel("显示名称").inputValue(), "New Operator");
  await page.keyboard.press("Escape");

  // Closing an in-flight read must not populate a subsequently opened create form.
  detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  const pendingRead = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/users/viewer");
  await userCard("Edited Viewer").click();
  await pendingRead;
  await dialog.getByText("正在读取账号详情…").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "新建用户", exact: true }).click();
  releaseDetail();
  detailGate = undefined;
  await page.getByLabel("显示名称").fill("Fresh draft");
  assert.equal(await dialog.getByRole("heading", { name: "新建用户" }).isVisible(), true);
  await page.getByRole("button", { name: "关闭用户设置" }).click();

  while (await page.getByRole("button", { name: "关闭通知" }).count()) await page.getByRole("button", { name: "关闭通知" }).first().click();
  await page.evaluate(() => { document.documentElement.dataset.uiTheme = "dark"; });
  await screenshot("-dark");
  await userCard("Edited Viewer").click();
  await page.getByLabel("显示名称").waitFor();
  await screenshot("-settings-dark");
  await page.getByRole("button", { name: "关闭用户设置" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.uiTheme = "light"; });
  await screenshot("-mobile");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await userCard("Edited Viewer").click();
  await page.getByLabel("显示名称").waitFor();
  await screenshot("-settings-mobile");
  assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.getByRole("button", { name: "保存修改" }).evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight), true);
  await page.getByRole("button", { name: "关闭用户设置" }).focus();
  await page.keyboard.press("Shift+Tab");
  // Native modal navigation may visit browser chrome (document.body), but never the inert list.
  for (let step = 0; step < 12; step++) {
    assert.equal(await dialog.evaluate((element) => document.activeElement === document.body || element.contains(document.activeElement)), true);
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 680 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log("PASS: user cards, modal create/edit/grants/delete/restore, cancel/focus, failure retry, pending requests, search, themes, and mobile layout.");
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
