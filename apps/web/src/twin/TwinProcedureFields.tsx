import { useState } from "react";
import {
  TWIN_DRIVE_LIMITS, type TwinDriveConfig, type TwinProcedure, type TwinProcedureStep, type TwinSetpoint,
} from "../../../../shared/twin-drive";
import { Select } from "../components/Select";

const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const numeric = (value: string) => value.trim() === "" ? NaN : Number(value);

function NumberField({ label, value, onChange, min, max, step = "any" }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number | "any";
}) {
  return <label><span>{label}</span><input type="number" step={step} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined}
    value={Number.isFinite(value) ? value : ""} onChange={(event) => onChange(numeric(event.target.value))} /></label>;
}

export function TwinProcedureFields({ config, onChange }: { config: TwinDriveConfig; onChange: (config: TwinDriveConfig) => void }) {
  const [selectedProcedureId, setSelectedProcedureId] = useState(config.procedures[0]?.id ?? "");
  const [selectedStepId, setSelectedStepId] = useState("");
  const procedure = config.procedures.find((item) => item.id === selectedProcedureId) ?? config.procedures[0];
  const step = procedure?.steps.find((item) => item.id === selectedStepId) ?? procedure?.steps[0];
  const stepIndex = step && procedure ? procedure.steps.indexOf(step) : -1;
  const simulation = config.simulation ?? { enabled: false, procedureId: "", repeat: false };
  const firstPoint = config.points[0];
  const unusedPoint = config.points.find((point) => !step?.targets.some((target) => target.pointId === point.id));
  const patchProcedure = (patch: Partial<TwinProcedure>) => onChange({ ...config, procedures: config.procedures.map((item) => item.id === procedure?.id ? { ...item, ...patch } : item) });
  const patchStep = (patch: Partial<TwinProcedureStep>) => {
    if (!procedure || !step) throw new Error("请先选择需要编辑的流程步骤。");
    patchProcedure({ steps: procedure.steps.map((item) => item.id === step.id ? { ...item, ...patch } : item) });
  };
  const patchTarget = (index: number, target: TwinSetpoint) => {
    if (!step) throw new Error("请先选择需要编辑的流程步骤。");
    patchStep({ targets: step.targets.map((item, itemIndex) => itemIndex === index ? target : item) });
  };
  const newStep = (number: number): TwinProcedureStep => {
    if (!firstPoint) throw new Error("添加流程步骤前需要先添加一个点位。");
    return { id: id("step"), label: `第 ${number} 步`, targets: [{ pointId: firstPoint.id, value: firstPoint.initialValue }], tolerance: 0.01, timeoutMs: 30000 };
  };
  const moveStep = (direction: -1 | 1) => {
    if (!procedure || !step || stepIndex + direction < 0 || stepIndex + direction >= procedure.steps.length) throw new Error("当前流程步骤无法继续移动。");
    const steps = [...procedure.steps];
    [steps[stepIndex], steps[stepIndex + direction]] = [steps[stepIndex + direction]!, step];
    patchProcedure({ steps });
    setSelectedStepId(step.id);
  };

  return <>
    <section className="twin-card">
      <h3>自动模拟数据</h3>
      <p className="twin-help">还没有现场数据时，可以让模型按配置的流程运行，用于演示和联调。</p>
      <label className="twin-check"><input type="checkbox" checked={simulation.enabled}
        onChange={(event) => onChange({ ...config, simulation: { ...simulation, enabled: event.target.checked } })} />保存后自动运行模拟流程</label>
      <div className="twin-fields">
        <label><span>运行哪个流程</span><Select value={simulation.procedureId} onValueChange={(procedureId) => onChange({ ...config, simulation: { ...simulation, procedureId } })}>
          <option value="">请选择流程</option>
          {simulation.procedureId && !config.procedures.some((item) => item.id === simulation.procedureId) ? <option value={simulation.procedureId}>已删除的流程（请重新选择）</option> : null}
          {config.procedures.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </Select></label>
        <label className="twin-check"><input type="checkbox" checked={simulation.repeat}
          onChange={(event) => onChange({ ...config, simulation: { ...simulation, repeat: event.target.checked } })} />完成后循环运行</label>
      </div>
      <p className="twin-help">关闭页面后模拟仍会继续。要停止，请取消自动运行并保存。模拟数据不会发送到真实设备。</p>
    </section>

    <section className="twin-card">
      <h3>编辑模拟流程</h3>
      <p className="twin-help">每一步选择需要变化的点位并填入目标值，所有点位到位后再进入下一步。</p>
      <div className="twin-row">
        <label><span>选择流程</span><Select value={procedure?.id ?? ""} disabled={!config.procedures.length} onValueChange={(value) => { setSelectedProcedureId(value); setSelectedStepId(""); }}>
          {!config.procedures.length && <option value="">尚未创建流程</option>}
          {config.procedures.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.steps.length} 步</option>)}
        </Select></label>
        <button type="button" className="secondary-button compact-button" disabled={!firstPoint || config.procedures.length >= TWIN_DRIVE_LIMITS.procedures} onClick={() => {
          const next = { id: id("procedure"), label: "新模拟流程", steps: [newStep(1)] };
          onChange({ ...config, procedures: [...config.procedures, next] }); setSelectedProcedureId(next.id); setSelectedStepId(next.steps[0]!.id);
        }}>＋ 新建流程</button>
      </div>
      {!firstPoint && <p className="twin-help">请先在“选择数据”中添加点位，再设置模拟流程。</p>}
      {config.procedures.length >= TWIN_DRIVE_LIMITS.procedures && <p className="twin-help">最多可创建 {TWIN_DRIVE_LIMITS.procedures} 个流程。</p>}

      {procedure && <>
        <label><span>流程名称</span><input value={procedure.label} maxLength={120} placeholder="例如：上料 → 搬运 → 回位" onChange={(event) => patchProcedure({ label: event.target.value })} /></label>
        <div className="twin-row">
          <label><span>当前步骤</span><Select value={step?.id ?? ""} disabled={!procedure.steps.length} onValueChange={setSelectedStepId}>
            {!procedure.steps.length && <option value="">请添加步骤</option>}
            {procedure.steps.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.label}</option>)}
          </Select></label>
          <button type="button" className="secondary-button compact-button" disabled={!firstPoint || procedure.steps.length >= TWIN_DRIVE_LIMITS.steps} onClick={() => {
            const next = newStep(procedure.steps.length + 1); patchProcedure({ steps: [...procedure.steps, next] }); setSelectedStepId(next.id);
          }}>＋ 添加步骤</button>
        </div>
        {procedure.steps.length >= TWIN_DRIVE_LIMITS.steps && <p className="twin-help">每个流程最多 {TWIN_DRIVE_LIMITS.steps} 步。</p>}

        {step && <section className="twin-card" key={step.id}>
          <div className="twin-row"><h4>第 {stepIndex + 1} 步 / 共 {procedure.steps.length} 步</h4>
            <div className="twin-row">
              <button type="button" className="secondary-button compact-button" disabled={stepIndex === 0} onClick={() => moveStep(-1)}>上移</button>
              <button type="button" className="secondary-button compact-button" disabled={stepIndex === procedure.steps.length - 1} onClick={() => moveStep(1)}>下移</button>
              <button type="button" className="secondary-button compact-button twin-danger" disabled={procedure.steps.length <= 1} title={procedure.steps.length <= 1 ? "每个流程至少保留一个步骤" : undefined} onClick={() => {
                patchProcedure({ steps: procedure.steps.filter((item) => item.id !== step.id) }); setSelectedStepId(procedure.steps[Math.max(0, stepIndex - 1)]?.id ?? "");
              }}>删除步骤</button>
            </div>
          </div>
          <label><span>步骤名称</span><input value={step.label} maxLength={120} placeholder="例如：升降台到达上料位置" onChange={(event) => patchStep({ label: event.target.value })} /></label>

          {step.targets.map((target, targetIndex) => {
            const point = config.points.find((item) => item.id === target.pointId);
            return <div className="twin-card" key={targetIndex}>
              <div className="twin-fields">
                <label><span>目标点位 {targetIndex + 1}</span><Select value={target.pointId} onValueChange={(pointId) => {
                  if (pointId === target.pointId) return;
                  const selected = config.points.find((item) => item.id === pointId);
                  if (!selected) throw new Error(`目标点位不存在：${pointId}`);
                  patchTarget(targetIndex, { pointId, value: selected.initialValue });
                }}>
                  {!point && <option value={target.pointId}>{target.pointId ? `点位已失效（${target.pointId}）` : "请选择点位"}</option>}
                  {config.points.map((item) => <option key={item.id} value={item.id} disabled={step.targets.some((existing, index) => index !== targetIndex && existing.pointId === item.id)}>{item.label}{item.unit ? `（${item.unit}）` : ""}</option>)}
                </Select></label>
                <NumberField label={`达到目标值${point?.unit ? `（${point.unit}）` : ""}`} value={target.value} min={point?.min} max={point?.max} onChange={(value) => patchTarget(targetIndex, { ...target, value })} />
              </div>
              <div className="twin-row"><span className="twin-help">{point ? `允许范围：${point.min} – ${point.max}${point.unit ? ` ${point.unit}` : ""}` : "请重新选择有效的点位。"}</span>
                <button type="button" className="secondary-button compact-button twin-danger" disabled={step.targets.length <= 1} title={step.targets.length <= 1 ? "每个步骤至少保留一个目标点位" : undefined}
                  onClick={() => patchStep({ targets: step.targets.filter((_, index) => index !== targetIndex) })}>移除目标</button>
              </div>
            </div>;
          })}
          <button type="button" className="secondary-button compact-button" disabled={!unusedPoint || step.targets.length >= TWIN_DRIVE_LIMITS.points} onClick={() => {
            if (!unusedPoint) throw new Error("此步骤已添加全部可用点位。");
            patchStep({ targets: [...step.targets, { pointId: unusedPoint.id, value: unusedPoint.initialValue }] });
          }}>＋ 同时控制另一个点位</button>
          <details className="twin-advanced"><summary>到位判断与超时</summary>
            <div className="twin-fields">
              <NumberField label="允许偏差（点位单位）" value={step.tolerance} min={0} onChange={(tolerance) => patchStep({ tolerance })} />
              <NumberField label="最长等待时间（秒）" value={step.timeoutMs / 1000} min={1} max={600} step={0.001} onChange={(seconds) => patchStep({ timeoutMs: Math.round(seconds * 1000) })} />
            </div>
            <p className="twin-help">所有目标点位都进入允许偏差后，才执行下一步。超过等待时间会停止并报告原因。</p>
          </details>
        </section>}
        <button type="button" className="secondary-button compact-button twin-danger" onClick={() => {
          onChange({ ...config, procedures: config.procedures.filter((item) => item.id !== procedure.id) }); setSelectedProcedureId(""); setSelectedStepId("");
        }}>删除这个流程</button>
      </>}
    </section>
  </>;
}
