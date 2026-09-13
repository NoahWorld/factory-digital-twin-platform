import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createUser } from "../apps/api/src/auth";
import { createDemo } from "./demo";

test("package commit and consumed-inspection retries recheck the user's current target authority",async ({},testInfo) => {
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),bootstrap = randomBytes(24).toString("hex");
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),publicDirectory:resolve("apps/web/dist"),migrationsDirectory:resolve("apps/api/migrations"),port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:"127.0.0.1:8790" } }),admin = await apiRequest.newContext({ baseURL:runtime.url });
  let userApi:Awaited<ReturnType<typeof apiRequest.newContext>>|undefined,release:()=>void = () => {};
  try {
    expect((await admin.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"package-admin@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Package authority" } })).status()).toBe(201);
    const demo = await createDemo(admin,true),base = `/api/v1/projects/${demo.projectId}`,draft = (await (await admin.get(`${base}/publication-draft`)).json()).draft;
    const version = (await (await admin.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Authority fixture" } })).json()).version,archive = await (await admin.get(`${base}/versions/${version.id}/package`)).body();
    const target = (await (await admin.post("/api/v1/projects",{ data:{ name:"Target authority" } })).json()).project,password = randomBytes(24).toString("hex"),email = "package-delivery@example.invalid";
    const user = await createUser(runtime.environment,{ email,password,displayName:"Delivery fixture",roles:["delivery_manager"] }),now = new Date().toISOString(),db = runtime.environment.DB;
    const grant = () => db.prepare("INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'editor',?,?)").bind(target.id,user.id,now,now).run(); await grant();
    userApi = await apiRequest.newContext({ baseURL:runtime.url }); expect((await userApi.post("/api/v1/auth/login",{ data:{ email,password } })).status()).toBe(200);
    const inspectionResponse = await userApi.post("/api/v1/project-packages",{ data:archive,headers:{ "content-type":"application/zip" } }); expect(inspectionResponse.status(),await inspectionResponse.text()).toBe(201); const inspection = (await inspectionResponse.json()).inspection;
    const originalPut = runtime.environment.PROJECT_FILES.put.bind(runtime.environment.PROJECT_FILES); let entered!:()=>void; const beginning = new Promise<void>((resolve) => { entered = resolve; }),gate = new Promise<void>((resolve) => { release = resolve; });
    runtime.environment.PROJECT_FILES.put = async (...args:Parameters<typeof originalPut>) => { const result = await originalPut(...args); entered(); await gate; return result; };
    const installing = userApi.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id,targetProjectId:target.id,expectedRuntimeRevision:0 } }); await beginning;
    await db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").bind(target.id,user.id).run(); release();
    const denied = await installing; expect(denied.status(),await denied.text()).toBe(403);
    expect((await db.prepare("SELECT id FROM project_versions WHERE project_id=?").bind(target.id).all()).results).toEqual([]); expect((await db.prepare("SELECT id FROM model_assets WHERE project_id=?").bind(target.id).all()).results).toEqual([]);
    runtime.environment.PROJECT_FILES.put = originalPut; await grant();
    const success = await userApi.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id,targetProjectId:target.id,expectedRuntimeRevision:0 } }); expect(success.status(),await success.text()).toBe(201);
    await db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").bind(target.id,user.id).run();
    const retry = await userApi.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id } }); expect(retry.status(),await retry.text()).toBe(403);
  } finally { release(); await userApi?.dispose(); await admin.dispose(); await runtime.close(); }
});
