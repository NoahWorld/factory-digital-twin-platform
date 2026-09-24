import { twinDriveErrors, type TwinDriveConfig, type TwinTarget } from "../../../../shared/twin-drive";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import type { TwinNodeCatalogEntry } from "../scene/twin-drive-runtime";

export type TwinRemapSource = {
  key: string; instanceId: string; modelAssetId: string; label: string;
  unavailable: boolean; bindingCount: number; colliderCount: number;
};
export type TwinRemapRow = { key: string; kind: "binding" | "collider"; label: string; target: TwinTarget };
export type TwinRemapNodes = Record<string, string>;
const sourceKey = (target: Pick<TwinTarget, "instanceId" | "modelAssetId">) => JSON.stringify([target.instanceId, target.modelAssetId]);

/** Include old resource references and removed instances so replacing a model never strands its configuration. */
export function twinRemapSources(config: TwinDriveConfig, scene: StandaloneSceneDocument): TwinRemapSource[] {
  const sources = new Map<string, TwinRemapSource>();
  for (const [kind, items] of [["binding", config.bindings], ["collider", config.colliders]] as const) {
    for (const item of items) {
      const key = sourceKey(item.target);
      let source = sources.get(key);
      if (!source) {
        const instance = scene.instances.find((entry) => entry.id === item.target.instanceId);
        const unavailable = !instance || instance.modelAssetId !== item.target.modelAssetId;
        source = {
          key, instanceId: item.target.instanceId, modelAssetId: item.target.modelAssetId,
          label: instance ? `${instance.label}${unavailable ? "（原模型资源已更换）" : ""}` : `已移除的模型 · ${item.target.instanceId || "未选择模型"}`,
          unavailable, bindingCount: 0, colliderCount: 0,
        };
        sources.set(key, source);
      }
      if (kind === "binding") source.bindingCount += 1;
      else source.colliderCount += 1;
    }
  }
  return [...sources.values()];
}

export function twinRemapRows(config: TwinDriveConfig, selectedSourceKey: string): TwinRemapRow[] {
  return [
    ...config.bindings.filter((item) => sourceKey(item.target) === selectedSourceKey).map((item) => ({ key: `binding:${item.id}`, kind: "binding" as const, label: item.label, target: item.target })),
    ...config.colliders.filter((item) => sourceKey(item.target) === selectedSourceKey).map((item) => ({ key: `collider:${item.id}`, kind: "collider" as const, label: item.label, target: item.target })),
  ];
}

export function twinRemapTargetNodes(scene: StandaloneSceneDocument, catalog: TwinNodeCatalogEntry[], targetInstanceId: string): { nodeName: string; unique: boolean; drivable: boolean }[] {
  const instance = scene.instances.find((item) => item.id === targetInstanceId);
  if (!instance) return [];
  const nodes = new Map<string, { nodeName: string; unique: boolean; drivable: boolean }>();
  for (const node of catalog) {
    if (node.instanceId !== instance.id || node.modelAssetId !== instance.modelAssetId) continue;
    const previous = nodes.get(node.nodeName);
    nodes.set(node.nodeName, { nodeName: node.nodeName, unique: !previous && node.unique && node.nodeName.length > 0, drivable: !previous && node.drivable });
  }
  return [...nodes.values()];
}

/** Suggestions are an editable draft, never an applied configuration. */
export function suggestTwinRemapNodes(rows: TwinRemapRow[], scene: StandaloneSceneDocument, catalog: TwinNodeCatalogEntry[], targetInstanceId: string): TwinRemapNodes {
  const nodes = new Map(twinRemapTargetNodes(scene, catalog, targetInstanceId).filter((node) => node.unique).map((node) => [node.nodeName, node]));
  return Object.fromEntries(rows.map((row) => {
    const node = nodes.get(row.target.nodeName);
    return [row.key, node && (row.kind === "collider" || node.drivable) ? row.target.nodeName : ""];
  }));
}

/** Build atomically: no partial updates, schema changes, dropped rows, or renamed point / motion / procedure IDs. */
export function prepareTwinBindingRemap(
  config: TwinDriveConfig, scene: StandaloneSceneDocument, catalog: TwinNodeCatalogEntry[],
  selectedSourceKey: string, targetInstanceId: string, nodeNames: TwinRemapNodes,
): { config: TwinDriveConfig | null; errors: string[]; mappedCount: number; totalCount: number } {
  const rows = twinRemapRows(config, selectedSourceKey);
  const errors: string[] = [];
  const instance = scene.instances.find((item) => item.id === targetInstanceId);
  if (!rows.length) errors.push("请选择有绑定配置的原模型。");
  if (!instance) errors.push("请选择场景中的新模型。");
  else if (sourceKey({ instanceId: instance.id, modelAssetId: instance.modelAssetId }) === selectedSourceKey) errors.push("新模型与原模型相同，请选择另一个模型。");
  const nodes = new Map(twinRemapTargetNodes(scene, catalog, targetInstanceId).map((node) => [node.nodeName, node]));
  let mappedCount = 0;
  for (const row of rows) {
    const name = nodeNames[row.key];
    const node = nodes.get(name);
    if (!name) errors.push(`${row.label}：请选择新模型中的部件。`);
    else if (!node) errors.push(`${row.label}：新模型中没有可用的“${name}”，请确认模型已加载。`);
    else if (!node.unique) errors.push(`${row.label}：部件“${name}”存在重名，无法绑定。`);
    else if (row.kind === "binding" && !node.drivable) errors.push(`${row.label}：部件“${name}”不能用于动作，模型根节点仅支持碰撞区域。`);
    else mappedCount += 1;
  }
  const report = { mappedCount, totalCount: rows.length };
  if (errors.length || !instance) return { ...report, config: null, errors };
  const target = (key: string): TwinTarget => ({ instanceId: instance.id, modelAssetId: instance.modelAssetId, nodeName: nodeNames[key] });
  const next: TwinDriveConfig = {
    ...config,
    bindings: config.bindings.map((item) => sourceKey(item.target) === selectedSourceKey ? { ...item, target: target(`binding:${item.id}`) } : item),
    colliders: config.colliders.map((item) => sourceKey(item.target) === selectedSourceKey ? { ...item, target: target(`collider:${item.id}`) } : item),
  };
  errors.push(...twinDriveErrors(next));
  const bindings = new Map(next.bindings.map((binding) => [binding.id, binding]));
  for (const binding of next.bindings) {
    if (!binding.parentBindingId) continue;
    const parent = bindings.get(binding.parentBindingId);
    if (parent && parent.target.instanceId === binding.target.instanceId && parent.target.modelAssetId !== binding.target.modelAssetId) {
      errors.push(`${binding.label}：上级动作与当前部件指向不同模型资源，请一并更换。`);
    }
  }
  return { ...report, config: errors.length ? null : next, errors: [...new Set(errors)] };
}
