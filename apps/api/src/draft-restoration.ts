import { AppError,currentProjectEditPredicate,requireCurrentProjectEditor,type AppEnv,type DatabaseStatement } from "./auth";
import { readPublicationVersion,verifyPublicationResource } from "./publications";
import { getProjectDefinition } from "./project-definitions";

export async function draftRestorationPreview(env:AppEnv,projectId:string,versionId:string) {
  const { snapshot,version } = await readPublicationVersion(env,projectId,versionId);
  const row = await env.DB.prepare(`SELECT name,runtime_revision AS runtimeRevision,
    (SELECT COUNT(*) FROM project_pages WHERE project_id=projects.id) AS pages,
    (SELECT COUNT(*) FROM canvas_nodes WHERE project_id=projects.id) AS nodes,
    (SELECT COUNT(*) FROM assets WHERE project_id=projects.id) AS assets,
    (SELECT COUNT(*) FROM project_alarm_rules WHERE project_id=projects.id) AS alarms,
    (SELECT COUNT(*) FROM data_sources WHERE project_id=projects.id) AS sources
    FROM projects WHERE id=?`).bind(projectId).first<{ name:string;runtimeRevision:number;pages:number;nodes:number;assets:number;sources:number;alarms:number }>();
  if (!row) throw new AppError(404,"project_not_found","Project not found.");
  return { version,expectedRuntimeRevision:row.runtimeRevision,current:row,incoming:{ name:snapshot.project.name,pages:snapshot.definition.pages.length,nodes:snapshot.definition.pages.reduce((total,page) => total+page.nodes.length,0),assets:snapshot.assets.length,sources:snapshot.dataSources.length,alarms:snapshot.alarmRules?.length ?? 0 } };
}

export async function restoreVersionAsDraft(env:AppEnv,projectId:string,versionId:string,userId:string,expectedRuntimeRevision:number,signal:AbortSignal) {
  if (!Number.isSafeInteger(expectedRuntimeRevision) || expectedRuntimeRevision < 0) throw new AppError(400,"invalid_restore_request","Provide the checked draft revision.");
  const { snapshot } = await readPublicationVersion(env,projectId,versionId);
  for (const model of snapshot.resources.models) await verifyPublicationResource(env,projectId,"model",model.id,model,signal);
  for (const image of snapshot.resources.images) await verifyPublicationResource(env,projectId,"image",image.id,image,signal);
  signal.throwIfAborted();
  const current = await env.DB.prepare("SELECT revision FROM project_canvases WHERE project_id=?").bind(projectId).first<{ revision:number }>();
  const canvasRevision = (current?.revision ?? 0)+1,id = crypto.randomUUID(),now = new Date().toISOString(),guard = "EXISTS(SELECT 1 FROM project_draft_restorations WHERE id=?)",statements:DatabaseStatement[] = [];
  statements.push(env.DB.prepare(`INSERT INTO project_draft_restorations(id,project_id,version_id,base_revision,created_by,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND runtime_revision=?) AND ${currentProjectEditPredicate}`).bind(id,projectId,versionId,expectedRuntimeRevision,userId,now,projectId,expectedRuntimeRevision,userId,projectId));
  const remove = (sql:string,...values:unknown[]) => statements.push(env.DB.prepare(`${sql} AND ${guard}`).bind(...values,id));
  remove("DELETE FROM project_alarm_rules WHERE project_id=?",projectId);
  remove("DELETE FROM project_canvases WHERE project_id=?",projectId);
  remove("DELETE FROM asset_data_bindings WHERE asset_id IN(SELECT id FROM assets WHERE project_id=?)",projectId);
  remove("DELETE FROM assets WHERE project_id=?",projectId);
  remove("DELETE FROM data_sources WHERE project_id=?",projectId);
  const insert = (table:string,columns:string[],values:unknown[]) => statements.push(env.DB.prepare(`INSERT INTO ${table}(${columns.join(",")}) SELECT ${values.map(() => "?").join(",")} WHERE ${guard}`).bind(...values,id));
  for (const rule of snapshot.alarmRules ?? []) insert("project_alarm_rules",["project_id","id","config_json","updated_by_user_id","created_at","updated_at"],[projectId,rule.id,JSON.stringify(rule),userId,now,now]);
  for (const asset of snapshot.assets) insert("assets",["id","project_id","asset_key","model_node","name","asset_type","metadata_json","created_at","updated_at"],[asset.id,projectId,asset.assetId,asset.modelNode,asset.name,asset.assetType,JSON.stringify(asset.metadata),asset.createdAt,now]);
  for (const source of snapshot.dataSources) insert("data_sources",["id","project_id","source_type","name","config_json","created_at","updated_at"],[source.id,projectId,source.sourceType,source.name,JSON.stringify(source.config),source.createdAt,now]);
  for (const binding of snapshot.assetDataBindings) insert("asset_data_bindings",["id","asset_id","data_source_id","metric_key","source_path","value_type","unit","stale_after_seconds","created_at","updated_at"],[binding.id,binding.assetRecordId,binding.dataSourceId,binding.metricKey,binding.sourcePath,binding.valueType,binding.unit,binding.staleAfterSeconds,binding.createdAt,now]);
  const definition = snapshot.definition,entry = definition.pages.find((page) => page.id === definition.entryPageId)!,theme = entry.theme;
  insert("project_canvases",["project_id","width","height","background_color","theme_mode","theme_preset_id","theme_background_pattern","theme_font_family","theme_glow_intensity","theme_panel_radius","theme_surface_color","theme_text_color","theme_accent_color","theme_border_color","revision","updated_by_user_id","updated_at","schema_version","entry_page_id","interactions_json"],[projectId,entry.width,entry.height,theme.backgroundColor,theme.mode,theme.presetId,theme.backgroundPattern,theme.fontFamily,theme.glowIntensity,theme.panelRadius,theme.surfaceColor,theme.textColor,theme.accentColor,theme.borderColor,canvasRevision,userId,now,4,definition.entryPageId,JSON.stringify(definition.interactions)]);
  for (const [position,page] of definition.pages.entries()) {
    insert("project_pages",["project_id","id","name","position","width","height","theme_json"],[projectId,page.id,page.name,position,page.width,page.height,JSON.stringify(page.theme)]);
    for (const node of page.nodes) insert("canvas_nodes",["id","project_id","page_id","group_id","scene_id","node_type","x","y","width","height","z_index","props_json","resource_refs_json","data_binding_refs_json","updated_at"],[node.id,projectId,page.id,node.groupId ?? null,node.sceneId ?? null,node.type,node.x,node.y,node.width,node.height,node.zIndex,JSON.stringify(node.props),JSON.stringify(node.resourceRefs),JSON.stringify(node.dataBindingRefs),now]);
  }
  for (const binding of definition.dataBindings) insert("component_data_bindings",["project_id","id","config_json"],[projectId,binding.id,JSON.stringify(binding)]);
  const assets = new Map(snapshot.assets.map((asset) => [asset.assetId,asset.id]));
  for (const [position,scene] of definition.scenes.entries()) {
    const { assetBindings,...config } = scene; insert("project_scenes",["project_id","id","position","config_json"],[projectId,scene.id,position,JSON.stringify(config)]);
    for (const binding of assetBindings) insert("asset_model_bindings",["project_id","scene_id","id","asset_id","instance_id","object_id"],[projectId,scene.id,binding.id,assets.get(binding.assetId),binding.instanceId,binding.objectId]);
  }
  statements.push(env.DB.prepare(`UPDATE projects SET name=?,updated_at=? WHERE id=? AND ${guard}`).bind(snapshot.project.name,now,projectId,id));
  signal.throwIfAborted(); const result = await env.DB.batch(statements);
  if (result[0]?.meta?.changes !== 1) { await requireCurrentProjectEditor(env,userId,projectId); throw new AppError(409,"draft_restoration_conflict","Draft changed after the preview. Review the updated draft before restoring."); }
  return { restorationId:id,definition:await getProjectDefinition(env,projectId) };
}
