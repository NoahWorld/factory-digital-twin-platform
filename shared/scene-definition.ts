import { AppError } from "./errors";
import { validateSceneMotions, type SceneMotion } from "./scene-motion";
import { requireIdentifier, validateNode, type Model3DProps, type ModelNodeAppearance, type ModelNodeTransform } from "./canvas-schema";

export type SceneSettings = Omit<Model3DProps, "appearanceOverrides" | "transformOverrides">;
export type ModelInstance = {
  id: string; name: string; modelAssetId: string;
  transform: ModelNodeTransform; visible: boolean; appearance: ModelNodeAppearance | null;
  objectTransforms: Record<string, ModelNodeTransform>;
  objectAppearances: Record<string, ModelNodeAppearance>;
};
export type SceneAssetBinding = { id: string; assetId: string; instanceId: string; objectId: string };
export type SceneDefinition = { id: string; name: string; settings: SceneSettings; instances: ModelInstance[]; assetBindings: SceneAssetBinding[]; motions?: SceneMotion[] };

export const IDENTITY_TRANSFORM: ModelNodeTransform = { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] };
export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  backgroundColor: "#071521", backgroundOpacity: 1, environmentLightColor: "#b9e4ff", environmentLightIntensity: 2,
  keyLightColor: "#ffffff", keyLightIntensity: 2.4, cameraFov: 42, cameraView: "isometric", autoRotate: false, rotationSpeed: .35, showGrid: true,
};
const invalid = (message: string): never => { throw new AppError(400, "invalid_scene_definition", message); };
const object = (value: unknown, keys: string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid(`${label} 不是有效对象或包含未知字段。`);
  return value as Record<string, unknown>;
};
const name = (value: unknown) => { if (typeof value !== "string" || !value.trim() || value.trim().length > 100) invalid("名称必须为 1–100 个字符。"); return (value as string).trim(); };
const modelProps = (props: Record<string, unknown>) => validateNode({ id: "validation", type: "model-3d", x: 0, y: 0, width: 360, height: 240, zIndex: 0, props, resourceRefs: [], dataBindingRefs: [] }).props as Model3DProps;
export function validateSceneSettings(value: unknown): SceneSettings {
  const input = object(value, Object.keys(DEFAULT_SCENE_SETTINGS), "场景设置");
  const { transformOverrides: _, appearanceOverrides: __, ...settings } = modelProps({ ...DEFAULT_SCENE_SETTINGS, ...input });
  return settings;
}
export function validateInstance(value: unknown): ModelInstance {
  const input = object(value, ["id", "name", "modelAssetId", "transform", "visible", "appearance", "objectTransforms", "objectAppearances"], "模型实例");
  const transforms = input.objectTransforms ?? {}, appearances = input.objectAppearances ?? {};
  if (!transforms || typeof transforms !== "object" || Array.isArray(transforms) || !appearances || typeof appearances !== "object" || Array.isArray(appearances)) invalid("对象覆盖必须是对象。");
  Object.keys(transforms).forEach((id) => requireIdentifier(id, "objectId")); Object.keys(appearances).forEach((id) => requireIdentifier(id, "objectId"));
  for (const transform of [input.transform, ...Object.values(transforms)]) object(transform, ["position", "rotation", "scale"], "对象变换");
  for (const appearance of [...Object.values(appearances), ...(input.appearance == null ? [] : [input.appearance])]) object(appearance, ["color", "opacity", "visible"], "对象外观");
  const validated = modelProps({ ...DEFAULT_SCENE_SETTINGS, transformOverrides: transforms, appearanceOverrides: appearances });
  const instance = modelProps({ ...DEFAULT_SCENE_SETTINGS, transformOverrides: { target: input.transform }, appearanceOverrides: input.appearance == null ? {} : { target: input.appearance } });
  if (typeof input.visible !== "boolean") invalid("实例显隐必须是布尔值。");
  return { id: requireIdentifier(input.id, "instance.id"), name: name(input.name), modelAssetId: requireIdentifier(input.modelAssetId, "modelAssetId"),
    transform: instance.transformOverrides.target, visible: input.visible as boolean, appearance: instance.appearanceOverrides.target ?? null,
    objectTransforms: validated.transformOverrides, objectAppearances: validated.appearanceOverrides };
}
export function validateScene(value: unknown): SceneDefinition {
  const input = object(value, ["id", "name", "settings", "instances", "assetBindings", "motions"], "场景");
  if (!Array.isArray(input.instances) || input.instances.length > 1000) invalid("单场景最多包含 1000 个模型实例。");
  const instances = (input.instances as unknown[]).map(validateInstance);
  if (new Set(instances.map((instance) => instance.id)).size !== instances.length) invalid("模型实例 ID 重复。");
  if (!Array.isArray(input.assetBindings) || input.assetBindings.length > 5000) invalid("单场景最多包含 5000 条对象资产映射。");
  const assetBindings = (input.assetBindings as unknown[]).map((value) => {
    const binding = object(value, ["id", "assetId", "instanceId", "objectId"], "对象资产映射");
    const instanceId = requireIdentifier(binding.instanceId, "instanceId");
    if (!instances.some((instance) => instance.id === instanceId)) invalid("映射的模型实例不存在。");
    return { id: requireIdentifier(binding.id, "binding.id"), assetId: requireIdentifier(binding.assetId, "assetId"), instanceId, objectId: requireIdentifier(binding.objectId, "objectId") };
  });
  if (new Set(assetBindings.map((binding) => binding.id)).size !== assetBindings.length || new Set(assetBindings.map((binding) => JSON.stringify([binding.instanceId, binding.objectId]))).size !== assetBindings.length) invalid("映射 ID 或目标对象重复。");
  const motions = input.motions === undefined ? undefined : validateSceneMotions(input.motions);
  for (const motion of motions ?? []) for (const track of motion.tracks) if (track.type !== "camera" && !instances.some((instance) => instance.id === track.target.instanceId)) invalid(`动画「${motion.name}」引用的实例不存在。`);
  return { id: requireIdentifier(input.id, "scene.id"), name: name(input.name), settings: validateSceneSettings(input.settings), instances, assetBindings, ...(motions === undefined ? {} : { motions }) };
}
export function validateScenes(value: unknown): SceneDefinition[] {
  if (!Array.isArray(value) || value.length > 100) invalid("项目最多包含 100 个场景。");
  const scenes = (value as unknown[]).map(validateScene);
  if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length) invalid("场景 ID 重复。");
  const instances = scenes.flatMap((scene) => scene.instances);
  if (instances.length > 2000 || new Set(instances.map((instance) => instance.id)).size !== instances.length) invalid("项目最多包含 2000 个唯一模型实例。");
  const bindings = scenes.flatMap((scene) => scene.assetBindings);
  if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length) invalid("对象资产映射 ID 必须在项目内唯一。");
  return scenes;
}
