import type { TwinPoint, TwinPointSample } from "../../../../shared/twin-drive";

/** Read-only business feedback: never infer a phase from elapsed time or model motion. */
export function feedbackLabel(point: TwinPoint, sample: TwinPointSample | undefined, connected: boolean, now: number): string {
  if (!connected) return "连接中断";
  if (!sample) return "等待数据";
  if (sample.quality === "error") return "数据异常";
  if (sample.quality === "stale" || now - Date.parse(sample.timestamp) > point.staleAfterMs) return "数据过期";
  const label = point.valueLabels?.find(entry => entry.value === sample.value)?.label;
  return label ?? (point.valueLabels ? `未知状态（${sample.value}）` : `${sample.value.toFixed(3)}${point.unit ? ` ${point.unit}` : ""}`);
}
