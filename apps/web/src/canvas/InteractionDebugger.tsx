import { useState } from "react";
import type { InteractionRuntime, InteractionSnapshot } from "../../../../shared/interaction-runtime";
import type { InteractionDefinition } from "../../../../shared/interactions";

export function InteractionDebugger({ runtime, snapshot, config, onClose }: { runtime: InteractionRuntime | null; snapshot: InteractionSnapshot; config: InteractionDefinition; onClose: () => void }) {
  const [event, setEvent] = useState("");
  const names: Record<string, string> = { event: "事件", started: "开始", succeeded: "完成", skipped: "跳过", failed: "失败", cancelled: "取消", limited: "已限制" };
  return <aside className="interaction-debugger" aria-label="交互调试"><header><strong>交互调试 · 执行中 {snapshot.active}</strong><button type="button" onClick={() => runtime?.cancelAll()}>取消全部动作</button><button type="button" onClick={() => runtime?.clearTrace()}>清空记录</button><button type="button" onClick={onClose}>关闭调试</button></header>
    <div className="interaction-fields"><input aria-label="调试事件名称" placeholder="自定义事件名称" value={event} onChange={(e) => setEvent(e.target.value)} /><button type="button" disabled={!runtime || !event.trim()} onClick={() => runtime?.emit({ type: "custom", sourceId: event.trim() })}>发送事件</button><span>仅影响当前运行，不会保存到项目。</span></div>
    <dl>{config.states.map((state) => <div key={state.id}><dt>{state.name}</dt><dd>{Object.hasOwn(snapshot.states, state.id) ? JSON.stringify(snapshot.states[state.id]) : "页面未激活"}</dd></div>)}</dl>
    <ol>{snapshot.traces.slice().reverse().map((trace) => <li key={trace.id} className={`is-${trace.status}`}><span>{names[trace.status]} · 链 {trace.rootId}{trace.ruleId ? ` · ${config.rules.find((rule) => rule.id === trace.ruleId)?.name ?? trace.ruleId}` : ""}{trace.actionIndex === undefined ? "" : ` · 动作 ${trace.actionIndex + 1}`}</span><strong>{trace.message}</strong></li>)}</ol>
  </aside>;
}
