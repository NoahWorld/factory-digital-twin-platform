import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";

test("active release continuous sources survive draft changes and restart, and rollbacks replace only the active background scope",async ({},testInfo) => {
  const hits = { first:0,second:0 };
  const upstream = createServer((request,response) => { const key = request.url === "/first" ? "first" : "second"; hits[key]++; response.writeHead(200,{ "content-type":"application/json" }); response.end(JSON.stringify({ value:key === "first" ? 11 : 22 })); }); upstream.listen(0,"127.0.0.1"); await once(upstream,"listening");
  const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`,runtime = await nodeRuntimeFixture(testInfo,[host]); let api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"published-continuous@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Published collector" } })).status()).toBe(201);
    const project = (await (await api.post("/api/v1/projects",{ data:{ name:"Published continuous sources" } })).json()).project,path = `/api/v1/projects/${project.id}`;
    const source = (await (await api.post(`${path}/data-sources`,{ data:{ name:"Frozen background",sourceType:"rest_polling",config:{ url:`http://${host}/first`,collectionMode:"continuous",intervalSeconds:1,timeoutMs:1000,timestampPath:null,credentialRef:null } } })).json()).dataSource;
    const freeze = async (label:string) => { const draft = (await (await api.get(`${path}/publication-draft`)).json()).draft; const response = await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label } }); expect(response.status(),await response.text()).toBe(201); return (await response.json()).version; };
    const v1 = await freeze("First source"); expect((await api.post(`${path}/versions/${v1.id}/activate`,{ data:{ expectedPublicationRevision:0 } })).status()).toBe(200);
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/second`,collectionMode:"demand" } } })).status()).toBe(200);
    let first = hits.first; await expect.poll(() => hits.first).toBeGreaterThan(first); expect(hits.second).toBe(0);
    const identity = await api.storageState(); await api.dispose(); let url = await runtime.restart(); api = await apiRequest.newContext({ baseURL:url,storageState:identity });
    first = hits.first; await expect.poll(() => hits.first).toBeGreaterThan(first); expect(hits.second).toBe(0);
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/second`,collectionMode:"continuous" } } })).status()).toBe(200);
    const v2 = await freeze("Second source"); expect((await api.post(`${path}/versions/${v2.id}/activate`,{ data:{ expectedPublicationRevision:1 } })).status()).toBe(200);
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/second`,collectionMode:"demand" } } })).status()).toBe(200);
    first = hits.first; const second = hits.second; await expect.poll(() => hits.second).toBeGreaterThan(second); await new Promise((resolve) => setTimeout(resolve,1100)); expect(hits.first).toBe(first);
    expect((await api.post(`${path}/versions/${v1.id}/activate`,{ data:{ expectedPublicationRevision:2 } })).status()).toBe(200);
    const lastSecond = hits.second; first = hits.first; await expect.poll(() => hits.first).toBeGreaterThan(first); await new Promise((resolve) => setTimeout(resolve,1100)); expect(hits.second).toBe(lastSecond);
    expect((await api.delete(path)).status()).toBe(200); first = hits.first; await new Promise((resolve) => setTimeout(resolve,1100)); expect(hits.first).toBe(first);
  } finally { await api.dispose(); await runtime.dispose(); upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
