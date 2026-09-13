import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { parseSourceEnvironment,createSourceResolver } from "../apps/runtime/src/source-environment";
import { fetchRuntimeSource } from "../apps/api/src/runtime-state";
import type { DataSource } from "../apps/api/src/data-sources";

const source = (projectId:string,config:object):DataSource => ({ id:"source",projectId,name:"Source",sourceType:"rest_polling",config:{ url:"",endpointRef:"gateway",credentialRef:null,intervalSeconds:1,timeoutMs:1000,timestampPath:null,...config },createdAt:"",updatedAt:"" });
test("environment credentials bind to a specific endpoint and explicit project",() => {
  const value = { version:1,endpoints:{ gateway:{ projectIds:["project"],url:"http://localhost:8790/state",credentialRef:"api" } },credentials:{ api:{ headers:{ authorization:"Bearer test-environment-fixture" } } } };
  const resolver = createSourceResolver(parseSourceEnvironment(value));
  expect(resolver(source("project",{})).url).toBe("http://localhost:8790/state");
  expect(() => resolver(source("outsider",{}))).toThrow("unavailable");
  expect(() => resolver(source("project",{ credentialRef:"other" }))).toThrow("does not match");
  expect(() => resolver(source("project",{ endpointRef:undefined,url:"http://localhost:8791/",credentialRef:"api" }))).toThrow("server-bound");
  expect(() => parseSourceEnvironment({ ...value,credentials:{ api:{ headers:{ host:"localhost" } } } })).toThrow("Invalid source environment");
  expect(() => parseSourceEnvironment({ ...value,endpoints:{ gateway:{ projectIds:["*"],url:"http://localhost/" } } })).toThrow();
});

test("logical endpoint UI saves without secrets and the same project resolves new private environments after restart",async ({ browser },testInfo) => {
  test.setTimeout(60000);
  const secret = randomBytes(24).toString("hex"); let echo = false,accepted = 0;
  const upstream = createServer((request,response) => {
    const authorized = request.headers.authorization === `Bearer ${secret}`; if (authorized) accepted++;
    response.writeHead(authorized ? 200 : 401,{ "content-type":"application/json" });
    response.end(JSON.stringify({ timestamp:new Date().toISOString(),values:{ temperature:request.url === "/second" ? 72.4 : 41.2,pressure:24,status:"running",alarmLevel:0 },...(echo ? { authorization:secret } : {}) }));
  });
  upstream.listen(0,"127.0.0.1"); await once(upstream,"listening");
  const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const runtime = await nodeRuntimeFixture(testInfo,[host]); let api = await apiRequest.newContext({ baseURL:runtime.url });
  let context:Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"environment@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Environment fixture" } })).status()).toBe(201);
    const demo = await createDemo(api,false),path = `/api/v1/projects/${demo.projectId}`;
    const sources = (await (await api.get(`${path}/data-sources`)).json()).dataSources;
    const privateConfig = (endpoint:string) => ({ version:1,endpoints:{ gateway:{ projectIds:[demo.projectId],url:`http://${host}/${endpoint}`,credentialRef:"api" } },credentials:{ api:{ headers:{ authorization:`Bearer ${secret}` } } } });
    await runtime.setSources(privateConfig("first"));
    let identity = await api.storageState(); await api.dispose(); let url = await runtime.restart(); api = await apiRequest.newContext({ baseURL:url,storageState:identity });
    context = await browser.newContext({ storageState:identity }); const page = await context.newPage();
    await page.goto(`${url}/#/projects/${demo.projectId}/canvas`); await page.getByRole("button",{ name:"数据源",exact:true }).click();
    await page.getByRole("button",{ name:new RegExp(sources[0].name) }).click();
    await page.getByLabel("环境端点引用（可选）",{ exact:true }).fill("gateway"); await expect(page.getByLabel("HTTP(S) 地址",{ exact:true })).toBeDisabled();
    await page.getByRole("button",{ name:"保存修改",exact:true }).click();
    await page.getByRole("button",{ name:"测试连接并发现字段",exact:true }).click();
    await expect(page.locator(".data-source-probe-result")).toBeVisible(); expect(accepted).toBeGreaterThan(0);
    await page.screenshot({ path:testInfo.outputPath("logical-environment-source.png") });
    const saved = (await (await api.get(`${path}/data-sources`)).json()).dataSources.find((item:{ id:string }) => item.id === sources[0].id);
    expect(saved.config).toMatchObject({ endpointRef:"gateway",url:"" });
    const serialized = JSON.stringify(saved); expect(serialized.includes(secret)).toBe(false); expect(serialized.includes(host)).toBe(false);
    const sample = await api.post(`${path}/data-sources/${saved.id}/test`); const sampleText = await sample.text(); expect(sample.status()).toBe(200); expect(sampleText.includes(secret)).toBe(false); expect(sampleText.includes(host)).toBe(false);
    let boundAsset = demo.assets[0];
    for (const asset of demo.assets) if ((await (await api.get(`${path}/assets/${asset.id}/data-bindings`)).json()).dataBindings.some((binding:{ dataSourceId:string }) => binding.dataSourceId === saved.id)) boundAsset = asset;
    const stateResponse = await api.get(`${path}/assets/${boundAsset.id}/runtime-state`); expect(stateResponse.status()).toBe(200);
    const stateBody = await stateResponse.text(); expect(JSON.parse(stateBody).runtimeState.values.temperature).toBe(41.2); expect(stateBody.includes(secret) || stateBody.includes(host) || stateBody.includes('sourcePath')).toBe(false);
    const cookie = (await api.storageState()).cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    const stream = await fetch(`${url}${path}/runtime/stream?assets=${boundAsset.id}`,{ headers:{ cookie },signal:AbortSignal.timeout(5000) }); expect(stream.status).toBe(200);
    const reader = stream.body!.getReader(); let streamText = '';
    try { while (!streamText.includes('live')) { const chunk = await reader.read(); if (chunk.done) throw new Error('Stream closed before a live sample'); streamText += new TextDecoder().decode(chunk.value); } }
    finally { await reader.cancel(); reader.releaseLock(); }
    expect(streamText.includes(secret) || streamText.includes(host) || streamText.includes('sourcePath')).toBe(false);
    echo = true; const rejected = await api.post(`${path}/data-sources/${saved.id}/test`); expect(rejected.status()).toBe(502); const rejection = await rejected.text(); expect(rejection.includes(secret)).toBe(false); expect(JSON.parse(rejection).error).toBe("data_source_private_echo"); echo = false;
    await context.close(); context = undefined; identity = await api.storageState(); await api.dispose();
    await runtime.setSources(privateConfig("second")); url = await runtime.restart(); api = await apiRequest.newContext({ baseURL:url,storageState:identity });
    const reloaded = (await (await api.get(`${path}/data-sources`)).json()).dataSources.find((item:{ id:string }) => item.id === saved.id); expect(reloaded).toEqual(saved);
    const probe = await api.post(`${path}/data-sources/${saved.id}/test`); expect(probe.status()).toBe(200); expect((await probe.json()).probe.fields.find((field:{ path:string }) => field.path === "$.values.temperature").sample).toBe(72.4);
    expect((await api.patch(`${path}/data-sources/${saved.id}`,{ data:{ config:{ ...saved.config,url:`http://${host}/first` } } })).status()).toBe(400);
  } finally { await context?.close(); await api.dispose(); await runtime.dispose(); upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});


test("private response echoes are rejected for case-insensitive bearer, short keys and hostnames",async () => {
  const original = globalThis.fetch;
  try {
    for (const [headers,echo] of [
      [{ authorization:"bearer synthetic-secret-long" },"synthetic-secret-long"],
      [{ "x-api-key":"short7" },"prefix:short7:suffix"],
      [{ authorization:`basic ${Buffer.from("operator:synthetic-password").toString("base64")}` },"synthetic-password"],
      [{},"private-host.example"],
    ] as Array<[Record<string,string>,string]>) {
      globalThis.fetch = async () => Response.json({ value:echo });
      const resolver = createSourceResolver(parseSourceEnvironment({ version:1,endpoints:{ gateway:{ projectIds:["project"],url:"http://private-host.example:8080/state",credentialRef:"api" } },credentials:{ api:{ headers } } }));
      await expect(fetchRuntimeSource({ DB:{} as any,RESOLVE_SOURCE:resolver,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:"private-host.example:8080" },source("project",{}),"test")).rejects.toMatchObject({ code:"data_source_private_echo" });
    }
    expect(() => parseSourceEnvironment({ version:1,endpoints:{ gateway:{ projectIds:["project"],url:"http://localhost/state?auth=synthetic" } },credentials:{} })).toThrow();
  } finally { globalThis.fetch = original; }
});
