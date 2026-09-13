import { parseRuntimeProjectSnapshot } from "../shared/runtime-project";
import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes,createHash } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { SqliteDatabase } from "../apps/runtime/src/sqlite-database";
import { createUser } from "../apps/api/src/auth";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";

test("publication revision covers mappings and sources, frozen versions survive draft edits, activation CAS and file integrity are enforced",async ({},testInfo) => {
  const runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL:runtime.url });
  let viewer:Awaited<ReturnType<typeof apiRequest.newContext>> | undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"publication@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Publication owner" } })).status()).toBe(201);
    const demo = await createDemo(api,true),path = `/api/v1/projects/${demo.projectId}`;
    const inspected = await api.get(`${path}/publication-draft`); expect(inspected.status(),await inspected.text()).toBe(200); const firstDraft = (await inspected.json()).draft;
    const source = (await (await api.get(`${path}/data-sources`)).json()).dataSources[0];
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,intervalSeconds:3 } } })).status()).toBe(200);
    expect((await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:firstDraft.runtimeRevision,label:"stale" } })).status()).toBe(409);
    expect((await (await api.get(`${path}/versions`)).json()).versions).toEqual([]);
    const draft = (await (await api.get(`${path}/publication-draft`)).json()).draft; expect(draft.canvasRevision).toBe(firstDraft.canvasRevision); expect(draft.runtimeRevision).toBeGreaterThan(firstDraft.runtimeRevision);
    const created = await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"V1" } }); expect(created.status(),await created.text()).toBe(201); const v1 = (await created.json()).version;
    const initial = (await (await api.get(`${path}/versions/${v1.id}/definition`)).json()).definition;
    expect((await api.post(`${path}/versions/${v1.id}/activate`,{ data:{ expectedPublicationRevision:0 } })).status()).toBe(200);
    expect((await (await api.get(path)).json()).project.status).toBe("published");
    let editor = createEditorState(initial); editor = executeEditorOperation(editor,{ type:"page.add",name:"Draft page" });
    expect((await api.patch(`${path}/definition`,{ data:projectDefinitionPatch(editor.project,editor.savedProject) })).status()).toBe(200);
    const binding = (await (await api.get(`${path}/assets/${demo.assets[0].id}/data-bindings`)).json()).dataBindings[0];
    const beforeMapping = (await (await api.get(`${path}/publication-draft`)).json()).draft;
    expect((await api.patch(`${path}/assets/${demo.assets[0].id}/data-bindings/${binding.id}`,{ data:{ staleAfterSeconds:12 } })).status()).toBe(200);
    const afterMapping = (await (await api.get(`${path}/publication-draft`)).json()).draft; expect(afterMapping.canvasRevision).toBe(beforeMapping.canvasRevision); expect(afterMapping.runtimeRevision).toBeGreaterThan(beforeMapping.runtimeRevision);
    expect((await (await api.get(`${path}/versions/${v1.id}/definition`)).json()).definition).toEqual(initial);
    const second = await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:afterMapping.runtimeRevision,label:"V2" } }); expect(second.status(),await second.text()).toBe(201); const v2 = (await second.json()).version;
    expect(v2.versionNumber).toBe(v1.versionNumber+1);
    const races = await Promise.all([api.post(`${path}/versions/${v2.id}/activate`,{ data:{ expectedPublicationRevision:1 } }),api.post(`${path}/versions/${v1.id}/activate`,{ data:{ expectedPublicationRevision:1 } })]); expect(races.map((response) => response.status()).sort()).toEqual([200,409]);
    const db = new SqliteDatabase(runtime.databasePath); let file:string,original:Buffer;
    try {
      const row = await db.prepare("SELECT id,object_key FROM model_assets WHERE project_id=?").bind(demo.projectId).first<{ id:string;object_key:string }>();
      const keyHash = createHash("sha256").update(row!.object_key).digest("hex"); file = join(runtime.dataDirectory,"objects",keyHash.slice(0,2),keyHash,"content"); original = await readFile(file);
      const stored = JSON.parse((await db.prepare("SELECT config_json FROM project_versions WHERE id=?").bind(v1.id).first<{ config_json:string }>())!.config_json);
      const badTrigger = structuredClone(stored); badTrigger.definition.interactions.rules = [{ id:"missing-trigger",name:"Missing metric",pageId:"main",enabled:true,reentry:"restart",trigger:{ type:"data.change",sourceId:"DEVICE-001",metricKey:"missingMetric" },condition:null,actions:[{ type:"event.emit",name:"test",value:{ kind:"literal",value:null } }] }];
      expect(() => parseRuntimeProjectSnapshot(badTrigger)).toThrow("触发器引用的指标");
      const duplicatedViewport = structuredClone(stored),legacy = duplicatedViewport.definition.pages[0].nodes.find((node:{ type:string }) => node.type === "model-3d"); duplicatedViewport.definition.pages[0].nodes.push({ ...legacy,id:"duplicate-model" });
      expect(() => parseRuntimeProjectSnapshot(duplicatedViewport)).toThrow("匹配多个旧模型对象");
      await expect(db.prepare("UPDATE project_versions SET label='modified' WHERE id=?").bind(v1.id).run()).rejects.toThrow("immutable");
      await expect(db.prepare("DELETE FROM model_assets WHERE id=?").bind(row!.id).run()).rejects.toThrow();
      const revision = await db.prepare("SELECT runtime_revision FROM projects WHERE id=?").bind(demo.projectId).first<{ runtime_revision:number }>();
      await expect(db.batch([db.prepare("UPDATE assets SET name='rolled back' WHERE id=?").bind(demo.assets[0].id),db.prepare("INSERT INTO project_version_model_assets(version_id,model_asset_id) VALUES('missing','missing')")])).rejects.toThrow();
      expect(await db.prepare("SELECT runtime_revision FROM projects WHERE id=?").bind(demo.projectId).first()).toEqual(revision);
      const password = randomBytes(24).toString("hex"),email = "publication-viewer@example.invalid",user = await createUser({ DB:db },{ email,password,displayName:"Viewer",roles:["viewer"] }),now = new Date().toISOString();
      await db.prepare("INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'viewer',?,?)").bind(demo.projectId,user.id,now,now).run();
      viewer = await apiRequest.newContext({ baseURL:runtime.url }); expect((await viewer.post("/api/v1/auth/login",{ data:{ email,password } })).status()).toBe(200);
    } finally { db.close(); }
    try {
      const corrupted = Buffer.from(original!); corrupted[corrupted.length-1] ^= 1; await writeFile(file!,corrupted);
      const blocked = await api.post(`${path}/versions/${v1.id}/activate`,{ data:{ expectedPublicationRevision:2 } }); expect(blocked.status()).toBe(409); expect((await blocked.json()).error).toBe("publication_resource_integrity_failed");
      expect((await (await api.get(`${path}/versions`)).json()).active.revision).toBe(2);
    } finally { await writeFile(file!,original!); }
    expect((await api.post(`${path}/versions/${v1.id}/activate`,{ data:{ expectedPublicationRevision:2 } })).status()).toBe(200);
    expect((await viewer!.get(`${path}/versions/${v1.id}/definition`)).status()).toBe(200); expect((await viewer!.get(`${path}/publication-draft`)).status()).toBe(403);
    expect((await viewer!.post(`${path}/versions/${v2.id}/activate`,{ data:{ expectedPublicationRevision:3 } })).status()).toBe(403);
    expect((await api.patch(`${path}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:"http://127.0.0.1:8790/not-a-device" } } })).status()).toBe(200);
    const failedDraft = (await (await api.get(`${path}/publication-draft`)).json()).draft;
    const failedVersion = await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:failedDraft.runtimeRevision,label:"Offline source" } }); expect(failedVersion.status()).toBe(201);
    const blockedData = await api.post(`${path}/versions/${(await failedVersion.json()).version.id}/activate`,{ data:{ expectedPublicationRevision:3 } }); expect(blockedData.status()).toBe(409); expect((await blockedData.json()).error).toBe("publication_data_unavailable"); expect((await (await api.get(`${path}/versions`)).json()).active.versionId).toBe(v1.id);
    expect((await api.delete(path)).status()).toBe(200);
  } finally { await viewer?.dispose(); await api.dispose(); await runtime.dispose(); }
});
