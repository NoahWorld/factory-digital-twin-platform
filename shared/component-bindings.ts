/** Serializable configuration only. Runtime snapshots never enter this contract. */
export type MetricType = "number" | "string" | "boolean" | "timestamp";
export type ComponentBinding = {
  id: string;
  version: 1;
  target: "value" | "series" | "rows";
  selection: "fixed" | "selected";
  assetIds: string[];
  metrics: Array<{ metricKey: string; valueType: MetricType }>;
};

export type MetricCatalogEntry = {
  assetId: string;
  metricKey: string;
  valueType: MetricType;
  unit: string | null;
};

export const bindingTargetForNode = (type: string): ComponentBinding["target"] | null =>
  type === "metric-card" ? "value" : type === "bar-chart" ? "series" : type === "data-table" ? "rows" : null;

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象。`);
  return value as Record<string, unknown>;
};

const knownFields = (value: Record<string, unknown>, fields: string[], path: string) => {
  const unknown = Object.keys(value).find((key) => !fields.includes(key));
  if (unknown) throw new Error(`${path}.${unknown} 是不支持的字段。`);
};

export function validateComponentBinding(value: unknown): ComponentBinding {
  const binding = object(value, "binding");
  knownFields(binding, ["id", "version", "target", "selection", "assetIds", "metrics"], "binding");
  if (typeof binding.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(binding.id)) {
    throw new Error("binding.id 必须是 1–100 位字母、数字或连字符。");
  }
  if (binding.version !== 1) throw new Error("binding.version 仅支持版本 1。");
  if (binding.target !== "value" && binding.target !== "series" && binding.target !== "rows") {
    throw new Error("binding.target 必须是 value、series 或 rows。");
  }
  if (binding.selection !== "fixed" && binding.selection !== "selected") {
    throw new Error("binding.selection 必须是 fixed 或 selected。");
  }
  if (binding.selection === "selected" && binding.target !== "value") {
    throw new Error("binding.selection：当前选中设备用于指标卡；图表和表格使用固定设备集合。");
  }
  if (!Array.isArray(binding.assetIds) || binding.assetIds.length < 1 || binding.assetIds.length > 20) {
    throw new Error("binding.assetIds：请选择 1–20 台设备。");
  }
  const assetIds = binding.assetIds.map((id, index) => {
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)) {
      throw new Error(`binding.assetIds[${index}]：设备编号无效。`);
    }
    return id;
  });
  if (new Set(assetIds).size !== assetIds.length) throw new Error("binding.assetIds：设备不能重复。");
  if (binding.target === "value" && binding.selection === "fixed" && assetIds.length !== 1) {
    throw new Error("binding.assetIds：固定设备指标卡只能选择一台设备。");
  }
  if (binding.target === "series" && assetIds.length < 2) throw new Error("binding.assetIds：柱状图至少比较两台设备。");
  if (!Array.isArray(binding.metrics) || binding.metrics.length < 1 || binding.metrics.length > 6) {
    throw new Error("binding.metrics：请选择 1–6 个指标。");
  }
  if (binding.target !== "rows" && binding.metrics.length !== 1) throw new Error("binding.metrics：指标卡和柱状图只选择一个指标。");
  const metrics = binding.metrics.map((item, index) => {
    const metric = object(item, `binding.metrics[${index}]`);
    knownFields(metric, ["metricKey", "valueType"], `binding.metrics[${index}]`);
    if (typeof metric.metricKey !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{0,79}$/.test(metric.metricKey)) {
      throw new Error(`binding.metrics[${index}].metricKey：指标键无效。`);
    }
    if (!["number", "string", "boolean", "timestamp"].includes(String(metric.valueType))) {
      throw new Error(`binding.metrics[${index}].valueType：指标类型无效。`);
    }
    if (binding.target === "series" && metric.valueType !== "number") {
      throw new Error(`binding.metrics[${index}].valueType：柱状图需要数值指标。`);
    }
    return { metricKey: metric.metricKey, valueType: metric.valueType as MetricType };
  });
  if (new Set(metrics.map((metric) => metric.metricKey)).size !== metrics.length) throw new Error("binding.metrics：指标不能重复。");
  return { id: binding.id, version: 1, target: binding.target, selection: binding.selection, assetIds, metrics };
}

export function validateBindingCatalog(binding: ComponentBinding, catalog: MetricCatalogEntry[]): string | null {
  for (const assetId of binding.assetIds) {
    for (const metric of binding.metrics) {
      const entry = catalog.find((item) => item.assetId === assetId && item.metricKey === metric.metricKey);
      if (!entry) return `${assetId} 未配置指标 ${metric.metricKey}，请在“资产与指标”中配置。`;
      if (entry.valueType !== metric.valueType) return `${assetId}.${metric.metricKey} 类型为 ${entry.valueType}，绑定要求 ${metric.valueType}。`;
    }
  }
  if (binding.target === "series") {
    const units = new Set(binding.assetIds.map((id) => catalog.find((entry) => entry.assetId === id && entry.metricKey === binding.metrics[0].metricKey)?.unit ?? ""));
    if (units.size > 1) return "柱状图的同一指标必须使用相同单位。";
  }
  return null;
}
