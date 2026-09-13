import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";

test("freeze, run and activate versions through UI; draft source, mapping, asset and page changes do not alter a running release",async ({ browser },testInfo) => {
  const runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL:runtime.url });
  const contexts:Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"publish-ui@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Publisher" } })).status()).toBe(201);
    const demo = await createDemo(api,true),base = `/api/v1/projects/${demo.projectId}`;
    const context = await browser.newContext({ storageState:await api.storageState(),viewport:{ width:1440,height:1000 } }); contexts.push(context); const editor = await context.newPage();
    await editor.goto(`${runtime.url}/#/projects/${demo.projectId}/canvas`); await editor.getByRole("button",{ name:"发布与版本",exact:true }).click();
    const panel = editor.getByRole("dialog",{ name:"项目发布与版本",exact:true });
    const freeze = async (label:string) => { await panel.getByRole("button",{ name:"检查已保存配置与资源",exact:true }).click(); await panel.getByLabel("版本说明",{ exact:true }).fill(label); await panel.getByRole("button",{ name:"冻结为新版本",exact:true }).click(); await expect(panel.getByRole("status")).toContainText("已冻结版本"); };
    await freeze("第一版：冻结页面和设备连接");
    let versions = (await (await api.get(`${base}/versions`)).json()).versions,v1 = versions[0];
    await panel.locator(`[data-version-id="${v1.id}"]`).getByRole("button",{ name:"激活此版本",exact:true }).click(); await expect(panel.getByRole("status")).toContainText("已成为当前发布版本");
    await editor.screenshot({ path:testInfo.outputPath("publication-version-panel.png") });
    const viewerContext = await browser.newContext({ storageState:await api.storageState() }); contexts.push(viewerContext); const running = await viewerContext.newPage(),requests:string[] = [];
    running.on("request",(request) => { if (new URL(request.url()).pathname.startsWith(base)) requests.push(new URL(request.url()).pathname); });
    await running.goto(`${runtime.url}/#/projects/${demo.projectId}/versions/${v1.id}/run`);
    await expect(running.locator(".published-version-label")).toContainText("固定发布版本"); await expect(running.locator(".runtime-status-banner")).toContainText("在线 2 台"); await running.getByRole("button",{ name:"选择设备 DEVICE-001",exact:true }).click();
    const value = running.locator('[data-node-id="selected-metric"] .dashboard-metric-value'); await expect(value).toContainText(/4[0-4]\.\d/);
    expect(requests).not.toContain(`${base}/definition`); expect(requests).not.toContain(`${base}/runtime-catalog`); expect(requests.some((path) => path.endsWith("/runtime-state"))).toBe(false);
    const binding = (await (await api.get(`${base}/assets/${demo.assets[0].id}/data-bindings`)).json()).dataBindings.find((item:{ metricKey:string }) => item.metricKey === "temperature");
    const source = (await (await api.get(`${base}/data-sources`)).json()).dataSources.find((item:{ id:string }) => item.id === binding.dataSourceId);
    expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:"http://127.0.0.1:8790/device/DEVICE-002" } } })).status()).toBe(200);
    expect((await api.patch(`${base}/assets/${demo.assets[0].id}/data-bindings/${binding.id}`,{ data:{ sourcePath:"$.values.pressure" } })).status()).toBe(200);
    expect((await api.patch(`${base}/assets/${demo.assets[0].id}`,{ data:{ name:"草稿已改名的设备" } })).status()).toBe(200);
    let state = createEditorState((await (await api.get(`${base}/definition`)).json()).definition); state = executeEditorOperation(state,{ type:"page.add",name:"仅新版页面" });
    expect((await api.patch(`${base}/definition`,{ data:projectDefinitionPatch(state.project,state.savedProject) })).status()).toBe(200);
    const draftValue = (await (await api.get(`${base}/assets/${demo.assets[0].id}/runtime-state`)).json()).runtimeState.values.temperature; expect(draftValue).toBeGreaterThan(95);
    await expect(value).toContainText(/4[0-4]\.\d/); await running.reload(); await expect(running.locator(".runtime-status-banner")).toContainText("在线 2 台"); await running.getByRole("button",{ name:"选择设备 DEVICE-001",exact:true }).click(); await expect(value).toContainText(/4[0-4]\.\d/);
    await expect(running.getByRole("combobox",{ name:"当前页面",exact:true }).locator("option")).toHaveCount(1); await expect(running.locator('[data-node-id="device-table"]')).not.toContainText("草稿已改名");
    await freeze("第二版：新数据映射与页面"); versions = (await (await api.get(`${base}/versions`)).json()).versions; const v2 = versions[0]; expect(v2.id).not.toBe(v1.id);
    await panel.locator(`[data-version-id="${v2.id}"]`).getByRole("button",{ name:"激活此版本",exact:true }).click(); await expect(panel.getByRole("status")).toContainText(`版本 ${v2.versionNumber} 已成为当前发布版本`);
    await expect(value).toContainText(/4[0-4]\.\d/);
    const newest = await viewerContext.newPage(); await newest.goto(`${runtime.url}/#/projects/${demo.projectId}/run`); await expect(newest).toHaveURL(new RegExp(`/versions/${v2.id}/run`)); await expect(newest.locator(".runtime-status-banner")).toContainText("在线 2 台"); await newest.getByRole("button",{ name:"选择设备 DEVICE-001",exact:true }).click();
    await expect(newest.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/(?:99|10[0-3])\.\d/); await expect(newest.getByRole("combobox",{ name:"当前页面",exact:true }).locator("option")).toHaveCount(2);
    await newest.getByRole("combobox",{ name:"当前页面",exact:true }).selectOption({ label:"仅新版页面" }); expect(newest.url()).toContain(`/versions/${v2.id}/run`);
    await panel.locator(`[data-version-id="${v1.id}"]`).getByRole("button",{ name:"回滚到此版本",exact:true }).click(); await expect(panel.getByRole("status")).toContainText(`版本 ${v1.versionNumber} 已成为当前发布版本`);
    expect((await (await api.get(`${base}/versions`)).json()).active.versionId).toBe(v1.id);
    await newest.goto(`${runtime.url}/#/projects/${demo.projectId}/run`); await expect(newest).toHaveURL(new RegExp(`/versions/${v1.id}/run`));
    await running.screenshot({ path:testInfo.outputPath("frozen-release-keeps-original-data.png") });
  } finally { for (const context of contexts) await context.close(); await api.dispose(); await runtime.dispose(); }
});
