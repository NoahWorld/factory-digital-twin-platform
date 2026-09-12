import { AppError } from "./errors";
import { requireIdentifier } from "./canvas-schema";
import type { ModelAsset } from "./model-assets";
import { modelObjectSourceKey, type ModelObject } from "./model-inspection";
import { validateScene, type SceneDefinition } from "./scene-definition";

export type ObjectReplacementMap = Record<string, string | null>;
export type ReplacementReference = { objectId: string; name: string; bindings: number; transform: boolean; appearance: boolean; suggestedId: string | null; match: "identity" | "source" | "name" | "unresolved" };
export type ReplacementPlan = { instanceId: string; oldAssetId: string; newAssetId: string; references: ReplacementReference[]; candidates: ModelObject[]; addedObjects: number; removedObjects: number };
const invalid = (message: string): never => { throw new AppError(400, "invalid_model_replacement", message); };

export function referencedInstanceObjects(scene: SceneDefinition, instanceId: string) {
  const instance = scene.instances.find((instance) => instance.id === instanceId);
  if (!instance) invalid("要替换的模型实例不存在。");
  return new Set([...Object.keys(instance!.objectTransforms), ...Object.keys(instance!.objectAppearances), ...scene.assetBindings.filter((binding) => binding.instanceId === instanceId).map((binding) => binding.objectId)]);
}
export function planModelReplacement(scene: SceneDefinition, instanceId: string, previous: ModelAsset, next: ModelAsset): ReplacementPlan {
  const instance = scene.instances.find((instance) => instance.id === instanceId);
  if (!instance || instance.modelAssetId !== previous.id || previous.projectId !== next.projectId) invalid("模型替换的来源或项目不匹配。");
  if (!previous.inspection.objects || !next.inspection.objects) invalid("请先补充两个模型的资源检查报告。");
  const old = previous.inspection.objects!, candidates = next.inspection.objects!.filter((object) => object.inDefaultScene === true);
  const choose = (object?: ModelObject): { suggestedId: string | null; match: ReplacementReference["match"] } => {
    if (!object) return { suggestedId: null, match: "unresolved" };
    if (candidates.some((candidate) => candidate.objectId === object.objectId)) return { suggestedId: object.objectId, match: "identity" };
    const sourceKey = modelObjectSourceKey(object);
    const source = sourceKey ? candidates.filter((candidate) => modelObjectSourceKey(candidate) === sourceKey) : [];
    if (source.length === 1) return { suggestedId: source[0].objectId, match: "source" };
    const names = object.name && !object.nameIsGenerated && old.filter((item) => item.name === object.name).length === 1 ? candidates.filter((candidate) => !candidate.nameIsGenerated && candidate.name === object.name) : [];
    return names.length === 1 ? { suggestedId: names[0].objectId, match: "name" } : { suggestedId: null, match: "unresolved" };
  };
  return { instanceId, oldAssetId: previous.id, newAssetId: next.id, candidates,
    references: [...referencedInstanceObjects(scene, instanceId)].map((objectId) => ({ objectId, name: old.find((object) => object.objectId === objectId)?.name || `已失效对象 ${objectId.slice(0,8)}`,
      bindings: scene.assetBindings.filter((binding) => binding.instanceId === instanceId && binding.objectId === objectId).length,
      transform: !!instance!.objectTransforms[objectId], appearance: !!instance!.objectAppearances[objectId], ...choose(old.find((object) => object.objectId === objectId)) })),
    addedObjects: candidates.filter((candidate) => !old.some((object) => object.objectId === candidate.objectId)).length,
    removedObjects: old.filter((object) => !candidates.some((candidate) => candidate.objectId === object.objectId)).length };
}

export function replaceInstanceResource(scene: SceneDefinition, instanceId: string, expectedAssetId: string, newAssetId: string, value: unknown): SceneDefinition {
  requireIdentifier(instanceId, "instanceId"); requireIdentifier(expectedAssetId, "expectedAssetId"); requireIdentifier(newAssetId, "newAssetId");
  const instance = scene.instances.find((instance) => instance.id === instanceId);
  if (!instance || instance.modelAssetId !== expectedAssetId) invalid("实例的模型版本已经改变，请重新打开替换预览。");
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("对象映射必须是对象。");
  const map = value as ObjectReplacementMap; const refs = referencedInstanceObjects(scene, instanceId);
  if (Object.keys(map).some((key) => !refs.has(key)) || [...refs].some((id) => !Object.prototype.hasOwnProperty.call(map, id))) invalid("每个受影响对象都必须明确映射或移除。");
  for (const target of Object.values(map)) if (target !== null) requireIdentifier(target, "replacement.objectId");
  const targetIds = Object.values(map).filter((id) => id !== null);
  if (new Set(targetIds).size !== targetIds.length) invalid("多个旧对象不能映射到同一个新对象；请明确移除多余映射。");
  const replacement = structuredClone(instance!); replacement.modelAssetId = newAssetId;
  const remap = <T>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).flatMap(([id, value]) => map[id] === null ? [] : [[map[id]!, value]]));
  replacement.objectTransforms = remap(replacement.objectTransforms); replacement.objectAppearances = remap(replacement.objectAppearances);
  return validateScene({ ...scene, instances: scene.instances.map((item) => item.id === instanceId ? replacement : item),
    assetBindings: scene.assetBindings.flatMap((binding) => binding.instanceId !== instanceId ? [binding] : map[binding.objectId] === null ? [] : [{ ...binding, objectId: map[binding.objectId]! }]) });
}

export function validateReplacementTargets(plan: ReplacementPlan, map: ObjectReplacementMap) {
  const ids = new Set(plan.candidates.map((object) => object.objectId));
  for (const value of Object.values(map)) if (value !== null && !ids.has(value)) invalid("新对象不在候选模型的默认场景中。");
}
