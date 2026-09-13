import type { AssetRuntimeState } from "../apps/api/src/runtime-state";

export type CentralConnection = {
  status: "loading" | "live" | "offline";
  snapshot?: AssetRuntimeState;
  failureCount: number;
  errorCode?: string;
  errorMessage?: string;
  failedAt?: string;
  lastSuccessAt?: string;
};
export type RuntimeFrame = { epoch: string; sequence: number; connections: Record<string,CentralConnection> };
export type RuntimeSubscription = { snapshot(): RuntimeFrame; release(): void };
export type SourceDiagnostic = { id:string;name:string;mode:"demand" | "continuous";state:"collecting" | "sampled" | "failed";subscribers:number;collectedAt:string|null;errorCode:string|null };
export type CentralRuntime = {
  diagnostics?(projectId:string):{ epoch:string;sources:SourceDiagnostic[] };
  subscribe(projectId: string, assetRecordIds: string[], changed: (frame: RuntimeFrame) => void, versionId?:string): Promise<RuntimeSubscription>;
};

const object = (value:unknown): value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const scalar = (value:unknown) => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const timestamp = (value:unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const positive = (value:unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const optionalText = (value:unknown) => value === undefined || typeof value === "string";
function validSnapshot(value:unknown): boolean {
  if (!object(value) || !object(value.asset) || !object(value.values) || !Array.isArray(value.metrics) || !Array.isArray(value.sources) || !value.sources.length) return false;
  const asset = value.asset;
  if (![asset.id,asset.assetId,asset.assetType,asset.name].every((item) => typeof item === "string" && item.length > 0) || !(asset.modelNode === null || typeof asset.modelNode === "string")) return false;
  if (!timestamp(value.timestamp) || !positive(value.pollAfterSeconds) || !positive(value.staleAfterSeconds) || !Object.values(value.values).every(scalar)) return false;
  const values = value.values;
  return value.metrics.every((metric:unknown) => object(metric) && typeof metric.bindingId === "string" && typeof metric.metricKey === "string" && scalar(metric.value)
    && Object.hasOwn(values,metric.metricKey) && values[metric.metricKey] === metric.value
    && ["number","string","boolean","timestamp"].includes(String(metric.valueType))
    && (metric.unit === null || typeof metric.unit === "string") && positive(metric.staleAfterSeconds))
    && value.sources.every((source:unknown) => object(source) && typeof source.id === "string" && typeof source.name === "string" && timestamp(source.collectedAt)
      && (source.sourceTimestamp === null || timestamp(source.sourceTimestamp)) && typeof source.durationMs === "number" && Number.isFinite(source.durationMs) && source.durationMs >= 0 && positive(source.staleAfterSeconds));
}

/** A malformed transport response must never become an apparently live device. */
export function decodeRuntimeFrame(value:unknown): RuntimeFrame {
  if (!object(value) || typeof value.epoch !== "string" || !value.epoch || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 || !object(value.connections)) throw new Error("采集快照格式无效。");
  for (const connection of Object.values(value.connections)) {
    if (!object(connection) || !["loading","live","offline"].includes(String(connection.status)) || !Number.isSafeInteger(connection.failureCount) || (connection.failureCount as number) < 0
      || !optionalText(connection.errorCode) || !optionalText(connection.errorMessage)
      || (connection.failedAt !== undefined && !timestamp(connection.failedAt)) || (connection.lastSuccessAt !== undefined && !timestamp(connection.lastSuccessAt))
      || (connection.snapshot !== undefined && !validSnapshot(connection.snapshot)) || (connection.status === "live" && connection.snapshot === undefined)) throw new Error("设备采集状态无效。");
  }
  return value as RuntimeFrame;
}
