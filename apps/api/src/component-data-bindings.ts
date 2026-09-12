import { bindingTargetForNode, validateBindingCatalog, validateComponentBinding, type ComponentBinding, type MetricCatalogEntry } from "../../../shared/component-bindings";
import { AppError, type AppEnv } from "./auth";

export function validateComponentBindings(value: unknown): ComponentBinding[] {
  if (!Array.isArray(value) || value.length > 100) throw new AppError(400, "invalid_component_bindings", "dataBindings 必须是最多 100 项的数组。");
  try {
    const bindings = value.map(validateComponentBinding);
    if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length) throw new Error("dataBindings 中的 ID 不能重复。");
    return bindings;
  } catch (error) {
    throw new AppError(400, "invalid_component_binding", error instanceof Error ? error.message : String(error));
  }
}

export async function listComponentBindings(env: AppEnv, projectId: string): Promise<ComponentBinding[]> {
  const rows = await env.DB.prepare("SELECT config_json FROM component_data_bindings WHERE project_id = ? ORDER BY id").bind(projectId).all<{ config_json: string }>();
  try {
    return validateComponentBindings(rows.results.map((row) => JSON.parse(row.config_json)));
  } catch (error) {
    throw new AppError(500, "invalid_component_binding_storage", `组件绑定存储无效：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function listMetricCatalog(env: AppEnv, projectId: string): Promise<MetricCatalogEntry[]> {
  const rows = await env.DB.prepare(`SELECT a.asset_key AS assetId, b.metric_key AS metricKey,
    b.value_type AS valueType, b.unit
    FROM assets a JOIN asset_data_bindings b ON b.asset_id = a.id
    JOIN data_sources s ON s.id = b.data_source_id AND s.project_id = a.project_id
    WHERE a.project_id = ? ORDER BY a.asset_key, b.metric_key`).bind(projectId).all<MetricCatalogEntry>();
  return rows.results;
}

export async function validateComponentReferences(
  env: AppEnv, projectId: string,
  nodes: Array<{ id: string; type: string; dataBindingRefs: string[] }>,
  definitions: ComponentBinding[],
): Promise<ComponentBinding[]> {
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
  const active = definitions.filter((binding) => referenced.has(binding.id));
  if (active.length === 0) return [];
  const catalog = await listMetricCatalog(env, projectId);
  for (const binding of active) {
    const error = validateBindingCatalog(binding, catalog);
    if (error) throw new AppError(400, "invalid_component_binding_metric", `绑定 ${binding.id}：${error}`);
  }
  return active;
}
