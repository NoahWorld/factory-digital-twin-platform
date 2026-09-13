import { useEffect, useState } from "react";
import { bindingTargetForNode, validateBindingCatalog, validateComponentBinding, type ComponentBinding } from "../../../../shared/component-bindings";
import { useProjectRuntimeContext } from "../project-runtime";
import { bindingStateLabels, resolveBinding } from "./binding-values";
import type { CanvasNode } from "./types";

const emptyBinding = (type:string):ComponentBinding => {
  const target = bindingTargetForNode(type) ?? "value";
  return { id:crypto.randomUUID(),version:target === "history" || target === "alarms" ? 2:1,target,selection:"fixed",assetIds:[],metrics:[],
    ...(target === "history" ? { history:{ windowMinutes:60,points:120,aggregation:"avg" as const } }:{}),
    ...(target === "alarms" ? { alarm:{ mode:"active" as const,limit:10,windowMinutes:1440 } }:{}) };
};

export function ComponentBindingInspector({ node, editable }: { node: CanvasNode; editable: boolean }) {
  const runtime = useProjectRuntimeContext();
  const persisted = runtime?.bindings.find((binding) => binding.id === node.dataBindingRefs[0]);
  const [draft, setDraft] = useState<ComponentBinding>(() => persisted ?? emptyBinding(node.type));
  const [configuring, setConfiguring] = useState(node.dataBindingRefs.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setDraft(persisted ?? emptyBinding(node.type));
    setConfiguring(node.dataBindingRefs.length > 0);
    setError(null);
    setNotice(null);
  }, [node.id, node.type, node.dataBindingRefs.length, persisted]);
  if (!runtime || !bindingTargetForNode(node.type)) return null;

  const options = runtime.metrics.filter((entry) => entry.assetId === draft.assetIds[0]
    && (!["series","history"].includes(draft.target) || entry.valueType === "number")
    && draft.assetIds.every((id) => runtime.metrics.some((candidate) => candidate.assetId === id && candidate.metricKey === entry.metricKey && candidate.valueType === entry.valueType)));
  const changeMetric = (metricKey: string, checked = true) => {
    const entry = options.find((option) => option.metricKey === metricKey);
    if (!entry) return;
    const metric = { metricKey, valueType: entry.valueType };
    setDraft({ ...draft, metrics: draft.target !== "rows" ? [metric]
      : checked ? [...draft.metrics.filter((item) => item.metricKey !== metricKey), metric] : draft.metrics.filter((item) => item.metricKey !== metricKey) });
    setError(null);
    setNotice(null);
  };
  const apply = () => {
    try {
      const binding = validateComponentBinding(draft);
      const invalid = validateBindingCatalog(binding,runtime.metrics,new Set(runtime.assets.map((asset) => asset.assetId)));
      if (invalid) throw new Error(invalid);
      runtime.changeBinding(node, binding);
      setError(null);
      setNotice("已应用到组件；点击“保存画布”持久保存。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const preview = persisted?.version === 1 ? resolveBinding(persisted, runtime.assets, runtime.metrics, runtime.connections, runtime.selectedAssetId) : null;
  return <section className="inspector-section component-binding-inspector" aria-label="组件数据绑定">
    <div className="inspector-section-title"><strong>数据绑定</strong><span>{{ value:"指标值",series:"设备对比序列",rows:"设备与指标行",history:"历史时间曲线",alarms:"服务端告警" }[draft.target]}</span></div>
    <label><span>数据模式</span><select disabled={!editable} value={configuring ? "binding" : "static"} onChange={(event) => {
      const enabled = event.target.value === "binding";
      setConfiguring(enabled);
      if (!enabled) runtime.changeBinding(node, null);
    }}><option value="static">静态演示</option><option value="binding">{draft.target === "history" ? "绑定历史数据":draft.target === "alarms" ? "绑定服务端告警":"绑定设备数据"}</option></select></label>
    {runtime.loading ? <p role="status">正在读取设备与指标…</p> : runtime.error ? <p className="binding-form-error" role="alert">{runtime.error}</p> : null}
    {configuring ? <>
      <p className="binding-help">{draft.target === "alarms" ? "按设备查询服务器告警，应用后保存画布；持续源无人查看时也执行。":draft.target === "history" ? "查询已保存的历史，时间桶中的无效、单位或配置变化会留空；保存画布会一起保存绑定。":"选择设备和指标，应用到组件后可预览；保存画布会一起保存绑定。"}</p>
      {["value","history","alarms"].includes(draft.target) ? <label><span>设备模式</span><select disabled={!editable} value={draft.selection} onChange={(event) => setDraft({ ...draft, selection: event.target.value as ComponentBinding["selection"], assetIds:event.target.value === "fixed" && draft.target !== "alarms" ? draft.assetIds.slice(0,1):draft.assetIds })}><option value="fixed">固定设备</option><option value="selected">当前选中设备</option></select></label> : null}
      <fieldset disabled={!editable} className="binding-choice-list"><legend>{draft.selection === "selected" ? "适用设备" : "绑定设备"}</legend>
        {runtime.assets.length === 0 ? <p>还没有设备。请先打开工具栏“资产与指标”添加设备并配置指标。</p> : runtime.assets.map((asset) => <label key={asset.assetId}>
          <input type="checkbox" checked={draft.assetIds.includes(asset.assetId)} onChange={(event) => {
            const assetIds = event.target.checked ? (draft.target === "value" || draft.target === "history") && draft.selection === "fixed" ? [asset.assetId] : [...draft.assetIds, asset.assetId] : draft.assetIds.filter((id) => id !== asset.assetId);
            setDraft({ ...draft, assetIds }); setNotice(null); setError(null);
          }} /><span>{asset.name}<small>{asset.assetId}{asset.metadata.simulated === true ? " · 模拟" : ""}</small></span>
        </label>)}
      </fieldset>
      {draft.target === "alarms" ? null:draft.target === "rows" ? <fieldset disabled={!editable} className="binding-choice-list"><legend>表格指标（最多 6 个）</legend>
        {options.map((entry) => <label key={entry.metricKey}><input type="checkbox" checked={draft.metrics.some((item) => item.metricKey === entry.metricKey)} onChange={(event) => changeMetric(entry.metricKey, event.target.checked)} /><span>{entry.metricKey}<small>{entry.valueType}{entry.unit ? ` · ${entry.unit}` : ""}</small></span></label>)}
      </fieldset> : <label><span>绑定指标</span><select disabled={!editable} value={draft.metrics[0]?.metricKey ?? ""} onChange={(event) => changeMetric(event.target.value)}>
        <option value="">选择指标</option>
        {draft.metrics[0] && !options.some((option) => option.metricKey === draft.metrics[0].metricKey) ? <option value={draft.metrics[0].metricKey}>{draft.metrics[0].metricKey}（不可用）</option> : null}
        {options.map((entry) => <option key={entry.metricKey} value={entry.metricKey}>{entry.metricKey} · {entry.valueType}{entry.unit ? ` · ${entry.unit}` : ""}</option>)}
      </select></label>}
      {draft.target !== "alarms" && draft.assetIds.length > 0 && options.length === 0 ? <p className="binding-help">所选设备还没有共同的适用指标；请在“资产与指标”配置同名、同类型的指标。</p> : null}
      {draft.metrics.length ? <p className="binding-help">类型：{draft.metrics.map((metric) => `${metric.metricKey} (${metric.valueType})`).join("、")}</p> : null}
      {draft.history ? <><label><span>历史范围（分钟）</span><input aria-label="历史范围（分钟）" type="number" min={1} max={10080} value={draft.history.windowMinutes} disabled={!editable} onChange={(event) => setDraft({ ...draft,history:{ ...draft.history!,windowMinutes:Number(event.target.value) } })}/></label><label><span>最大历史点数</span><input aria-label="最大历史点数" type="number" min={20} max={200} value={draft.history.points} disabled={!editable} onChange={(event) => setDraft({ ...draft,history:{ ...draft.history!,points:Number(event.target.value) } })}/></label><label><span>历史聚合</span><select aria-label="历史聚合" value={draft.history.aggregation} disabled={!editable} onChange={(event) => setDraft({ ...draft,history:{ ...draft.history!,aggregation:event.target.value as NonNullable<ComponentBinding["history"]>["aggregation"] } })}><option value="avg">时间桶均值</option><option value="min">时间桶最小值</option><option value="max">时间桶最大值</option><option value="last">时间桶最后值</option></select></label></>:null}
      {draft.alarm ? <><label><span>告警内容</span><select aria-label="告警内容" value={draft.alarm.mode} disabled={!editable} onChange={(event) => setDraft({ ...draft,alarm:{ ...draft.alarm!,mode:event.target.value as "active"|"events" } })}><option value="active">活动告警</option><option value="events">发生与恢复事件</option></select></label><label><span>告警显示条数</span><input aria-label="告警显示条数" type="number" min={1} max={20} value={draft.alarm.limit} disabled={!editable} onChange={(event) => setDraft({ ...draft,alarm:{ ...draft.alarm!,limit:Number(event.target.value) } })}/></label>{draft.alarm.mode === "events" ? <label><span>事件范围（分钟）</span><input aria-label="事件范围（分钟）" type="number" min={1} max={10080} value={draft.alarm.windowMinutes} disabled={!editable} onChange={(event) => setDraft({ ...draft,alarm:{ ...draft.alarm!,windowMinutes:Number(event.target.value) } })}/></label>:null}</>:null}
      {error ? <p className="binding-form-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <button className="secondary-button" disabled={!editable || runtime.loading || !!runtime.error} onClick={apply} type="button">应用到组件</button>
      {node.dataBindingRefs.length > 0 ? <button className="secondary-button" disabled={!editable} onClick={() => { runtime.changeBinding(node, null); setConfiguring(false); }} type="button">移除绑定，恢复静态演示</button> : null}
      {persisted?.selection === "selected" ? <label><span>预览选择的设备</span><select value={runtime.selectedAssetId ?? ""} onChange={(event) => runtime.selectAsset(event.target.value || null)}><option value="">请选择设备</option>{runtime.assets.filter((asset) => persisted.assetIds.includes(asset.assetId)).map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}</select></label> : null}
      {preview ? <div className="binding-result-preview" aria-label="已应用绑定预览"><strong>已应用绑定预览</strong>{preview.error ? <p>{preview.error}</p> : preview.rows.map((row) => <p key={row.assetId}>{row.asset?.name}：{row.cells.map((cell) => cell.state === "live" ? `${cell.text}${cell.unit ?? ""}` : bindingStateLabels[cell.state]).join(" / ")}</p>)}</div> : null}
    </> : <p className="binding-help">使用下方静态配置；不会因设备连接失败自动切回演示数字。</p>}
  </section>;
}
