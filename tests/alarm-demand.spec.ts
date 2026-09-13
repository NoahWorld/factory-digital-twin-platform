import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDemo } from "./demo";
import type { AlarmRule } from "../shared/alarm-rules";

test("last demand release pauses confirmation and a later subscriber resumes the same alarm episode",async ({},testInfo) => {
  let temperature = 50,hits = 0;
  const upstream = createServer((_,response) => { hits++;response.end(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature,pressure:24,status:"running",alarmLevel:0 } })); });upstream.listen(0,"127.0.0.1");await once(upstream,"listening");const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),bootstrap = randomBytes(24).toString("hex");
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host } }),api = await apiRequest.newContext({ baseURL:runtime.url });let subscription:{ release():void }|undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"demand-alarms@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Demand alarms" } })).status()).toBe(201);
    const demo = await createDemo(api,false,false),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await api.get(`${base}/data-sources`)).json()).dataSources;
    for (const source of sources) expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/state`,intervalSeconds:1,collectionMode:"demand" } } })).status()).toBe(200);
    const config = (await (await api.get(`${base}/alarm-rules`)).json()),rule:AlarmRule = { id:"hot",name:"Hot",assetId:"DEVICE-001",enabled:true,severity:"warning",message:"Hot device",condition:{ op:"gt",left:{ kind:"metric",assetId:"DEVICE-001",metricKey:"temperature" },right:{ kind:"literal",value:45 } },recoveryCondition:null };
    expect((await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:config.runtimeRevision,rules:[rule] } })).status()).toBe(200);expect(hits).toBe(0);
    const alarms = async () => (await (await api.get(`${base}/alarms`)).json());
    subscription = await runtime.environment.CENTRAL_RUNTIME.subscribe(demo.projectId,[demo.assets[0].id],() => {});await expect.poll(async () => (await alarms()).active.length).toBe(1);const id = (await alarms()).active[0].id;
    subscription.release();subscription = undefined;expect((await alarms()).active[0]).toMatchObject({ id,confirmation:"pending" });const stopped = hits;await new Promise((resolve) => setTimeout(resolve,1300));expect(hits).toBe(stopped);
    temperature = 39;subscription = await runtime.environment.CENTRAL_RUNTIME.subscribe(demo.projectId,[demo.assets[0].id],() => {});await expect.poll(async () => (await alarms()).active.length).toBe(0);expect((await alarms()).records.map((row:{ kind:string }) => row.kind)).toEqual(["recovered","triggered"]);
    subscription.release();subscription = undefined;
  } finally { subscription?.release();await api.dispose();await runtime.close();upstream.closeAllConnections();await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
