import { useEffect,useRef,useState } from "react";
import { request,errorMessage } from "./api";
import { ConditionEditor,type ConditionCatalog } from "./canvas/InteractionEditor";
import { validateAlarmRules,validateAlarmCatalog,type AlarmRule } from "../../../shared/alarm-rules";
import type { AlarmEpisode,AlarmRecord,AlarmRuleStatus } from "../../../shared/alarms";
import type { TelemetryDiagnostic } from "../../../shared/telemetry";
import type { MetricCatalogEntry } from "../../../shared/component-bindings";
import type { ProjectAsset } from "./canvas/assets";
import type { InteractionCondition } from "../../../shared/interactions";

type Configuration = { rules:AlarmRule[];runtimeRevision:number };
type Records = { active:AlarmEpisode[];activeTruncated:boolean;ruleStates:AlarmRuleStatus[];records:AlarmRecord[];nextCursor:number|null;diagnostics:TelemetryDiagnostic;retentionDays:number;maxEvents:number };
const severityNames = { info:"提示",warning:"警告",critical:"严重" },confirmationNames = { pending:"待新样本确认",known:"当前数据有效",unknown:"数据不可用，状态未知" };
export function AlarmPanel({ projectId,versionId,editable,onClose }:{ projectId:string;versionId?:string;editable:boolean;onClose():void }) {
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}${versionId ? `/versions/${encodeURIComponent(versionId)}`:""}`;
  const [tab,setTab] = useState<"records"|"rules">("records"),[configuration,setConfiguration] = useState<Configuration|null>(null),[rules,setRules] = useState<AlarmRule[]>([]),[selected,setSelected] = useState("");
  const [assets,setAssets] = useState<ProjectAsset[]>([]),[metrics,setMetrics] = useState<MetricCatalogEntry[]>([]),[records,setRecords] = useState<Records|null>(null);
  const [error,setError] = useState<string|null>(null),[recordsError,setRecordsError] = useState<string|null>(null),[notice,setNotice] = useState<string|null>(null),[busy,setBusy] = useState(false);
  const [query,setQuery] = useState({ hours:24,state:"all",before:null as number|null,stamp:0,to:new Date().toISOString() });
  const lastRangeTo = useRef(query.to);
  const canEdit = editable && !versionId,rule = rules.find((rule) => rule.id === selected),dirty = !!configuration && JSON.stringify(configuration.rules) !== JSON.stringify(rules);
  const reloadConfiguration = async (signal?:AbortSignal) => { const [config,catalog] = await Promise.all([request<Configuration>(`${base}/alarm-rules`,{ signal }),request<{ assets:ProjectAsset[];metrics:MetricCatalogEntry[] }>(`${base}/runtime-catalog`,{ signal })]);if (!signal?.aborted) { setConfiguration(config);setRules(config.rules);setAssets(catalog.assets);setMetrics(catalog.metrics);setSelected((id) => config.rules.some((rule) => rule.id === id) ? id:config.rules[0]?.id ?? ""); } };
  useEffect(() => { const controller = new AbortController();void reloadConfiguration(controller.signal).catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); });return () => controller.abort(); },[base]);
  useEffect(() => {
    const controller = new AbortController();let fetching = false;
    const load = async () => { if (fetching) return;fetching = true;try { const to = query.before ? new Date(query.to):new Date(),params = new URLSearchParams({ from:new Date(to.getTime()-query.hours*3600000).toISOString(),to:to.toISOString(),state:query.state,limit:"50",summary:"1" });if (query.before) params.set("before",String(query.before));const result = await request<Records>(`${base}/alarms?${params}`,{ signal:controller.signal });if (!controller.signal.aborted) { lastRangeTo.current = to.toISOString();setRecords(result);setRecordsError(null); } } catch (reason) { if (!controller.signal.aborted) setRecordsError(errorMessage(reason)); } finally { fetching = false; } };
    void load();const timer = query.before || tab !== "records" ? undefined:setInterval(() => { void load(); },3000);
    return () => { controller.abort();clearInterval(timer); };
  },[base,query,tab]);
  const catalog:ConditionCatalog = { allowedValueKinds:["literal","metric"],states:[],assets:assets.filter((asset) => asset.assetId === rule?.assetId),metrics:metrics.filter((metric) => metric.assetId === rule?.assetId) };
  const update = (patch:Partial<AlarmRule>) => setRules((rules) => rules.map((item) => item.id === selected ? { ...item,...patch }:item));
  const defaultCondition = (assetId:string):InteractionCondition => ({ op:"gt",left:{ kind:"metric",assetId,metricKey:metrics.find((metric) => metric.assetId === assetId && metric.valueType === "number")?.metricKey ?? metrics.find((metric) => metric.assetId === assetId)?.metricKey ?? "" },right:{ kind:"literal",value:45 } });
  const add = () => { const assetId = assets.find((asset) => metrics.some((metric) => metric.assetId === asset.assetId))?.assetId ?? "",id = crypto.randomUUID();setRules([...rules,{ id,name:"新告警",assetId,enabled:true,severity:"warning",message:"设备指标超过告警条件",condition:defaultCondition(assetId),recoveryCondition:null }]);setSelected(id);setNotice(null); };
  const save = async () => {
    if (!configuration) return;setBusy(true);setError(null);setNotice(null);
    try { const checked = validateAlarmRules(rules);validateAlarmCatalog(checked,metrics,new Set(assets.map((asset) => asset.assetId)));const result = await request<Configuration>(`${base}/alarm-rules`,{ method:"PUT",body:JSON.stringify({ expectedRuntimeRevision:configuration.runtimeRevision,rules:checked }) });setConfiguration(result);setRules(result.rules);setNotice("告警规则已保存，服务端按新配置确认状态。");setQuery({ ...query,before:null,stamp:query.stamp+1 }); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <div className="data-source-panel-backdrop" role="dialog" aria-modal="true" aria-label="告警记录与规则">
    <section className="data-source-panel alarm-panel"><header className="data-source-panel-header"><div><span>ALARMS</span><h2>告警记录与规则</h2></div><button className="data-source-panel-close" aria-label="关闭告警" disabled={busy} onClick={onClose} type="button">×</button></header>
    <nav className="alarm-tabs" aria-label="告警视图"><button type="button" aria-pressed={tab === "records"} onClick={() => setTab("records")}>告警记录</button><button type="button" aria-pressed={tab === "rules"} onClick={() => setTab("rules")}>{canEdit ? "配置规则":"规则定义"}</button><span>{versionId ? "固定发布版本":"草稿"}{dirty ? " · 有未保存修改":""}</span></nav>
    {tab === "records" ? <div className="telemetry-content">
      {assets.some((asset) => asset.metadata.simulated === true) ? <p className="alarm-simulation-label">项目包含模拟设备，部分告警由模拟数据产生。</p>:null}
      <p>持续源无需打开页面即可触发告警。数据失联、陈旧或重启后尚未确认时，活动告警保留，等待有效样本；配置变更的结束记录单独标明。</p>
      {recordsError ? <p role="alert" className="form-error">{recordsError}；下方若有记录，是上次查询结果，当前状态尚未确认。</p>:null}
      {records ? <><p role="status">活动告警 {records.active.length}{records.activeTruncated ? "+":""} 条 · {records.ruleStates.filter((state) => state.confirmation !== "known").length} 条规则待确认{records.diagnostics.state === "degraded" ? ` · 记录存在缺口：${records.diagnostics.errorCode}`:""}</p>
      <h3>活动告警</h3>{records.active.length ? <div className="alarm-active-list">{records.active.map((episode) => <article key={episode.id} data-severity={episode.severity}><strong>{severityNames[episode.severity]} · {episode.name}</strong><p>{episode.assetId} · {episode.message}</p><small>{new Date(episode.occurredAt).toLocaleString("zh-CN")} · {recordsError ? "上次查询状态，待重新确认":confirmationNames[episode.confirmation]}</small></article>)}</div>:<p>当前没有活动告警。待确认的规则不代表设备已正常。</p>}
      <div className="telemetry-filters"><label>记录范围<select value={query.hours} onChange={(event) => setQuery({ ...query,hours:Number(event.target.value),before:null })}><option value={1}>最近一小时</option><option value={24}>最近一天</option><option value={720}>最近三十天</option></select></label><label>告警状态<select value={query.state} onChange={(event) => setQuery({ ...query,state:event.target.value,before:null })}><option value="all">全部</option><option value="active">仍在发生</option><option value="ended">已经结束</option></select></label><button className="secondary-button" onClick={() => setQuery({ ...query,before:null,stamp:query.stamp+1 })} type="button">刷新告警记录</button></div>
      <div className="telemetry-table"><table><thead><tr><th>时间</th><th>设备</th><th>事件</th><th>级别</th><th>消息</th></tr></thead><tbody>{records.records.map((event) => <tr key={event.id}><td>{new Date(event.observedAt).toLocaleString("zh-CN")}</td><td>{event.assetId}</td><td>{{ triggered:"发生",recovered:"恢复",retired:"配置变更结束" }[event.kind]}</td><td>{severityNames[event.severity]}</td><td>{event.message}</td></tr>)}</tbody></table></div>
      {!records.records.length ? <p>此范围没有告警事件记录。</p>:null}<p>事件最多保留 {records.retentionDays} 天、全宿主 {records.maxEvents.toLocaleString("zh-CN")} 条；尚未结束的活动告警另行保留。</p>
      <button className="secondary-button" type="button" disabled={!records.nextCursor} onClick={() => setQuery({ ...query,before:records.nextCursor,to:lastRangeTo.current })}>更早告警</button></>:!recordsError ? <p>正在读取告警…</p>:null}
    </div>:<div className="alarm-config-body interaction-editor-body"><aside><h3>告警规则</h3><button type="button" disabled={!canEdit || busy || !configuration || rules.length >= 200 || !metrics.length} onClick={add}>添加告警规则</button>{rules.map((item) => <button type="button" key={item.id} className={item.id === selected ? "is-active":""} onClick={() => setSelected(item.id)}>{item.name}{item.enabled ? "":" · 已停用"}</button>)}</aside><section>
      <p>规则在服务器执行。阈值、组合条件及恢复条件共用已校验的条件编辑器；仅使用所属设备指标和常量。</p>
      {error ? <p role="alert" className="form-error">{error}</p>:null}{notice ? <p role="status">{notice}</p>:null}
      {rule ? <fieldset className="interaction-rule-form" disabled={!canEdit || busy}>
        <label>规则名称<input aria-label="告警规则名称" value={rule.name} maxLength={100} onChange={(event) => update({ name:event.target.value })}/></label>
        <label>所属设备<select aria-label="告警所属设备" value={rule.assetId} onChange={(event) => { const assetId = event.target.value;update({ assetId,condition:defaultCondition(assetId),recoveryCondition:null }); }}><option value="">选择设备</option>{assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · {asset.assetId}</option>)}</select></label>
        <label>告警级别<select aria-label="告警级别" value={rule.severity} onChange={(event) => update({ severity:event.target.value as AlarmRule["severity"] })}>{Object.entries(severityNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>告警消息<input aria-label="告警消息" value={rule.message} maxLength={500} onChange={(event) => update({ message:event.target.value })}/></label><label><input type="checkbox" checked={rule.enabled} onChange={(event) => update({ enabled:event.target.checked })}/>启用此告警</label>
        <fieldset><legend>发生条件</legend><ConditionEditor condition={rule.condition} catalog={catalog} onChange={(condition) => update({ condition })}/></fieldset>
        <label><input type="checkbox" checked={!!rule.recoveryCondition} onChange={(event) => update({ recoveryCondition:event.target.checked ? { op:"lt",left:{ kind:"metric",assetId:rule.assetId,metricKey:metrics.find((metric) => metric.assetId === rule.assetId && metric.valueType === "number")?.metricKey ?? "" },right:{ kind:"literal",value:40 } }:null })}/>单独设置恢复条件</label>
        {rule.recoveryCondition ? <fieldset><legend>恢复条件</legend><ConditionEditor condition={rule.recoveryCondition} catalog={catalog} onChange={(recoveryCondition) => update({ recoveryCondition })}/></fieldset>:<p>未单独设置时，发生条件变为不满足且指标有效后恢复；未知数据不会触发恢复。</p>}
        <button type="button" className="secondary-button" onClick={() => { setRules(rules.filter((item) => item.id !== rule.id));setSelected(""); }}>删除所选告警</button>
      </fieldset>:<p>选择一条规则或添加告警规则。</p>}
      {canEdit ? <div className="publication-actions"><button className="primary-button" type="button" disabled={busy || !dirty} onClick={() => void save()}>保存告警规则</button><button className="secondary-button" type="button" disabled={busy} onClick={() => { setError(null);void reloadConfiguration().catch((reason) => setError(errorMessage(reason))); }}>重新载入规则</button></div>:null}
      <datalist id="interaction-metrics">{catalog.metrics.map((metric) => <option key={`${metric.assetId}/${metric.metricKey}`} value={metric.metricKey}/>)}</datalist>
    </section></div>}
    </section>
  </div>;
}
