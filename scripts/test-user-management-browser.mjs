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
import '/src/styles.css';
import '/src/theme/theme-palette.css';
document.documentElement.dataset.uiTheme = 'light';
createRoot(document.getElementById('root')).render(React.createElement(UsersPage, { currentUserId: 'admin' }));
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
    else if (method === "GET") body = { user };
    else if (method === "PUT") {
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
  await page.getByRole("heading", { name: "用户管理" }).waitFor();
  await page.locator(".users-row").filter({ hasText: "Viewer" }).getByRole("button", { name: "管理" }).click();
  await page.getByLabel("显示名称").fill("Edited Viewer");
  await page.getByRole("combobox", { name: "全局角色" }).click();
  await page.getByRole("option", { name: "交付负责人" }).click();
  await page.locator(".users-create-modules").getByLabel("3D 场景").check();
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByText("已保存“Edited Viewer”的资料和权限。").waitFor();
  assert.equal(writes.at(-1).method, "PUT");
  assert.equal(writes.at(-1).payload.role, "delivery_manager");
  assert.deepEqual(writes.at(-1).payload.modules, ["2d", "3d"]);

  const editedRow = page.locator(".users-row").filter({ hasText: "Edited Viewer" });
  await editedRow.getByLabel("Edited Viewer的模块权限").getByLabel("2D").click();
  await page.getByText("已更新“Edited Viewer”的模块权限。").waitFor();
  assert.deepEqual(writes.at(-1).payload.modules, ["3d"]);

  await page.getByRole("button", { name: "删除账号" }).click();
  await page.getByRole("button", { name: "确认删除 Edited Viewer" }).click();
  await page.getByRole("button", { name: "恢复账号" }).waitFor();
  assert.equal(users.find((item) => item.id === "viewer").active, false);
  await page.getByRole("button", { name: "已删除" }).click();
  await page.locator(".users-row").filter({ hasText: "Edited Viewer" }).waitFor();
  await page.getByRole("button", { name: "恢复账号" }).click();
  await page.getByRole("button", { name: "保存修改" }).waitFor();
  assert.equal(users.find((item) => item.id === "viewer").active, true);

  await page.getByRole("button", { name: "新建用户" }).click();
  await page.getByLabel("显示名称").fill("New Operator");
  await page.getByLabel("登录账号").fill("newoperator");
  await page.getByLabel("邮箱").fill("newoperator@example.invalid");
  await page.getByLabel("初始密码").fill("temporary-password-2026");
  await page.locator(".users-create-modules").getByLabel("2D 看板").check();
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByText("已创建账号“New Operator”。").waitFor();
  assert.equal(writes.at(-1).method, "POST");
  assert.deepEqual(writes.at(-1).payload.modules, ["2d"]);
  await page.getByRole("button", { name: "全部" }).click();
  await page.getByRole("searchbox", { name: "搜索用户" }).fill("newoperator");
  assert.equal(await page.locator(".users-row").count(), 1);
  assert.match(await page.locator(".users-row").innerText(), /New Operator/);

  if (process.env.USER_MANAGEMENT_SCREENSHOT) await page.screenshot({ path: process.env.USER_MANAGEMENT_SCREENSHOT });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log("PASS: user management browser create, read, edit, module grant, delete, restore, search, and mobile layout.");
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
