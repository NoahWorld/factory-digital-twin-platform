import type { CanvasNode } from "./types";

export function IotPointUnavailable({ node, message }: { node: CanvasNode; message: string }) {
  const title = typeof node.props.title === "string" ? node.props.title : node.iotBinding?.pointKey;
  const compact = node.type === "plain-text";
  return <div className={`iot-point-unavailable${compact ? " is-compact" : ""}`} role="status" title={`${title ?? "IoT 点位"}：${message}`} style={{ color: typeof node.props.textColor === "string" ? node.props.textColor : "var(--canvas-theme-text)", background: typeof node.props.fillColor === "string" ? node.props.fillColor : "transparent", borderColor: typeof node.props.borderColor === "string" ? node.props.borderColor : "var(--canvas-theme-border)" }}>
    {!compact && <strong>{title}</strong>}<span>{message}</span>
  </div>;
}
