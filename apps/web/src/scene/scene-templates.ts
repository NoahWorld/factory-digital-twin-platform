import { STANDALONE_3D_LIMITS, type StandaloneSceneDocument, type StandaloneSceneInstance } from "../../../../shared/standalone-3d";
import { workshopInstances, workshopSettings } from "../../../../shared/workshop-layout";
import { formatFileSize, type ModelAsset } from "../canvas/model-assets";
import type { CanvasTemplateId } from "../canvas/templates";

export const sceneTemplates = [{
  id: "production-workshop",
  name: "示例生产车间 · 机械臂与 AGV",
  description: "完整车间布局，包含生产单元、机械臂、输送线、仓储货架与 AGV。模型、布局、灯光和动画均可继续编辑。",
  category: "工业制造",
  instances: workshopInstances,
  settings: workshopSettings,
  previewModelIds: ["builtin:workshop-robot-arm-v2", "builtin:workshop-agv-v2", "builtin:workshop-rack-v2"],
}] as const;

export type SceneTemplateId = typeof sceneTemplates[number]["id"];
export type ProjectTemplate = { projectType: "2d"; id: CanvasTemplateId } | { projectType: "3d"; id: SceneTemplateId };

export const isSceneTemplateId = (id: string): id is SceneTemplateId => sceneTemplates.some((template) => template.id === id);

export function getSceneTemplate(id: SceneTemplateId) {
  const template = sceneTemplates.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`未知的 3D 场景模板：${id}`);
  return template;
}

type ScenePerformanceCost = {
  animatedInstances: number;
  estimatedMeshInstances: number;
  uniqueModelBytes: number;
  uniqueModelFiles: number;
};

export const measureScenePerformance = (instances: readonly StandaloneSceneInstance[], models: ModelAsset[]): ScenePerformanceCost => {
  const modelById = new Map(models.map((model) => [model.id, model]));
  const uniqueModelIds = new Set(instances.map((instance) => instance.modelAssetId));
  return {
    animatedInstances: instances.filter((instance) => instance.animation?.enabled !== false && (modelById.get(instance.modelAssetId)?.inspection.animationCount ?? 0) > 0).length,
    estimatedMeshInstances: instances.reduce((total, instance) => total + (modelById.get(instance.modelAssetId)?.inspection.meshCount ?? 0), 0),
    uniqueModelBytes: [...uniqueModelIds].reduce((total, modelId) => total + (modelById.get(modelId)?.byteSize ?? 0), 0),
    uniqueModelFiles: uniqueModelIds.size,
  };
};

export const sceneBudgetViolation = (cost: ScenePerformanceCost, limits: typeof STANDALONE_3D_LIMITS, playAnimations: boolean): string | null => {
  if (cost.uniqueModelFiles > limits.maximumUniqueModelAssets) return `场景最多引用 ${limits.maximumUniqueModelAssets} 个不同模型文件。`;
  if (cost.uniqueModelBytes > limits.maximumUniqueModelBytes) return `模型资源总量将超过 ${formatFileSize(limits.maximumUniqueModelBytes)}。`;
  if (cost.estimatedMeshInstances > limits.maximumEstimatedMeshInstances) return `预计网格实例将达到 ${cost.estimatedMeshInstances}，超过当前 ${limits.maximumEstimatedMeshInstances} 的实时渲染预算。`;
  if (playAnimations && cost.animatedInstances > limits.maximumAnimatedInstances) return `可播放动画的模型实例将达到 ${cost.animatedInstances}，超过当前 ${limits.maximumAnimatedInstances} 个的动画预算。`;
  return null;
};

/** Templates produce a local draft only; the existing scene PATCH remains the sole save path. */
export function instantiateSceneTemplate({ templateId, currentScene, savedScene, models, limits, editable, requireNewProject = false }: {
  templateId: SceneTemplateId;
  currentScene: StandaloneSceneDocument;
  savedScene: StandaloneSceneDocument;
  models: ModelAsset[];
  limits: typeof STANDALONE_3D_LIMITS;
  editable: boolean;
  requireNewProject?: boolean;
}): StandaloneSceneDocument {
  if (!editable) throw new Error("当前账号没有编辑此 3D 场景的权限。");
  if (requireNewProject && (savedScene.revision !== 0 || savedScene.instances.length > 0 || savedScene.linked2dProjectId !== null || JSON.stringify(currentScene) !== JSON.stringify(savedScene))) {
    throw new Error("模板链接仅用于全新空项目；已有项目请通过工具栏“模板”确认后套用。");
  }
  const template = getSceneTemplate(templateId);
  const missing = [...new Set(template.instances.map((instance) => instance.modelAssetId))].filter((id) => !models.some((model) => model.id === id));
  if (missing.length) throw new Error(`模板模型未全部就绪：${missing.join("、")}。请刷新资源库后重试。`);
  const violation = sceneBudgetViolation(measureScenePerformance(template.instances, models), limits, template.settings.playAnimations);
  if (violation) throw new Error(violation);
  if (template.instances.length > limits.maximumInstances) throw new Error(`模板超过当前 ${limits.maximumInstances} 个实例的预算。`);
  const presetIds = new Set<string>(template.instances.map((instance) => instance.id));
  const savedById = new Map(savedScene.instances.map((instance) => [instance.id, instance]));
  const changes = template.instances.filter((instance) => JSON.stringify(instance) !== JSON.stringify(savedById.get(instance.id))).length
    + savedScene.instances.filter((instance) => !presetIds.has(instance.id)).length;
  if (changes > limits.maximumPatchInstances) throw new Error(`套用模板需要 ${changes} 个实例变更，超过单次保存上限 ${limits.maximumPatchInstances}；请在模板中心创建新项目。`);
  return { ...currentScene, settings: structuredClone(template.settings), instances: structuredClone(template.instances) };
}
