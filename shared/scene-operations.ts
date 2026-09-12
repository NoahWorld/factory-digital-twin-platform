import { AppError } from "./errors";
import { requireIdentifier } from "./canvas-schema";
import { validateScene, validateInstance, validateSceneSettings, type SceneDefinition, type SceneSettings, type ModelInstance } from "./scene-definition";
import type { ProjectDefinition } from "./project-definition";
import { replaceInstanceResource, type ObjectReplacementMap } from "./model-replacement";
import { validateSceneMotions, type SceneMotion } from "./scene-motion";

export type SceneOperation =
  | { type: "scene.create" | "scene.update"; scene: SceneDefinition }
  | { type: "scene.extract"; scene: SceneDefinition; nodeId: string; pageId?: string }
  | { type: "scene.attach"; sceneId: string; nodeId: string; pageId?: string }
  | { type: "scene.detach"; nodeId: string; pageId?: string }
  | { type: "scene.duplicate"; sceneId: string; nodeId?: string; pageId?: string }
  | { type: "scene.delete"; sceneId: string; detachReferences?: boolean }
  | { type: "scene.settings"; sceneId: string; settings: SceneSettings }
  | { type: "scene.motions"; sceneId: string; motions: SceneMotion[] }
  | { type: "instance.upsert"; sceneId: string; instance: ModelInstance }
  | { type: "instance.replace-resource"; sceneId: string; instanceId: string; expectedAssetId: string; newAssetId: string; objectMap: ObjectReplacementMap }
  | { type: "instance.delete" | "instance.duplicate"; sceneId: string; instanceId: string };

const invalid = (message: string): never => { throw new AppError(400, "invalid_scene_operation", message); };
const fields: Record<SceneOperation["type"], string[]> = {
  "scene.create": ["type", "scene"], "scene.update": ["type", "scene"], "scene.extract": ["type", "scene", "nodeId", "pageId"],
  "scene.attach": ["type", "sceneId", "nodeId", "pageId"], "scene.detach": ["type", "nodeId", "pageId"],
  "scene.duplicate": ["type", "sceneId", "nodeId", "pageId"], "scene.delete": ["type", "sceneId", "detachReferences"],
  "scene.settings": ["type", "sceneId", "settings"], "instance.upsert": ["type", "sceneId", "instance"],
  "scene.motions": ["type", "sceneId", "motions"],
  "instance.replace-resource": ["type", "sceneId", "instanceId", "expectedAssetId", "newAssetId", "objectMap"],
  "instance.delete": ["type", "sceneId", "instanceId"], "instance.duplicate": ["type", "sceneId", "instanceId"],
};

/** Mutates only the already-cloned working project; caller validates the final graph. */
export function applySceneOperation(project: ProjectDefinition, operation: Record<string, unknown>, activePageId: string) {
  const type = operation.type as SceneOperation["type"];
  if (!Array.isArray(fields[type]) || Object.keys(operation).some((key) => !fields[type].includes(key))) invalid("场景操作类型或字段不支持。");
  const sceneFor = () => {
    const id = requireIdentifier(operation.sceneId, "sceneId");
    const scene = project.scenes.find((scene) => scene.id === id);
    if (!scene) invalid("场景不存在。"); return scene!;
  };
  const nodeFor = () => {
    const nodeId = requireIdentifier(operation.nodeId, "nodeId");
    const pageId = requireIdentifier(operation.pageId ?? activePageId, "pageId");
    const node = project.pages.find((page) => page.id === pageId)?.nodes.find((node) => node.id === nodeId);
    if (!node || node.type !== "model-3d") invalid("目标必须是当前页的 3D 视窗。"); return node!;
  };
  switch (type) {
    case "scene.create": case "scene.extract": {
      const scene = validateScene(operation.scene);
      if (project.scenes.some((item) => item.id === scene.id)) invalid("场景 ID 已存在。");
      if (type === "scene.extract") { const node = nodeFor(); node.sceneId = scene.id; node.resourceRefs = []; node.props = { ...node.props, transformOverrides: {}, appearanceOverrides: {} }; }
      project.scenes.push(scene); break;
    }
    case "scene.update": {
      const scene = validateScene(operation.scene); const index = project.scenes.findIndex((item) => item.id === scene.id);
      if (index < 0) invalid("场景不存在。"); project.scenes[index] = scene; break;
    }
    case "scene.attach": { const scene = sceneFor(); const node = nodeFor(); node.sceneId = scene.id; node.resourceRefs = []; node.props = { ...node.props, transformOverrides: {}, appearanceOverrides: {} }; break; }
    case "scene.detach": { const node = nodeFor(); delete node.sceneId; break; }
    case "scene.delete": {
      const scene = sceneFor();
      if (operation.detachReferences !== undefined && typeof operation.detachReferences !== "boolean") invalid("detachReferences 必须是布尔值。");
      const nodes = project.pages.flatMap((page) => page.nodes).filter((node) => node.sceneId === scene.id);
      if (nodes.length && !operation.detachReferences) invalid("该场景仍被页面引用，请先解除引用。");
      nodes.forEach((node) => { delete node.sceneId; }); project.scenes = project.scenes.filter((item) => item.id !== scene.id); break;
    }
    case "scene.duplicate": {
      const source = sceneFor(); const instanceIds = new Map(source.instances.map((instance) => [instance.id, crypto.randomUUID()]));
      const copy: SceneDefinition = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name.slice(0, 95)} 副本`,
        instances: source.instances.map((instance) => ({ ...structuredClone(instance), id: instanceIds.get(instance.id)! })),
        assetBindings: source.assetBindings.map((binding) => ({ ...binding, id: crypto.randomUUID(), instanceId: instanceIds.get(binding.instanceId)! })) };
      if (copy.motions) copy.motions = copy.motions.map((motion) => ({ ...motion, id: crypto.randomUUID(), tracks: motion.tracks.map((track) => ({ ...track, id: crypto.randomUUID(), ...(track.type === "object" ? { target: { ...track.target, instanceId: instanceIds.get(track.target.instanceId)! } } : {}) })) }));
      project.scenes.push(copy);
      if (operation.nodeId !== undefined) { const node = nodeFor();
        const motionIds = new Map((source.motions ?? []).map((motion,index) => [motion.id,copy.motions![index].id]));
        for (const rule of project.interactions.rules) rule.actions = rule.actions.map((action) => (action.type === "motion.play" || action.type === "motion.stop") && action.nodeId === node.id ? { ...action,motionId: motionIds.get(action.motionId) ?? action.motionId } : action);
        node.sceneId = copy.id; node.resourceRefs = []; node.props = { ...node.props, transformOverrides: {}, appearanceOverrides: {} }; } break;
    }
    case "scene.settings": sceneFor().settings = validateSceneSettings(operation.settings); break;
    case "scene.motions": sceneFor().motions = validateSceneMotions(operation.motions); break;
    case "instance.replace-resource": {
      const scene = sceneFor();
      const next = replaceInstanceResource(scene, requireIdentifier(operation.instanceId, "instanceId"), requireIdentifier(operation.expectedAssetId, "expectedAssetId"), requireIdentifier(operation.newAssetId, "newAssetId"), operation.objectMap);
      project.scenes[project.scenes.indexOf(scene)] = next; break;
    }
    case "instance.upsert": {
      const scene = sceneFor(); const instance = validateInstance(operation.instance);
      const index = scene.instances.findIndex((item) => item.id === instance.id);
      if (index < 0) scene.instances.push(instance); else scene.instances[index] = instance; break;
    }
    case "instance.delete": case "instance.duplicate": {
      const scene = sceneFor(); const id = requireIdentifier(operation.instanceId, "instanceId");
      const instance = scene.instances.find((instance) => instance.id === id); if (!instance) invalid("模型实例不存在。");
      if (type === "instance.delete") { scene.instances = scene.instances.filter((item) => item.id !== id); scene.assetBindings = scene.assetBindings.filter((binding) => binding.instanceId !== id); }
      else {
        const copy = structuredClone(instance!); copy.id = crypto.randomUUID(); copy.name = `${copy.name.slice(0, 95)} 副本`; copy.transform.position[0] += 2; scene.instances.push(copy);
        scene.assetBindings.push(...scene.assetBindings.filter((binding) => binding.instanceId === id).map((binding) => ({ ...binding, id: crypto.randomUUID(), instanceId: copy.id })));
      }
      break;
    }
  }
}
