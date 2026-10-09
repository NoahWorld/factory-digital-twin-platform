import { useState } from "react";
import type { TwinDriveDocument } from "../../../../shared/twin-drive";
import type { TwinDriveDiagnostics } from "../scene/twin-drive-runtime";
import type { TwinPointStream, TwinStreamState } from "./point-stream";
import { feedbackLabel } from "./feedback-label";
import "./twin-drive.css";

export function TwinDriveConsole({ document, loading, error, stream, diagnostics, onConfigure, onReload, onReconnect }: {
  document: TwinDriveDocument | null; loading: boolean; error: string | null;
  source: TwinPointStream; stream: TwinStreamState; diagnostics: TwinDriveDiagnostics | null;
  onConfigure?: () => void; onReload: () => void; onReconnect: () => void;
}) {
  const [open, setOpen] = useState(true);
  const snapshot = stream.snapshot;
  const config = document?.config;
  const retired = config?.source === "simulator";
  const stale = !!config && config.points.some((point) => {
    const sample = snapshot?.points[point.id];
    return !sample || sample.quality !== "good" || Date.now() - Date.parse(sample.timestamp) > point.staleAfterMs;
  });
  const upstreamRetrying = config?.enabled && stream.connected && stream.phase === "error";
  const connectedLabel = retired ? "旧版配置已停用" : !config?.enabled ? "未启用" : stream.phase === "reconnecting" ? `🔴 网络异常／正在重连 · 第 ${stream.retryCount} 次` : upstreamRetrying ? `🔴 接口异常／正在重试 · 第 ${stream.retryCount} 次` : stream.phase === "error" ? `🔴 网关连接异常 · 重试 ${stream.retryCount} 次` : stream.connected ? stale ? "🟠 数据过期 / 不可用" : "🟢 实时连接" : "🟡 等待接口数据";
  const protocol = config?.connection?.protocol === "websocket" ? "WebSocket 订阅" : "REST 轮询";
  const testSource = config?.connection?.url.startsWith("/api/v1/test-business/");
  return <aside className={`twin-drive-console${open ? " is-open" : ""}`} aria-label="已保存接口检查">
    <button className="twin-console-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}><strong>已保存接口检查</strong><span>{loading ? "正在加载配置…" : connectedLabel}</span><span aria-hidden="true">{open ? "▾" : "▸"}</span></button>
    {open ? <div className="twin-console-content">
      <div className="twin-row"><span className="twin-source-label">{retired ? "旧版配置已停用" : `${testSource ? "测试业务接口 · " : ""}${protocol}`}</span>{onConfigure ? <button className="secondary-button compact-button" type="button" onClick={onConfigure} disabled={!document}>配置接口与动作</button> : null}</div>
      {config?.connection ? <p className="twin-help twin-source-url">{config.connection.url}</p> : null}
      {config?.description ? <details className="twin-config-description"><summary>配置说明</summary><p>{config.description}</p></details> : null}
      {error ? <div className="twin-error" role="alert">{error}<button className="secondary-button compact-button" type="button" onClick={onReload}>重新加载配置</button></div> : null}
      {stream.error ? <div className="twin-error" role="alert">{stream.error}{config?.enabled && !stream.connected && stream.phase === "error" ? <button className="secondary-button compact-button" type="button" onClick={onReconnect}>重新连接</button> : null}</div> : null}
      {retired ? <p className="twin-readonly">请在配置中选择“重新接入接口”，将模型动作绑定到业务接口返回的字段。</p> : config?.enabled ? <>
        <div className={`twin-readonly${diagnostics?.status === "error" ? " twin-error" : ""}`} role="status">{diagnostics?.message ?? "等待接口数据与模型部件。"}{diagnostics ? <small>已绑定 {diagnostics.boundNodes} 个部件 · 更新序号 {diagnostics.sequence ?? "—"}</small> : null}</div>
        <details open className="twin-point-values"><summary>实际接口数据 · {snapshot ? new Date(snapshot.timestamp).toLocaleTimeString() : "暂无数据"}</summary><div className="twin-table-scroll"><table><thead><tr><th>数据字段</th><th>当前值</th><th>状态</th></tr></thead><tbody>{config.points.map((point) => {
          const sample = snapshot?.points[point.id];
          const quality = !sample ? "缺失" : !stream.connected ? "断线" : Date.now() - Date.parse(sample.timestamp) > point.staleAfterMs || sample.quality === "stale" ? "过期" : sample.quality === "error" ? "错误" : "正常";
          return <tr key={point.id}><th>{point.label}<small>{point.sourcePath}</small><small>{point.unit}</small></th><td>{feedbackLabel(point, sample, stream.connected, Date.now())}</td><td className={quality === "正常" ? "twin-success" : "twin-error"}>{quality}</td></tr>;
        })}</tbody></table></div></details>
        <details className="twin-collision-log"><summary>碰撞事件 · 当前 {diagnostics?.activeCollisions.length ?? 0} 对</summary><p className="twin-help">模型碰撞检查，保留最近 100 条，不用于设备安全控制。</p>{diagnostics?.events.length ? <ol>{[...diagnostics.events].reverse().map((event, index) => <li key={`${event.ruleId}-${event.sequence}-${event.phase}-${index}`}><strong>{event.phase === "enter" ? "进入" : "离开"} · {config.collisionRules.find((rule) => rule.id === event.ruleId)?.label ?? event.ruleId}</strong><small>{new Date(event.timestamp).toLocaleTimeString()} · 序号 {event.sequence} · {event.severity === "error" ? "错误" : "警告"}</small></li>)}</ol> : <p className="twin-help">尚无碰撞事件。</p>}</details>
      </> : document ? <p className="twin-empty">完成接口与动作配置后，启用并保存即可运行。</p> : null}
    </div> : null}
  </aside>;
}
