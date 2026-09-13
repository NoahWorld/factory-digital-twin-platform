import type { HistorySeriesQuery,HistoryPoint } from "../../../shared/history-series";
import { SqliteDatabase } from "./sqlite-database";

type Bucket = { bucket:number;count:number;invalid:number;revisions:number;units:number;unit:string|null;revision:number;average:number|null;minimum:number|null;maximum:number|null;last:number|null };
export function queryHistorySeries(db:SqliteDatabase,projectId:string,input:HistorySeriesQuery) {
  const from = Date.parse(input.from),to = Date.parse(input.to),bucketMs = Math.ceil((to-from)/input.points);
  const numeric = "quality='good' AND value_type='number' AND json_valid(value_json) AND json_type(value_json) IN ('integer','real')";
  const rows = db.statement(`WITH sample AS (
    SELECT *,CAST(((CAST(strftime('%s',collected_at) AS INTEGER)*1000+CAST(substr(strftime('%f',collected_at),4,3) AS INTEGER))-?)/? AS INTEGER) AS bucket,
      CASE WHEN ${numeric} THEN CAST(value_json AS REAL) ELSE NULL END AS numeric_value,
      CASE WHEN ${numeric} THEN 0 ELSE 1 END AS invalid_value
    FROM metric_history WHERE project_id=? AND scope_id=? AND asset_id=? AND metric_key=? AND collected_at>=? AND collected_at<?
  ), grouped AS (
    SELECT bucket,COUNT(*) AS count,SUM(invalid_value) AS invalid,COUNT(DISTINCT config_revision) AS revisions,
      COUNT(DISTINCT COALESCE(unit,char(0))) AS units,MAX(unit) AS unit,MAX(config_revision) AS revision,
      AVG(numeric_value) AS average,MIN(numeric_value) AS minimum,MAX(numeric_value) AS maximum,MAX(id) AS last_id
    FROM sample GROUP BY bucket
  ) SELECT grouped.*,CAST(last.value_json AS REAL) AS last FROM grouped JOIN metric_history last ON last.id=grouped.last_id ORDER BY bucket`).all(from,bucketMs,projectId,input.scopeId,input.assetId,input.metricKey,input.from,input.to) as Bucket[];
  const byBucket = new Map(rows.map((row) => [row.bucket,row]));
  const points:HistoryPoint[] = Array.from({ length:Math.ceil((to-from)/bucketMs) },(_,index) => {
    const row = byBucket.get(index),at = new Date(from+index*bucketMs).toISOString();
    if (!row) return { at,value:null,count:0,quality:"empty",unit:null,configRevision:null };
    const number = row[input.aggregation === "avg" ? "average":input.aggregation === "min" ? "minimum":input.aggregation === "max" ? "maximum":"last"];
    const quality = row.invalid || number === null || !Number.isFinite(number) ? "invalid":row.revisions !== 1 || row.units !== 1 ? "mixed":"good";
    return { at,value:quality === "good" ? number:null,count:row.count,quality,unit:row.units === 1 ? row.unit:null,configRevision:row.revisions === 1 ? row.revision:null };
  });
  return { projectId,scopeId:input.scopeId,assetId:input.assetId,metricKey:input.metricKey,from:input.from,to:input.to,aggregation:input.aggregation,bucketMs,points };
}
