import { AppError,type AppEnv } from "../../api/src/auth";
import { loadRuntimeAssetPlan,normalizeRuntimeAsset,inspectRuntimeSourceTimestamp,type RuntimeAssetPlan,type SourceSample } from "../../api/src/runtime-state";
import { readPublicationVersion } from "../../api/src/publications";
import type { DataSource } from "../../api/src/data-sources";
import type { TelemetryRecord } from "../../../shared/telemetry";
export type TelemetryPlan = { revision:number;metrics:RuntimeAssetPlan[] };
export async function loadTelemetryPlan(env:AppEnv,source:DataSource,versionId?:string):Promise<TelemetryPlan> {
  let plans:RuntimeAssetPlan[] = [],revision:number;
  if (versionId) {
    const { snapshot } = await readPublicationVersion(env,source.projectId,versionId); revision = snapshot.project.runtimeRevision;
    plans = snapshot.assets.map((asset) => ({ asset,bindings:snapshot.assetDataBindings.filter((binding) => binding.assetRecordId === asset.id && binding.dataSourceId === source.id),sources:[source] }));
  } else {
    const before = await env.DB.prepare("SELECT runtime_revision AS revision FROM projects WHERE id=?").bind(source.projectId).first<{ revision:number }>();
    if (!before) throw new AppError(404,"project_not_found","Project no longer exists."); revision = before.revision;
    const ids = (await env.DB.prepare("SELECT DISTINCT a.id FROM assets a JOIN asset_data_bindings b ON b.asset_id=a.id WHERE a.project_id=? AND b.data_source_id=? LIMIT 501").bind(source.projectId,source.id).all<{ id:string }>()).results;
    if (ids.length > 500) throw new AppError(429,"telemetry_plan_limit","A source exceeds the 500-asset history plan budget.");
    for (const { id } of ids) {
      const full = await loadRuntimeAssetPlan(env,source.projectId,id);
      plans.push({ asset:full.asset,bindings:full.bindings.filter((binding) => binding.dataSourceId === source.id),sources:[source] });
    }
    const after = await env.DB.prepare("SELECT runtime_revision AS revision FROM projects WHERE id=?").bind(source.projectId).first<{ revision:number }>();
    if (after?.revision !== revision) throw new AppError(409,"telemetry_configuration_changed","Configuration changed while loading history mappings.");
  }
  const metrics = plans.flatMap((plan) => plan.bindings.map((binding) => ({ ...plan,bindings:[binding] })));
  if (metrics.length > 10000 || plans.filter((plan) => plan.bindings.length).length > 500) throw new AppError(429,"telemetry_plan_limit","Source history plan budget exceeded.");
  return { revision,metrics };
}
export function normalizeTelemetry(plan:TelemetryPlan,source:DataSource,sampleId:string,sample:SourceSample|undefined,error:AppError|undefined,versionId?:string,observedAt=new Date().toISOString()):TelemetryRecord[] {
  return plan.metrics.map((metric) => {
    const binding = metric.bindings[0];
    const row:TelemetryRecord = { projectId:source.projectId,scopeId:versionId ?? "draft",configRevision:plan.revision,sampleId,assetId:metric.asset.assetId,assetRecordId:metric.asset.id,metricKey:binding.metricKey,sourceId:source.id,bindingId:binding.id,value:null,valueType:binding.valueType,unit:binding.unit,sourceTimestamp:null,collectedAt:error ? observedAt:sample?.collectedAt ?? observedAt,quality:"error",errorCode:null };
    try {
      if (error) throw error;
      if (!sample) throw new AppError(503,"data_source_pending","Waiting for first sample.");
      row.sourceTimestamp = inspectRuntimeSourceTimestamp(sample.payload,source,source.config).sourceTimestamp;
      if (Date.now()-Date.parse(row.sourceTimestamp ?? sample.collectedAt) > binding.staleAfterSeconds*1000) throw new AppError(502,"data_source_stale","Source sample is stale.");
      const snapshot = normalizeRuntimeAsset(metric,new Map([[source.id,sample]])); row.value = snapshot.metrics[0].value;
      if (typeof row.value === "string" && new TextEncoder().encode(row.value).byteLength > 4096) { row.value = null; throw new AppError(422,"telemetry_value_too_large","History scalar exceeds 4096 bytes."); }
      row.quality = row.value === null ? "missing":"good";
    } catch (reason) { row.errorCode = reason instanceof AppError ? reason.code:"telemetry_normalization_failed"; row.quality = row.errorCode === "data_source_stale" ? "stale":"error"; row.value = null; row.collectedAt = observedAt; }
    return row;
  });
}
