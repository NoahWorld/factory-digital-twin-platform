import { AppError, type AppEnv, type DatabaseResult } from "./auth";
import { DEFAULT_THEME, validateNode } from "../../../shared/canvas-schema";
import { applyProjectPatch, emptyProjectDefinition, parseProjectDefinition, type ProjectDefinition, type ProjectPatch } from "../../../shared/project-definition";
import { listComponentBindings, validateComponentReferences } from "./component-data-bindings";
import { validateCanvasResources } from "./canvas-resources";
import { inspectStoredModelAsset } from "./model-assets";

type RootRow = { project_id: string; revision: number; updated_at: string; entry_page_id: string; schema_version: number };
type PageRow = { id: string; name: string; position: number; width: number; height: number; theme_json: string };
type NodeRow = { id: string; page_id: string; group_id: string | null; scene_id: string | null; node_type: string; x: number; y: number; width: number; height: number; z_index: number; props_json: string; resource_refs_json: string; data_binding_refs_json: string };

export async function getProjectDefinition(env: AppEnv, projectId: string): Promise<ProjectDefinition> {
  const root = await env.DB.prepare("SELECT project_id, revision, updated_at, entry_page_id, schema_version FROM project_canvases WHERE project_id = ?").bind(projectId).first<RootRow>();
  if (!root) return emptyProjectDefinition(projectId);
  const [pages, nodes, dataBindings, scenes, modelBindings] = await Promise.all([
    env.DB.prepare("SELECT id,name,position,width,height,theme_json FROM project_pages WHERE project_id = ? ORDER BY position,id").bind(projectId).all<PageRow>(),
    env.DB.prepare("SELECT id,page_id,group_id,scene_id,node_type,x,y,width,height,z_index,props_json,resource_refs_json,data_binding_refs_json FROM canvas_nodes WHERE project_id = ? ORDER BY z_index,id").bind(projectId).all<NodeRow>(),
    listComponentBindings(env, projectId),
    env.DB.prepare("SELECT id,config_json FROM project_scenes WHERE project_id = ? ORDER BY position,id").bind(projectId).all<{ id: string; config_json: string }>(),
    env.DB.prepare("SELECT b.id,b.scene_id,b.instance_id,b.object_id,a.asset_key FROM asset_model_bindings b JOIN assets a ON a.id=b.asset_id WHERE b.project_id = ? ORDER BY b.id").bind(projectId).all<{ id: string; scene_id: string; instance_id: string; object_id: string; asset_key: string }>(),
  ]);
  try {
    if (nodes.results.some((node) => !pages.results.some((page) => page.id === node.page_id))) throw new Error("存在不属于任何页面的节点。");
    return parseProjectDefinition({ kind: "newpower.project", schemaVersion: root.schema_version, projectId,
      scenes: scenes.results.map((scene) => ({ ...JSON.parse(scene.config_json), assetBindings: modelBindings.results.filter((binding) => binding.scene_id === scene.id).map((binding) => ({ id: binding.id, assetId: binding.asset_key, instanceId: binding.instance_id, objectId: binding.object_id })) })),
      revision: root.revision, updatedAt: root.updated_at, entryPageId: root.entry_page_id, dataBindings,
      pages: pages.results.map((page) => ({ id: page.id, name: page.name, width: page.width, height: page.height,
        theme: JSON.parse(page.theme_json), nodes: nodes.results.filter((node) => node.page_id === page.id).map((node) => validateNode({
          id: node.id, type: node.node_type, x: node.x, y: node.y, width: node.width, height: node.height, zIndex: node.z_index,
          props: JSON.parse(node.props_json), resourceRefs: JSON.parse(node.resource_refs_json), dataBindingRefs: JSON.parse(node.data_binding_refs_json),
          ...(node.group_id === null ? {} : { groupId: node.group_id }),
          ...(node.scene_id === null ? {} : { sceneId: node.scene_id }),
        })),
      })),
    });
  } catch (error) { throw new AppError(500, "invalid_project_storage", `项目定义无法解析：${error instanceof Error ? error.message : String(error)}`); }
}

const affected = (result: DatabaseResult | undefined) => {
  if (typeof result?.meta?.changes !== "number") throw new AppError(500, "missing_database_result", "Database did not return a revision result.");
  return result.meta.changes;
};

export async function persistProjectPatch(env: AppEnv, projectId: string, userId: string, patch: ProjectPatch): Promise<ProjectDefinition> {
  const current = await getProjectDefinition(env, projectId);
  const next = applyProjectPatch(current, patch);
  const oldNodes = new Map(current.pages.flatMap((page) => page.nodes).map((node) => [node.id, node]));
  for (const node of patch.upsertNodes) {
    const old = oldNodes.get(node.id);
    if (old?.type === "model-3d" && !old.sceneId && !node.sceneId && old.resourceRefs[0] && node.resourceRefs[0] && old.resourceRefs[0] !== node.resourceRefs[0]) {
      throw new AppError(400, "model_replacement_requires_scene", "更换已有模型请使用场景替换预览，明确迁移对象绑定与覆盖。");
    }
  }
  next.dataBindings = await validateComponentReferences(env, projectId, next.pages.flatMap((page) => page.nodes), next.dataBindings);
  await validateCanvasResources(env, projectId, patch.upsertNodes.filter((node) => !node.sceneId));
  const sceneAssetRecords = await validateSceneResources(env, projectId, next);
  const now = new Date().toISOString();
  const statements = [env.DB.prepare(`INSERT OR IGNORE INTO project_canvases
    (project_id,width,height,background_color,theme_mode,theme_preset_id,theme_background_pattern,theme_font_family,
     theme_glow_intensity,theme_panel_radius,theme_surface_color,theme_text_color,theme_accent_color,theme_border_color,
     revision,updated_by_user_id,updated_at,schema_version,entry_page_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,3,?)`).bind(projectId,1920,1080,DEFAULT_THEME.backgroundColor,DEFAULT_THEME.mode,
      DEFAULT_THEME.presetId,DEFAULT_THEME.backgroundPattern,DEFAULT_THEME.fontFamily,DEFAULT_THEME.glowIntensity,
      DEFAULT_THEME.panelRadius,DEFAULT_THEME.surfaceColor,DEFAULT_THEME.textColor,DEFAULT_THEME.accentColor,
      DEFAULT_THEME.borderColor,userId,now,next.entryPageId)];
  const pageChanges = current.revision === 0 ? next.pages : patch.upsertPages;
  for (const page of pageChanges) {
    statements.push(env.DB.prepare(`INSERT INTO project_pages (project_id,id,name,position,width,height,theme_json)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)
      ON CONFLICT(project_id,id) DO UPDATE SET name=excluded.name,position=excluded.position,width=excluded.width,height=excluded.height,theme_json=excluded.theme_json`)
      .bind(projectId,page.id,page.name,next.pages.findIndex((item) => item.id === page.id),page.width,page.height,JSON.stringify(page.theme),projectId,patch.expectedRevision));
  }
  for (const id of patch.deleteNodeIds) statements.push(env.DB.prepare(`DELETE FROM canvas_nodes WHERE project_id = ? AND id = ?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`).bind(projectId,id,projectId,patch.expectedRevision));
  for (const node of patch.upsertNodes) {
    statements.push(env.DB.prepare(`INSERT INTO canvas_nodes
      (id,project_id,page_id,group_id,scene_id,node_type,x,y,width,height,z_index,props_json,resource_refs_json,data_binding_refs_json,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)
      ON CONFLICT(project_id,id) DO UPDATE SET page_id=excluded.page_id,group_id=excluded.group_id,scene_id=excluded.scene_id,node_type=excluded.node_type,
      x=excluded.x,y=excluded.y,width=excluded.width,height=excluded.height,z_index=excluded.z_index,props_json=excluded.props_json,
      resource_refs_json=excluded.resource_refs_json,data_binding_refs_json=excluded.data_binding_refs_json,updated_at=excluded.updated_at`)
      .bind(node.id,projectId,node.pageId,node.groupId ?? null,node.sceneId ?? null,node.type,node.x,node.y,node.width,node.height,node.zIndex,
        JSON.stringify(node.props),JSON.stringify(node.resourceRefs),JSON.stringify(node.dataBindingRefs),now,projectId,patch.expectedRevision));
  }
  // Move nodes before deleting their previous page, so the page FK cannot delete them.
  for (const id of patch.deletePageIds) statements.push(env.DB.prepare(`DELETE FROM project_pages WHERE project_id = ? AND id = ?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`).bind(projectId,id,projectId,patch.expectedRevision));
  if (patch.pageOrder || patch.upsertPages.length || patch.deletePageIds.length) for (let index = 0; index < next.pages.length; index++) statements.push(env.DB.prepare(`UPDATE project_pages SET position = ? WHERE project_id = ? AND id = ?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`).bind(index,projectId,next.pages[index].id,projectId,patch.expectedRevision));
  const sceneChanges = current.revision === 0 ? next.scenes : patch.upsertScenes ?? [];
  for (const id of [...sceneChanges.map((scene) => scene.id), ...(patch.deleteSceneIds ?? [])]) statements.push(env.DB.prepare(`DELETE FROM asset_model_bindings WHERE project_id=? AND scene_id=?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id=? AND revision=?)`).bind(projectId,id,projectId,patch.expectedRevision));
  for (const scene of sceneChanges) {
    const { assetBindings, ...config } = scene;
    statements.push(env.DB.prepare(`INSERT INTO project_scenes (project_id,id,position,config_json)
      SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id=? AND revision=?)
      ON CONFLICT(project_id,id) DO UPDATE SET position=excluded.position,config_json=excluded.config_json`)
      .bind(projectId,scene.id,next.scenes.findIndex((item) => item.id === scene.id),JSON.stringify(config),projectId,patch.expectedRevision));
    for (const binding of assetBindings) statements.push(env.DB.prepare(`INSERT INTO asset_model_bindings (project_id,scene_id,id,asset_id,instance_id,object_id)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id=? AND revision=?)`)
      .bind(projectId,scene.id,binding.id,sceneAssetRecords.get(binding.assetId),binding.instanceId,binding.objectId,projectId,patch.expectedRevision));
  }
  for (const id of patch.deleteSceneIds ?? []) statements.push(env.DB.prepare(`DELETE FROM project_scenes WHERE project_id=? AND id=?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id=? AND revision=?)`).bind(projectId,id,projectId,patch.expectedRevision));
  statements.push(env.DB.prepare(`DELETE FROM component_data_bindings WHERE project_id = ?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`).bind(projectId,projectId,patch.expectedRevision));
  for (const binding of next.dataBindings) statements.push(env.DB.prepare(`INSERT INTO component_data_bindings (project_id,id,config_json)
    SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`).bind(projectId,binding.id,JSON.stringify(binding),projectId,patch.expectedRevision));
  statements.push(env.DB.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`).bind(now,projectId,projectId,patch.expectedRevision));
  statements.push(env.DB.prepare(`UPDATE project_canvases SET revision=revision+1,schema_version=3,entry_page_id=?,updated_at=?,updated_by_user_id=?
    WHERE project_id=? AND revision=?`).bind(next.entryPageId,now,userId,projectId,patch.expectedRevision));
  const results = await env.DB.batch(statements);
  if (affected(results.at(-1)) !== 1) throw new AppError(409, "canvas_revision_conflict", "项目版本已变更，本次保存没有写入。");
  return getProjectDefinition(env, projectId);
}

async function validateSceneResources(env: AppEnv, projectId: string, project: ProjectDefinition) {
  const assets = await env.DB.prepare("SELECT id,asset_key FROM assets WHERE project_id=?").bind(projectId).all<{ id: string; asset_key: string }>();
  const assetRecords = new Map(assets.results.map((asset) => [asset.asset_key, asset.id]));
  const objects = new Map<string, Set<string>>();
  for (const id of new Set(project.scenes.flatMap((scene) => scene.instances.map((instance) => instance.modelAssetId)))) {
    const model = await env.DB.prepare("SELECT inspection_json FROM model_assets WHERE project_id=? AND id=?").bind(projectId,id).first<{ inspection_json: string }>();
    if (!model) throw new AppError(400, "invalid_scene_resource", `模型资源 ${id} 不属于当前项目。`);
    let inspection = JSON.parse(model.inspection_json);
    if (inspection.reportVersion !== 2 || !Array.isArray(inspection.objects)) throw new AppError(400, "model_inspection_required", "请先为旧模型补充资源检查，再添加到可复用场景。");
    if (inspection.objectManifestVersion !== 2 || inspection.objects.some((object: { inDefaultScene?: boolean }) => typeof object.inDefaultScene !== "boolean")) inspection = (await inspectStoredModelAsset(env, projectId, id)).inspection;
    objects.set(id, new Set(inspection.objects.filter((object: { inDefaultScene: boolean }) => object.inDefaultScene).map((object: { objectId: string }) => object.objectId)));
  }
  for (const scene of project.scenes) {
    for (const instance of scene.instances) for (const id of [...Object.keys(instance.objectTransforms), ...Object.keys(instance.objectAppearances)]) {
      if (!objects.get(instance.modelAssetId)?.has(id)) throw new AppError(400, "invalid_scene_object", `模型实例 ${instance.name} 的对象 ${id} 不在当前资源版本中，请修复映射。`);
    }
    for (const binding of scene.assetBindings) {
      if (!assetRecords.has(binding.assetId)) throw new AppError(400, "invalid_scene_asset", `资产 ${binding.assetId} 不属于当前项目。`);
      const instance = scene.instances.find((instance) => instance.id === binding.instanceId)!;
      if (!objects.get(instance.modelAssetId)?.has(binding.objectId)) throw new AppError(400, "invalid_scene_object", "对象资产映射引用的模型对象不存在，请修复映射。");
    }
  }
  return assetRecords;
}
