import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { writeFile,readFile,mkdir,stat,rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn,spawnSync,type ChildProcessWithoutNullStreams } from "node:child_process";
import { unzipSync } from "fflate";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("downloaded runtime ZIP starts via its launcher in a clean directory, initializes privately and runs an imported project",async ({ browser },testInfo) => {
  test.setTimeout(90000);
  const source = await nodeRuntimeFixture(testInfo),original = await apiRequest.newContext({ baseURL:source.url }); let closedSource = false,child:ChildProcessWithoutNullStreams|undefined,api:Awaited<ReturnType<typeof apiRequest.newContext>>|undefined,context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  const clean = testInfo.outputPath("delivery"); await mkdir(clean,{ recursive:true,mode:0o700 });
  const stop = async () => { const current = child; child = undefined; if (!current || current.exitCode !== null || current.signalCode !== null) return; await new Promise<void>((resolve,reject) => { const timeout = setTimeout(() => { current.kill("SIGKILL"); reject(new Error("Distribution did not stop.")); },10000); current.once("close",() => { clearTimeout(timeout);resolve(); }); current.kill("SIGTERM"); }); };
  const start = async () => {
    child = spawn("/bin/sh",[join(clean,"start.sh"),"--port","0"],{ cwd:clean,stdio:"pipe" }); const process_ = child;
    let output = "",errors = "";
    process_.stderr.on("data",(bytes) => { errors+=String(bytes); });
    return new Promise<string>((resolve,reject) => { const timeout = setTimeout(() => { process_.kill("SIGKILL");reject(new Error("Distribution did not start.")); },15000); process_.once("error",reject); process_.once("exit",(code) => { clearTimeout(timeout); if (code !== 0) reject(new Error(`Distribution startup failed: ${errors}`)); }); process_.stdout.on("data",(bytes) => { output+=String(bytes); for (const line of output.split("\n")) { try { const value = JSON.parse(line); if (value.event === "runtime_listening") { clearTimeout(timeout);resolve(value.url); } } catch {} } }); });
  };
  try {
    expect((await original.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":source.bootstrap },data:{ email:"distribution-source@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Distribution source" } })).status()).toBe(201);
    const demo = await createDemo(original,true),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await original.get(`${base}/data-sources`)).json()).dataSources,draft = (await (await original.get(`${base}/publication-draft`)).json()).draft;
    const version = (await (await original.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Distribution sample" } })).json()).version,projectZip = await (await original.get(`${base}/versions/${version.id}/package`)).body();
    const download = await original.get("/api/v1/runtime/distribution"); expect(download.status()).toBe(200); const runtimeZip = await download.body(),files = unzipSync(runtimeZip);
    expect(Object.keys(files)).toContain("start.sh"); expect(Object.keys(files)).toContain("start.cmd"); expect(Object.keys(files).some((name) => name.includes("node_modules") || name.startsWith("data/") || name === "runtime.env")).toBe(false);
    expect(Buffer.from(runtimeZip).includes(Buffer.from(source.bootstrap))).toBe(false); expect(Object.keys(files).some((name) => name.startsWith("licenses/three-"))).toBe(true);
    for (const [name,bytes] of Object.entries(files)) { expect(name.startsWith("/") || name.includes("..") || name.includes("\\")).toBe(false); const filename = join(clean,name); await mkdir(join(filename,".."),{ recursive:true }); await writeFile(filename,bytes,{ mode:name === "start.sh" ? 0o700 : 0o600 }); }
    await writeFile(testInfo.outputPath("NewPower-runtime.zip"),runtimeZip); await writeFile(testInfo.outputPath("NewPower-project.zip"),projectZip);
    await source.dispose(); closedSource = true;
    let url = await start(); expect((await stat(join(clean,"runtime.env"))).mode & 0o777).toBe(0o600);
    const password = randomBytes(24).toString("hex"),passwordFile = testInfo.outputPath("admin-password.txt"); await writeFile(passwordFile,password,{ mode:0o600 });
    const initialized = spawnSync(process.execPath,[join(clean,"initialize-admin.mjs"),"--email","delivery@example.invalid","--password-file",passwordFile,"--port",new URL(url).port],{ cwd:clean,encoding:"utf8" }); expect(initialized.status,initialized.stderr).toBe(0); expect(initialized.stdout.includes(password)).toBe(false); await rm(passwordFile);
    api = await apiRequest.newContext({ baseURL:url }); expect((await api.post("/api/v1/auth/login",{ data:{ email:"delivery@example.invalid",password } })).status()).toBe(200);
    const inspection = (await (await api.post("/api/v1/project-packages",{ data:projectZip,headers:{ "content-type":"application/zip" } })).json()).inspection;
    const installed = await api.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id,projectName:"独立程序交付" } }); expect(installed.status(),await installed.text()).toBe(201); const installation = (await installed.json()).installation;
    const identity = await api.storageState(); await api.dispose(); api = undefined; await stop();
    const endpoints = Object.fromEntries(sources.map((source:{ id:string;config:{ url:string } }) => [`source-${source.id}`,{ projectIds:[installation.projectId],url:source.config.url }])); await writeFile(join(clean,"sources.json"),JSON.stringify({ version:1,endpoints,credentials:{} }),{ mode:0o600 });
    let config = await readFile(join(clean,"runtime.env"),"utf8"); config = config.replace("RUNTIME_POLLING_ENABLED=false","RUNTIME_POLLING_ENABLED=true").replace("RUNTIME_ALLOWED_HOSTS=\n","RUNTIME_ALLOWED_HOSTS=127.0.0.1:8790\n").replace("SOURCE_ENVIRONMENT_FILE=\n","SOURCE_ENVIRONMENT_FILE=sources.json\n"); await writeFile(join(clean,"runtime.env"),config);
    url = await start(); api = await apiRequest.newContext({ baseURL:url,storageState:identity }); const path = `/api/v1/projects/${installation.projectId}`;
    const activated = await api.post(`${path}/versions/${installation.versionId}/activate`,{ data:{ expectedPublicationRevision:0 } }); expect(activated.status(),await activated.text()).toBe(200);
    context = await browser.newContext({ storageState:identity,viewport:{ width:1440,height:1000 } }); const page = await context.newPage(); await page.goto(`${url}/#/projects/${installation.projectId}/run`); await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台"); await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    await page.screenshot({ path:testInfo.outputPath("downloaded-runtime-running-import.png") });
  } finally { await context?.close(); await api?.dispose(); await stop(); await original.dispose(); if (!closedSource) await source.dispose(); }
});
