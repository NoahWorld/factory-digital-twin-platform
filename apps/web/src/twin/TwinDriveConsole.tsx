import { useState } from "react";
import type { TwinDriveCommand, TwinDriveDocument } from "../../../../shared/twin-drive";
import type { TwinDriveDiagnostics } from "../scene/twin-drive-runtime";
import { Select } from "../components/Select";
import { errorMessage } from "../api";
import { TwinPointStream, type TwinStreamState } from "./point-stream";
import "./twin-drive.css";

export function TwinDriveConsole({ document, loading, error, source, stream, diagnostics, onConfigure, onReload, onReconnect }: {
  document: TwinDriveDocument | null; loading: boolean; error: string | null;
  source: TwinPointStream; stream: TwinStreamState; diagnostics: TwinDriveDiagnostics | null;
  onConfigure?: () => void; onReload: () => void; onReconnect: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [pointId, setPointId] = useState("");
  const [target, setTarget] = useState("");
  const [procedureId, setProcedureId] = useState("");
  const [pending, setPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [ack, setAck] = useState<string | null>(null);
  const snapshot = stream.snapshot;
  const config = document?.config;
  const automatic = config?.simulation?.enabled === true;
  const selectedPoint = config?.points.find((item) => item.id === pointId);
  const value = target.trim() === "" ? NaN : Number(target);
  const valueValid = selectedPoint && Number.isFinite(value) && value >= selectedPoint.min && value <= selectedPoint.max;
  const stale = !!config && config.points.some((point) => {
    const sample = snapshot?.points[point.id];
    return !sample || sample.quality !== "good" || Date.now() - Date.parse(sample.timestamp) > point.staleAfterMs;
  });
  const send = async (operation: TwinDriveCommand["operation"]) => {
    if (!document) return;
    setPending(true); setCommandError(null); setAck(null);
    try {
      await source.command({ expectedRevision: document.revision, operation,
        ...(operation === "set" || operation === "move" ? { values: [{ pointId, value }] } : {}),
        ...(operation === "run-procedure" ? { procedureId } : {}),
      });
      setAck("命令已确认；实际运动与到位状态以点位反馈为准。");
    } catch (reason) { setCommandError(errorMessage(reason)); }
    finally { setPending(false); }
  };
  const connectedLabel = !config?.enabled ? "未启用" : stream.phase === "reconnecting" ? `🔴 正在重连 · 第 ${stream.retryCount} 次` : stream.phase === "error" ? `🔴 连接异常 · 重试 ${stream.retryCount} 次` : stream.connected ? stale ? "🟠 点位过期 / 不可用" : "🟢 实时连接" : "🟡 等待点位连接";
  return <aside className={`twin-drive-console${open ? " is-open" : ""}`} aria-label="已保存点位接入测试">
    <button className="twin-console-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}><strong>已保存点位接入测试</strong><span>{loading ? "正在加载配置…" : connectedLabel}</span><span aria-hidden="true">{open ? "▾" : "▸"}</span></button>
    {open ? <div className="twin-console-content">
      <div className="twin-row"><span className="twin-source-label">模拟点位 · WebSocket{document ? ` · v${document.revision}` : ""}</span>{onConfigure ? <button className="secondary-button compact-button" type="button" onClick={onConfigure} disabled={!document}>点位配置</button> : null}</div>
      {config?.description ? <details className="twin-config-description"><summary>配置说明 / 标定范围</summary><p>{config.description}</p></details> : null}
      {error ? <div className="twin-error" role="alert">{error}<button className="secondary-button compact-button" type="button" onClick={onReload}>重新加载配置</button></div> : null}
      {stream.error ? <div className="twin-error" role="alert">{stream.error}<button className="secondary-button compact-button" type="button" onClick={onReconnect}>重新连接</button></div> : null}
      {config?.enabled ? <>
        <div className={`twin-readonly${diagnostics?.status === "error" ? " twin-error" : ""}`} role="status">{diagnostics?.message ?? "等待场景节点与点位快照。"}{diagnostics ? <small>已绑定 {diagnostics.boundNodes} 个节点 · 序号 {diagnostics.sequence ?? "—"}</small> : null}</div>
        {automatic ? <p className="twin-readonly">后端独立产生点位数据。当前页面只订阅已保存的 topic，不发送启动、重置或运动命令。</p> : <fieldset className="twin-console-controls" disabled={pending || !stream.connected || !document?.editable}>
          <div className="twin-fields"><label><span>控制点位</span><Select value={pointId} onValueChange={(next) => { setPointId(next); setTarget(""); setAck(null); }}><option value="">选择点位</option>{config.points.map((point) => <option key={point.id} value={point.id}>{point.label}（{point.unit}）</option>)}</Select></label><label><span>目标值{selectedPoint ? `（${selectedPoint.min}～${selectedPoint.max}）` : ""}</span><input type="number" step="any" value={target} min={selectedPoint?.min} max={selectedPoint?.max} disabled={!selectedPoint || pending || !stream.connected || !document?.editable} onChange={(event) => setTarget(event.target.value)} /></label></div>
          <div className="twin-button-group"><button className="primary-button compact-button" disabled={!valueValid} type="button" onClick={() => void send("move")}>运动到目标</button><button className="secondary-button compact-button" disabled={!valueValid} type="button" onClick={() => void send("set")}>直接设置反馈值</button></div>
          <div className="twin-button-group"><button className="secondary-button compact-button" type="button" onClick={() => void send("pause")}>暂停模拟</button><button className="secondary-button compact-button" type="button" onClick={() => void send("resume")}>继续模拟</button><button className="secondary-button compact-button" type="button" onClick={() => void send("reset")}>重置点位</button></div>
          {config.procedures.length ? <><label><span>到位联动流程</span><Select value={procedureId} onValueChange={setProcedureId}><option value="">选择流程</option>{config.procedures.map((procedure) => <option value={procedure.id} key={procedure.id}>{procedure.label}</option>)}</Select></label><div className="twin-button-group"><button className="primary-button compact-button" type="button" disabled={!config.procedures.some((item) => item.id === procedureId)} onClick={() => void send("run-procedure")}>运行一次</button><button className="secondary-button compact-button" type="button" onClick={() => void send("stop-procedure")}>停止流程</button></div></> : null}
        </fieldset>}
        {pending ? <p className="twin-help" role="status">等待服务端确认命令…</p> : null}{ack ? <p className="twin-success" role="status">{ack}</p> : null}{commandError ? <p className="twin-error" role="alert">{commandError}</p> : null}
        {snapshot?.procedure ? <p className={snapshot.procedure.status === "error" ? "twin-error" : "twin-readonly"}>流程：{config.procedures.find((item) => item.id === snapshot.procedure?.id)?.label ?? snapshot.procedure.id} · 第 {snapshot.procedure.stepIndex + 1} 步 · {snapshot.procedure.status === "running" ? "执行中" : snapshot.procedure.status === "completed" ? "已完成" : "错误"}<br />{snapshot.procedure.message}</p> : null}
        <details open className="twin-point-values"><summary>实时点位 · {snapshot ? { idle: "空闲", running: "运动中", paused: "已暂停", error: "异常" }[snapshot.status] : "暂无快照"}</summary><div className="twin-table-scroll"><table><thead><tr><th>点位</th><th>反馈值</th><th>目标值</th><th>质量</th></tr></thead><tbody>{config.points.map((point) => {
          const sample = snapshot?.points[point.id];
          const quality = !sample ? "缺失" : !stream.connected ? "断线" : Date.now() - Date.parse(sample.timestamp) > point.staleAfterMs || sample.quality === "stale" ? "过期" : sample.quality === "error" ? "错误" : "正常";
          return <tr key={point.id}><th title={`${point.assetId}.${point.metricKey}`}>{point.label}<small>{point.topic ?? "旧版点位（未配置 topic）"}</small><small>{point.unit}</small></th><td>{sample ? sample.value.toFixed(3) : "—"}</td><td>{sample ? sample.target.toFixed(3) : "—"}</td><td className={quality === "正常" ? "twin-success" : "twin-error"}>{quality}</td></tr>;
        })}</tbody></table></div></details>
        <details className="twin-collision-log"><summary>碰撞事件 · 当前 {diagnostics?.activeCollisions.length ?? 0} 对</summary><p className="twin-help">浏览器 OBB 检测 · 保留最近 100 条，不用于设备安全控制。</p>{diagnostics?.events.length ? <ol>{[...diagnostics.events].reverse().map((event, index) => <li key={`${event.ruleId}-${event.sequence}-${event.phase}-${index}`}><strong>{event.phase === "enter" ? "进入" : "离开"} · {config.collisionRules.find((rule) => rule.id === event.ruleId)?.label ?? event.ruleId}</strong><small>{new Date(event.timestamp).toLocaleTimeString()} · 序号 {event.sequence} · {event.severity === "error" ? "错误" : "警告"}</small></li>)}</ol> : <p className="twin-help">尚无碰撞事件。</p>}</details>
      </> : document ? <p className="twin-empty">数据驱动未启用。配置点位与模型节点绑定后，显式启用并保存；不会自动启动流程。</p> : null}
    </div> : null}
  </aside>;
}
