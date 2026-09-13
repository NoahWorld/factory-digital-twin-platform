import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { createDemo } from "./demo";
const loadRuntime = () => import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href);

test("two independent browsers and two assets share one source cycle, recover failures and release the last demand",async ({ browser },testInfo) => {
  test.setTimeout(60000);
  const hits:number[] = []; let outage = false,stale = false,temperature = 43.8;
  const upstream = createServer((_,response) => {
    hits.push(Date.now()); response.writeHead(outage ? 503 : 200,{ "content-type":"application/json" });
    response.end(JSON.stringify({ timestamp:new Date(Date.now()-(stale ? 60000 : 0)).toISOString(),values:{ temperature,pressure:24,status:"running",alarmLevel:0 } }));
  });
  upstream.listen(0,"127.0.0.1"); await once(upstream,"listening");
  const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`,bootstrap = randomBytes(24).toString("hex");
  const { startRuntime } = await loadRuntime();
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),publicDirectory:resolve("apps/web/dist"),migrationsDirectory:resolve("apps/api/migrations"),port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host } });
  const api = await apiRequest.newContext({ baseURL:runtime.url }),anonymous = await apiRequest.newContext({ baseURL:runtime.url });
  const contexts:Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"central@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Central fixture" } })).status()).toBe(201);
    const demo = await createDemo(api,true),path = `/api/v1/projects/${demo.projectId}`;
    const sources = (await (await api.get(`${path}/data-sources`)).json()).dataSources;
    const shared = sources[0];
    expect((await api.patch(`${path}/data-sources/${shared.id}`,{ data:{ config:{ ...shared.config,url:`http://${host}/shared` } } })).status()).toBe(200);
    for (const asset of demo.assets) {
      const bindings = (await (await api.get(`${path}/assets/${asset.id}/data-bindings`)).json()).dataBindings;
      for (const binding of bindings) expect((await api.patch(`${path}/assets/${asset.id}/data-bindings/${binding.id}`,{ data:{ dataSourceId:shared.id } })).status()).toBe(200);
    }
    expect((await anonymous.get(`${path}/runtime/stream?assets=${demo.assets[0].id}`)).status()).toBe(401);
    const pages = [];
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({ storageState:await api.storageState(),viewport:{ width:1440,height:1000 } }); contexts.push(context);
      const page = await context.newPage(); pages.push(page);
      const assetRequests:string[] = []; page.on("request",(request) => { if (request.url().endsWith("/runtime-state")) assetRequests.push(request.url()); });
      await page.goto(`${runtime.url}/#/projects/${demo.projectId}/preview?page=main`);
      await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台");
      expect(assetRequests).toEqual([]);
    }
    await expect.poll(() => hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.slice(1).every((time,index) => time-hits[index] >= 1800)).toBe(true);
    await pages[1].screenshot({ path:testInfo.outputPath("central-two-clients.png") });
    await contexts[0].close(); contexts.shift();
    await pages[1].getByRole("button",{ name:"选择设备 DEVICE-001",exact:true }).click();
    const before = hits.length; temperature = 64.2;
    await expect(pages[1].locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText("64.2"); expect(hits.length).toBeGreaterThan(before);
    outage = true; await expect(pages[1].locator(".runtime-status-banner")).toContainText("失联");
    outage = false; stale = true; await expect(pages[1].locator(".runtime-status-banner")).toContainText("陈旧");
    stale = false; await expect(pages[1].locator(".runtime-status-banner")).toContainText("在线 2 台");
    await contexts[0].close(); contexts.shift();
    const stopped = hits.length; await new Promise((resolve) => setTimeout(resolve,2600)); expect(hits.length).toBe(stopped);
  } finally { for (const context of contexts) await context.close(); await api.dispose(); await anonymous.dispose(); await runtime.close(); upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
