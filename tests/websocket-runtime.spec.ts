import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer,WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("configure authenticated WebSocket through UI, share it across two browsers and restore subscriptions after failure",async ({ browser },testInfo) => {
  test.setTimeout(60000);
  const secret = randomBytes(24).toString("hex"),wss = new WebSocketServer({ noServer:true });
  let accepting = true,stale = false,temperature = 43.8,connections = 0,subscriptions = 0;
  const server = createServer(); server.on("upgrade",(request,socket,head) => {
    if (!accepting || request.headers.authorization !== `Bearer ${secret}`) { socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }
    wss.handleUpgrade(request,socket,head,(peer) => wss.emit("connection",peer,request));
  });
  wss.on("connection",(peer) => {
    connections++; let timer:ReturnType<typeof setInterval> | undefined;
    peer.on("error",() => {});
    peer.on("message",(message) => {
      const value = JSON.parse(message.toString()); if (value.type !== "subscribe" || JSON.stringify(value.topics) !== '["devices"]') return;
      subscriptions++;
      const send = () => { if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ timestamp:new Date(Date.now()-(stale ? 60000 : 0)).toISOString(),values:{ temperature,pressure:24,status:"running",alarmLevel:0 } })); };
      send(); timer = setInterval(send,50);
    });
    peer.once("close",() => clearInterval(timer));
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening"); const host = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const runtime = await nodeRuntimeFixture(testInfo,[host]); let api = await apiRequest.newContext({ baseURL:runtime.url });
  const contexts:Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"websocket@example.invalid",password:randomBytes(24).toString("hex"),displayName:"WebSocket fixture" } })).status()).toBe(201);
    const demo = await createDemo(api,true),path = `/api/v1/projects/${demo.projectId}`,source = (await (await api.get(`${path}/data-sources`)).json()).dataSources[0];
    for (const asset of demo.assets) for (const binding of (await (await api.get(`${path}/assets/${asset.id}/data-bindings`)).json()).dataBindings) expect((await api.patch(`${path}/assets/${asset.id}/data-bindings/${binding.id}`,{ data:{ dataSourceId:source.id } })).status()).toBe(200);
    await runtime.setSources({ version:1,endpoints:{ gateway:{ projectIds:[demo.projectId],url:`ws://${host}/feed`,credentialRef:"api" } },credentials:{ api:{ headers:{ authorization:`Bearer ${secret}` } } } });
    const identity = await api.storageState(); await api.dispose(); const url = await runtime.restart(); api = await apiRequest.newContext({ baseURL:url,storageState:identity });
    const editor = await browser.newContext({ storageState:identity }); contexts.push(editor); const editPage = await editor.newPage();
    await editPage.goto(`${url}/#/projects/${demo.projectId}/canvas`); await editPage.getByRole("button",{ name:"数据源",exact:true }).click(); await editPage.getByRole("button",{ name:new RegExp(source.name) }).click();
    await editPage.getByRole("combobox",{ name:"连接类型",exact:true }).selectOption("websocket"); await editPage.getByLabel("环境端点引用（可选）",{ exact:true }).fill("gateway");
    await editPage.getByLabel("心跳周期（秒）",{ exact:true }).fill("5"); await editPage.getByLabel("最大重连间隔（秒）",{ exact:true }).fill("5");
    await editPage.getByLabel("数据时间戳路径",{ exact:true }).fill("$.timestamp"); await editPage.getByLabel("采样间隔（毫秒）",{ exact:true }).fill("100"); await editPage.getByLabel("订阅主题（每行一个，可选）",{ exact:true }).fill("devices");
    await editPage.getByRole("button",{ name:"保存修改",exact:true }).click(); await expect(editPage.getByRole("button",{ name:"测试连接并发现字段",exact:true })).toBeEnabled(); await editPage.getByRole("button",{ name:"测试连接并发现字段",exact:true }).click();
    await expect(editPage.locator(".data-source-probe-result")).toBeVisible(); await editPage.screenshot({ path:testInfo.outputPath("websocket-configuration.png") });
    const saved = (await (await api.get(`${path}/data-sources`)).json()).dataSources.find((item:{ id:string }) => item.id === source.id); expect(saved.sourceType).toBe("websocket"); expect(saved.config).toMatchObject({ url:"",endpointRef:"gateway",topics:["devices"],sampleIntervalMs:100 }); expect(JSON.stringify(saved).includes(secret) || JSON.stringify(saved).includes(host)).toBe(false);
    await editor.close(); contexts.shift(); await expect.poll(() => wss.clients.size).toBe(0);
    const baseline = connections,subscriptionBaseline = subscriptions;
    const pages = [];
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({ storageState:identity }); contexts.push(context); const page = await context.newPage(); pages.push(page); const directSockets:string[] = [];
      page.on("websocket",(socket) => directSockets.push(socket.url()));
      await page.goto(`${url}/#/projects/${demo.projectId}/preview?page=main`); await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台"); await page.getByRole("button",{ name:"选择设备 DEVICE-001",exact:true }).click(); expect(directSockets).toEqual([]);
    }
    expect(connections-baseline).toBe(1); expect(subscriptions-subscriptionBaseline).toBe(1); expect(wss.clients.size).toBe(1);
    temperature = 68.5; for (const page of pages) await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText("68.5");
    accepting = false; for (const peer of wss.clients) peer.terminate(); await expect(pages[1].locator(".runtime-status-banner")).toContainText("失联");
    accepting = true; await expect(pages[1].locator(".runtime-status-banner")).toContainText("在线 2 台"); expect(subscriptions-subscriptionBaseline).toBeGreaterThanOrEqual(2);
    stale = true; await expect(pages[1].locator(".runtime-status-banner")).toContainText("陈旧"); stale = false; await expect(pages[1].locator(".runtime-status-banner")).toContainText("在线 2 台");
    await pages[1].screenshot({ path:testInfo.outputPath("websocket-two-clients.png") });
    await contexts[0].close(); contexts.shift(); expect(wss.clients.size).toBe(1); temperature = 71.3; await expect(pages[1].locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText("71.3");
    await contexts[0].close(); contexts.shift(); await expect.poll(() => wss.clients.size).toBe(0); const stopped = connections; await new Promise((resolve) => setTimeout(resolve,1500)); expect(connections).toBe(stopped);
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...saved.config,collectionMode:"continuous" } } })).status()).toBe(200);
    await expect.poll(() => wss.clients.size).toBe(1);
    const previousEpoch = (await (await api.get(`${path}/runtime/sources`)).json()).epoch;
    await api.dispose(); const restartedUrl = await runtime.restart(); api = await apiRequest.newContext({ baseURL:restartedUrl,storageState:identity });
    await expect.poll(async () => (await (await api.get(`${path}/runtime/sources`)).json()).sources.find((item:{ id:string }) => item.id === source.id)?.state).toBe("sampled");
    const resumed = await (await api.get(`${path}/runtime/sources`)).json(); expect(resumed.epoch).not.toBe(previousEpoch); expect(resumed.sources.find((item:{ id:string }) => item.id === source.id)).toMatchObject({ mode:"continuous",subscribers:0,state:"sampled" });
    expect(wss.clients.size).toBe(1);
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...saved.config,collectionMode:"demand" } } })).status()).toBe(200);
    await expect.poll(() => wss.clients.size).toBe(0);

  } finally { for (const context of contexts) await context.close(); await api.dispose(); await runtime.dispose(); for (const peer of wss.clients) peer.terminate(); await new Promise<void>((resolve) => wss.close(() => resolve())); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
