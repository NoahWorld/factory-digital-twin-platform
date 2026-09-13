import { ApiRequestError,request,errorMessage } from "./api";
import { decodeHistorySeries } from "../../../shared/history-series";
import { decodeAlarmSnapshot } from "../../../shared/alarms";
import { PersistedQueryStore,PersistedQueryError,type PersistedQueryData } from "./persisted-query-store";
export function createPersistedQueryStore(projectId:string,versionId?:string) {
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}${versionId ? `/versions/${encodeURIComponent(versionId)}`:""}`,scopeId = versionId ?? "draft";
  return new PersistedQueryStore(async (query,signal):Promise<PersistedQueryData> => {
    const to = new Date().toISOString(),from = new Date(Date.parse(to)-query.options.windowMinutes*60000).toISOString(),params = new URLSearchParams({ from,to });
    try {
      if (query.kind === "history") {
        params.set("assetId",query.assetId);params.set("metricKey",query.metricKey);params.set("points",String(query.options.points));params.set("aggregation",query.options.aggregation);
        const value = decodeHistorySeries(await request(`${base}/telemetry/series?${params}`,{ signal }));
        if (value.projectId !== projectId || value.scopeId !== scopeId || value.assetId !== query.assetId || value.metricKey !== query.metricKey) throw new Error("历史曲线响应与查询对象不符。");
        return { kind:query.kind,value };
      }
      params.set("summary","1");params.set("limit",String(query.options.limit));params.set("state",query.options.mode === "active" ? "active":"all");for (const id of query.assetIds) params.append("assetId",id);
      const value = decodeAlarmSnapshot(await request(`${base}/alarms?${params}`,{ signal }));
      if (value.projectId !== projectId || value.scopeId !== scopeId || [...value.active,...value.records,...value.ruleStates].some((item) => !query.assetIds.includes(item.assetId))) throw new Error("告警响应超出组件绑定的设备范围。");
      return { kind:query.kind,value };
    } catch (reason) { throw new PersistedQueryError(errorMessage(reason),reason instanceof ApiRequestError && [401,403,404].includes(reason.status)); }
  });
}
