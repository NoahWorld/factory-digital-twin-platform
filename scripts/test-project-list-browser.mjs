// Route/list regression using the real App and editor pages. API state is isolated in memory.
// Developer/CI supplies installed Playwright and Chrome; no credentials or live project writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createServer } = await import(web.resolve("vite"));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const cacheDir = await mkdtemp(join(tmpdir(), "project-list-browser-"));
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '/src/App.tsx';
import { ThemeProvider } from '/src/theme/ThemeProvider.tsx';
import { NotificationProvider } from '/src/components/NotificationProvider.tsx';
import { initializeUiTheme } from '/src/theme/ui-theme.ts';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
  React.createElement(ThemeProvider, { initialState: initializeUiTheme() },
    React.createElement(NotificationProvider, null, React.createElement(App)))));
`;
const now = "2026-10-09T00:00:00.000Z";
const project = (id, name, projectType) => ({ id, name, projectType, status: "draft",
  createdAt: now, updatedAt: now, projectRole: "owner", coverStatus: "ready", coverUrl: null,
  documentRevision: 1, coverRevision: 0, coverSourceRevision: 1 });
const projects = [project("example-3d", "接口驱动搬运单元 · 后端测试接口", "3d"), project("board-2d", "生产看板", "2d")];
const user = { id: "test-owner", email: "owner@example.invalid", loginName: "owner", displayName: "验收账号",
  roles: ["delivery_manager"], modules: ["2d", "3d"],
  capabilities: { canCreateProject: true, canManageUsers: false, canAccess2D: true, canAccess3D: true } };
const settings = { animationSpeed: 1, autoRotate: false, backgroundColor: "#e9edf3", backgroundOpacity: 1,
  cameraFov: 45, cameraView: "front", preventBottomView: true, environmentLightColor: "#ffffff",
  environmentLightIntensity: 1, keyLightColor: "#ffffff", keyLightIntensity: 2, modelScale: 1,
  playAnimations: false, rotationSpeed: .3, showGrid: false };
const limits = { maximumInstances: 128, maximumUniqueModelAssets: 24, maximumUniqueModelBytes: 157286400,
  maximumEstimatedMeshInstances: 6000, maximumAnimatedInstances: 24, maximumPatchInstances: 100 };
const scenes = new Map();
const drives = new Map();
const getScene = (id) => {
  if (!scenes.has(id)) scenes.set(id, { projectId: id, revision: 0, updatedAt: now, linked2dProjectId: null,
    instances: [], settings, decorations: [], roomAlarms: [], staticMap: null, fluids: [] });
  return scenes.get(id);
};
const getDrive = (id) => {
  if (!drives.has(id)) drives.set(id, { projectId: id, revision: 0, editable: true, config: { version: 1,
    enabled: false, source: "api", connection: { protocol: "rest", url: "", timestampPath: "timestamp", intervalMs: 500, timeoutMs: 5000 },
    points: [], bindings: [], colliders: [], collisionRules: [], procedures: [] } });
  return drives.get(id);
};
let projectRequests = 0;
let failList = false;
let failDocument = false;
const writes = [];
const unexpectedRequests = [];
const jsonResponse = (res, body, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};
const server = await createServer({ configFile: false, cacheDir,
  root: fileURLToPath(new URL("../apps/web", import.meta.url)),
  define: { "import.meta.env.VITE_API_BASE_URL": '""' },
  server: { host: "127.0.0.1", port: Number(process.env.PROJECT_LIST_TEST_PORT || 5206), strictPort: true, hmr: false },
  plugins: [{ name: "project-list-browser-fixture",
    resolveId(id) { if (id === "/__project-list-entry.js") return "\0project-list-entry"; },
    load(id) { if (id === "\0project-list-entry") return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url, "http://fixture.invalid").pathname;
      if (path === "/__project-list") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/__project-list-entry.js"></script></html>');
        return;
      }
      if (!path.startsWith("/api/")) return next();
      if (path === "/api/v1/auth/bootstrap-status") return jsonResponse(res, { setupRequired: false });
      if (path === "/api/v1/auth/me") return jsonResponse(res, { user });
      if (path === "/api/v1/test-business/handling-cell/state") return jsonResponse(res,
        { timestamp: new Date().toISOString(), agv: { positionM: 2, wheelAngleDeg: 716 },
          robot: { baseYawDeg: 0, shoulderDeg: 0, elbowDeg: 90, wristDeg: -90 },
          gripper: { openingM: .56 }, cargo: { xM: 0, yM: .845, zM: -2, yawDeg: 0 }, cycle: { phaseCode: 0 } });
      let body;
      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        body = JSON.parse(raw);
        writes.push({ path, method: req.method, body });
      }
      if (path === "/api/v1/projects" && req.method === "GET") {
        projectRequests += 1;
        return failList ? jsonResponse(res, { error: "service_unavailable", message: "Private upstream failure", requestId: "list-refresh-fixture" }, 503)
          : jsonResponse(res, { projects, nextOffset: null });
      }
      if (path === "/api/v1/projects" && req.method === "POST") {
        const created = project(`created-${projects.length}`, body.name, body.projectType);
        projects.unshift(created);
        return jsonResponse(res, { project: created }, 201);
      }
      const match = path.match(/^\/api\/v1\/projects\/([^/]+)\/(scene|canvas|model-assets|assets|twin-drive)$/);
      if (match) {
        const [, id, resource] = match;
        const item = projects.find(p => p.id === id);
        if (!item) return jsonResponse(res, { error: "project_not_found" }, 404);
        if (resource === "model-assets") return jsonResponse(res, { modelAssets: [] });
        if (resource === "assets") return jsonResponse(res, { assets: [] });
        if (failDocument && (resource === "scene" || resource === "canvas")) return jsonResponse(res, { error: "service_unavailable" }, 503);
        if (resource === "scene") {
          if (req.method === "PATCH") scenes.set(id, { ...getScene(id), revision: getScene(id).revision + 1,
            instances: body.upsertInstances, settings: body.settings });
          return jsonResponse(res, { project: item, scene: getScene(id), editable: true, limits, sceneExtensionsVersion: 1 });
        }
        if (resource === "twin-drive") {
          if (req.method === "PUT") drives.set(id, { ...getDrive(id), revision: getDrive(id).revision + 1, config: body.config });
          return jsonResponse(res, getDrive(id));
        }
        return jsonResponse(res, { project: item, editable: true, canvas: { projectId: id, revision: 0,
          width: 1920, height: 1080, updatedAt: now, nodes: [], theme: { mode: "light", presetId: "light-industrial",
            backgroundPattern: "none", fontFamily: "system", glowIntensity: 0, panelRadius: 8,
            backgroundColor: "#e9edf3", surfaceColor: "#ffffff", textColor: "#15233b", accentColor: "#235ee7", borderColor: "#ccd6e5" } } });
      }
      unexpectedRequests.push({ method: req.method, path });
      return jsonResponse(res, { error: "not_found" }, 404);
    }); },
  }],
});

let browser;
let deadline;
let page;
const pageErrors = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  deadline = setTimeout(() => { console.error("Project list browser regression exceeded 120 seconds"); void browser.close(); }, 120000);
  deadline.unref();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const diagnostics = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", msg => {
    if (msg.type() === "error" && msg.text().startsWith("[DTwin] 操作失败")) {
      diagnostics.push(msg.args()[1].jsonValue());
    }
  });
  const base = `${server.resolvedUrls.local[0]}__project-list`;
  const tab = type => page.getByRole("tab", { name: new RegExp(`^${type.toUpperCase()} `) });
  const exampleHeading = page.getByRole("heading", { name: projects[0].name, exact: true });
  await page.goto(`${base}#/projects?type=3d`);
  await exampleHeading.waitFor();
  assert.equal(await tab("3d").getAttribute("aria-selected"), "true");
  await page.reload();
  await exampleHeading.waitFor();
  assert.equal(await tab("3d").getAttribute("aria-selected"), "true", "reload retains explicit 3D filter");
  await tab("2d").click();
  await page.waitForURL("**#/**?type=2d");
  await page.getByRole("heading", { name: "生产看板", exact: true }).waitFor();
  assert.equal(await exampleHeading.count(), 0);
  await page.goBack();
  await exampleHeading.waitFor();
  await page.goForward();
  await tab("2d").waitFor();
  await tab("2d").press("ArrowRight");
  await exampleHeading.waitFor();
  assert.ok(page.url().endsWith("#/projects?type=3d"), "keyboard selection updates the URL");
  console.log("PASS URL, reload, history and keyboard preserve project type");

  await page.getByRole("link", { name: "打开 接口驱动搬运单元 · 后端测试接口 的独立 3D 场景", exact: true }).click();
  const return3d = page.getByRole("link", { name: "返回项目", exact: true });
  await return3d.waitFor();
  assert.equal(await return3d.getAttribute("href"), "#/projects?type=3d");
  await return3d.click();
  await exampleHeading.waitFor();
  await tab("2d").click();
  await page.getByRole("link", { name: "打开 生产看板 的2D 画布", exact: true }).click();
  const return2d = page.getByRole("link", { name: "返回项目列表", exact: true });
  await return2d.waitFor();
  assert.equal(await return2d.getAttribute("href"), "#/projects?type=2d");
  await return2d.click();
  await page.getByRole("heading", { name: "生产看板", exact: true }).waitFor();
  console.log("PASS both editors return to their own project type");

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "模板", exact: true }).click();
  await page.getByRole("tab", { name: /^3D 场景模板/ }).click();
  const exampleCard = page.locator(".scene-template-card").filter({ has: page.getByRole("heading", { name: "接口驱动搬运单元 · 送检与回收", exact: true }) });
  await exampleCard.getByRole("button", { name: "用模板创建 3D 项目", exact: true }).click();
  await page.getByRole("dialog").getByLabel("项目名称", { exact: true }).fill("新接口驱动示例");
  await page.getByRole("dialog").getByRole("button", { name: "创建并进入编辑器", exact: true }).click();
  await return3d.waitFor();
  await return3d.click();
  await page.getByRole("heading", { name: "新接口驱动示例", exact: true }).waitFor();
  assert.equal(await tab("3d").getAttribute("aria-selected"), "true");
  assert.equal(writes.filter(x => x.path === "/api/v1/projects").length, 1);
  assert.equal(writes.filter(x => x.path.endsWith("/scene")).length, 1);
  assert.equal(writes.filter(x => x.path.endsWith("/twin-drive")).length, 1);
  console.log("PASS newly created API example is discoverable in the 3D list");

  // An already open list learns about projects created elsewhere when it regains visibility/focus.
  const beforeRefresh = projectRequests;
  projects.unshift(project("external-3d", "另一页签创建的项目", "3d"));
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await page.getByRole("heading", { name: "另一页签创建的项目", exact: true }).waitFor();
  assert.equal(projectRequests, beforeRefresh + 1, "simultaneous focus/visibility triggers share one request");
  assert.equal(await tab("3d").getAttribute("aria-selected"), "true");
  failList = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("heading", { name: "项目列表加载失败", exact: true }).waitFor();
  const failureText = await page.locator("#project-list-panel").innerText();
  assert.match(failureText, /服务暂时异常/);
  assert.doesNotMatch(failureText, /Private upstream failure|list-refresh-fixture/);
  const reportedFailures = await Promise.all(diagnostics);
  assert.ok(reportedFailures.some(item => item.requestId === "list-refresh-fixture" && item.path === "/api/v1/projects"), "developer diagnostics retain request context");
  failList = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("heading", { name: "另一页签创建的项目", exact: true }).waitFor();
  console.log("PASS visible list refreshes, deduplicates requests, and exposes failures clearly");

  failDocument = true;
  await page.goto(`${base}#/projects/example-3d/scene`);
  await page.getByRole("heading", { name: "3D 项目加载失败", exact: true }).waitFor();
  assert.equal(await return3d.getAttribute("href"), "#/projects?type=3d");
  await return3d.click();
  await exampleHeading.waitFor();
  await page.goto(`${base}#/projects/board-2d/canvas`);
  await page.getByRole("heading", { name: "画布加载失败", exact: true }).waitFor();
  assert.equal(await return2d.getAttribute("href"), "#/projects?type=2d");
  await return2d.click();
  await page.getByRole("heading", { name: "生产看板", exact: true }).waitFor();
  console.log("PASS editor load failures also retain the correct return filter");

  user.modules = ["2d"];
  await page.goto(`${base}#/projects?type=3d`);
  await page.reload();
  await page.getByRole("heading", { name: "没有3D 场景访问权限", exact: true }).waitFor();
  assert.equal(await page.locator(".project-card").count(), 0, "explicit filters never bypass module access");
  await page.goto(`${base}#/projects?type=unknown`);
  await page.getByRole("heading", { name: "页面地址无效", exact: true }).waitFor();
  console.log("PASS unauthorized or invalid project filters are explicit errors");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log("Project list browser regression passed");
} catch (error) {
  if (page) {
    console.error("Regression page:", page.url());
    console.error("Visible page:", (await page.locator("body").innerText()).slice(0, 4000));
    console.error("Browser exceptions:", JSON.stringify(pageErrors));
  }
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
