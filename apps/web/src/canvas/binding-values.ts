import { validateBindingCatalog, type ComponentBinding, type MetricCatalogEntry } from "../../../../shared/component-bindings";
import type { ProjectAsset } from "./assets";
import type { RuntimeAssetConnection, RuntimeMetricValue } from "../runtime-state";

export type BindingCell = { state: "live" | "loading" | "empty" | "null" | "type-error" | "stale" | "offline"; text: string; value?: RuntimeMetricValue; unit?: string };
export const bindingStateLabels: Record<BindingCell["state"], string> = {
  live: "实时", loading: "读取中", empty: "指标缺失", null: "空值", "type-error": "类型错误", stale: "数据陈旧", offline: "设备失联",
};
export const formatBindingValue = (value: RuntimeMetricValue) => value === null ? "空值" : typeof value === "boolean" ? value ? "是" : "否" : String(value);

export function readBindingCell(connection: RuntimeAssetConnection | undefined, metric: ComponentBinding["metrics"][number]): BindingCell {
  if (!connection || connection.status === "loading") return { state: "loading", text: "正在读取设备数据…" };
  if (connection.status === "offline") {
    const state = connection.errorCode === "data_source_stale" ? "stale"
      : connection.errorCode === "metric_type_mismatch" ? "type-error"
      : connection.errorCode === "source_path_not_found" || connection.errorCode === "asset_data_binding_required" ? "empty" : "offline";
    return { state, text: connection.errorMessage ?? bindingStateLabels[state] };
  }
  const snapshot = connection.snapshot;
  if (!snapshot || !Object.prototype.hasOwnProperty.call(snapshot.values, metric.metricKey)) {
    return { state: "empty", text: `未返回指标 ${metric.metricKey}。` };
  }
  const value = snapshot.values[metric.metricKey];
  if (value === null) return { state: "null", text: `${metric.metricKey} 当前为空值。` };
  const valid = metric.valueType === "number" ? typeof value === "number" && Number.isFinite(value)
    : metric.valueType === "timestamp" ? typeof value === "string" && Number.isFinite(Date.parse(value))
    : typeof value === metric.valueType;
  if (!valid) return { state: "type-error", text: `${metric.metricKey} 需要 ${metric.valueType}。` };
  return { state: "live", text: formatBindingValue(value), value, unit: snapshot.metrics.find((item) => item.metricKey === metric.metricKey)?.unit ?? "" };
}

export function resolveBinding(binding: ComponentBinding, assets: ProjectAsset[], catalog: MetricCatalogEntry[], connections: Record<string, RuntimeAssetConnection>, selectedAssetId: string | null) {
  const error = validateBindingCatalog(binding, catalog);
  if (error) return { error, rows: [] };
  const assetIds = binding.selection === "selected" ? selectedAssetId && binding.assetIds.includes(selectedAssetId) ? [selectedAssetId] : [] : binding.assetIds;
  if (assetIds.length === 0) return { error: "请从设备选择器或表格选择一台适用设备。", rows: [] };
  const rows = assetIds.map((assetId) => ({
    assetId,
    asset: assets.find((asset) => asset.assetId === assetId),
    cells: binding.metrics.map((metric) => readBindingCell(connections[assetId], metric)),
  }));
  if (rows.some((row) => !row.asset)) return { error: "绑定引用的设备已不存在，请重新配置。", rows: [] };
  return { error: null, rows };
}
