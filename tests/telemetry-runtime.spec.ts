import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("continuous metric history survives no viewers, bad fields, two browsers, restart and project deletion",async ({ browser },testInfo) => {
  test.setTimeout(90000); let hits = 0,outage = false,badField = true,stale = false;
  const upstream = createServer((_,response) => { hits++;response.writeHead(outage ? 503:200,{ "content-type":"application/json" });response.end(JSON.stringify({ timestamp:new Date(Date.now()-(stale ? 60000:0)).toISOString(),values:{ temperature:42,pressure:badField ? "bad":24,status:"running",alarmLevel:0 } })); });
  upstream.listen(0,"127.0.0.1");await once(upstream,"listening");const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const runtime = await nodeRuntimeFixture(testInfo,[host]);let api = await apiRequest.newContext({ baseURL:runtime.url }),context:Awaited<ReturnType<typeof browser.newContext>>|undefined,other:typeof context;
  const db = new DatabaseSync(join(runtime.dataDirectory,"telemetry.sqlite"),{ readOnly:true });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"history@example.invalid",password:randomBytes(24).toString("hex"),displayName:"History fixture" } })).status()).toBe(201);
    const demo = await createDemo(api,false),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await api.get(`${base}/data-sources`)).json()).dataSources;
    for (const source of sources) expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/state`,collectionMode:"continuous",intervalSeconds:1 } } })).status()).toBe(200);
    const history = async (query="") => { const response = await api.get(`${base}/telemetry/history${query}`);expect(response.status(),await response.text()).toBe(200);return response.json(); };
    await expect.poll(async () => (await history()).records.filter((row:{ quality:string }) => row.quality === "good").length).toBeGreaterThan(3);
    const first = await history();expect(first.records.some((row:{ metricKey:string;quality:string;errorCode:string }) => row.metricKey === "pressure" && row.quality === "error" && row.errorCode === "metric_type_mismatch")).toBe(true);
    expect((await (await api.get(`${base}/runtime/sources`)).json()).sources.every((source:{ subscribers:number }) => source.subscribers === 0)).toBe(true);
    const maxId = first.records[0].id;badField = false;
    await expect.poll(async () => (await history()).records.some((row:{ id:number;metricKey:string;quality:string }) => row.id > maxId && row.metricKey === "pressure" && row.quality === "good")).toBe(true);
    context = await browser.newContext({ storageState:await api.storageState() });other = await browser.newContext({ storageState:await api.storageState() });
    const page = await context.newPage(),page2 = await other.newPage();await page.goto(`${runtime.url}/#/projects/${demo.projectId}/preview`);await page2.goto(`${runtime.url}/#/projects/${demo.projectId}/preview`);
    await expect(page.locator('[data-node-id="fixed-metric"] .dashboard-metric-value')).toContainText("42");await expect(page2.locator('[data-node-id="fixed-metric"] .dashboard-metric-value')).toContainText("42");
    const countBefore = Number(db.prepare("SELECT COUNT(*) AS n FROM metric_history WHERE quality='good'").get()!.n),hitsBefore = hits;
    await expect.poll(() => hits).toBeGreaterThan(hitsBefore+3);
    const delta = Number(db.prepare("SELECT COUNT(*) AS n FROM metric_history WHERE quality='good'").get()!.n)-countBefore;expect(delta).toBeLessThanOrEqual((hits-hitsBefore+1)*4);
    expect(db.prepare("SELECT sample_id,binding_id,COUNT(*) AS n FROM metric_history GROUP BY sample_id,binding_id HAVING COUNT(*)>1").all()).toEqual([]);
    await page.getByRole("button",{ name:"历史数据",exact:true }).click();const panel = page.getByRole("dialog",{ name:"历史数据与诊断" });await expect(panel).toContainText("DEVICE-001");await expect(panel).toContainText("metric_type_mismatch");
    await panel.getByLabel("指标",{ exact:true }).fill("temperature");await panel.getByRole("button",{ name:"查询与刷新",exact:true }).click();await expect(panel.locator("tbody")).not.toContainText("pressure");await page.screenshot({ path:testInfo.outputPath("continuous-history-query.png") });
    await context.close();context = undefined;await other.close();other = undefined;
    outage = true;await expect.poll(async () => (await history()).records.some((row:{ errorCode:string }) => row.errorCode === "data_source_http_error")).toBe(true);
    const errorsBefore = Number(db.prepare("SELECT COUNT(*) AS n FROM metric_history WHERE error_code='data_source_http_error'").get()!.n),failureHits = hits;
    await expect.poll(() => hits).toBeGreaterThan(failureHits+1);expect(Number(db.prepare("SELECT COUNT(*) AS n FROM metric_history WHERE error_code='data_source_http_error'").get()!.n)).toBe(errorsBefore);
    const identity = await api.storageState(),retained = (await history()).records.at(-1).sampleId;await api.dispose();const restarted = await runtime.restart();api = await apiRequest.newContext({ baseURL:restarted,storageState:identity });
    expect((await history()).records.some((row:{ sampleId:string }) => row.sampleId === retained)).toBe(true);
    outage = false;stale = true;await expect.poll(async () => (await history()).records.some((row:{ quality:string }) => row.quality === "stale")).toBe(true);stale = false;
    await expect.poll(async () => (await history()).records[0]?.quality).toBe("good");
    const limited = await history("?limit=2");expect(limited.records).toHaveLength(2);expect(limited.nextCursor).toBeTruthy();const older = await history(`?limit=2&before=${limited.nextCursor}`);expect(older.records[0].id).toBeLessThan(limited.records[1].id);
    expect((await api.get(`${base}/telemetry/history?limit=10000`)).status()).toBe(400);expect((await api.get(`${base}/telemetry/history?from=2020-01-01&to=2026-01-01`)).status()).toBe(400);
    const guest = await apiRequest.newContext({ baseURL:restarted });expect((await guest.get(`${base}/telemetry/history`)).status()).toBe(401);await guest.dispose();
    expect((await api.delete(base)).status()).toBe(200);expect(db.prepare("SELECT COUNT(*) AS n FROM metric_history WHERE project_id=?").get(demo.projectId)!.n).toBe(0);
    const stopped = hits;await new Promise((resolve) => setTimeout(resolve,1400));expect(hits).toBe(stopped);expect((await api.get(`${base}/telemetry/history`)).status()).toBe(404);
  } finally { db.close();await context?.close();await other?.close();await api.dispose();await runtime.dispose();upstream.closeAllConnections();await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
