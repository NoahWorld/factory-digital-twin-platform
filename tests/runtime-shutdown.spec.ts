import { test,expect,request as apiRequest } from "@playwright/test";
import { EventEmitter,once } from "node:events";
import { createServer,type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir,writeFile,stat,symlink } from "node:fs/promises";
import { join } from "node:path";
import { createMockGltf } from "../scripts/mock-model.mjs";
const loadRuntime = () => import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href);

test("aborting a pending response read settles the handler and invokes stream cancellation", async () => {
  const { writeRuntimeResponse } = await loadRuntime();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } });
  const target = Object.assign(new EventEmitter(),{ statusCode: 0,setHeader() {},write() { return true; },end() {} }) as unknown as ServerResponse;
  const controller = new AbortController();
  const result = writeRuntimeResponse(new Response(stream),target,controller.signal).then(() => "complete",() => "aborted");
  await Promise.resolve(); controller.abort();
  await expect(result).resolves.toBe("aborted"); expect(cancelled).toBe(true);
});

test("runtime data cannot overlap public files and hidden configuration files are never served", async ({},testInfo) => {
  const { startRuntime } = await loadRuntime();
  const publicDirectory = testInfo.outputPath("public"),dataDirectory = testInfo.outputPath("data");
  await mkdir(publicDirectory,{ recursive: true }); await writeFile(join(publicDirectory,"index.html"),"<html>Runtime</html>"); await writeFile(join(publicDirectory,".env"),"PRIVATE_TEST_VALUE=not-public");
  const options = { publicDirectory,migrationsDirectory: resolve("apps/api/migrations"),port: 0 };
  await expect(startRuntime({ ...options,dataDirectory: publicDirectory })).rejects.toThrow("outside");
  await expect(stat(join(publicDirectory,"config.sqlite"))).rejects.toThrow();
  const alias = testInfo.outputPath("public-alias"); await symlink(publicDirectory,alias,"dir");
  await expect(startRuntime({ ...options,dataDirectory: alias })).rejects.toThrow("inside public");
  const runtime = await startRuntime({ ...options,dataDirectory });
  try { expect((await fetch(`${runtime.url}/.env`)).status).toBe(404); expect((await fetch(`${runtime.url}/`)).status).toBe(200); }
  finally { await runtime.close(); }
});

test("shutdown waits for an accepted resource write before closing the database", async ({},testInfo) => {
  const { startRuntime } = await loadRuntime();
  const bootstrap = randomBytes(24).toString("hex");
  const runtime = await startRuntime({ dataDirectory: testInfo.outputPath("data"),publicDirectory: resolve("apps/web/dist"),migrationsDirectory: resolve("apps/api/migrations"),port: 0,environment: { BOOTSTRAP_TOKEN: bootstrap } });
  const api = await apiRequest.newContext({ baseURL: runtime.url });
  let release!: () => void;
  try {
    const initialized = await api.post("/api/v1/auth/bootstrap",{ headers: { "x-bootstrap-token": bootstrap },data: { email: "shutdown@example.invalid",password: randomBytes(24).toString("hex"),displayName: "Shutdown fixture" } }); expect(initialized.status()).toBe(201);
    const project = (await (await api.post("/api/v1/projects",{ data: { name: "Shutdown resource test" } })).json()).project;
    const bucket = runtime.environment.PROJECT_FILES!,put = bucket.put.bind(bucket);
    let started!: () => void; const beginning = new Promise<void>((resolve) => { started = resolve; }),gate = new Promise<void>((resolve) => { release = resolve; });
    bucket.put = async (...args) => { started(); await gate; return put(...args); };
    const upload = api.post(`/api/v1/projects/${project.id}/model-assets?filename=shutdown.gltf`,{ data: createMockGltf(),headers: { "content-type": "model/gltf+json" } }).catch(() => null);
    await beginning;
    let closed = false; const closing = runtime.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve,30)); expect(closed).toBe(false);
    expect(await runtime.environment.DB.prepare("SELECT 1 AS value").first<{ value: number }>()).toMatchObject({ value: 1 });
    release(); await closing; await upload;
    const read = new DatabaseSync(runtime.databasePath,{ readOnly: true });
    try { expect(read.prepare("SELECT COUNT(*) AS n FROM model_assets").get()?.n).toBe(1); } finally { read.close(); }
  } finally { release?.(); await api.dispose(); await runtime.close(); }
});

test("shutdown aborts an upstream response that has not finished its body", async ({},testInfo) => {
  const { startRuntime } = await loadRuntime();
  let requested!: () => void,upstreamClosed = false;
  const started = new Promise<void>((resolve) => { requested = resolve; });
  const source = createServer((_,response) => { response.writeHead(200,{ "content-type": "application/json" }); response.write('{"value":'); response.once("close",() => { upstreamClosed = true; }); requested(); });
  source.listen(0,"127.0.0.1"); await once(source,"listening"); const address = source.address() as import("node:net").AddressInfo;
  const bootstrap = randomBytes(24).toString("hex"),host = `127.0.0.1:${address.port}`;
  const runtime = await startRuntime({ dataDirectory: testInfo.outputPath("data"),publicDirectory: resolve("apps/web/dist"),migrationsDirectory: resolve("apps/api/migrations"),port: 0,environment: { BOOTSTRAP_TOKEN: bootstrap,RUNTIME_POLLING_ENABLED: "true",RUNTIME_ALLOWED_HOSTS: host } });
  const api = await apiRequest.newContext({ baseURL: runtime.url });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers: { "x-bootstrap-token": bootstrap },data: { email: "cancel@example.invalid",password: randomBytes(24).toString("hex"),displayName: "Cancel fixture" } })).status()).toBe(201);
    const project = (await (await api.post("/api/v1/projects",{ data: { name: "Cancellation source test" } })).json()).project,path = `/api/v1/projects/${project.id}`;
    const asset = (await (await api.post(`${path}/assets`,{ data: { assetId: "TEST",name: "Test",assetType: "equipment",modelNode: null,metadata: {} } })).json()).asset;
    const dataSource = (await (await api.post(`${path}/data-sources`,{ data: { name: "Slow local source",sourceType: "rest_polling",config: { url: `http://${host}/`,credentialRef: null,intervalSeconds: 2,timeoutMs: 10000,timestampPath: null } } })).json()).dataSource;
    expect((await api.post(`${path}/assets/${asset.id}/data-bindings`,{ data: { dataSourceId: dataSource.id,metricKey: "value",sourcePath: "$.value",valueType: "number",unit: null,staleAfterSeconds: 10 } })).status()).toBe(201);
    const response = api.get(`${path}/assets/${asset.id}/runtime-state`).catch(() => null); await started;
    const before = Date.now(); await runtime.close(); expect(Date.now()-before).toBeLessThan(1000);
    await expect.poll(() => upstreamClosed).toBe(true); await response;
  } finally { await api.dispose(); await runtime.close(); source.closeAllConnections(); await new Promise<void>((resolve) => source.close(() => resolve())); }
});

test("a second host cannot recover or mutate a data directory while its original host is live",async ({},testInfo) => {
  const { startRuntime } = await loadRuntime();
  const options = { dataDirectory:testInfo.outputPath("owned-data"),publicDirectory:resolve("apps/web/dist"),migrationsDirectory:resolve("apps/api/migrations"),port:0 };
  const first = await startRuntime(options);
  try { await expect(startRuntime(options)).rejects.toThrow("already owns"); expect((await fetch(`${first.url}/health`)).status).toBe(200); }
  finally { await first.close(); }
  const second = await startRuntime(options); await second.close();
});
