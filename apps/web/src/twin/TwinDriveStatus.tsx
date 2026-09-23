import type { TwinDriveDocument } from "../../../../shared/twin-drive";
import type { TwinDriveDiagnostics } from "../scene/twin-drive-runtime";
import type { TwinStreamState } from "./point-stream";
import "./twin-drive.css";

/** Delivery view: provenance and actual faults only; configuration and point tables belong to the editor. */
export function TwinDriveStatus({ document, error, stream, diagnostics, onReload, onReconnect }: {
  document: TwinDriveDocument | null; error: string | null; stream: TwinStreamState;
  diagnostics: TwinDriveDiagnostics | null; onReload: () => void; onReconnect: () => void;
}) {
  const enabled = document?.config.enabled === true;
  const reconnecting = enabled && stream.phase === "reconnecting";
  const runtimeIssue = enabled && diagnostics && !["disabled", "live", "paused"].includes(diagnostics.status) ? diagnostics.message : null;
  const message = error ? `点位配置加载失败：${error}` : enabled && stream.error ? stream.error : runtimeIssue;
  if (!enabled && !message) return null;
  return <>
    {enabled ? <span className="twin-simulation-badge">模拟数据 · WebSocket</span> : null}
    {message ? <div className="embedded-twin-status" role="status" aria-live="polite">
      <span>{message}{reconnecting ? ` · 第 ${stream.retryCount} 次` : ""}</span>
      {error ? <button className="secondary-button compact-button" type="button" onClick={onReload}>重试配置</button>
        : enabled && stream.phase === "error" ? <button className="secondary-button compact-button" type="button" onClick={onReconnect}>重新连接</button> : null}
    </div> : null}
  </>;
}
