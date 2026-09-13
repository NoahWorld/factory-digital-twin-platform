import { AppError } from "./errors";
import { parseTelemetryQuery } from "./telemetry";
import type { AlarmRule } from "./alarm-rules";
import type { TelemetryRecord } from "./telemetry";
export type AlarmEvaluationRule = { rule:AlarmRule;signature:string;metrics:Array<{ metricKey:string;bindingId:string;sourceId:string;staleAfterSeconds:number }> };
export type AlarmEvaluationPlan = { projectId:string;scopeId:string;revision:number;rules:AlarmEvaluationRule[] };
export type AlarmEpisode = { id:string;ruleId:string;assetId:string;name:string;severity:AlarmRule["severity"];message:string;occurredAt:string;endedAt:string|null;endReason:"recovered"|"configuration_changed"|null;confirmation:"pending"|"known"|"unknown" };
export type AlarmQuery = { summary?:boolean;assetIds?:string[]; from:string;to:string;before:number|null;limit:number;state:"all"|"active"|"ended" };
export type AlarmRecord = { valuesOmitted?:boolean;id:number;episodeId:string;ruleId:string;assetId:string;severity:AlarmRule["severity"];message:string;kind:"triggered"|"recovered"|"retired";observedAt:string;values:Array<Pick<TelemetryRecord,"metricKey"|"value"|"unit"|"quality"|"sourceTimestamp">> };

export type AlarmRuleStatus = { assetId:string;ruleId:string;confirmation:"pending"|"known"|"unknown";activeEpisodeId:string|null };
export function parseAlarmQuery(params:URLSearchParams):AlarmQuery {
  if ([...params.keys()].some((key) => !["from","to","before","limit","state","assetId","summary"].includes(key))) throw new AppError(400,"invalid_alarm_query","告警查询包含不支持的参数。");
  const query = parseTelemetryQuery(params,"draft"),state = params.get("state") ?? "all";
  if (!["all","active","ended"].includes(state)) throw new AppError(400,"invalid_alarm_query","告警状态筛选无效。");
  const assetIds = [...new Set(params.getAll("assetId"))];if (assetIds.length>20 || assetIds.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id))) throw new AppError(400,"invalid_alarm_query","告警资产筛选无效或超过20台。");
  if (params.has("summary") && !["0","1"].includes(params.get("summary")!)) throw new AppError(400,"invalid_alarm_query","告警摘要参数无效。");
  return { summary:params.get("summary") === "1",assetIds,from:query.from,to:query.to,before:query.beforeId,limit:query.limit,state:state as AlarmQuery["state"] };
}

export type AlarmSnapshot = { configured:boolean;projectId:string;scopeId:string;active:AlarmEpisode[];activeTruncated:boolean;ruleStates:AlarmRuleStatus[];records:AlarmRecord[];nextCursor:number|null;retentionDays:number;maxEvents:number;diagnostics:import("./telemetry").TelemetryDiagnostic };
export function decodeAlarmSnapshot(input:unknown):AlarmSnapshot {
  const value = input as AlarmSnapshot,validDate = (value:unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (!value || typeof value !== "object" || typeof value.configured !== "boolean" || typeof value.projectId !== "string" || typeof value.scopeId !== "string" || !Array.isArray(value.active) || value.active.length>200 || typeof value.activeTruncated !== "boolean" || !Array.isArray(value.ruleStates) || value.ruleStates.length>200 || !Array.isArray(value.records) || value.records.length>200 || !(value.nextCursor === null || Number.isSafeInteger(value.nextCursor) && value.nextCursor>0)) throw new Error("告警响应结构无效。");
  for (const episode of value.active) if (!episode || typeof episode.id !== "string" || typeof episode.assetId !== "string" || typeof episode.ruleId !== "string" || typeof episode.name !== "string" || typeof episode.message !== "string" || !["info","warning","critical"].includes(episode.severity) || !["pending","known","unknown"].includes(episode.confirmation) || !validDate(episode.occurredAt) || episode.endedAt !== null || episode.endReason !== null) throw new Error("活动告警状态无效。");
  for (const state of value.ruleStates) if (!state || typeof state.ruleId !== "string" || typeof state.assetId !== "string" || !["pending","known","unknown"].includes(state.confirmation) || !(state.activeEpisodeId === null || typeof state.activeEpisodeId === "string")) throw new Error("告警规则状态无效。");
  for (const event of value.records) if (!event || !Number.isSafeInteger(event.id) || event.id<1 || typeof event.assetId !== "string" || typeof event.ruleId !== "string" || typeof event.episodeId !== "string" || typeof event.message !== "string" || !["info","warning","critical"].includes(event.severity) || !["triggered","recovered","retired"].includes(event.kind) || !validDate(event.observedAt)) throw new Error("告警事件记录无效。");
  const activeById = new Map(value.active.map((episode) => [episode.id,episode])),statesById = new Map(value.ruleStates.map((state) => [state.ruleId,state]));
  if (statesById.size !== value.ruleStates.length || value.activeTruncated && value.active.length !== 200) throw new Error("告警状态重复或截断标记不一致。");
  for (const episode of value.active) { const state = statesById.get(episode.ruleId);if (!state || state.activeEpisodeId !== episode.id || state.assetId !== episode.assetId || state.confirmation !== episode.confirmation) throw new Error("活动告警与规则状态不一致。"); }
  for (const state of value.ruleStates) if (state.activeEpisodeId !== null) { const episode = activeById.get(state.activeEpisodeId);if (!episode && !value.activeTruncated) throw new Error("告警响应遗漏了活动事件。");if (episode && (episode.ruleId !== state.ruleId || episode.assetId !== state.assetId)) throw new Error("活动事件被错误地归属到其他规则。"); }
  const scalar = (value:unknown) => value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
  for (const event of value.records) {
    if (!Array.isArray(event.values) || event.values.length>256 || (event.valuesOmitted !== undefined && typeof event.valuesOmitted !== "boolean") || event.valuesOmitted && event.values.length) throw new Error("告警采样值摘要无效。");
    for (const metric of event.values) if (!metric || typeof metric.metricKey !== "string" || !scalar(metric.value) || !(metric.unit === null || typeof metric.unit === "string") || !["good","missing","stale","error"].includes(metric.quality) || !(metric.sourceTimestamp === null || validDate(metric.sourceTimestamp))) throw new Error("告警采样值格式无效。");
  }
  if (new Set(value.active.map((episode) => episode.id)).size !== value.active.length || new Set(value.records.map((event) => event.id)).size !== value.records.length || !value.diagnostics || !["ready","degraded"].includes(value.diagnostics.state) || !Number.isSafeInteger(value.diagnostics.dropped) || value.diagnostics.dropped<0) throw new Error("告警记录重复或存储诊断无效。");
  return value;
}
