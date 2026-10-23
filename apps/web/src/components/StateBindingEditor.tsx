import { useEffect, useState } from "react";
import { parseStateBinding, type ProcessState, type StateBinding } from "../../../../shared/process-control";
import { Select } from "./Select";
import "../canvas/process-control.css";

const state = (label: string, value: number | string | boolean, flowing: boolean): ProcessState => ({ label, value, operator: "eq", color: flowing ? "#22c55e" : "#94a3b8", visible: true, flowing, direction: "forward", speed: 1 });
const initial = (): StateBinding => ({ pointKey: "", valueType: "number", staleAfterSeconds: 60, states: [state("停止", 0, false), state("运行", 1, true)] });

export function StateBindingEditor({ binding, disabled, flowControls = true, onChange, onValidationChange }: {
  binding?: StateBinding; disabled: boolean; flowControls?: boolean; onChange: (value: StateBinding | undefined) => void; onValidationChange: (error: string | null) => void;
}) {
  const [enabled, setEnabled] = useState(binding !== undefined);
  const [draft, setDraft] = useState(binding ?? initial);
  const signature = JSON.stringify(binding);
  useEffect(() => { setEnabled(binding !== undefined); setDraft(binding ?? initial()); }, [signature]);
  const validation = enabled ? parseStateBinding(draft) : null;
  const error = validation && !validation.ok ? validation.message : null;
  useEffect(() => { onValidationChange(error); return () => onValidationChange(null); }, [error, onValidationChange]);
  const update = (next: StateBinding) => { setDraft(next); const parsed = parseStateBinding(next); if (parsed.ok) onChange(parsed.value); };
  const updateState = (index: number, patch: Partial<ProcessState>) => update({ ...draft, states: draft.states.map((s, i) => i === index ? { ...s, ...patch } : s) });
  return <section className="inspector-section canvas-interaction-inspector process-inspector">
    <div className="inspector-section-title"><strong>状态联动</strong></div>
    <label className="inspector-check-row"><input type="checkbox" checked={enabled} disabled={disabled} onChange={e => { setEnabled(e.target.checked); if (e.target.checked) update(draft); else onChange(undefined); }} />由 IoT 点位驱动</label>
    {enabled ? <>
      <label className="iot-binding-field"><span>点位名称</span><input disabled={disabled} value={draft.pointKey} placeholder="pump.running" maxLength={200} onChange={e => update({ ...draft, pointKey: e.target.value })} /></label>
      <div className="process-field-pair">
        <label className="iot-binding-field"><span>数据类型</span><Select disabled={disabled} value={draft.valueType} onValueChange={v => { const valueType = v as StateBinding["valueType"]; update({ ...draft, valueType, states: valueType === "boolean" ? [state("停止", false, false), state("运行", true, true)] : valueType === "string" ? [state("停止", "stopped", false), state("运行", "running", true)] : initial().states }); }}><option value="number">数字</option><option value="boolean">布尔</option><option value="string">文本</option></Select></label>
        <label className="iot-binding-field"><span>过期秒数</span><input type="number" min={1} max={86400} disabled={disabled} value={Number.isNaN(draft.staleAfterSeconds) ? "" : draft.staleAfterSeconds} onChange={e => update({ ...draft, staleAfterSeconds: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>
      </div>
      <p className="inspector-help">按顺序匹配第一条规则。未匹配、断线或过期时{flowControls ? "停止流动并提示" : "显示数据不可用"}。类型切换会重置规则。</p>
      {draft.states.map((s, index) => <details className="process-rule" key={index} open={undefined}>
        <summary>{index + 1}. {s.label || "未命名状态"}<span style={{ background: s.color }} /></summary>
        <label className="iot-binding-field"><span>状态名称</span><input disabled={disabled} maxLength={80} value={s.label} onChange={e => updateState(index, { label: e.target.value })} /></label>
        <div className="process-field-pair">
          <label className="iot-binding-field"><span>条件</span><Select disabled={disabled || draft.valueType !== "number"} value={s.operator} onValueChange={v => updateState(index, { operator: v as ProcessState["operator"] })}><option value="eq">等于</option><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option></Select></label>
          <label className="iot-binding-field"><span>比较值</span>{draft.valueType === "boolean" ? <Select disabled={disabled} value={String(s.value)} onValueChange={v => updateState(index, { value: v === "true" })}><option value="false">false</option><option value="true">true</option></Select> : <input disabled={disabled} type={draft.valueType === "number" ? "number" : "text"} maxLength={1000} value={typeof s.value === "number" && Number.isNaN(s.value) ? "" : String(s.value)} onChange={e => updateState(index, { value: draft.valueType === "number" ? e.target.value === "" ? NaN : Number(e.target.value) : e.target.value })} />}</label>
        </div>
        <div className="process-field-pair"><label className="iot-binding-field"><span>状态色</span><input disabled={disabled} type="color" value={s.color} onChange={e => updateState(index, { color: e.target.value })} /></label>{flowControls ? <label className="iot-binding-field"><span>视觉速度</span><input type="number" min={0} max={30} step={0.1} disabled={disabled} value={Number.isNaN(s.speed) ? "" : s.speed} onChange={e => updateState(index, { speed: e.target.value === "" ? NaN : Number(e.target.value) })} /></label> : null}</div>
        {flowControls ? <label className="iot-binding-field"><span>流向</span><Select disabled={disabled} value={s.direction} onValueChange={v => updateState(index, { direction: v as ProcessState["direction"] })}><option value="forward">起点 → 终点</option><option value="reverse">终点 → 起点</option></Select></label> : null}
        <div className="process-field-pair">{flowControls ? <label className="inspector-check-row"><input disabled={disabled} type="checkbox" checked={s.flowing} onChange={e => updateState(index, { flowing: e.target.checked })} />流动</label> : null}<label className="inspector-check-row"><input disabled={disabled} type="checkbox" checked={s.visible} onChange={e => updateState(index, { visible: e.target.checked })} />显示</label></div>
        <button className="secondary-button compact-button" disabled={disabled || draft.states.length === 1} type="button" onClick={() => update({ ...draft, states: draft.states.filter((_, i) => i !== index) })}>删除规则</button>
      </details>)}
      <button className="secondary-button compact-button" disabled={disabled || draft.states.length >= 8} type="button" onClick={() => update({ ...draft, states: [...draft.states, state("新状态", draft.valueType === "boolean" ? true : draft.valueType === "string" ? "new" : draft.states.length, false)] })}>添加状态规则</button>
    </> : null}
    {error ? <p className="inspector-validation-error" role="alert">{error}</p> : null}
  </section>;
}
