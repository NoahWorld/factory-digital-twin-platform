import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("continuous collection is saved through UI, runs without viewers and restarts with fresh failure state",async ({ browser },testInfo) => {
  test.setTimeout(60000);
  let hits = 0,outage = false;
  const upstream = createServer((_,response) => { hits++; response.writeHead(outage ? 503 : 200,{ "content-type":"application/json" }); response.end(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature:42,pressure:24,status:"running",alarmLevel:0 } })); });
  upstream.listen(0,"127.0.0.1"); await once(upstream,"listening"); const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const runtime = await nodeRuntimeFixture(testInfo,[host]); let api = await apiRequest.newContext({ baseURL:runtime.url });
  let context:Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"continuous@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Continuous fixture" } })).status()).toBe(201);
    const demo = await createDemo(api,false,false),path = `/api/v1/projects/${demo.projectId}`,source = (await (await api.get(`${path}/data-sources`)).json()).dataSources[0];
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/state`,intervalSeconds:1 } } })).status()).toBe(200);
    expect(hits).toBe(0);
    context = await browser.newContext({ storageState:await api.storageState() }); const page = await context.newPage();
    await page.goto(`${runtime.url}/#/projects/${demo.projectId}/canvas`); await page.getByRole("button",{ name:"数据源",exact:true }).click(); await page.getByRole("button",{ name:new RegExp(source.name) }).click();
    await expect(page.locator('option[value="continuous"]')).toBeEnabled();
    await page.getByLabel("采集方式",{ exact:true }).selectOption("continuous"); await page.getByRole("button",{ name:"保存修改",exact:true }).click();
    await expect(page.locator(".data-source-runtime-summary")).toContainText("持续采集 · 已采样"); await expect(page.locator(".data-source-runtime-summary")).toContainText("查看订阅：0");
    await page.screenshot({ path:testInfo.outputPath("continuous-source-status.png") });
    const saved = (await (await api.get(`${path}/data-sources`)).json()).dataSources.find((item:{ id:string }) => item.id === source.id); expect(saved.config.collectionMode).toBe("continuous");
    await context.close(); context = undefined; const before = hits; await expect.poll(() => hits).toBeGreaterThan(before+1);
    const diagnostics = async () => (await (await api.get(`${path}/runtime/sources`)).json());
    const previous = await diagnostics(); expect(previous.sources[0]).toMatchObject({ mode:"continuous",state:"sampled",subscribers:0 });
    const identity = await api.storageState(); await api.dispose(); outage = true;
    const url = await runtime.restart(); api = await apiRequest.newContext({ baseURL:url,storageState:identity });
    await expect.poll(async () => (await diagnostics()).sources[0]?.state).toBe("failed");
    const restarted = await diagnostics(); expect(restarted.epoch).not.toBe(previous.epoch); expect(restarted.sources[0].collectedAt).toBeNull(); expect(restarted.sources[0].errorCode).toBe("data_source_http_error");
    outage = false; await expect.poll(async () => (await diagnostics()).sources[0]?.state).toBe("sampled");
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...saved.config,collectionMode:"demand" } } })).status()).toBe(200);
    expect((await diagnostics()).sources).toEqual([]); const stopped = hits; await new Promise((resolve) => setTimeout(resolve,1500)); expect(hits).toBe(stopped);
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...saved.config,collectionMode:"invalid" } } })).status()).toBe(400);
  } finally { await context?.close(); await api.dispose(); await runtime.dispose(); upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
