import { AppError } from "./errors";
import { parseTelemetryQuery } from "./telemetry";
import type { AlarmRule } from "./alarm-rules";
import type { TelemetryRecord } from "./telemetry";
export type AlarmEvaluationRule = { rule:AlarmRule;signature:string;metrics:Array<{ metricKey:string;bindingId:string;sourceId:string;staleAfterSeconds:number }> };
export type AlarmEvaluationPlan = { projectId:string;scopeId:string;revision:number;rules:AlarmEvaluationRule[] };
export type AlarmEpisode = { id:string;ruleId:string;assetId:string;name:string;severity:AlarmRule["severity"];message:string;occurredAt:string;endedAt:string|null;endReason:"recovered"|"configuration_changed"|null;confirmation:"pending"|"known"|"unknown" };
export type AlarmQuery = { from:string;to:string;before:number|null;limit:number;state:"all"|"active"|"ended" };
export type AlarmRecord = { id:number;episodeId:string;ruleId:string;assetId:string;severity:AlarmRule["severity"];message:string;kind:"triggered"|"recovered"|"retired";observedAt:string;values:Array<Pick<TelemetryRecord,"metricKey"|"value"|"unit"|"quality"|"sourceTimestamp">> };

export type AlarmRuleStatus = { ruleId:string;confirmation:"pending"|"known"|"unknown";activeEpisodeId:string|null };
export function parseAlarmQuery(params:URLSearchParams):AlarmQuery {
  if ([...params.keys()].some((key) => !["from","to","before","limit","state"].includes(key))) throw new AppError(400,"invalid_alarm_query","告警查询包含不支持的参数。");
  const query = parseTelemetryQuery(params,"draft"),state = params.get("state") ?? "all";
  if (!["all","active","ended"].includes(state)) throw new AppError(400,"invalid_alarm_query","告警状态筛选无效。");
  return { from:query.from,to:query.to,before:query.beforeId,limit:query.limit,state:state as AlarmQuery["state"] };
}
