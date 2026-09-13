import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";

test("history and alarm widgets configure, persist, share queries, select assets and run from frozen bindings",async ({ browser },testInfo) => {
  test.setTimeout(120000);let outage = false;
  const upstream = createServer((request,response) => { const second = request.url?.includes("DEVICE-002");response.writeHead(outage ? 503:200,{ "content-type":"application/json" });response.end(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature:second ? 62:51,pressure:24,status:"running",alarmLevel:0 } })); });upstream.listen(0,"127.0.0.1");await once(upstream,"listening");const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const runtime = await nodeRuntimeFixture(testInfo,[host]),api = await apiRequest.newContext({ baseURL:runtime.url });let context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"widgets@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Persisted widgets" } })).status()).toBe(201);
    const demo = await createDemo(api,true,false),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await api.get(`${base}/data-sources`)).json()).dataSources;
    for (const asset of demo.assets) { const binding = (await (await api.get(`${base}/assets/${asset.id}/data-bindings`)).json()).dataBindings[0],source = sources.find((source:{ id:string }) => source.id === binding.dataSourceId);expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/${asset.assetId}`,intervalSeconds:1,collectionMode:"continuous" } } })).status()).toBe(200); }
    const alarmConfig = (await (await api.get(`${base}/alarm-rules`)).json());expect((await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:alarmConfig.runtimeRevision,rules:[{ id:"temperature-high",name:"模拟温度告警",assetId:"DEVICE-001",enabled:true,severity:"critical",message:"组件验证：温度超过45",condition:{ op:"gt",left:{ kind:"metric",assetId:"DEVICE-001",metricKey:"temperature" },right:{ kind:"literal",value:45 } },recoveryCondition:null }] } })).status()).toBe(200);
    const history = { ...createCanvasNode("line-chart",960,330,4),id:"history",width:880,height:300 },alarm = { ...createCanvasNode("alarm-list",960,660,5),id:"alarms",width:880,height:300 };
    const canvas = (await (await api.get(`${base}/canvas`)).json()).canvas;expect((await api.patch(`${base}/canvas`,{ data:{ expectedRevision:canvas.revision,upsertNodes:[history,alarm],deleteNodeIds:["device-chart","device-table"] } })).status()).toBe(200);
    context = await browser.newContext({ storageState:await api.storageState() });const page = await context.newPage();await page.goto(`${runtime.url}/#/projects/${demo.projectId}/canvas`);
    for (const id of ["history","alarms","selected-metric"]) {
      await page.locator(`[data-node-id="${id}"]`).click();const form = page.getByRole("region",{ name:"组件数据绑定" });await form.getByRole("combobox",{ name:"数据模式",exact:true }).selectOption("binding");
      if (id !== "alarms") await form.getByRole("combobox",{ name:"设备模式",exact:true }).selectOption("selected");
      await form.getByRole("checkbox",{ name:/模拟设备 001/ }).check();if (id !== "alarms") await form.getByRole("checkbox",{ name:/模拟设备 002/ }).check();
      if (id !== "alarms") await form.getByRole("combobox",{ name:"绑定指标",exact:true }).selectOption("temperature");
      else expect(await form.getByRole("combobox",{ name:"绑定指标",exact:true }).count()).toBe(0);
      if (id === "history") { await form.getByLabel("历史范围（分钟）",{ exact:true }).fill("1");await form.getByLabel("最大历史点数",{ exact:true }).fill("60");await form.getByLabel("历史聚合",{ exact:true }).selectOption("last"); }
      await form.getByRole("button",{ name:"应用到组件",exact:true }).click();await expect(form.locator(".binding-form-error")).toHaveCount(0);
    }
    await page.getByRole("button",{ name:"保存画布",exact:true }).click();await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    let state = createEditorState((await (await api.get(`${base}/definition`)).json()).definition);const oldIds = new Set(state.project.pages[0].nodes.map((node) => node.id));state = executeEditorOperation(state,{ type:"nodes.duplicate",nodeIds:["history"] });const copy = state.project.pages[0].nodes.find((node) => !oldIds.has(node.id))!;
    state = executeEditorOperation(state,{ type:"nodes.upsert",nodes:[{ ...state.project.pages[0].nodes.find((node) => node.id === "history")!,width:430 },{ ...copy,x:1410,y:330,width:430,height:300 }] });expect((await api.patch(`${base}/definition`,{ data:projectDefinitionPatch(state.project,state.savedProject) })).status()).toBe(200);
    const saved = (await (await api.get(`${base}/definition`)).json()).definition;expect(saved.dataBindings.filter((binding:{ version:number }) => binding.version === 2)).toHaveLength(3);expect(saved.pages[0].nodes.find((node:{ id:string }) => node.id === "history").props).toEqual(history.props);expect(saved.pages[0].nodes.find((node:{ id:string }) => node.id === "alarms").props).toEqual(alarm.props);
    const times:number[] = [];page.on("request",(request) => { const url = new URL(request.url());if (url.pathname.endsWith("/telemetry/series") && url.searchParams.get("assetId") === "DEVICE-001") times.push(Date.now()); });
    await page.goto(`${runtime.url}/#/projects/${demo.projectId}/preview`);await page.reload();const alarmNode = page.locator('[data-node-id="alarms"]');await expect(alarmNode).toContainText("组件验证：温度超过45");expect(await alarmNode.locator(".dashboard-sample-badge").count()).toBe(0);
    await alarmNode.getByRole("button",{ name:"选择告警设备 DEVICE-001",exact:true }).click();await expect(page.getByRole("combobox",{ name:"当前设备",exact:true })).toHaveValue("DEVICE-001");await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText("51");
    for (const id of ["history",copy.id]) await expect.poll(() => page.locator(`[data-node-id="${id}"] [data-history-value="51"]`).count()).toBeGreaterThan(0);
    await expect.poll(() => times.length).toBeGreaterThanOrEqual(2);for (let index=1;index<times.length;index++) expect(times[index]-times[index-1]).toBeGreaterThan(2000);
    await page.screenshot({ path:testInfo.outputPath("history-and-alarm-widgets.png") });
    await page.getByRole("combobox",{ name:"当前设备",exact:true }).selectOption("DEVICE-002");await expect.poll(() => page.locator('[data-node-id="history"] [data-history-value="62"]').count()).toBeGreaterThan(0);await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText("62");
    expect((await (await api.get(`${base}/definition`)).json()).definition).toEqual(saved);
    outage = true;await expect(alarmNode).toContainText("状态未知");outage = false;
    const draft = (await (await api.get(`${base}/publication-draft`)).json()).draft,created = await api.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Frozen query widgets" } });expect(created.status(),await created.text()).toBe(201);const version = (await created.json()).version;
    const activated = await api.post(`${base}/versions/${version.id}/activate`,{ data:{ expectedPublicationRevision:0 } });expect(activated.status(),await activated.text()).toBe(200);
    await page.goto(`${runtime.url}/#/projects/${demo.projectId}/versions/${version.id}/run`);await expect(alarmNode).toContainText("组件验证：温度超过45");await alarmNode.getByRole("button",{ name:"选择告警设备 DEVICE-001",exact:true }).click();await expect.poll(() => page.locator('[data-node-id="history"] [data-history-value="51"]').count()).toBeGreaterThan(0);await page.screenshot({ path:testInfo.outputPath("frozen-query-widgets.png") });
    await page.getByRole("link",{ name:"返回项目列表",exact:true }).click();const stopped = times.length;await new Promise((resolve) => setTimeout(resolve,3500));expect(times.length).toBe(stopped);
  } finally { await context?.close();await api.dispose();await runtime.dispose();upstream.closeAllConnections();await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
