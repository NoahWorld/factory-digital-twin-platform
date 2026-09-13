import { createHash } from "node:crypto";
import { AppError,type AppEnv } from "../../api/src/auth";
import { listAlarmRules } from "../../api/src/alarm-rules";
import { listAssets } from "../../api/src/assets";
import { listAssetDataBindings } from "../../api/src/asset-data-bindings";
import { listDataSources } from "../../api/src/data-sources";
import { canonicalJson } from "../../api/src/package-resource-validation";
import { alarmMetricKeys,validateAlarmCatalog } from "../../../shared/alarm-rules";
import { snapshotMetricCatalog,type RuntimeProjectSnapshot } from "../../../shared/runtime-project";
import type { AlarmEvaluationPlan } from "../../../shared/alarms";

type Configuration = Pick<RuntimeProjectSnapshot,"project"|"assets"|"assetDataBindings"|"dataSources"|"alarmRules">;
export function buildAlarmPlan(snapshot:Configuration,scopeId:string):AlarmEvaluationPlan {
  const rules = snapshot.alarmRules ?? [],catalog = snapshotMetricCatalog(snapshot);
  validateAlarmCatalog(rules,catalog,new Set(snapshot.assets.map((asset) => asset.assetId)));
  return { projectId:snapshot.project.id,scopeId,revision:snapshot.project.runtimeRevision,rules:rules.map((rule) => {
    const asset = snapshot.assets.find((asset) => asset.assetId === rule.assetId)!,keys = new Set(alarmMetricKeys(rule));
    const bindings = snapshot.assetDataBindings.filter((binding) => binding.assetRecordId === asset.id && keys.has(binding.metricKey)).sort((a,b) => a.metricKey.localeCompare(b.metricKey));
    const sources = snapshot.dataSources.filter((source) => bindings.some((binding) => binding.dataSourceId === source.id)).sort((a,b) => a.id.localeCompare(b.id));
    const signature = createHash("sha256").update(canonicalJson({ rule:{ id:rule.id,assetId:rule.assetId,enabled:rule.enabled,condition:rule.condition,recoveryCondition:rule.recoveryCondition },bindings:bindings.map(({ id,metricKey,sourcePath,valueType,unit,staleAfterSeconds,dataSourceId,transform }) => ({ ...(transform ? { transform }:{}),id,metricKey,sourcePath,valueType,unit,staleAfterSeconds,dataSourceId })),sources:sources.map(({ id,sourceType,config }) => ({ id,sourceType,config:Object.fromEntries(Object.entries(config).filter(([key]) => !["collectionMode","intervalSeconds","timeoutMs","heartbeatSeconds","reconnectMaxSeconds","sampleIntervalMs"].includes(key))) })) })).digest("hex");
    return { rule,signature,metrics:bindings.map((binding) => ({ metricKey:binding.metricKey,bindingId:binding.id,sourceId:binding.dataSourceId,staleAfterSeconds:binding.staleAfterSeconds })) };
  }) };
}
export async function loadDraftAlarmPlan(env:AppEnv,projectId:string):Promise<AlarmEvaluationPlan> {
  for (let attempt=0;attempt<4;attempt++) {
    const before = await env.DB.prepare("SELECT name,runtime_revision AS revision FROM projects WHERE id=?").bind(projectId).first<{ name:string;revision:number }>();
    if (!before) throw new AppError(404,"project_not_found","Project no longer exists.");
    const rules = await listAlarmRules(env,projectId);
    const assets = rules.length ? (await listAssets(env,projectId)).filter((asset) => rules.some((rule) => rule.assetId === asset.assetId)):[];
    const [bindings,sources] = await Promise.all([Promise.all(assets.map((asset) => listAssetDataBindings(env,projectId,asset.id))),rules.length ? listDataSources(env,projectId):Promise.resolve([])]);
    const after = await env.DB.prepare("SELECT runtime_revision AS revision FROM projects WHERE id=?").bind(projectId).first<{ revision:number }>();
    if (before.revision !== after?.revision) continue;
    return buildAlarmPlan({ project:{ id:projectId,name:before.name,runtimeRevision:before.revision },alarmRules:rules,assets,assetDataBindings:bindings.flat(),dataSources:sources },"draft");
  }
  throw new AppError(409,"alarm_configuration_busy","告警配置读取期间连续变化，请重新采集。");
}
