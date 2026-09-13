import { AppError,currentProjectEditPredicate,requireCurrentProjectEditor,type AppEnv } from "./auth";
import { validateAlarmRules,validateAlarmCatalog,type AlarmRule } from "../../../shared/alarm-rules";
import { listAssets } from "./assets";
import { listAssetDataBindings } from "./asset-data-bindings";
import { snapshotMetricCatalog } from "../../../shared/runtime-project";

export async function listAlarmRules(env:AppEnv,projectId:string):Promise<AlarmRule[]> {
  const rows = (await env.DB.prepare("SELECT config_json FROM project_alarm_rules WHERE project_id=? ORDER BY id").bind(projectId).all<{ config_json:string }>()).results;
  return validateAlarmRules(rows.map((row) => JSON.parse(row.config_json)));
}
export async function readAlarmConfiguration(env:AppEnv,projectId:string) {
  for (let attempt=0;attempt<3;attempt++) {
    const before = await env.DB.prepare("SELECT runtime_revision AS revision FROM projects WHERE id=?").bind(projectId).first<{ revision:number }>();
    if (!before) throw new AppError(404,"project_not_found","Project not found.");
    const rules = await listAlarmRules(env,projectId),after = await env.DB.prepare("SELECT runtime_revision AS revision FROM projects WHERE id=?").bind(projectId).first<{ revision:number }>();
    if (before.revision === after?.revision) return { rules,runtimeRevision:before.revision };
  }
  throw new AppError(409,"alarm_configuration_busy","告警配置正在变化，请刷新后重试。");
}
export async function replaceAlarmRules(env:AppEnv,projectId:string,userId:string,input:unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(400,"invalid_alarm_configuration","告警配置必须是对象。");
  const body = input as Record<string,unknown>;
  if (Object.keys(body).some((key) => !["expectedRuntimeRevision","rules"].includes(key)) || !Number.isSafeInteger(body.expectedRuntimeRevision) || (body.expectedRuntimeRevision as number) < 0) throw new AppError(400,"invalid_alarm_configuration","请提供当前完整项目修订与告警规则。");
  const rules = validateAlarmRules(body.rules),assets = await listAssets(env,projectId),assetDataBindings = (await Promise.all(assets.map((asset) => listAssetDataBindings(env,projectId,asset.id)))).flat();
  validateAlarmCatalog(rules,snapshotMetricCatalog({ assets,assetDataBindings }),new Set(assets.map((asset) => asset.assetId)));
  const id = crypto.randomUUID(),now = new Date().toISOString(),guard = "EXISTS(SELECT 1 FROM project_alarm_rule_changes WHERE id=?)";
  const statements = [env.DB.prepare(`INSERT INTO project_alarm_rule_changes(id,project_id,base_revision,created_by_user_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND runtime_revision=?) AND ${currentProjectEditPredicate}`).bind(id,projectId,body.expectedRuntimeRevision,userId,now,projectId,body.expectedRuntimeRevision,userId,projectId),env.DB.prepare(`DELETE FROM project_alarm_rules WHERE project_id=? AND ${guard}`).bind(projectId,id)];
  for (const rule of rules) statements.push(env.DB.prepare(`INSERT INTO project_alarm_rules(project_id,id,config_json,updated_by_user_id,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(projectId,rule.id,JSON.stringify(rule),userId,now,now,id));
  const result = await env.DB.batch(statements);
  if (result[0]?.meta?.changes !== 1) { await requireCurrentProjectEditor(env,userId,projectId);throw new AppError(409,"alarm_configuration_conflict","项目配置已变化，请刷新并核对后再保存告警。"); }
  return readAlarmConfiguration(env,projectId);
}
