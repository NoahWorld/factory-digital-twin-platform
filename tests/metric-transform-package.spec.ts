import { test,expect,request as apiRequest } from "@playwright/test";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDemo } from "./demo";
import { captureRuntimeSnapshot } from "../apps/api/src/publications";
import { parseRuntimeProjectSnapshot } from "../shared/runtime-project";
import { createPackageManifest,projectPackageIdentity } from "../shared/project-package";
import { canonicalJson } from "../apps/api/src/package-resource-validation";
import { buildAlarmPlan } from "../apps/runtime/src/alarm-plan";
import type { AlarmRule } from "../shared/alarm-rules";

test("metric transforms survive immutable snapshots, remapped packages and draft restore while old v1 bytes and alarm signatures remain stable",async ({},testInfo) => {
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),bootstrap = randomBytes(24).toString("hex");
  const runtime = await startRuntime({ dataDirectory:testInfo.outputPath("data"),port:0,environment:{ BOOTSTRAP_TOKEN:bootstrap } }),api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":bootstrap },data:{ email:"transform-package@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Transform package" } })).status()).toBe(201);
    const demo = await createDemo(api),base = `/api/v1/projects/${demo.projectId}`,before = await captureRuntimeSnapshot(runtime.environment,demo.projectId),{ alarmRules,requiredCapabilities,...rest } = before;
    const legacy = { ...rest,snapshotVersion:1 as const },wire = JSON.stringify(legacy),sha = createHash("sha256").update(wire).digest("hex"),legacyId = randomUUID(),db = runtime.environment.DB,user = await db.prepare("SELECT id FROM users LIMIT 1").first();
    await db.prepare("INSERT INTO project_versions(id,project_id,version_number,config_json,created_at,snapshot_sha256,source_revision,created_by,label) VALUES(?,?,1,?,?,?,?,?,?)").bind(legacyId,demo.projectId,wire,new Date().toISOString(),sha,legacy.project.runtimeRevision,user.id,"Legacy unchanged").run();
    const manifest = createPackageManifest(legacy,{ id:legacyId,projectId:demo.projectId,versionNumber:1,label:"Legacy unchanged",sourceRevision:legacy.project.runtimeRevision,sha256:sha,createdAt:new Date().toISOString(),active:false });expect(canonicalJson(projectPackageIdentity(manifest))).toBe(canonicalJson(manifest));
    const parsedLegacy = parseRuntimeProjectSnapshot(legacy);expect(JSON.stringify(parsedLegacy)).not.toContain('"transform"');expect(JSON.stringify(parsedLegacy)).not.toContain('"timestampFormat"');
    const rule:AlarmRule = { id:"transform-high",name:"Converted high",assetId:"DEVICE-001",enabled:true,severity:"warning",message:"Converted metric high",recoveryCondition:null,condition:{ op:"gt",left:{ kind:"metric",assetId:"DEVICE-001",metricKey:"temperature" },right:{ kind:"literal",value:50 } } };
    const oldPlan = buildAlarmPlan({ ...before,alarmRules:[rule] },"draft");
    // Exact pre-transform dependency projection, not a second call to the changed implementation.
    const bindings = before.assetDataBindings.filter((binding) => binding.assetRecordId === demo.assets[0].id && binding.metricKey === "temperature"),sources = before.dataSources.filter((source) => bindings.some((binding) => binding.dataSourceId === source.id));
    const oldSignature = createHash("sha256").update(canonicalJson({ rule:{ id:rule.id,assetId:rule.assetId,enabled:rule.enabled,condition:rule.condition,recoveryCondition:rule.recoveryCondition },bindings:bindings.map(({ id,metricKey,sourcePath,valueType,unit,staleAfterSeconds,dataSourceId }) => ({ id,metricKey,sourcePath,valueType,unit,staleAfterSeconds,dataSourceId })),sources:sources.map(({ id,sourceType,config }) => ({ id,sourceType,config:Object.fromEntries(Object.entries(config).filter(([key]) => !["collectionMode","intervalSeconds","timeoutMs","heartbeatSeconds","reconnectMaxSeconds","sampleIntervalMs"].includes(key))) })) })).digest("hex");expect(oldPlan.rules[0].signature).toBe(oldSignature);
    const binding = bindings[0],transform = { version:1,steps:[{ type:"number",coerceString:true,scale:0.5,offset:1 }] },assetPath = `${base}/assets/${binding.assetRecordId}`;
    expect((await api.patch(`${assetPath}/data-bindings/${binding.id}`,{ data:{ transform } })).status()).toBe(200);
    const transformed = await captureRuntimeSnapshot(runtime.environment,demo.projectId);expect(transformed.requiredCapabilities).toEqual(["metric-transforms-v1"]);expect(transformed.project.runtimeRevision).toBeGreaterThan(before.project.runtimeRevision);expect(buildAlarmPlan({ ...transformed,alarmRules:[rule] },"draft").rules[0].signature).not.toBe(oldSignature);
    const source = sources[0];expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,timestampFormat:"unix_seconds" } } })).status()).toBe(200);
    const snapshot = await captureRuntimeSnapshot(runtime.environment,demo.projectId);expect(snapshot.requiredCapabilities).toEqual(["metric-transforms-v1","source-time-format-v1"]);expect(() => parseRuntimeProjectSnapshot({ ...snapshot,requiredCapabilities:[] })).toThrow("能力声明");expect(() => parseRuntimeProjectSnapshot({ ...snapshot,snapshotVersion:1,requiredCapabilities:undefined,alarmRules:undefined })).toThrow();
    const freeze = await api.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:snapshot.project.runtimeRevision,label:"Converted frozen" } });expect(freeze.status(),await freeze.text()).toBe(201);const version = (await freeze.json()).version;
    const frozenRow = await db.prepare("SELECT config_json FROM project_versions WHERE id=?").bind(version.id).first();
    expect((await api.patch(`${assetPath}/data-bindings/${binding.id}`,{ data:{ transform:null } })).status()).toBe(200);
    const exported = await api.get(`${base}/versions/${version.id}/package`);expect(exported.status()).toBe(200);const checked = await api.post("/api/v1/project-packages",{ data:await exported.body(),headers:{ "content-type":"application/zip" } });expect(checked.status(),await checked.text()).toBe(201);
    const inspection = (await checked.json()).inspection,installed = await api.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id,projectName:"Imported transforms" } });expect(installed.status(),await installed.text()).toBe(201);const installation = (await installed.json()).installation,importedBase = `/api/v1/projects/${installation.projectId}`;
    const restore = async (base:string,versionId:string) => { const previewResponse = await api.get(`${base}/versions/${versionId}/restore-draft`);expect(previewResponse.status(),await previewResponse.text()).toBe(200);const preview = (await previewResponse.json()).preview;const response = await api.post(`${base}/versions/${versionId}/restore-draft`,{ data:{ expectedRuntimeRevision:preview.expectedRuntimeRevision } });expect(response.status(),await response.text()).toBe(200); };
    await restore(importedBase,installation.versionId);const imported = await captureRuntimeSnapshot(runtime.environment,installation.projectId),copied = imported.assetDataBindings.find((row) => row.metricKey === binding.metricKey && imported.assets.find((asset) => asset.id === row.assetRecordId)?.assetId === "DEVICE-001")!;
    expect(copied.transform).toEqual(transform);expect(copied.id).not.toBe(binding.id);expect(copied.dataSourceId).not.toBe(binding.dataSourceId);expect(imported.dataSources.find((row) => row.id === copied.dataSourceId)?.config.timestampFormat).toBe("unix_seconds");expect(imported.requiredCapabilities).toEqual(snapshot.requiredCapabilities);
    await restore(base,version.id);expect((await captureRuntimeSnapshot(runtime.environment,demo.projectId)).assetDataBindings.find((row) => row.id === binding.id)?.transform).toEqual(transform);
    await restore(base,legacyId);const restored = await captureRuntimeSnapshot(runtime.environment,demo.projectId);expect(restored.assetDataBindings.every((row) => !Object.hasOwn(row,"transform"))).toBe(true);expect(restored.dataSources.every((row) => !Object.hasOwn(row.config,"timestampFormat"))).toBe(true);expect(buildAlarmPlan({ ...restored,alarmRules:[rule] },"draft").rules[0].signature).toBe(oldSignature);
    expect((await db.prepare("SELECT config_json,snapshot_sha256 FROM project_versions WHERE id=?").bind(legacyId).first())).toEqual({ config_json:wire,snapshot_sha256:sha });expect((await db.prepare("SELECT config_json FROM project_versions WHERE id=?").bind(version.id).first())).toEqual(frozenRow);
  } finally { await api.dispose();await runtime.close(); }
});
