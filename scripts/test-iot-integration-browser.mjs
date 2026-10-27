import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createServer } = await import(web.resolve("vite"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const cacheDir = await mkdtemp(join(tmpdir(), "iot-integration-browser-"));
const requests = [];
let mode = "authorized";
let identityReads = 0;
const project = {
  id: "test-line", name: "测试产线", projectType: "3d", status: "draft", projectRole: "viewer",
  createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
  coverStatus: "ready", coverRevision: 1, coverUrl: "/api/v1/projects/test-line/cover.png?revision=1",
  relatedProjectIds: [], has3dContent: false,
};
const canvasProject = { ...project, id: "test-board", name: "测试组合看板", projectType: "2d", coverUrl: null, relatedProjectIds: ["test-line"], has3dContent: true };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=", "base64");
// Contract fixtures only. No connection to production data, MinIO or a DTwin backend.
const server = await createServer({
  root: fileURLToPath(new URL("../apps/web", import.meta.url)),
  configFile: fileURLToPath(new URL("../apps/web/vite.config.ts", import.meta.url)),
  cacheDir,
  // This isolated fixture server must not connect to the live development HMR port.
  server: { host: "127.0.0.1", port: Number(process.env.IOT_INTEGRATION_TEST_PORT || 5219), strictPort: true, hmr: false },
  plugins: [{
    name: "isolated-iot-contract-fixtures",
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        const path = req.url.split("?")[0];
        if (path === "/__test_cover.png") {
          assert.equal(req.headers["x-access-token"], undefined);
          res.setHeader("Content-Type", "image/png"); res.end(png); return;
        }
        if (!path.startsWith("/cloud/")) return next();
        requests.push({ path, method: req.method, authenticated: req.headers["x-access-token"] === "fixture-token" });
        const send = (result, status = 200, code) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ status, result, code }));
        };
        if (req.headers["x-access-token"] !== "fixture-token") return send(null, 401);
        if (path === "/cloud/authorize/me") {
          identityReads++;
          if (mode === "expired") return send(null, 401);
          if (mode === "identity-failed") return send(null, 500, "internal_error");
          return send({ user: { id: "test-user", name: "测试用户" }, permissions: mode === "ungranted" ? [] : [
            { id: "twin-project", actions: ["query", "save"] }, { id: "twin-resource", actions: ["query"] },
          ] });
        }
        if (path === "/cloud/twin/projects" && req.method === "GET") {
          return mode === "missing-module" ? send(null, 404) : send({ projects: [project, canvasProject], nextOffset: null });
        }
        if (path === "/cloud/twin/projects/test-line/cover.png/access") {
          return send({ url: "/__test_cover.png", expiresAt: Date.now() + 120_000 });
        }
        if (path.endsWith("/model-assets")) return send({ modelAssets: [] });
        if (path.endsWith("/image-assets")) return send({ imageAssets: [] });
        if (path.endsWith("/media-assets")) return send({ mediaAssets: [] });
        return send(null, 404);
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  await page.goto(`${origin}/twin/`);
  await page.getByRole("heading", { name: "请先登录 IoT" }).waitFor();
  await page.locator(".iot-gate-origin").getByText(origin, { exact: true }).waitFor();
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  assert.equal(requests.length, 0, "anonymous visits must not load business data");
  assert.equal(await page.getByRole("link", { name: "前往 IoT 登录" }).getAttribute("href"), "/user/login");

  await page.evaluate(() => {
    localStorage.setItem("x-access-token", "fixture-token");
    window.dispatchEvent(new StorageEvent("storage", { key: "x-access-token" }));
  });
  const dashboardTab = page.getByRole("tab", { name: "看板", exact: true });
  const twoDTab = page.getByRole("tab", { name: "2D", exact: true });
  const threeDTab = page.getByRole("tab", { name: "3D", exact: true });
  await page.getByRole("heading", { name: "测试组合看板", exact: true }).waitFor();
  assert.equal(await dashboardTab.getAttribute("aria-selected"), "true");
  assert.equal(await page.getByText("引用：测试产线", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("heading", { name: "测试产线", exact: true }).count(), 0);
  await dashboardTab.press("ArrowRight");
  assert.equal(await twoDTab.getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("tabpanel").getByText("暂无项目", { exact: true }).count(), 1);
  await twoDTab.press("ArrowRight");
  assert.equal(await threeDTab.getAttribute("aria-selected"), "true");
  await page.getByRole("heading", { name: "测试产线", exact: true }).waitFor();
  assert.equal(await page.getByText("被引用：测试组合看板", { exact: true }).count(), 1);
  await page.waitForFunction(() => {
    const cover = document.querySelector('img[alt="测试产线 项目封面"]');
    return cover?.complete && cover.naturalWidth > 0;
  });
  for (const type of ["2d", "3d"]) {
    await page.goto(`${origin}/twin/#/projects?type=${type}`);
    await dashboardTab.click();
    await page.getByRole("heading", { name: "测试组合看板", exact: true }).waitFor();
    await threeDTab.click();
    await page.getByRole("heading", { name: "测试产线", exact: true }).waitFor();
  }
  assert.equal(await page.getByText("用户管理", { exact: true }).count(), 0);
  assert.ok(requests.every(item => item.authenticated));

  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("未保存的草稿");
  const reads = identityReads;
  const verification = page.waitForResponse(response => response.url().endsWith("/cloud/authorize/me"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await verification;
  assert.ok(identityReads > reads);
  assert.equal(await page.getByLabel("项目名称", { exact: true }).inputValue(), "未保存的草稿");
  mode = "identity-failed";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText("IoT 授权验证失败，当前草稿已保留。", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("项目名称", { exact: true }).inputValue(), "未保存的草稿");
  mode = "authorized";
  await page.getByRole("button", { name: "重新验证", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();

  mode = "missing-module";
  await page.reload();
  await page.getByText("IoT 尚未提供此数字孪生接口，请联系管理员完成接口接入。", { exact: true }).waitFor();
  mode = "ungranted";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.reload();
  await page.getByRole("heading", { name: "测试组合看板", exact: true }).waitFor();
  assert.equal(await page.getByText("尚未获得模块权限").count(), 0);

  mode = "authorized";
  for (const path of ["#/templates", "#/projects/test-line/scene?template=production-workshop", "#/projects/test-board/canvas?template=overview"]) {
    await page.goto(`${origin}/twin/${path}`);
    await page.getByRole("heading", { name: "页面地址无效" }).waitFor();
    await page.getByText("模板功能已移除，请从项目列表进入编辑器。", { exact: true }).waitFor();
  }
  await page.goto(`${origin}/twin/#/users`);
  await page.getByRole("heading", { name: "页面地址无效" }).waitFor();
  await page.goto(`${origin}/twin/#/share/retired`);
  await page.getByRole("heading", { name: "页面地址无效" }).waitFor();
  assert.equal(requests.some(item => /\/auth\/|\/users|\/publications\/projects/.test(item.path)), false);
  mode = "expired";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("heading", { name: "IoT 登录已失效" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "测试产线", exact: true }).count(), 0);
  await page.evaluate(() => {
    localStorage.removeItem("x-access-token");
    window.dispatchEvent(new StorageEvent("storage", { key: "x-access-token" }));
  });
  await page.getByRole("heading", { name: "请先登录 IoT" }).waitFor();

  for (const path of ["/twin/branding/cssc-logo.svg", "/twin/decoders/draco/draco_decoder.wasm"]) {
    const result = await fetch(`${origin}${path}`);
    assert.equal(result.status, 200);
    assert.ok((await result.arrayBuffer()).byteLength > 0);
  }
  assert.deepEqual(pageErrors, []);
  assert.equal(requests.some(item => item.method !== "GET"), false, "retired routes must not mutate project drafts");
  console.log("PASS: IoT session, unified project list, legacy bookmarks, disabled templates, permissions, draft retention, signed cover, missing module, retired routes, expiry and /twin/ static assets (isolated contract fixtures).");
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
