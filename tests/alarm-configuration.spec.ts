import { createUser } from "../apps/api/src/auth";
import { test,expect,request as apiRequest } from "@playwright/test";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDemo } from "./demo";
import { captureRuntimeSnapshot } from "../apps/api/src/publications";
import { parseRuntimeProjectSnapshot } from "../shared/runtime-project";
import { createPackageManifest,projectPackageIdentity } from "../shared/project-package";
import { canonicalJson } from "../apps/api/src/package-resource-validation";
import { validateAlarmRules,type AlarmRule } from "../shared/alarm-rules";

test("alarm configuration is CAS guarded, frozen as a required capability, and v1 restoration clears draft rules without changing its wire identity",async ({},testInfo) => {
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),bootstrap = randomBytes(24).toString("hex");
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap } }),api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    const boot = await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"alarms@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Alarm fixture" } });expect(boot.status()).toBe(201);
    const demo = await createDemo(api,false),base = `/api/v1/projects/${demo.projectId}`,empty = await captureRuntimeSnapshot(runtime.environment,demo.projectId);
    const { alarmRules,requiredCapabilities,...rest } = empty,legacy = { ...rest,snapshotVersion:1 as const },config = JSON.stringify(legacy),sha = createHash("sha256").update(config).digest("hex"),legacyId = randomUUID(),db = runtime.environment.DB,user = await db.prepare("SELECT id FROM users LIMIT 1").first();
    const manifest = createPackageManifest(legacy,{ id:legacyId,projectId:demo.projectId,versionNumber:1,label:"Legacy v1",sourceRevision:legacy.project.runtimeRevision,sha256:sha,createdAt:new Date().toISOString(),active:false });
    expect(parseRuntimeProjectSnapshot(legacy)).not.toHaveProperty("alarmRules");expect(canonicalJson(projectPackageIdentity(manifest))).toBe(canonicalJson(manifest));
    await db.prepare("INSERT INTO project_versions(id,project_id,version_number,config_json,created_at,snapshot_sha256,source_revision,created_by,label) VALUES(?,?,1,?,?,?,?,?,?)").bind(legacyId,demo.projectId,config,new Date().toISOString(),sha,legacy.project.runtimeRevision,user.id,"Legacy v1").run();
    const original = (await (await api.get(`${base}/alarm-rules`)).json());expect(original.rules).toEqual([]);
    const rule:AlarmRule = { id:"high-temperature",name:"温度过高",assetId:"DEVICE-001",enabled:true,severity:"warning",message:"设备温度超过阈值",condition:{ op:"gt",left:{ kind:"metric",assetId:"DEVICE-001",metricKey:"temperature" },right:{ kind:"literal",value:40 } },recoveryCondition:{ op:"lt",left:{ kind:"metric",assetId:"DEVICE-001",metricKey:"temperature" },right:{ kind:"literal",value:38 } } };
    const saved = await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:original.runtimeRevision,rules:[rule] } });expect(saved.status(),await saved.text()).toBe(200);expect((await saved.json()).runtimeRevision).toBeGreaterThan(original.runtimeRevision);
    expect((await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:original.runtimeRevision,rules:[] } })).status()).toBe(409);
    const snapshot = await captureRuntimeSnapshot(runtime.environment,demo.projectId);expect(snapshot.snapshotVersion).toBe(2);expect(snapshot.requiredCapabilities).toEqual(["alarm-rules-v1"]);expect(snapshot.alarmRules).toEqual([rule]);
    expect(() => parseRuntimeProjectSnapshot({ ...snapshot,requiredCapabilities:["unknown-capability"] })).toThrow("必要能力");expect(() => parseRuntimeProjectSnapshot({ ...snapshot,requiredCapabilities:[] })).toThrow("能力声明");
    const frozen = await api.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:snapshot.project.runtimeRevision,label:"Alarm v2" } });expect(frozen.status(),await frozen.text()).toBe(201);const version = (await frozen.json()).version;
    const installVersion = async (versionId:string,targetProjectId?:string) => {
      const exported = await api.get(`${base}/versions/${versionId}/package`);expect(exported.status()).toBe(200);
      const checked = await api.post("/api/v1/project-packages",{ data:await exported.body(),headers:{ "content-type":"application/zip" } });expect(checked.status(),await checked.text()).toBe(201);const inspection = (await checked.json()).inspection;
      const target = targetProjectId ? (await (await api.get(`/api/v1/projects/${targetProjectId}/package-target`)).json()):null;
      const installed = await api.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id,...(targetProjectId ? { targetProjectId,expectedRuntimeRevision:target.runtimeRevision }:{ projectName:"Imported alarm configuration" }) } });expect(installed.status(),await installed.text()).toBe(targetProjectId ? 200:201);
      return { ...(await installed.json()).installation,inspection };
    };
    const oldImported = await installVersion(legacyId);expect(oldImported.inspection.alarms).toBe(0);expect((await installVersion(legacyId,oldImported.projectId)).alreadyInstalled).toBe(true);
    const imported = await installVersion(version.id);expect(imported.inspection.alarms).toBe(1);
    const importedBase = `/api/v1/projects/${imported.projectId}`,importPreview = (await (await api.get(`${importedBase}/versions/${imported.versionId}/restore-draft`)).json()).preview;
    expect(importPreview.incoming.alarms).toBe(1);expect((await api.post(`${importedBase}/versions/${imported.versionId}/restore-draft`,{ data:{ expectedRuntimeRevision:importPreview.expectedRuntimeRevision } })).status()).toBe(200);
    expect((await (await api.get(`${importedBase}/alarm-rules`)).json()).rules).toEqual([rule]);
    const password = randomBytes(24).toString("hex"),email = "alarm-member@example.invalid",member = await createUser(runtime.environment,{ email,password,displayName:"Alarm member",roles:["delivery_manager"] }),now = new Date().toISOString();
    await db.prepare("INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'viewer',?,?)").bind(demo.projectId,member.id,now,now).run();
    const memberApi = await apiRequest.newContext({ baseURL:runtime.url });const originalBatch = db.batch.bind(db);
    try {
      expect((await memberApi.post("/api/v1/auth/login",{ data:{ email,password } })).status()).toBe(200);expect((await memberApi.get(`${base}/alarms`)).status()).toBe(200);expect((await memberApi.get(`${base}/alarm-rules`)).status()).toBe(200);
      const checked = (await (await api.get(`${base}/alarm-rules`)).json()),body = { expectedRuntimeRevision:checked.runtimeRevision,rules:[] };
      expect((await memberApi.put(`${base}/alarm-rules`,{ data:body })).status()).toBe(403);
      await db.prepare("UPDATE project_members SET role='editor' WHERE project_id=? AND user_id=?").bind(demo.projectId,member.id).run();
      db.batch = async (statements:Parameters<typeof originalBatch>[0]) => { await db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").bind(demo.projectId,member.id).run();return originalBatch(statements); };
      expect((await memberApi.put(`${base}/alarm-rules`,{ data:body })).status()).toBe(403);db.batch = originalBatch;
      expect((await (await api.get(`${base}/alarm-rules`)).json()).rules).toEqual([rule]);expect((await memberApi.get(`${base}/alarms`)).status()).toBe(404);
    } finally { db.batch = originalBatch;await memberApi.dispose(); }
    runtime.environment.RUNTIME_CAPABILITIES = new Set();
    const activation = await api.post(`${base}/versions/${version.id}/activate`,{ data:{ expectedPublicationRevision:0 } });expect(activation.status(),await activation.text()).toBe(503);expect((await activation.json()).error).toBe("publication_capability_unavailable");
    const preview = (await (await api.get(`${base}/versions/${legacyId}/restore-draft`)).json()).preview;expect(preview.current.alarms).toBe(1);expect(preview.incoming.alarms).toBe(0);
    const restored = await api.post(`${base}/versions/${legacyId}/restore-draft`,{ data:{ expectedRuntimeRevision:preview.expectedRuntimeRevision } });expect(restored.status(),await restored.text()).toBe(200);expect((await (await api.get(`${base}/alarm-rules`)).json()).rules).toEqual([]);
    const row = await db.prepare("SELECT config_json,snapshot_sha256 FROM project_versions WHERE id=?").bind(legacyId).first();expect(row.config_json).toBe(config);expect(row.snapshot_sha256).toBe(sha);
    expect(JSON.parse((await db.prepare("SELECT config_json FROM project_versions WHERE id=?").bind(version.id).first()).config_json).alarmRules).toEqual([rule]);
    expect(() => validateAlarmRules([{ ...rule,condition:{ op:"exists",value:{ kind:"state",stateId:"browser-only" } } }])).toThrow();
  } finally { await api.dispose();await runtime.close(); }
});
