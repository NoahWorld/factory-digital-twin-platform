import { AppError } from "./errors";
import { parseTelemetryQuery,type TelemetryDiagnostic } from "./telemetry";
export type HistoryAggregation = "avg"|"min"|"max"|"last";
export type HistorySeriesQuery = { scopeId:string;assetId:string;metricKey:string;from:string;to:string;points:number;aggregation:HistoryAggregation };
export type HistoryPoint = { at:string;value:number|null;count:number;quality:"good"|"empty"|"invalid"|"mixed";unit:string|null;configRevision:number|null };
export type HistorySeries = { projectId:string;scopeId:string; assetId:string;metricKey:string;from:string;to:string;aggregation:HistoryAggregation;bucketMs:number;points:HistoryPoint[];diagnostics:TelemetryDiagnostic };
export function parseHistorySeriesQuery(params:URLSearchParams,scopeId:string):HistorySeriesQuery {
  if ([...params.keys()].some((key) => !["assetId","metricKey","from","to","points","aggregation"].includes(key))) throw new AppError(400,"invalid_history_series_query","历史曲线查询包含未知参数。");
  const query = parseTelemetryQuery(params,scopeId),points = Number(params.get("points") ?? 120),aggregation = params.get("aggregation") ?? "avg";
  if (!query.assetId || !query.metricKey || !Number.isInteger(points) || points<20 || points>200 || !["avg","min","max","last"].includes(aggregation) || Date.parse(query.to)-Date.parse(query.from)<1000) throw new AppError(400,"invalid_history_series_query","请选择资产/指标、至少一秒时间范围和20–200个聚合点。");
  return { scopeId,assetId:query.assetId,metricKey:query.metricKey,from:query.from,to:query.to,points,aggregation:aggregation as HistoryAggregation };
}
export function decodeHistorySeries(input:unknown):HistorySeries {
  const value = input as HistorySeries;
  const date = (value:unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (!value || typeof value !== "object" || typeof value.projectId !== "string" || typeof value.scopeId !== "string" || typeof value.assetId !== "string" || typeof value.metricKey !== "string" || !date(value.from) || !date(value.to) || Date.parse(value.from)>=Date.parse(value.to) || !["avg","min","max","last"].includes(value.aggregation) || !Number.isFinite(value.bucketMs) || value.bucketMs<=0 || !Array.isArray(value.points) || value.points.length<1 || value.points.length>200) throw new Error("历史曲线响应格式无效。");
  let previous = -Infinity;
  for (const point of value.points) {
    if (!point || !date(point.at) || Date.parse(point.at)<=previous || Date.parse(point.at)<Date.parse(value.from) || Date.parse(point.at)>=Date.parse(value.to) || !(point.value === null || typeof point.value === "number" && Number.isFinite(point.value)) || !Number.isSafeInteger(point.count) || point.count<0 || !["good","empty","invalid","mixed"].includes(point.quality) || !(point.unit === null || typeof point.unit === "string") || !(point.configRevision === null || Number.isSafeInteger(point.configRevision) && point.configRevision>=0) || (point.quality === "good" && (point.value === null || !point.count || point.configRevision === null)) || (point.quality !== "good" && point.value !== null)) throw new Error("历史曲线包含无效的质量、时间或数值。");
    previous = Date.parse(point.at);
  }
  if (!value.diagnostics || !["ready","degraded"].includes(value.diagnostics.state) || !Number.isSafeInteger(value.diagnostics.dropped) || value.diagnostics.dropped<0) throw new Error("历史存储诊断无效。");
  return value;
}
