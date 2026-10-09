import type { TwinDriveDocument } from "../../../../shared/twin-drive";
import type { TwinDriveDiagnostics } from "../scene/twin-drive-runtime";
import type { TwinStreamState } from "./point-stream";
import { feedbackLabel } from "./feedback-label";
import "./twin-drive.css";

/** Delivery view: provenance and actual faults only; configuration and point tables belong to the editor. */
export function TwinDriveStatus({ document, error, stream, diagnostics, onReload, onReconnect }: {
  document: TwinDriveDocument | null; error: string | null; stream: TwinStreamState;
  diagnostics: TwinDriveDiagnostics | null; onReload: () => void; onReconnect: () => void;
}) {
  const config = document?.config;
  const enabled = config?.enabled === true;
  const retired = config?.source === "simulator";
  const protocol = config?.connection?.protocol === "websocket" ? "WebSocket 订阅" : "REST 轮询";
  const sourceLabel = `${config?.connection?.url.startsWith("/api/v1/test-business/") ? "测试业务接口 · " : ""}${protocol}`;
  const reconnecting = enabled && stream.phase === "reconnecting";
  const upstreamRetrying = enabled && stream.connected && stream.phase === "error";
  const runtimeIssue = enabled && diagnostics && !["disabled", "live", "paused"].includes(diagnostics.status) ? diagnostics.message : null;
  const message = error ? `接口配置加载失败：${error}` : retired ? "旧版数据配置已停用，请重新接入接口。" : enabled && stream.error ? stream.error : runtimeIssue;
  if (!enabled && !message) return null;
  return <>
    {enabled && !retired && !message ? <div className="twin-source-badge">
      {config.points.filter(point => point.valueLabels).map(point => <div className="twin-feedback-readout" key={point.id}><span>{point.label}</span><strong>{feedbackLabel(point, stream.snapshot?.points[point.id], stream.connected, Date.now())}</strong></div>)}
      <span>{sourceLabel}</span>
    </div> : null}
    {message ? <div className="embedded-twin-status" role="status" aria-live="polite">
      <span>{message}{upstreamRetrying ? ` · 🔴 接口异常／正在重试 · 第 ${stream.retryCount} 次` : reconnecting ? ` · 🔴 网络异常／正在重连，第 ${stream.retryCount} 次` : ""}</span>
      {error ? <button className="secondary-button compact-button" type="button" onClick={onReload}>重试配置</button>
        : enabled && !stream.connected && stream.phase === "error" ? <button className="secondary-button compact-button" type="button" onClick={onReconnect}>重新连接</button> : null}
    </div> : null}
  </>;
}
