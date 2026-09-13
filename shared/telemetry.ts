import { AppError } from "./errors";
export type TelemetryQuality = "good" | "missing" | "stale" | "error";
export type TelemetryRecord = {
  projectId:string;scopeId:string;configRevision:number;sampleId:string;assetId:string;assetRecordId:string;
  metricKey:string;sourceId:string;bindingId:string;value:number|string|boolean|null;valueType:"number"|"string"|"boolean"|"timestamp";
  unit:string|null;sourceTimestamp:string|null;collectedAt:string;quality:TelemetryQuality;errorCode:string|null;
};
export type TelemetryRow = TelemetryRecord & { id:number };
export type TelemetryQuery = { scopeId:string;from:string;to:string;beforeId:number|null;limit:number;assetId:string|null;metricKey:string|null;configRevision:number|null };
export type TelemetryDiagnostic = { state:"ready"|"degraded";pending:number;dropped:number;lastPersistedAt:string|null;errorCode:string|null;retentionDays:number;maxRows:number };
export type TelemetryService = {
  configureAlarms?(plan:import("./alarms").AlarmEvaluationPlan):void;
  deactivateAlarms?(projectId:string,scopeId:string):void;
  queryAlarms?(projectId:string,scopeId:string,input:import("./alarms").AlarmQuery):{ retentionDays:number;maxEvents:number;ruleStates:import("./alarms").AlarmRuleStatus[];active:import("./alarms").AlarmEpisode[];activeTruncated:boolean;records:import("./alarms").AlarmRecord[];nextCursor:number|null };
  enqueue(records:TelemetryRecord[]):void;
  reportGap(projectId:string,code:string,count?:number):void;
  query(projectId:string,input:TelemetryQuery):{ records:TelemetryRow[];nextCursor:number|null };
  diagnostics(projectId:string):TelemetryDiagnostic;
  removeProject(projectId:string):void;
};
export function parseTelemetryQuery(params:URLSearchParams,scopeId:string):TelemetryQuery {
  const bad = () => new AppError(400,"invalid_history_query","Use an ordered time range of at most 31 days, a valid cursor and 1–200 rows.");
  const from = params.get("from") ?? new Date(Date.now()-3600000).toISOString(),to = params.get("to") ?? new Date().toISOString();
  const start = Date.parse(from),end = Date.parse(to),limit = Number(params.get("limit") ?? 100),beforeId = params.has("before") ? Number(params.get("before")) : null,configRevision = params.has("revision") ? Number(params.get("revision")) : null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end-start > 31*86400000 || !Number.isInteger(limit) || limit < 1 || limit > 200 || (beforeId !== null && (!Number.isSafeInteger(beforeId) || beforeId < 1)) || (configRevision !== null && (!Number.isSafeInteger(configRevision) || configRevision < 0))) throw bad();
  const assetId = params.get("assetId"),metricKey = params.get("metricKey");
  if ((assetId !== null && (!assetId || assetId.length > 100)) || (metricKey !== null && (!metricKey || metricKey.length > 80))) throw bad();
  return { scopeId,from:new Date(start).toISOString(),to:new Date(end).toISOString(),beforeId,limit,assetId,metricKey,configRevision };
}
