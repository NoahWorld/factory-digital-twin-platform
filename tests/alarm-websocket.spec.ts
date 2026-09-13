import { test,expect,request as apiRequest } from "@playwright/test";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("continuous WebSocket alarms become unknown on stale messages, recover on fresh data and release without viewers",async ({},testInfo) => {
  test.setTimeout(45000);let temperature = 50,paused = false,connections = 0;
  const websocket = new WebSocketServer({ host:"127.0.0.1",port:0 });await once(websocket,"listening");const host = `127.0.0.1:${(websocket.address() as import("node:net").AddressInfo).port}`;
  websocket.on("connection",(socket) => { connections++;const send = () => { if (!paused) socket.send(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature,pressure:24,status:"running",alarmLevel:0 } })); };send();const timer = setInterval(send,250);socket.on("close",() => clearInterval(timer)); });
  const runtime = await nodeRuntimeFixture(testInfo,[host]),api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"ws-alarms@example.invalid",password:randomBytes(24).toString("hex"),displayName:"WS alarms" } })).status()).toBe(201);
    const demo = await createDemo(api,false,false),base = `/api/v1/projects/${demo.projectId}`,binding = (await (await api.get(`${base}/assets/${demo.assets[0].id}/data-bindings`)).json()).dataBindings[0],config = (await (await api.get(`${base}/alarm-rules`)).json());
    expect((await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:config.runtimeRevision,rules:[{ id:"hot",name:"WS high",assetId:"DEVICE-001",enabled:true,severity:"warning",message:"WS temperature high",condition:{ op:"gt",left:{ kind:"metric",assetId:"DEVICE-001",metricKey:"temperature" },right:{ kind:"literal",value:45 } },recoveryCondition:null }] } })).status()).toBe(200);
    const sourceConfig = { url:`ws://${host}`,credentialRef:null,collectionMode:"continuous",timestampPath:"$.timestamp",topics:[],sampleIntervalMs:100,heartbeatSeconds:30,reconnectMaxSeconds:5 };
    expect((await api.patch(`${base}/data-sources/${binding.dataSourceId}`,{ data:{ sourceType:"websocket",config:sourceConfig } })).status()).toBe(200);
    const alarms = async () => (await (await api.get(`${base}/alarms`)).json());await expect.poll(async () => (await alarms()).active.length).toBe(1);const id = (await alarms()).active[0].id;expect(connections).toBe(1);
    paused = true;await expect.poll(async () => (await alarms()).active[0]?.confirmation,{ timeout:12000 }).toBe("unknown");expect((await alarms()).active[0].id).toBe(id);expect((await alarms()).records).toHaveLength(1);expect(connections).toBe(1);
    temperature = 39;paused = false;await expect.poll(async () => (await alarms()).active.length).toBe(0);expect((await alarms()).records.map((row:{ kind:string }) => row.kind)).toEqual(["recovered","triggered"]);
    expect((await api.patch(`${base}/data-sources/${binding.dataSourceId}`,{ data:{ config:{ ...sourceConfig,collectionMode:"demand" } } })).status()).toBe(200);await expect.poll(() => websocket.clients.size).toBe(0);const stopped = connections;await new Promise((resolve) => setTimeout(resolve,1200));expect(connections).toBe(stopped);
  } finally { await api.dispose();await runtime.dispose();for (const socket of websocket.clients) socket.terminate();await new Promise<void>((resolve) => websocket.close(() => resolve())); }
});
