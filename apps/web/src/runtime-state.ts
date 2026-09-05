import type { ProjectAsset } from "./canvas/assets";

export type RuntimeMetricValue = number | string | boolean;

export type AssetRuntimeState = {
  asset: Pick<ProjectAsset, "id" | "assetId" | "assetType" | "modelNode" | "name">;
  timestamp: string;
  values: Record<string, RuntimeMetricValue>;
  metrics: Array<{
    bindingId: string;
    metricKey: string;
    sourcePath: string;
    value: RuntimeMetricValue;
    valueType: "number" | "string" | "boolean" | "timestamp";
    unit: string | null;
    staleAfterSeconds: number;
  }>;
  sources: Array<{
    id: string;
    name: string;
    collectedAt: string;
    durationMs: number;
  }>;
  pollAfterSeconds: number;
  staleAfterSeconds: number;
};

export type AssetRuntimeStateResponse = {
  runtimeState: AssetRuntimeState;
  requestId: string;
};

export type RuntimeAssetConnection = {
  status: "loading" | "live" | "offline";
  snapshot?: AssetRuntimeState;
  errorCode?: string;
  errorMessage?: string;
  failedAt?: string;
  failureCount: number;
  lastSuccessAt?: string;
};

export type DeviceVisualStatus =
  | "running"
  | "stopped"
  | "warning"
  | "alarm"
  | "offline"
  | "loading"
  | "unknown";

const STATUS_ALIASES: Record<string, DeviceVisualStatus> = {
  alarm: "alarm",
  critical: "alarm",
  error: "alarm",
  fault: "alarm",
  idle: "stopped",
  normal: "running",
  off: "stopped",
  online: "running",
  on: "running",
  running: "running",
  stopped: "stopped",
  warn: "warning",
  warning: "warning",
};

export const assetRuntimeStatePath = (
  projectId: string,
  assetRecordId: string,
): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetRecordId)}/runtime-state`;

export const deviceVisualStatus = (
  connection: RuntimeAssetConnection | undefined,
): DeviceVisualStatus => {
  if (!connection || connection.status === "loading") return "loading";
  if (connection.status === "offline") return "offline";

  const alarmLevel = connection.snapshot?.values.alarmLevel;
  if (typeof alarmLevel === "number") {
    if (alarmLevel >= 2) return "alarm";
    if (alarmLevel >= 1) return "warning";
  }
  const status = connection.snapshot?.values.status;
  return typeof status === "string"
    ? STATUS_ALIASES[status.trim().toLowerCase()] ?? "unknown"
    : "unknown";
};

export const deviceVisualStatusLabel: Record<DeviceVisualStatus, string> = {
  alarm: "告警",
  loading: "连接中",
  offline: "失联",
  running: "运行",
  stopped: "停机",
  unknown: "状态未映射",
  warning: "预警",
};
