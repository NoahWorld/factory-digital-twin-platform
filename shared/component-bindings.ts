import { AppError } from "./errors";
/** Serializable configuration only. Runtime snapshots never enter this contract. */
export type MetricType = "number" | "string" | "boolean" | "timestamp";
export type ComponentBinding = {
  id: string;
  version: 1|2;
  target: "value" | "series" | "rows" | "history" | "alarms";
  history?:{ windowMinutes:number;points:number;aggregation:"avg"|"min"|"max"|"last" };
  alarm?:{ mode:"active"|"events";limit:number;windowMinutes:number };
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
  type === "metric-card" ? "value" : type === "bar-chart" ? "series" : type === "data-table" ? "rows" : type === "alarm-list" ? "alarms":type === "line-chart" || type === "area-chart" ? "history":null;

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
  knownFields(binding, ["id", "version", "target", "selection", "assetIds", "metrics",...(binding.version === 2 ? binding.target === "history" ? ["history"]:binding.target === "alarms" ? ["alarm"]:[]:[])], "binding");
  if (typeof binding.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(binding.id)) {
    throw new Error("binding.id 必须是 1–100 位字母、数字或连字符。");
  }
  if (binding.version !== 1 && binding.version !== 2) throw new Error("binding.version 仅支持版本1或2。");
  if (!(binding.version === 1 ? ["value","series","rows"]:["history","alarms"]).includes(String(binding.target))) throw new Error("绑定目标与版本不匹配。");
  if (binding.selection !== "fixed" && binding.selection !== "selected") {
    throw new Error("binding.selection 必须是 fixed 或 selected。");
  }
  if (binding.selection === "selected" && !["value","history","alarms"].includes(String(binding.target))) {
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
  if ((binding.target === "value" || binding.target === "history") && binding.selection === "fixed" && assetIds.length !== 1) {
    throw new Error("binding.assetIds：固定指标卡或历史曲线只能选择一台设备。");
  }
  if (binding.target === "series" && assetIds.length < 2) throw new Error("binding.assetIds：柱状图至少比较两台设备。");
  if (!Array.isArray(binding.metrics) || binding.metrics.length < (binding.target === "alarms" ? 0:1) || binding.metrics.length > (binding.target === "alarms" ? 0:6)) {
    throw new Error("binding.metrics：请选择 1–6 个指标。");
  }
  if (binding.target !== "rows" && binding.target !== "alarms" && binding.metrics.length !== 1) throw new Error("binding.metrics：指标卡和柱状图只选择一个指标。");
  const metrics = binding.metrics.map((item, index) => {
    const metric = object(item, `binding.metrics[${index}]`);
    knownFields(metric, ["metricKey", "valueType"], `binding.metrics[${index}]`);
    if (typeof metric.metricKey !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{0,79}$/.test(metric.metricKey)) {
      throw new Error(`binding.metrics[${index}].metricKey：指标键无效。`);
    }
    if (!["number", "string", "boolean", "timestamp"].includes(String(metric.valueType))) {
      throw new Error(`binding.metrics[${index}].valueType：指标类型无效。`);
    }
    if ((binding.target === "series" || binding.target === "history") && metric.valueType !== "number") {
      throw new Error(`binding.metrics[${index}].valueType：${binding.target === "series" ? "柱状图":"历史曲线"}需要数值指标。`);
    }
    return { metricKey: metric.metricKey, valueType: metric.valueType as MetricType };
  });
  if (new Set(metrics.map((metric) => metric.metricKey)).size !== metrics.length) throw new Error("binding.metrics：指标不能重复。");
  const integer = (value:unknown,min:number,max:number,label:string) => { if (!Number.isInteger(value) || (value as number)<min || (value as number)>max) throw new Error(`${label}必须是${min}–${max}的整数。`);return value as number; };
  const result:ComponentBinding = { id:binding.id,version:binding.version,target:binding.target as ComponentBinding["target"],selection:binding.selection,assetIds,metrics };
  if (binding.target === "history") {
    const value = object(binding.history,"binding.history");knownFields(value,["windowMinutes","points","aggregation"],"binding.history");
    if (!["avg","min","max","last"].includes(String(value.aggregation))) throw new Error("历史曲线聚合方式无效。");
    result.history = { windowMinutes:integer(value.windowMinutes,1,10080,"历史分钟数"),points:integer(value.points,20,200,"历史点数"),aggregation:value.aggregation as NonNullable<ComponentBinding["history"]>["aggregation"] };
  }
  if (binding.target === "alarms") {
    const value = object(binding.alarm,"binding.alarm");knownFields(value,["mode","limit","windowMinutes"],"binding.alarm");
    if (value.mode !== "active" && value.mode !== "events") throw new Error("告警展示方式无效。");
    result.alarm = { mode:value.mode,limit:integer(value.limit,1,20,"告警显示条数"),windowMinutes:integer(value.windowMinutes,1,10080,"告警查询分钟数") };
  }
  return result;
}

export function validateBindingCatalog(binding: ComponentBinding, catalog: MetricCatalogEntry[],assetIds?:Set<string>): string | null {
  for (const assetId of binding.assetIds) {
    if (assetIds && !assetIds.has(assetId)) return `${assetId} 不属于当前项目或已删除。`;
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

/** Lookup-free graph checks shared by loading, editing and persistence. */
export function validateLocalComponentReferences(
  nodes: Array<{ id: string; type: string; dataBindingRefs: string[] }>, definitions: ComponentBinding[],
): ComponentBinding[] {
  const bindings = new Map(definitions.map((binding) => [binding.id, binding]));
  const referenced = new Set<string>();
  for (const node of nodes) {
    if (node.dataBindingRefs.length > 1) throw new AppError(400, "invalid_component_binding_reference", `组件 ${node.id} 只支持一个数据绑定。`);
    for (const ref of node.dataBindingRefs) {
      const binding = bindings.get(ref);
      if (!binding) throw new AppError(400, "invalid_component_binding_reference", `组件 ${node.id} 的绑定 ${ref} 不属于本项目或已删除。`);
      if (binding.target !== bindingTargetForNode(node.type)) throw new AppError(400, "invalid_component_binding_target", `组件 ${node.id} (${node.type}) 不支持绑定目标 ${binding.target}。`);
      referenced.add(ref);
    }
  }
  return definitions.filter((binding) => referenced.has(binding.id));
}

export function validateComponentBindings(value: unknown): ComponentBinding[] {
  if (!Array.isArray(value) || value.length > 1000) throw new AppError(400, "invalid_component_bindings", "dataBindings 必须是最多 1000 项的数组。");
  try {
    const bindings = value.map(validateComponentBinding);
    if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length) throw new Error("dataBindings 中的 ID 不能重复。");
    return bindings;
  } catch (error) {
    throw new AppError(400, "invalid_component_binding", error instanceof Error ? error.message : String(error));
  }
}
