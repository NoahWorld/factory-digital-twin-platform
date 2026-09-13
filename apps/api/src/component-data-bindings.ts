export { validateComponentBindings } from "../../../shared/component-bindings";
import { validateLocalComponentReferences, validateBindingCatalog, validateComponentBindings, type ComponentBinding, type MetricCatalogEntry } from "../../../shared/component-bindings";
import { AppError, type AppEnv } from "./auth";

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
  const active = validateLocalComponentReferences(nodes, definitions);
  if (active.length === 0) return [];
  const [catalog,assets] = await Promise.all([listMetricCatalog(env,projectId),env.DB.prepare("SELECT asset_key AS assetId FROM assets WHERE project_id=?").bind(projectId).all<{ assetId:string }>()]);
  const assetIds = new Set(assets.results.map((asset) => asset.assetId));
  for (const binding of active) {
    const error = validateBindingCatalog(binding,catalog,assetIds);
    if (error) throw new AppError(400, "invalid_component_binding_metric", `绑定 ${binding.id}：${error}`);
  }
  return active;
}
