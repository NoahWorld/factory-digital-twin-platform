import { IDENTITY_TRANSFORM, type SceneDefinition } from "../../../../shared/scene-definition";
import { parseModel3DProps, type CanvasNode } from "./types";
import type { ModelAsset } from "./model-assets";
import type { ModelSceneNode, ModelSceneSnapshot } from "./model-scene";
import type { ProjectAsset } from "./assets";
import { modelObjectLocator } from "../../../../shared/model-inspection";

export function extractLegacyScene(node: CanvasNode, model: ModelAsset | null, snapshot: ModelSceneSnapshot | null, assets: ProjectAsset[]): SceneDefinition {
  const parsed = parseModel3DProps(node.props); if (!parsed.ok) throw new Error(parsed.message);
  const { transformOverrides, appearanceOverrides, ...settings } = parsed.value;
  const scene: SceneDefinition = { id: crypto.randomUUID(), name: "可复用场景", settings, instances: [], assetBindings: [] };
  if (!node.resourceRefs[0]) return scene;
  if (!model || model.id !== node.resourceRefs[0] || snapshot?.assetId !== model.id || !model.inspection.objects) throw new Error("请等待模型加载并完成资源检查后再转换。");
  const nodes: ModelSceneNode[] = [];
  const visit = (items: ModelSceneNode[]) => items.forEach((item) => { nodes.push(item); visit(item.children); }); visit(snapshot.roots);
  const objectIdForName = (name: string) => {
    const matches = nodes.filter((node) => node.name === name && node.nodeIndex !== undefined);
    if (matches.length !== 1) throw new Error(`旧模型对象「${name}」缺失或重名，请先修复旧配置。`);
    const locator = modelObjectLocator({ ...matches[0], nodeIndex: matches[0].nodeIndex! });
    const object = model.inspection.objects!.find((object) => modelObjectLocator(object) === locator);
    if (!object) throw new Error(`对象「${name}」的清单与已加载模型不匹配。`); return object.objectId;
  };
  const instanceId = crypto.randomUUID();
  scene.instances.push({ id: instanceId, name: model.originalFilename.slice(0,100), modelAssetId: model.id, transform: structuredClone(IDENTITY_TRANSFORM), visible: true, appearance: null,
    objectTransforms: Object.fromEntries(Object.entries(transformOverrides).map(([name, value]) => [objectIdForName(name), value])),
    objectAppearances: Object.fromEntries(Object.entries(appearanceOverrides).map(([name, value]) => [objectIdForName(name), value])) });
  for (const asset of assets) if (asset.modelNode && nodes.some((node) => node.name === asset.modelNode)) {
    scene.assetBindings.push({ id: crypto.randomUUID(), assetId: asset.assetId, instanceId, objectId: objectIdForName(asset.modelNode) });
  }
  return scene;
}
