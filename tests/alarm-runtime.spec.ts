import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("UI configured alarms run without viewers, survive transient write failure and restart, then recover and remain frozen after draft edits",async ({ browser },testInfo) => {
  test.setTimeout(120000);let temperature = 39,outage = false,hits = 0;
  const upstream = createServer((_,response) => { hits++;response.writeHead(outage ? 503:200,{ "content-type":"application/json" });response.end(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature,pressure:24,status:"running",alarmLevel:0 } })); });upstream.listen(0,"127.0.0.1");await once(upstream,"listening");const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const runtime = await nodeRuntimeFixture(testInfo,[host]);let api = await apiRequest.newContext({ baseURL:runtime.url }),context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  const db = new DatabaseSync(join(runtime.dataDirectory,"telemetry.sqlite"));
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"runtime-alarms@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Alarm runtime" } })).status()).toBe(201);
    const demo = await createDemo(api,false,false),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await api.get(`${base}/data-sources`)).json()).dataSources;
    for (const source of sources) expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/state`,collectionMode:"continuous",intervalSeconds:1 } } })).status()).toBe(200);
    context = await browser.newContext({ storageState:await api.storageState() });const page = await context.newPage();await page.goto(`${runtime.url}/#/projects/${demo.projectId}/canvas`);await page.getByRole("button",{ name:"告警",exact:true }).click();
    const panel = page.getByRole("dialog",{ name:"告警记录与规则" });await panel.getByRole("button",{ name:"配置规则",exact:true }).click();await panel.getByRole("button",{ name:"添加告警规则",exact:true }).click();
    await panel.getByLabel("告警规则名称",{ exact:true }).fill("模拟温度过高");await panel.getByLabel("告警所属设备",{ exact:true }).selectOption("DEVICE-001");await panel.getByLabel("告警级别",{ exact:true }).selectOption("critical");await panel.getByLabel("告警消息",{ exact:true }).fill("模拟设备温度超过45度");
    const trigger = panel.getByRole("group",{ name:"发生条件",exact:true });await trigger.getByLabel("取值指标",{ exact:true }).fill("temperature");await trigger.getByLabel("常量值",{ exact:true }).fill("45");
    await panel.getByLabel("单独设置恢复条件",{ exact:true }).check();const recovery = panel.getByRole("group",{ name:"恢复条件",exact:true });await recovery.getByLabel("取值指标",{ exact:true }).fill("temperature");await recovery.getByLabel("常量值",{ exact:true }).fill("40");
    expect(await panel.locator('option[value="event"]').count()).toBe(0);await panel.getByRole("button",{ name:"保存告警规则",exact:true }).click();await expect(panel).toContainText("告警规则已保存");await page.screenshot({ path:testInfo.outputPath("server-alarm-rule-editor.png") });
    const alarms = async (versionId?:string) => { const response = await api.get(`${base}${versionId ? `/versions/${versionId}`:""}/alarms`);expect(response.status(),await response.text()).toBe(200);return response.json(); };
    await expect.poll(async () => (await alarms()).ruleStates[0]?.confirmation).toBe("known");expect((await alarms()).active).toHaveLength(0);
    temperature = 50;await expect.poll(async () => (await alarms()).active.length).toBe(1);const episode = (await alarms()).active[0].id;
    await panel.getByRole("button",{ name:"告警记录",exact:true }).click();await expect(panel.locator(".alarm-active-list")).toContainText("当前数据有效");await page.screenshot({ path:testInfo.outputPath("active-server-alarm.png") });
    await context.close();context = undefined;const before = hits;await expect.poll(() => hits).toBeGreaterThan(before+3);expect((await alarms()).records.filter((event:{ kind:string }) => event.kind === "triggered")).toHaveLength(1);
    db.exec("CREATE TRIGGER block_error_history BEFORE INSERT ON metric_history WHEN NEW.quality='error' BEGIN SELECT RAISE(ABORT,'transient fixture'); END;");outage = true;
    await expect.poll(async () => (await alarms()).diagnostics.errorCode).toBe("telemetry_write_failed");expect((await alarms()).active[0]).toMatchObject({ id:episode,confirmation:"unknown" });
    db.exec("DROP TRIGGER block_error_history");await expect.poll(async () => (await alarms()).diagnostics.pending).toBe(0);expect((await alarms()).active[0]).toMatchObject({ id:episode,confirmation:"unknown" });
    const identity = await api.storageState();await api.dispose();const url = await runtime.restart();api = await apiRequest.newContext({ baseURL:url,storageState:identity });
    expect((await alarms()).active[0].id).toBe(episode);expect(["pending","unknown"]).toContain((await alarms()).active[0].confirmation);
    temperature = 39;outage = false;await expect.poll(async () => (await alarms()).active.length).toBe(0);expect((await alarms()).records.map((event:{ kind:string }) => event.kind).sort()).toEqual(["recovered","triggered"]);
    const draft = (await (await api.get(`${base}/publication-draft`)).json()).draft,created = await api.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Frozen alarm rules" } });expect(created.status(),await created.text()).toBe(201);const version = (await created.json()).version;
    expect((await api.post(`${base}/versions/${version.id}/activate`,{ data:{ expectedPublicationRevision:0 } })).status()).toBe(200);
    const config = (await (await api.get(`${base}/alarm-rules`)).json());config.rules[0].condition.right.value = 100;
    expect((await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:config.runtimeRevision,rules:config.rules } })).status()).toBe(200);
    temperature = 60;await expect.poll(async () => (await alarms(version.id)).active.length).toBe(1);expect((await alarms()).active).toHaveLength(0);
    context = await browser.newContext({ storageState:await api.storageState() });const fixedPage = await context.newPage();await fixedPage.goto(`${url}/#/projects/${demo.projectId}/versions/${version.id}/run`);await fixedPage.getByRole("button",{ name:"告警",exact:true }).click();const fixedPanel = fixedPage.getByRole("dialog",{ name:"告警记录与规则" });await expect(fixedPanel.locator(".alarm-active-list")).toContainText("模拟温度过高");await fixedPanel.getByRole("button",{ name:"规则定义",exact:true }).click();await expect(fixedPanel.getByLabel("告警规则名称",{ exact:true })).toBeDisabled();await fixedPage.screenshot({ path:testInfo.outputPath("frozen-alarm-definition.png") });
  } finally { try { db.exec("DROP TRIGGER IF EXISTS block_error_history"); } finally { db.close(); }await context?.close();await api.dispose();await runtime.dispose();upstream.closeAllConnections();await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
