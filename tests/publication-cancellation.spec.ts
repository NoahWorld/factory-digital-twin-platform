import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { SqliteDatabase } from "../apps/runtime/src/sqlite-database";

test("shutdown cancels activation checks without changing the publication pointer",async ({},testInfo) => {
  let started!:() => void,closed = false; const requested = new Promise<void>((resolve) => { started = resolve; });
  const source = createServer((_,response) => { response.writeHead(200,{ "content-type":"application/json" }); response.write('{"value":'); response.once("close",() => { closed = true; }); started(); }); source.listen(0,"127.0.0.1"); await once(source,"listening");
  const host = `127.0.0.1:${(source.address() as import("node:net").AddressInfo).port}`,bootstrap = randomBytes(24).toString("hex");
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href);
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),publicDirectory:resolve("apps/web/dist"),migrationsDirectory:resolve("apps/api/migrations"),port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host } }),api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"cancel-publish@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Cancel publisher" } })).status()).toBe(201);
    const project = (await (await api.post("/api/v1/projects",{ data:{ name:"Publication cancellation" } })).json()).project,path = `/api/v1/projects/${project.id}`;
    const asset = (await (await api.post(`${path}/assets`,{ data:{ assetId:"DEVICE",name:"Device",assetType:"equipment",modelNode:null,metadata:{} } })).json()).asset;
    const dataSource = (await (await api.post(`${path}/data-sources`,{ data:{ name:"Slow source",sourceType:"rest_polling",config:{ url:`http://${host}/`,intervalSeconds:1,timeoutMs:30000,timestampPath:null,credentialRef:null } } })).json()).dataSource;
    expect((await api.post(`${path}/assets/${asset.id}/data-bindings`,{ data:{ dataSourceId:dataSource.id,metricKey:"value",sourcePath:"$.value",valueType:"number",unit:null,staleAfterSeconds:10 } })).status()).toBe(201);
    const draft = (await (await api.get(`${path}/publication-draft`)).json()).draft;
    const versionResponse = await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Slow data" } }); expect(versionResponse.status(),await versionResponse.text()).toBe(201); const version = (await versionResponse.json()).version;
    const activating = api.post(`${path}/versions/${version.id}/activate`,{ data:{ expectedPublicationRevision:0 } }).catch(() => null); await requested;
    const before = Date.now(); await runtime.close(); expect(Date.now()-before).toBeLessThan(1500); await activating; await expect.poll(() => closed).toBe(true);
    const db = new SqliteDatabase(runtime.databasePath); try { expect((await db.prepare("SELECT * FROM project_publications").all()).results).toEqual([]); expect((await db.prepare("SELECT id FROM project_versions").all()).results).toHaveLength(1); } finally { db.close(); }
  } finally { await api.dispose(); await runtime.close(); source.closeAllConnections(); await new Promise<void>((resolve) => source.close(() => resolve())); }
});
