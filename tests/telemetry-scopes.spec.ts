import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve,join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocketServer } from "ws";
import { createDemo } from "./demo";
import { createUser } from "../apps/api/src/auth";

test("draft and frozen history preserve mappings and permissions; deletion stops even fixed-version subscriptions",async ({},testInfo) => {
  test.setTimeout(60000);let hits = 0;
  const upstream = createServer((_,response) => { hits++;response.end(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature:42,pressure:24,status:"running",alarmLevel:0 } })); });upstream.listen(0,"127.0.0.1");await once(upstream,"listening");const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),bootstrap = randomBytes(24).toString("hex"),dataDirectory = testInfo.outputPath("data");
  const runtime = await startRuntime({ dataDirectory,port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host } }),api = await apiRequest.newContext({ baseURL:runtime.url });let subscription:{ release():void }|undefined,userApi:typeof api|undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"scope@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Scope fixture" } })).status()).toBe(201);
    const demo = await createDemo(api,false),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await api.get(`${base}/data-sources`)).json()).dataSources;
    for (const source of sources) expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/state`,collectionMode:"continuous",intervalSeconds:1 } } })).status()).toBe(200);
    const freeze = async () => { const draft = (await (await api.get(`${base}/publication-draft`)).json()).draft;return (await (await api.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"History scope" } })).json()).version; };
    const v1 = await freeze();expect((await api.post(`${base}/versions/${v1.id}/activate`,{ data:{ expectedPublicationRevision:0 } })).status()).toBe(200);
    const history = async (versionId?:string) => (await (await api.get(`${base}${versionId ? `/versions/${versionId}`:""}/telemetry/history?assetId=DEVICE-001&metricKey=temperature`)).json()).records;
    await expect.poll(async () => (await history(v1.id))[0]?.value).toBe(42);
    const binding = (await (await api.get(`${base}/assets/${demo.assets[0].id}/data-bindings` )).json()).dataBindings.find((binding:{ metricKey:string }) => binding.metricKey === "temperature");
    expect((await api.patch(`${base}/assets/${demo.assets[0].id}/data-bindings/${binding.id}`,{ data:{ dataSourceId:binding.dataSourceId,metricKey:binding.metricKey,sourcePath:"$.values.pressure",valueType:binding.valueType,unit:binding.unit,staleAfterSeconds:binding.staleAfterSeconds } })).status()).toBe(200);
    await expect.poll(async () => (await history())[0]?.value).toBe(24);expect((await history(v1.id)).every((row:{ value:number;scopeId:string }) => row.value === 42 && row.scopeId === v1.id)).toBe(true);
    const v2 = await freeze();expect((await api.post(`${base}/versions/${v2.id}/activate`,{ data:{ expectedPublicationRevision:1 } })).status()).toBe(200);await expect.poll(async () => (await history(v2.id))[0]?.value).toBe(24);
    subscription = await runtime.environment.CENTRAL_RUNTIME.subscribe(demo.projectId,[demo.assets[0].id],() => {},v1.id);
    const password = randomBytes(24).toString("hex"),email = "history-viewer@example.invalid",user = await createUser(runtime.environment,{ email,password,displayName:"History viewer",roles:["viewer"] }),now = new Date().toISOString();
    await runtime.environment.DB.prepare("INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'viewer',?,?)").bind(demo.projectId,user.id,now,now).run();
    userApi = await apiRequest.newContext({ baseURL:runtime.url });expect((await userApi.post("/api/v1/auth/login",{ data:{ email,password } })).status()).toBe(200);expect((await userApi.get(`${base}/versions/${v1.id}/telemetry/history`)).status()).toBe(200);
    await runtime.environment.DB.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").bind(demo.projectId,user.id).run();expect((await userApi.get(`${base}/versions/${v1.id}/telemetry/history`)).status()).toBe(404);
    expect((await api.delete(base)).status()).toBe(200);const stopped = hits;await new Promise((resolve) => setTimeout(resolve,1400));expect(hits).toBe(stopped);
    const db = new DatabaseSync(join(dataDirectory,"telemetry.sqlite"),{ readOnly:true });expect(db.prepare("SELECT COUNT(*) AS n FROM metric_history WHERE project_id=?").get(demo.projectId)!.n).toBe(0);db.close();
    subscription.release();subscription = undefined;
  } finally { subscription?.release();await userApi?.dispose();await api.dispose();await runtime.close();upstream.closeAllConnections();await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});

test("a continuous WebSocket retries a transient history-plan failure without reconnect and records stale quality with no clients",async ({},testInfo) => {
  test.setTimeout(40000);const websocket = new WebSocketServer({ host:"127.0.0.1",port:0 });await once(websocket,"listening");const host = `127.0.0.1:${(websocket.address() as import("node:net").AddressInfo).port}`;let connections = 0,paused = false;
  websocket.on("connection",(socket) => { connections++;const send = () => { if (!paused) socket.send(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature:42,pressure:24,status:"running",alarmLevel:0 } })); };send();const timer = setInterval(send,250);socket.on("close",() => clearInterval(timer)); });
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),bootstrap = randomBytes(24).toString("hex");
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host } }),api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"ws-history@example.invalid",password:randomBytes(24).toString("hex"),displayName:"WS history" } })).status()).toBe(201);
    const demo = await createDemo(api,false,false),base = `/api/v1/projects/${demo.projectId}`,source = (await (await api.get(`${base}/data-sources`)).json()).dataSources[0];
    const db = runtime.environment.DB,original = db.prepare.bind(db);let failed = false;
    db.prepare = (sql:string) => { const statement = original(sql);if (sql.startsWith("SELECT DISTINCT a.id") && !failed) { failed = true; const bind = statement.bind.bind(statement);statement.bind = (...values:unknown[]) => { const bound = bind(...values);bound.all = async () => { throw new Error("Transient history read failure"); };return bound; }; }return statement; };
    expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ sourceType:"websocket",config:{ url:`ws://${host}`,credentialRef:null,collectionMode:"continuous",timestampPath:"$.timestamp",topics:[],sampleIntervalMs:100,heartbeatSeconds:30,reconnectMaxSeconds:5 } } })).status()).toBe(200);
    const history = async () => (await (await api.get(`${base}/telemetry/history?metricKey=temperature`)).json()).records;
    await expect.poll(async () => (await history())[0]?.quality).toBe("good");expect(failed).toBe(true);expect(connections).toBe(1);paused = true;
    await expect.poll(async () => (await history())[0]?.quality,{ timeout:12000 }).toBe("stale");expect(connections).toBe(1);
    paused = false;await expect.poll(async () => (await history())[0]?.quality).toBe("good");expect((await (await api.get(`${base}/runtime/sources`)).json()).sources[0].subscribers).toBe(0);
    db.prepare = original;
  } finally { await api.dispose();await runtime.close();for (const socket of websocket.clients) socket.terminate();await new Promise<void>((resolve) => websocket.close(() => resolve())); }
});
