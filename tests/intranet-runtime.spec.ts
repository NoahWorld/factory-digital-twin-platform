import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdir,readFile,chmod } from "node:fs/promises";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { createDemo } from "./demo";

test("trusted HTTPS reverse proxy preserves Secure sessions, same-origin assets and live SSE, including last-client release",async ({ browser },testInfo) => {
  const tls = testInfo.outputPath("tls"); await mkdir(tls,{ recursive:true,mode:0o700 });
  const key = join(tls,"key.pem"),cert = join(tls,"cert.pem");
  const generated = spawnSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=IP:127.0.0.1,DNS:localhost"],{ encoding:"utf8" }); expect(generated.status,generated.stderr).toBe(0); await chmod(key,0o600);
  let backend = "",streamConnections = 0;
  const proxy = createHttpsServer({ key:await readFile(key),cert:await readFile(cert) },(request,response) => {
    const target = new URL(backend),streaming = request.url?.includes("/runtime/stream"); if (streaming) streamConnections++;
    const forwarded = httpRequest({ hostname:target.hostname,port:target.port,path:request.url,method:request.method,headers:request.headers },(upstream) => { response.writeHead(upstream.statusCode ?? 502,upstream.headers); upstream.pipe(response); });
    forwarded.on("error",() => { if (!response.headersSent) response.writeHead(502);response.end(); }); request.pipe(forwarded); response.once("close",() => { forwarded.destroy();if (streaming) streamConnections--; });
  });
  proxy.listen(0,"127.0.0.1"); await once(proxy,"listening"); const publicOrigin = `https://127.0.0.1:${(proxy.address() as import("node:net").AddressInfo).port}`;
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),bootstrap = randomBytes(24).toString("hex");
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),publicDirectory:resolve("apps/web/dist"),migrationsDirectory:resolve("apps/api/migrations"),port:0,publicOrigin,environment:{ BOOTSTRAP_TOKEN:bootstrap,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:"127.0.0.1:8790" } }); backend = runtime.url;
  const api = await apiRequest.newContext({ baseURL:publicOrigin,ignoreHTTPSErrors:true }); let context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  try {
    const initialized = await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"intranet@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Intranet fixture" } }); expect(initialized.status()).toBe(201); expect(initialized.headers()["set-cookie"].includes("Secure")).toBe(true);
    const demo = await createDemo(api,true);
    context = await browser.newContext({ storageState:await api.storageState(),ignoreHTTPSErrors:true,viewport:{ width:1440,height:1000 } }); const page = await context.newPage(),insecure:string[] = [];
    page.on("request",(request) => { if (request.url().startsWith("http://")) insecure.push(request.url()); });
    await page.goto(`${publicOrigin}/#/projects/${demo.projectId}/preview`); await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台"); await expect(page.locator(".model-3d-edit-hint")).toBeVisible(); expect(insecure).toEqual([]); expect(streamConnections).toBe(1);
    await page.screenshot({ path:testInfo.outputPath("https-proxy-runtime.png") }); await context.close(); context = undefined; await expect.poll(() => streamConnections).toBe(0);
  } finally { await context?.close(); await api.dispose(); proxy.closeAllConnections(); await new Promise<void>((resolve) => proxy.close(() => resolve())); await runtime.close(); }
});
