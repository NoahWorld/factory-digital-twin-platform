import { useCallback,useMemo,useSyncExternalStore } from "react";
import { useProjectRuntimeContext } from "../project-runtime";
import type { ComponentBinding } from "../../../../shared/component-bindings";
import { validateBindingCatalog } from "../../../../shared/component-bindings";
import { persistedQueryKey,type PersistedQuery,type PersistedQuerySnapshot } from "../persisted-query-store";
import { HistoryChart } from "./HistoryChart";
import { DashboardNode } from "./DashboardNode";
import type { AlarmListItem,CanvasNode } from "./types";

export function PersistedBoundNode({ node,binding,interactive }:{ node:CanvasNode;binding:ComponentBinding;interactive:boolean }) {
  const runtime = useProjectRuntimeContext()!,ids = binding.selection === "selected" ? runtime.selectedAssetId && binding.assetIds.includes(runtime.selectedAssetId) ? [runtime.selectedAssetId]:[]:binding.assetIds;
  const error = validateBindingCatalog(binding,runtime.metrics,new Set(runtime.assets.map((asset) => asset.assetId))),title = String(node.props.title ?? "历史与告警");
  const raw:PersistedQuery|null = error || !ids.length ? null:binding.target === "history" ? { kind:"history",assetId:ids[0],metricKey:binding.metrics[0].metricKey,options:binding.history! }:{ kind:"alarms",assetIds:ids,options:binding.alarm! };
  const key = raw ? persistedQueryKey(raw):"",query = useMemo(() => raw,[key]),store = runtime.queries;
  const fallback = useMemo<PersistedQuerySnapshot>(() => ({ status:"loading" }),[]);
  const subscribe = useCallback((listener:() => void) => query ? store.subscribe(query,listener):() => {},[store,query]);
  const getSnapshot = useCallback(() => query ? store.getSnapshot(query):fallback,[store,query,fallback]);
  const result = useSyncExternalStore(subscribe,getSnapshot);
  const message = (text:string,state="empty") => <div className={`bound-node-message is-${state}`} data-binding-state={state} role="status"><strong>{title}</strong><p>{text}</p>{query && state === "error" ? <button type="button" className="secondary-button" onClick={() => store.refresh(query)}>重新查询</button>:null}</div>;
  if (error) return message(error,"invalid");if (!ids.length) return message("请先选择一台适用设备。");
  if (result.status === "error") return message(result.error ?? "数据查询失败。","error");if (!result.data) return message("正在查询已保存的数据…","loading");
  const simulated = runtime.assets.some((asset) => ids.includes(asset.assetId) && asset.metadata.simulated === true),badge = <span className="bound-data-badge">{simulated ? "模拟 · ":""}{binding.target === "history" ? "历史数据":"服务端告警"}{result.status === "loading" ? " · 刷新中，显示上次记录":""}</span>;
  const diagnostics = result.data.value.diagnostics,errorNote = diagnostics.state === "degraded" ? <p className="bound-data-error">存储诊断：{diagnostics.errorCode ?? "存在记录缺口"}；累计丢弃{diagnostics.dropped}条。</p>:null;
  if (result.data.kind === "history") {
    const unit = runtime.metrics.find((metric) => metric.assetId === ids[0] && metric.metricKey === binding.metrics[0].metricKey)?.unit ?? null;
    return <div className="bound-node" data-binding-state="history">{badge}<HistoryChart node={node} series={result.data.value} unit={unit}/>{errorNote}</div>;
  }
  const data = result.data.value,active = binding.alarm!.mode === "active",rows = (active ? data.active:data.records).slice(0,binding.alarm!.limit),assetIds:string[] = [];
  const items:Array<AlarmListItem & { label:string }> = rows.map((row) => {
    assetIds.push(row.assetId);const episode = "occurredAt" in row ? row:null,event = "observedAt" in row ? row:null;
    const unknown = episode && episode.confirmation !== "known",recovered = event?.kind === "recovered";
    return { time:new Date(episode?.occurredAt ?? event!.observedAt).toLocaleTimeString("zh-CN"),source:runtime.assets.find((asset) => asset.assetId === row.assetId)?.name ?? row.assetId,message:`${unknown ? "[状态未知] ":event?.kind === "retired" ? "[配置变更结束] ":recovered ? "[已恢复] ":""}${row.message}`,label:recovered ? "已恢复":unknown ? "状态未知":event?.kind === "retired" ? "配置变更":row.severity === "critical" ? "严重":row.severity === "warning" ? "警告":"提示",tone:recovered ? "normal":unknown ? "warning":event?.kind === "retired" ? "offline":row.severity === "critical" ? "danger":row.severity === "warning" ? "warning":"normal" };
  });
  if (!items.length) return <div className="bound-node" data-binding-state={active && (!data.configured || data.ruleStates.some((state) => state.confirmation !== "known")) ? "unknown":"alarms"}>{badge}{message(result.status === "loading" ? "正在刷新，尚未确认当前告警状态。":!active ? "此范围没有告警事件。":!data.configured ? "等待运行器确认此版本的告警状态。":!data.ruleStates.length ? "此范围未配置启用的告警规则。":data.ruleStates.some((state) => state.confirmation !== "known") ? "此范围没有活动记录；部分规则尚无有效数据确认。":"当前没有活动告警。")}{errorNote}</div>;
  return <div className="bound-node" data-binding-state="alarms">{badge}<DashboardNode node={{ ...node,props:{ ...node.props,sample:false } }} alarmItems={items} rowAssetIds={assetIds} onAssetSelect={interactive ? runtime.selectAsset:undefined} selectedAssetId={runtime.selectedAssetId}/>{errorNote}</div>;
}
