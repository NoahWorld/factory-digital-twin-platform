import { listAlarmRules } from "./alarm-rules";
import { fetchRuntimeSource,normalizeRuntimeAsset,type SourceSample } from "./runtime-state";
import { inspectLegacyModelNames } from "./legacy-model-names";
import { AppError,currentProjectEditPredicate,requireCurrentProjectEditor,type AppEnv,type DatabaseStatement } from "./auth";
import { getProjectDefinition } from "./project-definitions";
import { listAssets } from "./assets";
import { listAssetDataBindings } from "./asset-data-bindings";
import { listDataSources } from "./data-sources";
import { getModelAssetRow,inspectStoredModelAsset,type ModelAsset } from "./model-assets";
import { listImageAssets } from "./image-assets";
import { requiredRuntimeCapabilities,parseRuntimeProjectSnapshot,runtimeResourceIds,type RuntimeProjectSnapshot,type PublicationVersion,type PublicationPointer } from "../../../shared/runtime-project";

const digest = async (bytes:Uint8Array):Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as Uint8Array<ArrayBuffer>))].map((value) => value.toString(16).padStart(2,"0")).join("");
type DraftIdentity = { id:string;name:string;runtime_revision:number };
type VersionRow = { id:string;project_id:string;version_number:number;label:string;source_revision:number|null;snapshot_sha256:string|null;config_json:string;created_at:string };
const versionFields = "id,project_id,version_number,label,source_revision,snapshot_sha256,config_json,created_at";
const requireActiveRequest = (signal?:AbortSignal) => { if (signal?.aborted) throw new AppError(499,"publication_cancelled","Publication operation cancelled."); };
const conflict = () => new AppError(409,"publication_draft_changed","运行配置在检查期间发生变化，请重新检查后创建版本。");

async function draftIdentity(env:AppEnv,projectId:string):Promise<DraftIdentity> {
  const project = await env.DB.prepare("SELECT id,name,runtime_revision FROM projects WHERE id=?").bind(projectId).first<DraftIdentity>();
  if (!project) throw new AppError(404,"project_not_found","Project not found.");
  return project;
}

export async function publicationPointer(env:AppEnv,projectId:string):Promise<PublicationPointer> {
  const row = await env.DB.prepare("SELECT version_id,revision,updated_at FROM project_publications WHERE project_id=?").bind(projectId).first<{ version_id:string;revision:number;updated_at:string }>();
  return row ? { versionId:row.version_id,revision:row.revision,updatedAt:row.updated_at } : null;
}

const presentVersion = (row:VersionRow,activeId:string|null):PublicationVersion => {
  if (row.source_revision === null || row.snapshot_sha256 === null) throw new AppError(409,"legacy_publication_unsupported","This historical version does not contain a complete runtime snapshot.");
  return { id:row.id,projectId:row.project_id,versionNumber:row.version_number,label:row.label,sourceRevision:row.source_revision,sha256:row.snapshot_sha256,createdAt:row.created_at,active:row.id === activeId };
};
export async function listPublicationVersions(env:AppEnv,projectId:string) {
  const [rows,active] = await Promise.all([env.DB.prepare(`SELECT ${versionFields.replace("config_json,","")} FROM project_versions WHERE project_id=? AND snapshot_sha256 IS NOT NULL ORDER BY version_number DESC`).bind(projectId).all<VersionRow>(),publicationPointer(env,projectId)]);
  return { versions:rows.results.map((row) => presentVersion(row,active?.versionId ?? null)),active };
}

export async function readPublicationVersion(env:AppEnv,projectId:string,versionId:string) {
  const row = await env.DB.prepare(`SELECT ${versionFields} FROM project_versions WHERE project_id=? AND id=?`).bind(projectId,versionId).first<VersionRow>();
  if (!row) throw new AppError(404,"publication_not_found","Published version not found in this project.");
  if (!row.snapshot_sha256 || await digest(new TextEncoder().encode(row.config_json)) !== row.snapshot_sha256) throw new AppError(409,"publication_integrity_failed","The version snapshot hash is missing or invalid.");
  let snapshot:RuntimeProjectSnapshot;
  try { snapshot = parseRuntimeProjectSnapshot(JSON.parse(row.config_json)); } catch { throw new AppError(409,"publication_snapshot_invalid","The version snapshot or one of its references is invalid."); }
  if (snapshot.project.id !== projectId || snapshot.project.runtimeRevision !== row.source_revision) throw new AppError(409,"publication_identity_mismatch","Published snapshot identity is inconsistent.");
  return { version:presentVersion(row,(await publicationPointer(env,projectId))?.versionId ?? null),snapshot };
}

/** Read actual bounded bytes, not merely the metadata row or advertised ETag. */
export async function verifyPublicationResource(env:AppEnv,projectId:string,kind:"model" | "image",assetId:string,expected?:{ byteSize:number;sha256:string },signal?:AbortSignal):Promise<Uint8Array> {
  requireActiveRequest(signal);
  const table = kind === "model" ? "model_assets" : "image_assets",limit = (kind === "model" ? 25 : 8)*1024*1024;
  const row = await env.DB.prepare(`SELECT object_key,byte_size,sha256 FROM ${table} WHERE project_id=? AND id=?`).bind(projectId,assetId).first<{ object_key:string;byte_size:number;sha256:string }>();
  if (!row || (expected && (row.byte_size !== expected.byteSize || row.sha256 !== expected.sha256))) throw new AppError(409,"publication_resource_metadata_changed",`资源${assetId}的元数据缺失或与版本不一致。`);
  if (!env.PROJECT_FILES) throw new AppError(503,"publication_storage_unavailable","Project resource storage is unavailable.");
  let object;
  try { object = await env.PROJECT_FILES.get(row.object_key); } catch { throw new AppError(409,"publication_resource_integrity_failed",`资源${assetId}的文件或存储元数据无法验证。`); }
  if (!object) throw new AppError(409,"publication_resource_missing",`资源${assetId}的实际文件缺失。`);
  const reader = object.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal?.addEventListener("abort",cancel,{ once:true }); let completed = false,total = 0; const chunks:Uint8Array[] = [];
  try {
    if (object.size !== row.byte_size || object.size > limit) throw new AppError(409,"publication_resource_integrity_failed",`资源${assetId}的文件大小不正确。`);
    while (true) {
      requireActiveRequest(signal); const chunk = await reader.read(); requireActiveRequest(signal); if (chunk.done) { completed = true; break; }
      total+=chunk.value.byteLength;
      if (total > row.byte_size || total > limit) throw new AppError(409,"publication_resource_integrity_failed",`资源${assetId}超过声明的文件大小。`);
      chunks.push(chunk.value);
    }
    if (total !== row.byte_size) throw new AppError(409,"publication_resource_integrity_failed",`资源${assetId}的文件被截断。`);
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
    if (await digest(bytes) !== row.sha256) throw new AppError(409,"publication_resource_integrity_failed",`资源${assetId}的SHA256不匹配。`);
    return bytes;
  } finally { signal?.removeEventListener("abort",cancel); if (!completed) await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function captureRuntimeSnapshot(env:AppEnv,projectId:string,expectedRevision?:number,signal?:AbortSignal):Promise<RuntimeProjectSnapshot> {
  for (let attempt = 0; attempt < 3; attempt++) {
    requireActiveRequest(signal); const identity = await draftIdentity(env,projectId);
    if (expectedRevision !== undefined && identity.runtime_revision !== expectedRevision) throw conflict();
    const [definition,assets,dataSources,allImages] = await Promise.all([getProjectDefinition(env,projectId),listAssets(env,projectId),listDataSources(env,projectId),listImageAssets(env,projectId)]);
    const assetDataBindings = (await Promise.all(assets.map((asset) => listAssetDataBindings(env,projectId,asset.id)))).flat();
    const alarmRules = await listAlarmRules(env,projectId);
    const legacyRefs = new Set(definition.pages.flatMap((page) => page.nodes).filter((node) => node.type === "model-3d" && !node.sceneId).flatMap((node) => node.resourceRefs));
    const legacyModelNames:RuntimeProjectSnapshot["legacyModelNames"] = Object.create(null);
    const refs = runtimeResourceIds(definition),models = new Map<string,ModelAsset>(),visiting = new Set<string>();
    const includeModel = async (id:string):Promise<void> => {
      if (visiting.has(id)) throw new AppError(409,"publication_model_history_invalid","Model version lineage contains a cycle.");
      if (models.has(id)) return; visiting.add(id);
      const row = await getModelAssetRow(env,projectId,id);
      const bytes = await verifyPublicationResource(env,projectId,"model",id,undefined,signal);
      if (legacyRefs.has(id)) legacyModelNames[id] = await inspectLegacyModelNames(bytes);
      const model = await inspectStoredModelAsset(env,projectId,id); models.set(id,model);
      if (row.previous_version_id) await includeModel(row.previous_version_id);
      visiting.delete(id);
    };
    for (const id of refs.models) await includeModel(id);
    const images = allImages.filter((image) => refs.images.includes(image.id));
    if (images.length !== refs.images.length) throw new AppError(409,"publication_resource_missing","An image dependency is missing.");
    for (const image of images) await verifyPublicationResource(env,projectId,"image",image.id,image,signal);
    requireActiveRequest(signal); const current = await draftIdentity(env,projectId);
    if (current.runtime_revision !== identity.runtime_revision) { if (expectedRevision !== undefined) throw conflict(); continue; }
    try { return parseRuntimeProjectSnapshot({ kind:"newpower.runtime-project",snapshotVersion:2,alarmRules,requiredCapabilities:requiredRuntimeCapabilities({ definition,alarmRules,assetDataBindings,dataSources }),project:{ id:projectId,name:identity.name,runtimeRevision:identity.runtime_revision },definition,assets,assetDataBindings,dataSources,legacyModelNames,resources:{ models:[...models.values()].sort((a,b) => a.id.localeCompare(b.id)),images } }); }
    catch (reason) { throw new AppError(409,"publication_dependencies_invalid",reason instanceof Error ? reason.message : "Runtime snapshot validation failed."); }
  }
  throw conflict();
}

export async function inspectPublicationDraft(env:AppEnv,projectId:string,signal?:AbortSignal) {
  const snapshot = await captureRuntimeSnapshot(env,projectId,undefined,signal);
  return { runtimeRevision:snapshot.project.runtimeRevision,canvasRevision:snapshot.definition.revision,projectName:snapshot.project.name,pages:snapshot.definition.pages.length,scenes:snapshot.definition.scenes.length,assets:snapshot.assets.length,dataSources:snapshot.dataSources.length,models:snapshot.resources.models.length,images:snapshot.resources.images.length,active:await publicationPointer(env,projectId) };
}

export async function createPublicationVersion(env:AppEnv,projectId:string,userId:string,expectedRevision:number,label:string,signal?:AbortSignal) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof label !== "string" || label.trim().length > 200) throw new AppError(400,"invalid_publication_request","Provide the checked runtime revision and a label of at most 200 characters.");
  const snapshot = await captureRuntimeSnapshot(env,projectId,expectedRevision,signal),config = JSON.stringify(snapshot),sha256 = await digest(new TextEncoder().encode(config)),id = crypto.randomUUID(),now = new Date().toISOString();
  const statements:DatabaseStatement[] = [env.DB.prepare(`INSERT INTO project_versions(id,project_id,version_number,config_json,created_at,snapshot_sha256,source_revision,created_by,label)
    SELECT ?,?,COALESCE((SELECT MAX(version_number) FROM project_versions WHERE project_id=?),0)+1,?,?,?,?,?,?
    WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND runtime_revision=?) AND ${currentProjectEditPredicate}`).bind(id,projectId,projectId,config,now,sha256,expectedRevision,userId,label.trim(),projectId,expectedRevision,userId,projectId)];
  for (const model of snapshot.resources.models) statements.push(env.DB.prepare("INSERT INTO project_version_model_assets(version_id,model_asset_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM project_versions WHERE id=?)").bind(id,model.id,id));
  for (const image of snapshot.resources.images) statements.push(env.DB.prepare("INSERT INTO project_version_image_assets(version_id,image_asset_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM project_versions WHERE id=?)").bind(id,image.id,id));
  requireActiveRequest(signal);
  const result = await env.DB.batch(statements);
  if (result[0]?.meta?.changes !== 1) { await requireCurrentProjectEditor(env,userId,projectId); throw conflict(); }
  return (await readPublicationVersion(env,projectId,id)).version;
}

export async function verifyPublicationData(env:AppEnv,snapshot:RuntimeProjectSnapshot,signal?:AbortSignal) {
  for (const feature of snapshot.requiredCapabilities ?? []) if (!env.RUNTIME_CAPABILITIES?.has(feature)) throw new AppError(503,"publication_capability_unavailable",`当前宿主不提供版本要求的运行能力：${feature}`);
  requireActiveRequest(signal);
  const used = snapshot.dataSources.filter((source) => source.config.collectionMode === "continuous" || snapshot.assetDataBindings.some((binding) => binding.dataSourceId === source.id));
  const samples = new Map<string,SourceSample>(),controller = new AbortController(); let cursor = 0;
  const cancel = () => controller.abort(); signal?.addEventListener("abort",cancel,{ once:true }); if (signal?.aborted) cancel();
  const workers = Array.from({ length:Math.min(6,used.length) },async () => {
    while (cursor < used.length) {
      requireActiveRequest(signal); const source = used[cursor++];
      try { samples.set(source.id,await fetchRuntimeSource(env,source,crypto.randomUUID(),controller.signal)); }
      catch (reason) { controller.abort(); throw reason; }
    }
  });
  const results = await Promise.allSettled(workers); signal?.removeEventListener("abort",cancel); requireActiveRequest(signal); const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw new AppError(409,"publication_data_unavailable",`发布版本的数据连接检查失败：${failed.reason instanceof AppError ? failed.reason.code : "collection_failed"}。当前发布版本保持不变。`);
  for (const asset of snapshot.assets) {
    const bindings = snapshot.assetDataBindings.filter((binding) => binding.assetRecordId === asset.id); if (!bindings.length) continue;
    try { normalizeRuntimeAsset({ asset,bindings,sources:snapshot.dataSources.filter((source) => bindings.some((binding) => binding.dataSourceId === source.id)) },samples); }
    catch (reason) { throw new AppError(409,"publication_data_invalid",`设备${asset.assetId}的发布数据校验失败：${reason instanceof AppError ? reason.code : "normalization_failed"}。`); }
  }
}

export async function activatePublicationVersion(env:AppEnv,projectId:string,userId:string,versionId:string,expectedRevision:number,signal?:AbortSignal) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new AppError(400,"invalid_publication_request","Provide the current publication pointer revision, or zero for the first activation.");
  const { snapshot } = await readPublicationVersion(env,projectId,versionId);
  for (const model of snapshot.resources.models) await verifyPublicationResource(env,projectId,"model",model.id,model,signal);
  for (const image of snapshot.resources.images) await verifyPublicationResource(env,projectId,"image",image.id,image,signal);
  await verifyPublicationData(env,snapshot,signal);
  requireActiveRequest(signal);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`INSERT INTO project_publications(project_id,version_id,revision,updated_by,updated_at)
    SELECT ?,?,1,?,? WHERE EXISTS(SELECT 1 FROM project_versions WHERE project_id=? AND id=?) AND ${currentProjectEditPredicate}
    AND ((?=0 AND NOT EXISTS(SELECT 1 FROM project_publications WHERE project_id=?)) OR EXISTS(SELECT 1 FROM project_publications WHERE project_id=? AND revision=?))
    ON CONFLICT(project_id) DO UPDATE SET version_id=excluded.version_id,revision=project_publications.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at
    WHERE project_publications.revision=?`).bind(projectId,versionId,userId,now,projectId,versionId,userId,projectId,expectedRevision,projectId,projectId,expectedRevision,expectedRevision).run();
  if (result.meta?.changes !== 1) { await requireCurrentProjectEditor(env,userId,projectId); throw new AppError(409,"publication_activation_conflict","当前发布版本已变化，请刷新后再激活或回滚。"); }
  return { versionId,revision:expectedRevision+1,updatedAt:now };
}
