import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { createUser } from "../apps/api/src/auth";
import { SqliteDatabase } from "../apps/runtime/src/sqlite-database";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";

test("a copied Node bundle starts without the workspace, preserves project CAS and resources, enforces roles and survives restart", async ({ page },testInfo) => {
  const runtime = await nodeRuntimeFixture(testInfo);
  const api = await apiRequest.newContext({ baseURL: runtime.url }),anonymous = await apiRequest.newContext({ baseURL: runtime.url });
  const email = `node-owner-${crypto.randomUUID()}@example.invalid`,password = randomBytes(24).toString("base64url");
  let viewer: Awaited<ReturnType<typeof apiRequest.newContext>> | null = null;
  try {
    expect(await readdir(runtime.bundleDirectory)).not.toContain("node_modules");
    expect((await (await api.get("/health")).json()).runtime).toEqual({ host: "node",database: "sqlite",collection: "per-request" });
    expect((await anonymous.get("/api/v1/projects")).status()).toBe(401);
    const bootstrap = await api.post("/api/v1/auth/bootstrap",{ headers: { "x-bootstrap-token": runtime.bootstrap },data: { email,password,displayName: "Local runtime owner" } });
    expect(bootstrap.status(),await bootstrap.text()).toBe(201); expect(bootstrap.headers()["set-cookie"]?.includes("HttpOnly")).toBe(true);
    const demo = await createDemo(api,true),path = `/api/v1/projects/${demo.projectId}`;
    const modelId = demo.canvas.nodes.find((node: { type: string }) => node.type === "model-3d").resourceRefs[0];
    const file = await api.get(`${path}/model-assets/${modelId}/content`); expect(file.status()).toBe(200); const bytes = await file.body();
    const cached = await api.get(`${path}/model-assets/${modelId}/content`,{ headers: { "if-none-match": file.headers().etag } }); expect(cached.status()).toBe(304);
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    state = executeEditorOperation(state,{ type: "page.add",name: "第二页" });
    const patch = projectDefinitionPatch(state.project,state.savedProject);
    const updates = await Promise.all([api.patch(`${path}/definition`,{ data: patch }),api.patch(`${path}/definition`,{ data: patch })]);
    expect(updates.map((response) => response.status()).sort()).toEqual([200,409]);
    const definition = (await (await api.get(`${path}/definition`)).json()).definition; expect(definition.pages).toHaveLength(2);
    const fixtureDb = new SqliteDatabase(runtime.databasePath),viewerPassword = randomBytes(24).toString("base64url"),viewerEmail = `node-viewer-${crypto.randomUUID()}@example.invalid`;
    try {
      const user = await createUser({ DB: fixtureDb },{ email: viewerEmail,password: viewerPassword,displayName: "Local runtime viewer",roles: ["viewer"] });
      const now = new Date().toISOString(); await fixtureDb.prepare("INSERT INTO project_members (project_id,user_id,role,created_at,updated_at) VALUES(?,?,'viewer',?,?)").bind(demo.projectId,user.id,now,now).run();
    } finally { fixtureDb.close(); }
    viewer = await apiRequest.newContext({ baseURL: runtime.url }); expect((await viewer.post("/api/v1/auth/login",{ data: { email: viewerEmail,password: viewerPassword } })).status()).toBe(200);
    expect((await viewer.get(`${path}/definition`)).status()).toBe(200); expect((await viewer.patch(`${path}/definition`,{ data: { ...patch,expectedRevision: definition.revision } })).status()).toBe(403);
    const requests: string[] = []; page.on("request",(request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
    await page.goto(`${runtime.url}/#/projects`); await page.getByLabel("邮箱",{ exact: true }).fill(email); await page.getByLabel("密码",{ exact: true }).fill(password); await page.getByRole("button",{ name: "登录平台",exact: true }).click();
    await page.goto(`${runtime.url}/#/projects/${demo.projectId}/preview?page=main`);
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible(); await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台");
    await page.getByRole("button",{ name: "选择设备 DEVICE-002",exact: true }).click();
    await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/6\d/);
    await expect(page.locator(".model-3d-renderer")).not.toHaveAttribute("data-selected-scene-node","");
    expect(requests.every((url) => new URL(url).origin === runtime.url)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("node-standalone-runtime.png") }); await page.goto("about:blank");
    const restartedUrl = await runtime.restart(),after = await apiRequest.newContext({ baseURL: restartedUrl });
    try {
      expect((await after.post("/api/v1/auth/login",{ data: { email,password } })).status()).toBe(200);
      expect((await (await after.get(`${path}/definition`)).json()).definition).toEqual(definition);
      expect(await (await after.get(`${path}/model-assets/${modelId}/content`)).body()).toEqual(bytes);
      expect((await after.get("/%2e%2e%2fdata%2fconfig.sqlite")).status()).toBe(404);
    } finally { await after.dispose(); }
  } finally { await api.dispose(); await anonymous.dispose(); await viewer?.dispose(); await runtime.dispose(); }
});

test("Node HTTP returns bounded JSON and upload errors without consuming an unlimited body", async ({},testInfo) => {
  const runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL: runtime.url });
  try {
    const response = await api.post("/api/v1/auth/bootstrap",{ headers: { "x-bootstrap-token": runtime.bootstrap },data: JSON.stringify({ padding: "x".repeat(70000) }) });
    expect(response.status(),await response.text()).toBe(413); expect((await response.json()).error).toBe("request_body_too_large");
    expect((await (await api.get("/api/v1/auth/bootstrap-status")).json()).setupRequired).toBe(true);
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { produced++; if (produced > 100) controller.close(); else controller.enqueue(new TextEncoder().encode("x".repeat(65536))); } });
    const streamed = await fetch(`${runtime.url}/api/v1/auth/bootstrap`,{ method: "POST",headers: { "x-bootstrap-token": runtime.bootstrap,"content-type": "application/json" },body,duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413); await streamed.text(); expect(produced).toBeLessThan(100);
    expect((await (await api.get("/api/v1/auth/bootstrap-status")).json()).setupRequired).toBe(true);
  } finally { await api.dispose(); await runtime.dispose(); }
});
