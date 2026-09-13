import { useEffect,useState } from "react";
import { request,errorMessage } from "./api";
import type { TelemetryRow,TelemetryDiagnostic } from "../../../shared/telemetry";
type Result = { records:TelemetryRow[];nextCursor:number|null;diagnostics:TelemetryDiagnostic };
const quality = { good:"有效",missing:"缺值",stale:"陈旧",error:"失败" };
export function TelemetryPanel({ projectId,versionId,onClose }:{ projectId:string;versionId?:string;onClose():void }) {
  const [hours,setHours] = useState(1),[assetId,setAssetId] = useState(""),[metricKey,setMetricKey] = useState("");
  const [query,setQuery] = useState({ hours:1,assetId:"",metricKey:"",to:new Date().toISOString(),before:null as number|null });
  const [result,setResult] = useState<Result|null>(null),[error,setError] = useState<string|null>(null),[loading,setLoading] = useState(true);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}${versionId ? `/versions/${encodeURIComponent(versionId)}`:""}/telemetry`;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);setError(null);
    const params = new URLSearchParams({ from:new Date(Date.parse(query.to)-query.hours*3600000).toISOString(),to:query.to,limit:"100" });
    if (query.assetId) params.set("assetId",query.assetId); if (query.metricKey) params.set("metricKey",query.metricKey); if (query.before) params.set("before",String(query.before));
    void request<Result>(`${base}/history?${params}`,{ signal:controller.signal }).then((value) => { if (!controller.signal.aborted) setResult(value); }).catch((reason) => { if (!controller.signal.aborted) { setError(errorMessage(reason));setResult(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[base,query]);
  const refresh = () => setQuery({ hours,assetId:assetId.trim(),metricKey:metricKey.trim(),to:new Date().toISOString(),before:null });
  return <div className="data-source-panel-backdrop" role="dialog" aria-modal="true" aria-label="历史数据与诊断">
    <section className="data-source-panel telemetry-panel">
      <header className="data-source-panel-header"><div><p className="eyebrow">RUNTIME HISTORY</p><h2>历史数据与诊断</h2></div><button className="data-source-panel-close" type="button" aria-label="关闭历史数据" onClick={onClose}>×</button></header>
      <div className="telemetry-content">
        <p>{versionId ? "当前固定发布版本的采集历史":"草稿的采集历史，表内保留每次记录对应的配置修订"}。历史值不代表当前实时状态；持续源无需打开页面即可记录。</p>
        <div className="telemetry-filters"><label>时间范围<select value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={1}>最近一小时</option><option value={24}>最近一天</option><option value={168}>最近七天</option></select></label><label>资产编号<input value={assetId} maxLength={100} onChange={(event) => setAssetId(event.target.value)} placeholder="全部资产" /></label><label>指标<input value={metricKey} maxLength={80} onChange={(event) => setMetricKey(event.target.value)} placeholder="全部指标" /></label><button className="secondary-button" type="button" disabled={loading} onClick={refresh}>查询与刷新</button></div>
        {error ? <p className="form-error" role="alert">{error}</p>:null}
        {result ? <><p role="status">{result.diagnostics.state === "degraded" ? `历史记录存在缺口：${result.diagnostics.errorCode}；累计丢弃 ${result.diagnostics.dropped} 条。`:"历史存储可用。"} 待写 {result.diagnostics.pending} 条；最近写入 {result.diagnostics.lastPersistedAt ? new Date(result.diagnostics.lastPersistedAt).toLocaleString("zh-CN"):"尚无"}。最多保留 {result.diagnostics.retentionDays} 天、全宿主 {result.diagnostics.maxRows.toLocaleString("zh-CN")} 条。</p>
        <div className="telemetry-table"><table><thead><tr><th>采集时间</th><th>资产 / 指标</th><th>历史值</th><th>质量</th><th>源时间</th><th>配置修订</th></tr></thead><tbody>{result.records.map((row) => <tr key={row.id}><td>{new Date(row.collectedAt).toLocaleString("zh-CN")}</td><td>{row.assetId}<br/>{row.metricKey}</td><td>{row.value === null ? "—":String(row.value)} {row.unit ?? ""}</td><td>{quality[row.quality]}{row.errorCode ? <small>{row.errorCode}</small>:null}</td><td>{row.sourceTimestamp ? new Date(row.sourceTimestamp).toLocaleString("zh-CN"):"未提供"}</td><td>{row.configRevision}</td></tr>)}</tbody></table></div>
        {!result.records.length ? <p>此范围尚无已保存记录。按需源只在有人查看时采集，旧记录可能已超出保留范围。</p>:null}
        <div className="telemetry-filters"><button className="secondary-button" type="button" disabled={loading || !query.before} onClick={refresh}>返回最新</button><button className="secondary-button" type="button" disabled={loading || !result.nextCursor} onClick={() => setQuery({ ...query,before:result.nextCursor })}>更早记录</button><span>本页 {result.records.length} 条{loading ? " · 查询中…":""}</span></div></>:loading ? <p>正在查询历史…</p>:null}
      </div>
    </section>
  </div>;
}
