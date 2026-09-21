import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  STANDALONE_3D_LIMITS,
  defaultStandaloneSceneInstanceAnimation,
  defaultStandaloneSceneInstanceAppearance,
  standaloneScenePath,
  standaloneSceneRoutePath,
  type ProjectType,
  type StandaloneSceneDocument,
  type StandaloneSceneInstance,
  type StandaloneSceneSettings,
} from "../../../../shared/standalone-3d";
import type { TwinAction } from "../../../../shared/twin-actions";
import { errorMessage, request } from "../api";
import { findBuiltinModel, latestBuiltinModel } from "../../../../shared/builtin-models";
import { workshopInstances, workshopSettings } from "../../../../shared/workshop-layout";
import { projectAssetsPath, type ProjectAsset, type ProjectAssetListResponse } from "../canvas/assets";
import { Model3DNode } from "../canvas/Model3DNode";
import { CanvasSurface } from "../canvas/CanvasSurface";
import { canvasRoutePath, projectCanvasPath } from "../canvas/routes";
import { ModelAssetThumbnail } from "../canvas/ModelAssetThumbnail";
import { ModelAssetPreviewDialog } from "../canvas/ModelAssetPreviewDialog";
import { standaloneRendererNode } from "../canvas/standalone-renderer-node";
import { ThemeToggle } from "../theme/ThemeToggle";
import {
  formatFileSize,
  modelAssetsPath,
  type ModelAsset,
  type ModelAssetListResponse,
  type ModelAssetUploadResponse,
} from "../canvas/model-assets";
import {
  type ModelNodeTransform,
  type Vector3Tuple,
  type CanvasDocument,
  type CanvasNode,
  type CanvasResponse,
} from "../canvas/types";
import type { InstanceTransformMode } from "../scene/instance-transform";
import { AssetRuntimeStatusBanner } from "../twin/AssetRuntimeStatusBanner";
import { AssetRuntimeDetailPanel } from "../twin/AssetRuntimeDetailPanel";
import { TwinActionEditor } from "../twin/TwinActionEditor";
import { TwinActionFeedback } from "../twin/TwinActionFeedback";
import { useTwinActions } from "../twin/useTwinActions";
import { useLinkedTwinScenes } from "../twin/useLinkedTwinScenes";
import { publishTwinActions, subscribeTwinActions } from "../twin/action-events";
import { useAssetRuntimeConnections } from "../twin/useAssetRuntimeConnections";

type ProjectSummary = {
  id: string;
  name: string;
  projectType: ProjectType;
};

type SceneResponse = {
  editable: boolean;
  limits: typeof STANDALONE_3D_LIMITS;
  project: ProjectSummary;
  requestId: string;
  scene: StandaloneSceneDocument;
};

type ProjectsResponse = {
  projects: ProjectSummary[];
  requestId: string;
};

type ScenePatch = {
  deleteInstanceIds: string[];
  expectedRevision: number;
  linked2dProjectId?: string | null;
  settings?: StandaloneSceneSettings;
  upsertInstances: StandaloneSceneInstance[];
};

type Standalone3DProjectPageProps = {
  mode: "edit" | "preview";
  projectId: string;
};

type LibraryView = "layers" | "models";
type InspectorView = "model" | "scene";

const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const axisLabels = ["X", "Y", "Z"] as const;
const ignoreSceneNodeSelection = () => undefined;

const modelName = (asset: ModelAsset): string => {
  const name = findBuiltinModel(asset.id)?.name ?? asset.originalFilename;
  return latestBuiltinModel(asset.id)?.id !== asset.id && findBuiltinModel(asset.id) ? `${name}（旧版）` : name;
};

const modelSourceText = (source: ModelAsset["source"]): string =>
  source === "system" ? "系统模型" : source === "scene-background" ? "背景模型" : "上传模型";

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

type ScenePerformanceCost = {
  animatedInstances: number;
  estimatedMeshInstances: number;
  uniqueModelBytes: number;
  uniqueModelFiles: number;
};

const measureScenePerformance = (
  instances: StandaloneSceneInstance[],
  models: ModelAsset[],
): ScenePerformanceCost => {
  const modelById = new Map(models.map((model) => [model.id, model]));
  const uniqueModelIds = new Set(instances.map((instance) => instance.modelAssetId));
  return {
    animatedInstances: instances.filter((instance) =>
      instance.animation?.enabled !== false
      &&
      (modelById.get(instance.modelAssetId)?.inspection.animationCount ?? 0) > 0).length,
    estimatedMeshInstances: instances.reduce((total, instance) =>
      total + (modelById.get(instance.modelAssetId)?.inspection.meshCount ?? 0), 0),
    uniqueModelBytes: [...uniqueModelIds].reduce((total, modelId) =>
      total + (modelById.get(modelId)?.byteSize ?? 0), 0),
    uniqueModelFiles: uniqueModelIds.size,
  };
};

const sceneBudgetViolation = (
  cost: ScenePerformanceCost,
  limits: typeof STANDALONE_3D_LIMITS,
  playAnimations: boolean,
): string | null => {
  if (cost.uniqueModelFiles > limits.maximumUniqueModelAssets) {
    return `场景最多引用 ${limits.maximumUniqueModelAssets} 个不同模型文件。`;
  }
  if (cost.uniqueModelBytes > limits.maximumUniqueModelBytes) {
    return `模型资源总量将超过 ${formatFileSize(limits.maximumUniqueModelBytes)}。`;
  }
  if (cost.estimatedMeshInstances > limits.maximumEstimatedMeshInstances) {
    return `预计网格实例将达到 ${cost.estimatedMeshInstances}，超过当前 ${limits.maximumEstimatedMeshInstances} 的实时渲染预算。`;
  }
  if (playAnimations && cost.animatedInstances > limits.maximumAnimatedInstances) {
    return `可播放动画的模型实例将达到 ${cost.animatedInstances}，超过当前 ${limits.maximumAnimatedInstances} 个的动画预算。`;
  }
  return null;
};

export default function Standalone3DProjectPage({ mode, projectId }: Standalone3DProjectPageProps) {
  const [projectName, setProjectName] = useState("");
  const [savedScene, setSavedScene] = useState<StandaloneSceneDocument | null>(null);
  const [draftScene, setDraftScene] = useState<StandaloneSceneDocument | null>(null);
  const [editable, setEditable] = useState(false);
  const [limits, setLimits] = useState<typeof STANDALONE_3D_LIMITS>(STANDALONE_3D_LIMITS);
  const [models, setModels] = useState<ModelAsset[]>([]);
  const [previewModel, setPreviewModel] = useState<ModelAsset | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [linkedAssets, setLinkedAssets] = useState<ProjectAsset[]>([]);
  const [linkedAssetsLoading, setLinkedAssetsLoading] = useState(false);
  const [linkedAssetLoadError, setLinkedAssetLoadError] = useState<string | null>(null);
  const [linkedCanvas, setLinkedCanvas] = useState<CanvasDocument | null>(null);
  const [linkedCanvasLoading, setLinkedCanvasLoading] = useState(false);
  const [linkedCanvasError, setLinkedCanvasError] = useState<string | null>(null);
  const [selectedRuntimeAssetId, setSelectedRuntimeAssetId] = useState<string | null>(null);
  const [modelFocusRequest, setModelFocusRequest] = useState<{ instanceId: string; requestId: string } | null>(null);
  const [interactionTransportError, setInteractionTransportError] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>("layers");
  const [inspectorView, setInspectorView] = useState<InspectorView>("scene");
  const [instanceTransformMode, setInstanceTransformMode] = useState<InstanceTransformMode>("translate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draftSceneRef = useRef<StandaloneSceneDocument | null>(null);
  const layerTreeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    draftSceneRef.current = draftScene;
  }, [draftScene]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPreviewModel(null);
    setError(null);
    void Promise.all([
      request<SceneResponse>(standaloneScenePath(projectId)),
      request<ModelAssetListResponse>(modelAssetsPath(projectId)),
      request<ProjectsResponse>("/api/v1/projects"),
    ]).then(([sceneResult, modelResult, projectResult]) => {
      if (!active) return;
      setProjectName(sceneResult.project.name);
      setSavedScene(sceneResult.scene);
      setDraftScene(sceneResult.scene);
      setEditable(sceneResult.editable);
      setLimits(sceneResult.limits);
      setModels(modelResult.modelAssets);
      setProjects(projectResult.projects);
      setSelectedInstanceId(null);
      setInspectorView("scene");
    }).catch((reason) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setLinkedAssets([]);
    setLinkedAssetLoadError(null);
    const linkedProjectId = draftScene?.linked2dProjectId;
    if (!linkedProjectId) {
      setLinkedAssetsLoading(false);
      return () => { active = false; };
    }
    setLinkedAssetsLoading(true);
    void request<ProjectAssetListResponse>(projectAssetsPath(linkedProjectId))
      .then((result) => {
        if (active) setLinkedAssets(result.assets);
      })
      .catch((reason) => {
        if (active) setLinkedAssetLoadError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLinkedAssetsLoading(false);
      });
    return () => { active = false; };
  }, [draftScene?.linked2dProjectId]);

  useEffect(() => {
    let active = true;
    setLinkedCanvas(null);
    setLinkedCanvasError(null);
    setSelectedRuntimeAssetId(null);
    const linkedProjectId = draftScene?.linked2dProjectId;
    setLinkedCanvasLoading(Boolean(linkedProjectId));
    if (!linkedProjectId) return () => { active = false; };
    void request<CanvasResponse>(projectCanvasPath(linkedProjectId)).then((result) => {
      if (active) setLinkedCanvas(result.canvas);
    }).catch((reason) => {
      console.error("Failed to load linked 2D overlay", { projectId, linkedProjectId, reason });
      if (active) setLinkedCanvasError(`关联 2D 画布加载失败：${errorMessage(reason)}`);
    }).finally(() => { if (active) setLinkedCanvasLoading(false); });
    return () => { active = false; };
  }, [projectId, draftScene?.linked2dProjectId, mode]);

  useEffect(() => {
    setSelectedInstanceId(null);
    setSelectedRuntimeAssetId(null);
    setModelFocusRequest(null);
    setInteractionTransportError(null);
    setPreviewModel(null);
    setInspectorView("scene");
    setNotice(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit" || libraryView !== "layers") return;
    const tree = layerTreeRef.current;
    if (!tree) return;
    const target = selectedInstanceId
      ? Array.from(tree.querySelectorAll<HTMLElement>("[data-instance-id]"))
          .find((element) => element.dataset.instanceId === selectedInstanceId)
      : tree.querySelector<HTMLElement>("[data-scene-root]");
    target?.scrollIntoView({ block: "nearest" });
  }, [libraryView, mode, selectedInstanceId]);

  useEffect(() => {
    if (mode !== "edit" || previewModel) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.key.toLowerCase() === "w") setInstanceTransformMode("translate");
      if (event.key.toLowerCase() === "r") setInstanceTransformMode("scale");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [mode, previewModel]);

  const dirty = savedScene !== null && draftScene !== null && !sameJson(savedScene, draftScene);
  const selectedInstance = draftScene?.instances.find((item) => item.id === selectedInstanceId) ?? null;
  const selectedModelAsset = selectedInstance
    ? models.find((model) => model.id === selectedInstance.modelAssetId) ?? null
    : null;
  const selectedAnimation = selectedInstance?.animation ?? defaultStandaloneSceneInstanceAnimation();
  const selectedAppearance = selectedInstance?.appearance ?? defaultStandaloneSceneInstanceAppearance();
  const selectedAsset = selectedRuntimeAssetId
    ? linkedAssets.find((asset) => asset.assetId === selectedRuntimeAssetId) ?? null
    : null;
  const boundRuntimeAssets = useMemo(() => {
    const boundAssetIds = new Set(
      draftScene?.instances.flatMap((instance) => instance.assetId ? [instance.assetId] : []) ?? [],
    );
    if (selectedRuntimeAssetId) boundAssetIds.add(selectedRuntimeAssetId);
    return linkedAssets.filter((asset) => boundAssetIds.has(asset.assetId));
  }, [draftScene?.instances, linkedAssets, selectedRuntimeAssetId]);
  const runtimeSetupError = useMemo(() => {
    if (mode !== "preview" || linkedAssetsLoading) return null;
    if (linkedAssetLoadError) return `资产台账加载失败：${linkedAssetLoadError}`;
    if (draftScene?.linked2dProjectId) {
      const availableAssetIds = new Set(linkedAssets.map((asset) => asset.assetId));
      const missingAssetIds = [...new Set(draftScene.instances.flatMap((instance) => (
        instance.assetId && !availableAssetIds.has(instance.assetId) ? [instance.assetId] : []
      )))];
      if (missingAssetIds.length > 0) return `场景绑定的业务资产不存在或当前账号无权访问：${missingAssetIds.join("、")}。`;
    }
    if (boundRuntimeAssets.length > 50) {
      return `当前绑定 ${boundRuntimeAssets.length} 台设备；本地直连轮询上限为 50，请使用服务端批量采集器。`;
    }
    return null;
  }, [boundRuntimeAssets.length, draftScene, linkedAssetLoadError, linkedAssets, linkedAssetsLoading, mode]);
  const runtimeConnections = useAssetRuntimeConnections({
    assets: boundRuntimeAssets,
    blockedReason: runtimeSetupError,
    enabled: mode === "preview" && !linkedAssetsLoading,
    projectId: draftScene?.linked2dProjectId ?? null,
  });
  const scenePerformance = useMemo(
    () => measureScenePerformance(draftScene?.instances ?? [], models),
    [draftScene?.instances, models],
  );

  const rendererNode = useMemo(
    () => draftScene ? standaloneRendererNode(draftScene) : null,
    [draftScene],
  );

  const linkedSceneCatalog = useLinkedTwinScenes(draftScene?.linked2dProjectId ?? "", linkedCanvas);
  const actionScenes = useMemo(() => draftScene ? [
    { projectId, name: projectName, instances: draftScene.instances },
    ...linkedSceneCatalog.scenes.filter((scene) => scene.projectId !== projectId),
  ] : linkedSceneCatalog.scenes, [draftScene, projectId, projectName, linkedSceneCatalog.scenes]);
  const focusActionModel = useCallback((targetProjectId: string, instanceId: string) => {
    if (targetProjectId !== projectId) return; // The validated remote target is dispatched through the project-scoped bus.
    setSelectedInstanceId(instanceId);
    setModelFocusRequest({ instanceId, requestId: crypto.randomUUID() });
  }, [projectId]);
  const selectActionAsset = useCallback((assetId: string) => {
    setSelectedRuntimeAssetId(assetId);
    const instance = draftScene?.instances.find((candidate) => candidate.assetId === assetId && candidate.visible);
    if (instance) setSelectedInstanceId((current) => draftScene?.instances.some((candidate) => candidate.id === current && candidate.assetId === assetId && candidate.visible) ? current : instance.id);
  }, [draftScene?.instances]);
  const interactions = useTwinActions({
    canvasDocument: linkedCanvas, assets: linkedAssets, scenes: actionScenes,
    contextKey: `${projectId}:${draftScene?.linked2dProjectId ?? ""}:${mode}:${linkedCanvas?.revision ?? ""}:${draftScene?.revision ?? ""}`,
    onSelectAsset: selectActionAsset, onFocusModel: focusActionModel,
  });
  const executeAndPublish = useCallback((actions: readonly TwinAction[], source: string, originProjectId = projectId) => {
    if (!interactions.execute(actions, source)) return;
    setInteractionTransportError(null);
    try {
      const canvasActions = actions.filter((action) => action.type !== "focus-model");
      if (canvasActions.length && draftScene?.linked2dProjectId) {
        publishTwinActions({ actions: canvasActions, originProjectId, targetProjectId: draftScene.linked2dProjectId });
      }
      const focusProjects = new Set(actions.flatMap((action) => action.type === "focus-model" ? [action.projectId] : []));
      for (const targetProjectId of focusProjects) {
        publishTwinActions({ originProjectId, targetProjectId, actions: actions.filter((action) => action.type === "focus-model" && action.projectId === targetProjectId) });
      }
    } catch (reason) {
      console.error("Failed to synchronize linked project actions", { projectId, originProjectId, source, reason });
      setInteractionTransportError(`当前页面已执行交互，但跨页面同步失败：${errorMessage(reason)}`);
    }
  }, [interactions.execute, draftScene?.linked2dProjectId, projectId]);
  const overlayNodeActions = useCallback((node: CanvasNode) => {
    if (node.interaction && draftScene?.linked2dProjectId) executeAndPublish(node.interaction.clickActions, `2D 组件 ${node.id}`, draftScene.linked2dProjectId);
  }, [draftScene?.linked2dProjectId, executeAndPublish]);
  useEffect(() => {
    if (mode !== "preview" || !draftScene?.linked2dProjectId || !linkedCanvas || linkedAssetsLoading) return;
    return subscribeTwinActions({
      targetProjectIds: [projectId, draftScene.linked2dProjectId],
      allowedOriginProjectIds: [projectId, draftScene.linked2dProjectId, ...linkedSceneCatalog.scenes.map((scene) => scene.projectId)],
      onActions: (event) => {
        interactions.execute(event.actions, `来自项目 ${event.originProjectId} 的交互`);
      },
      onError: (reason) => setInteractionTransportError(`跨页面联动不可用：${errorMessage(reason)}`),
    });
  }, [mode, projectId, draftScene?.linked2dProjectId, linkedCanvas, linkedAssetsLoading, linkedSceneCatalog.scenes, interactions.execute]);

  const updateSettings = <K extends keyof StandaloneSceneSettings>(
    key: K,
    value: StandaloneSceneSettings[K],
  ) => {
    if (
      key === "playAnimations" && value === true
      && scenePerformance.animatedInstances > limits.maximumAnimatedInstances
    ) {
      setError(`当前有 ${scenePerformance.animatedInstances} 个动画模型，超过 ${limits.maximumAnimatedInstances} 个的播放预算。请先减少动画模型。`);
      return;
    }
    setDraftScene((current) => current ? {
      ...current,
      settings: { ...current.settings, [key]: value },
    } : current);
    setError(null);
    setNotice(null);
  };

  const updateInstance = (id: string, patch: Partial<StandaloneSceneInstance>) => {
    setDraftScene((current) => current ? {
      ...current,
      instances: current.instances.map((instance) => instance.id === id
        ? { ...instance, ...patch }
        : instance),
    } : current);
    setError(null);
    setNotice(null);
  };

  const updateInstanceAnimation = (
    instance: StandaloneSceneInstance,
    patch: Partial<NonNullable<StandaloneSceneInstance["animation"]>>,
  ) => {
    const currentScene = draftSceneRef.current;
    if (!currentScene) return;
    const animation = {
      ...defaultStandaloneSceneInstanceAnimation(),
      ...instance.animation,
      ...patch,
    };
    const instances = currentScene.instances.map((candidate) => candidate.id === instance.id
      ? { ...candidate, animation }
      : candidate);
    const cost = measureScenePerformance(instances, models);
    if (currentScene.settings.playAnimations && cost.animatedInstances > limits.maximumAnimatedInstances) {
      setError(`启用后将有 ${cost.animatedInstances} 个动画模型，超过 ${limits.maximumAnimatedInstances} 个的播放预算。`);
      return;
    }
    updateInstance(instance.id, { animation });
  };

  const commitInstanceTransform = useCallback((_nodeId: string, instanceId: string, transform: ModelNodeTransform) => {
    if (mode !== "edit" || !editable) return;
    setDraftScene((current) => current ? {
      ...current,
      instances: current.instances.map((instance) => instance.id === instanceId
        ? { ...instance, transform }
        : instance),
    } : current);
    setError(null);
    setNotice(null);
  }, [editable, mode]);

  const updateVector = (
    instance: StandaloneSceneInstance,
    field: keyof StandaloneSceneInstance["transform"],
    axis: 0 | 1 | 2,
    value: number,
  ) => {
    if (!Number.isFinite(value) || (field === "scale" && value < 0.001)) return;
    const vector = [...instance.transform[field]] as Vector3Tuple;
    vector[axis] = value;
    updateInstance(instance.id, {
      transform: { ...instance.transform, [field]: vector },
    });
  };

  const addModel = (asset: ModelAsset) => {
    const currentScene = draftSceneRef.current;
    if (!currentScene) return;
    if (currentScene.instances.length >= limits.maximumInstances) {
      setError(`当前场景最多允许 ${limits.maximumInstances} 个模型实例。`);
      return;
    }
    const index = currentScene.instances.length;
    const instance: StandaloneSceneInstance = {
      animation: defaultStandaloneSceneInstanceAnimation(),
      appearance: defaultStandaloneSceneInstanceAppearance(),
      assetId: null,
      id: `scene-${crypto.randomUUID()}`,
      label: `${modelName(asset)} ${index + 1}`,
      modelAssetId: asset.id,
      renderMode: asset.source === "scene-background" ? "background" : "interactive",
      sortOrder: index,
      transform: {
        position: [(index % 6) * 3, 0, Math.floor(index / 6) * 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      visible: true,
    };
    const nextInstances = [...currentScene.instances, instance];
    const availableModels = models.some((model) => model.id === asset.id)
      ? models
      : [asset, ...models];
    const violation = sceneBudgetViolation(
      measureScenePerformance(nextInstances, availableModels),
      limits,
      currentScene.settings.playAnimations,
    );
    if (violation) {
      setError(violation);
      return;
    }
    setDraftScene({ ...currentScene, instances: nextInstances });
    setSelectedInstanceId(instance.id);
    setLibraryView("layers");
    setInspectorView("model");
    setError(null);
    setNotice(`已把“${modelName(asset)}”加入场景，保存后生效。`);
  };

  const assembleWorkshop = (replaceExisting = false) => {
    const currentScene = draftSceneRef.current;
    if (!editable || !currentScene || !savedScene || (!replaceExisting && (currentScene.instances.length || savedScene.instances.length))) {
      setError("示例车间只能搭建到可编辑的全新空场景中。");
      return;
    }
    const missing = [...new Set(workshopInstances.map((instance) => instance.modelAssetId))]
      .filter((id) => !models.some((model) => model.id === id));
    if (missing.length) {
      setError(`车间模型未全部就绪：${missing.join("、")}。请刷新资源库后重试。`);
      return;
    }
    const violation = sceneBudgetViolation(measureScenePerformance(workshopInstances, models), limits, workshopSettings.playAnimations);
    const presetIds = new Set(workshopInstances.map(instance => instance.id));
    const deletions = savedScene.instances.filter(instance => !presetIds.has(instance.id)).length;
    if (violation || workshopInstances.length > limits.maximumInstances || workshopInstances.length + deletions > limits.maximumPatchInstances) {
      setError(violation ?? "示例车间超过当前实例或单次保存预算。");
      return;
    }
    setDraftScene({ ...currentScene, settings: { ...workshopSettings }, instances: structuredClone(workshopInstances) });
    setSelectedInstanceId(null);
    setLibraryView("layers");
    setInspectorView("scene");
    setError(null);
    setNotice("新版示例车间已载入草稿，包含新的模型、布局和灯光；保存场景后生效。设备动画为演示，尚未绑定现场数据。");
  };

  const updateBuiltinModels = () => {
    const current = draftSceneRef.current;
    if (!editable || !current || !savedScene) return;
    const instances = current.instances.map(instance => {
      const latest = latestBuiltinModel(instance.modelAssetId);
      return latest && latest.id !== instance.modelAssetId ? { ...instance, modelAssetId: latest.id } : instance;
    });
    const missing = instances.filter(instance => !models.some(model => model.id === instance.modelAssetId));
    if (missing.length) { setError(`新版模型未就绪：${missing.map(instance => instance.label).join("、")}。请刷新后重试。`); return; }
    const violation = sceneBudgetViolation(measureScenePerformance(instances, models), limits, current.settings.playAnimations);
    const changes = instances.filter(instance => !savedScene.instances.some(saved => saved.id === instance.id && sameJson(saved, instance))).length
      + savedScene.instances.filter(saved => !instances.some(instance => instance.id === saved.id)).length;
    if (violation || changes > limits.maximumPatchInstances) { setError(violation ?? "模型更新超过单次保存预算，请先保存当前修改。"); return; }
    const count = instances.filter((instance, i) => instance !== current.instances[i]).length;
    setDraftScene({ ...current, instances });
    setError(null);
    setNotice(`已更新 ${count} 个实例的内置模型版本，请保存场景。位置、缩放、名称和业务绑定保持原值。`);
  };

  const removeSelected = () => {
    if (!draftScene || !selectedInstance) return;
    setDraftScene({
      ...draftScene,
      instances: draftScene.instances.filter((instance) => instance.id !== selectedInstance.id),
    });
    setSelectedInstanceId(null);
    setInspectorView("scene");
    setNotice(`已从草稿中移除“${selectedInstance.label}”。`);
  };

  const save = async () => {
    if (!savedScene || !draftScene || !dirty) return;
    const savedById = new Map(savedScene.instances.map((instance) => [instance.id, instance]));
    const draftIds = new Set(draftScene.instances.map((instance) => instance.id));
    const upsertInstances = draftScene.instances.filter((instance) =>
      !sameJson(savedById.get(instance.id), instance));
    const deleteInstanceIds = savedScene.instances
      .filter((instance) => !draftIds.has(instance.id))
      .map((instance) => instance.id);
    if (upsertInstances.length + deleteInstanceIds.length > limits.maximumPatchInstances) {
      setError(`一次最多保存 ${limits.maximumPatchInstances} 个实例变更，请分批保存。`);
      return;
    }
    const patch: ScenePatch = {
      deleteInstanceIds,
      expectedRevision: savedScene.revision,
      upsertInstances,
    };
    if (!sameJson(savedScene.settings, draftScene.settings)) patch.settings = draftScene.settings;
    if (savedScene.linked2dProjectId !== draftScene.linked2dProjectId) {
      patch.linked2dProjectId = draftScene.linked2dProjectId;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await request<SceneResponse>(standaloneScenePath(projectId), {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSavedScene(result.scene);
      setDraftScene(result.scene);
      setNotice(`场景已保存为修订版 ${result.scene.revision}。`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (extension !== "glb" && extension !== "gltf") {
      setError("只支持 .glb 和 .gltf 模型文件。");
      return;
    }
    if (file.size === 0 || file.size > MAX_MODEL_BYTES) {
      setError(`单个模型必须大于 0 B 且不超过 ${formatFileSize(MAX_MODEL_BYTES)}。`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await request<ModelAssetUploadResponse>(
        `${modelAssetsPath(projectId)}?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          body: file,
          headers: {
            "content-type": extension === "glb" ? "model/gltf-binary" : "model/gltf+json",
          },
        },
      );
      setModels((current) => [result.modelAsset, ...current]);
      addModel(result.modelAsset);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  const selectModelInstance = useCallback((_nodeId: string, instanceId: string | null) => {
    setSelectedInstanceId(instanceId);
    setNotice(null);
    if (mode === "edit") {
      setLibraryView("layers");
      setInspectorView(instanceId ? "model" : "scene");
      return;
    }
    if (!instanceId) return;
    const instance = draftScene?.instances.find((item) => item.id === instanceId);
    if (!instance || instance.renderMode === "background") return;
    const actions: TwinAction[] = instance.clickActions ?? (instance.assetId && draftScene?.linked2dProjectId ? [{ type: "select-asset", assetId: instance.assetId }] : []);
    if (actions.length) executeAndPublish(actions, `模型 ${instance.label}`);
  }, [draftScene?.instances, draftScene?.linked2dProjectId, mode, executeAndPublish]);

  if (loading) {
    return <main className="canvas-page-state"><p className="eyebrow">3D workspace</p><h1>正在加载独立 3D 场景…</h1></main>;
  }
  if (error && !draftScene) {
    return <main className="canvas-page-state error-state"><p className="eyebrow">3D workspace</p><h1>3D 项目加载失败</h1><p>{error}</p><a className="secondary-button" href="#/projects">返回项目</a></main>;
  }
  if (!draftScene || !rendererNode) return null;

  const sceneView = (
    <Model3DNode
      cameraControlsEnabled
      editable={false}
      interactive
      instanceTransformMode={mode === "edit" && editable ? instanceTransformMode : null}
      maximumModelInstances={limits.maximumInstances}
      modelFocusRequest={mode === "preview" ? modelFocusRequest : null}
      node={rendererNode}
      onModelInstanceSelect={selectModelInstance}
      onModelInstanceTransform={commitInstanceTransform}
      onSceneNodeSelect={ignoreSceneNodeSelection}
      projectId={projectId}
      runtimeControlsEnabled={false}
      selectionStyle={mode === "edit" ? "editor" : "runtime"}
      selectedModelInstanceId={selectedInstanceId}
      selectedSceneNodePath={null}
    />
  );

  if (mode === "preview") {
    return (
      <main className="standalone-3d-preview">
        <header>
          <a className="secondary-button compact-button" href="#/projects">返回项目</a>
          <div><span>独立 3D 项目</span><strong>{projectName}</strong></div>
          <ThemeToggle />
          <a className="primary-button compact-button" href={standaloneSceneRoutePath(projectId, "edit")}>编辑场景</a>
        </header>
        <section className="standalone-3d-preview-stage" data-canvas-fullscreen-root>
          {sceneView}
          {linkedCanvas ? <CanvasSurface
            document={linkedCanvas} editable={false} presentation="overlay"
            selectedNodeId={null} selectedModelSceneNodePath={null}
            onCreateNode={ignoreSceneNodeSelection} onModelSceneNodeSelect={ignoreSceneNodeSelection}
            onNodeChange={ignoreSceneNodeSelection} onSelectNode={ignoreSceneNodeSelection}
            onNodeActions={overlayNodeActions}
            runtimeNodeVisibility={interactions.nodeVisibility} runtimeTextOverrides={interactions.textOverrides}
            runtimeAsset={selectedAsset} runtimeAssetConnection={selectedAsset ? runtimeConnections[selectedAsset.id] : undefined}
            runtimeAssetLoading={linkedAssetsLoading} runtimeAssetError={runtimeSetupError}
          /> : null}
          {linkedCanvasLoading ? <div className="linked-canvas-status" role="status">正在加载 2D 画布…</div> : null}
          {linkedCanvasError ? <div className="linked-canvas-status is-error" role="alert">{linkedCanvasError}</div> : null}
          <AssetRuntimeStatusBanner connections={runtimeConnections} label="2D / 3D 设备联动" loading={linkedAssetsLoading} setupError={runtimeSetupError} />
          {selectedAsset && !linkedCanvas?.nodes.some((node) => node.type === "asset-detail" && (interactions.nodeVisibility[node.id] ?? !node.interaction?.hiddenInPreview)) ? <AssetRuntimeDetailPanel
            asset={selectedAsset} connection={runtimeConnections[selectedAsset.id]} onClose={() => setSelectedRuntimeAssetId(null)}
          /> : null}
          <TwinActionFeedback messages={interactions.messages} error={interactions.error ?? interactionTransportError}
            onDismissMessage={interactions.dismissMessage} onDismissError={() => { interactions.dismissError(); setInteractionTransportError(null); }} />
        </section>
      </main>
    );
  }

  return (
    <main className="standalone-3d-editor">
      <header className="standalone-3d-toolbar">
        <a className="secondary-button compact-button" href="#/projects">返回项目</a>
        <div className="standalone-3d-title"><span>3D SCENE BUILDER</span><strong>{projectName}</strong></div>
        <div className="standalone-3d-budget" title="通过明确预算阻止浏览器无上限加载">
          <span>{draftScene.instances.length}/{limits.maximumInstances} 实例</span>
          <span>{scenePerformance.estimatedMeshInstances}/{limits.maximumEstimatedMeshInstances} 网格</span>
          <span>{formatFileSize(scenePerformance.uniqueModelBytes)}/{formatFileSize(limits.maximumUniqueModelBytes)}</span>
          {draftScene.settings.playAnimations ? <span>{scenePerformance.animatedInstances}/{limits.maximumAnimatedInstances} 动画实例</span> : null}
        </div>
        <ThemeToggle />
        {editable && draftScene.instances.some(instance => instance.modelAssetId.startsWith("builtin:workshop-") && instance.modelAssetId.endsWith("-v1")) ? <button className="secondary-button compact-button" disabled={saving} onClick={() => assembleWorkshop(true)} title="用新版预设替换草稿中的模型、布局和灯光，保存后生效" type="button">替换为新版示例车间</button> : null}
        {editable && draftScene.instances.some(instance => {
          const latest = latestBuiltinModel(instance.modelAssetId);
          return latest && latest.id !== instance.modelAssetId;
        }) ? <button className="secondary-button compact-button" disabled={saving} onClick={updateBuiltinModels} title="仅更新内置模型资源版本，保留当前布局与设置，保存后生效" type="button">更新内置模型</button> : null}
        <a className="secondary-button compact-button" href={standaloneSceneRoutePath(projectId, "preview")}>预览</a>
        <button className="primary-button compact-button" disabled={!dirty || saving || !editable} onClick={() => void save()} type="button">
          {saving ? "保存中…" : dirty ? "保存场景" : "已保存"}
        </button>
      </header>

      <aside className="standalone-3d-library">
        <nav aria-label="场景内容" className="standalone-panel-tabs">
          <button aria-pressed={libraryView === "layers"} className={libraryView === "layers" ? "is-active" : ""} onClick={() => setLibraryView("layers")} type="button">图层 <span>{draftScene.instances.length}</span></button>
          <button aria-pressed={libraryView === "models"} className={libraryView === "models" ? "is-active" : ""} onClick={() => setLibraryView("models")} type="button">模型库 <span>{models.length}</span></button>
        </nav>
        {libraryView === "layers" ? (
          <>
            <div className="standalone-panel-heading standalone-layer-heading">
              <div><span>SCENE LAYERS</span><strong>画布模型</strong></div>
              <button className="icon-button" onClick={() => setLibraryView("models")} title="添加模型" type="button">＋</button>
            </div>
            <p className="standalone-panel-copy">选择图层会同步选中画布中的模型，并打开对应属性。</p>
            <div className="standalone-layer-tree" ref={layerTreeRef}>
              <article className={inspectorView === "scene" && selectedInstanceId === null ? "is-selected is-scene" : "is-scene"} data-scene-root>
                <button
                  className="standalone-layer-main"
                  onClick={() => {
                    setSelectedInstanceId(null);
                    setInspectorView("scene");
                  }}
                  type="button"
                >
                  <span className="standalone-layer-icon">◇</span>
                  <span><strong>场景</strong><small>背景、灯光与相机</small></span>
                </button>
                <span className="standalone-layer-state">ROOT</span>
              </article>
              {draftScene.instances.map((instance, index) => {
                const asset = models.find((model) => model.id === instance.modelAssetId);
                return (
                  <article className={`${selectedInstanceId === instance.id ? "is-selected" : ""}${instance.visible ? "" : " is-hidden"}`} data-instance-id={instance.id} key={instance.id}>
                    <span className="standalone-layer-branch" aria-hidden="true">└</span>
                    <button
                      className="standalone-layer-main"
                      onClick={() => {
                        setSelectedInstanceId(instance.id);
                        setInspectorView("model");
                      }}
                      type="button"
                    >
                      <span className="standalone-layer-icon">▧</span>
                      <span><strong>{instance.label}</strong><small>{asset ? modelName(asset) : instance.modelAssetId} · #{index + 1}</small></span>
                    </button>
                    <button
                      aria-label={`${instance.visible ? "隐藏" : "显示"}${instance.label}`}
                      aria-pressed={instance.visible}
                      className="standalone-layer-visibility"
                      disabled={!editable}
                      onClick={() => updateInstance(instance.id, { visible: !instance.visible })}
                      title={instance.visible ? "隐藏图层" : "显示图层"}
                      type="button"
                    >{instance.visible ? "◉" : "○"}</button>
                  </article>
                );
              })}
            </div>
            {draftScene.instances.length === 0 ? <p className="standalone-layer-empty">画布中还没有模型。打开“模型库”加入第一个模型。</p> : null}
          </>
        ) : (
          <>
            <div className="standalone-panel-heading standalone-layer-heading">
              <div><span>MODEL LIBRARY</span><strong>模型积木</strong></div>
              <label className={`secondary-button compact-button${uploading ? " is-disabled" : ""}`}>
                {uploading ? "上传中…" : "上传模型"}
                <input accept=".glb,.gltf,model/gltf-binary,model/gltf+json" disabled={uploading || !editable} onChange={(event) => void upload(event)} type="file" />
              </label>
            </div>
            <p className="standalone-panel-copy">点击缩略图查看模型，点击 ＋ 加入场景。</p>
            <div className="standalone-model-list">
              {models.map((asset) => (
                <article key={asset.id}>
                  <ModelAssetThumbnail asset={asset} name={modelName(asset)} onPreview={() => setPreviewModel(asset)} />
                  <div><strong title={modelName(asset)}>{modelName(asset)}</strong><span>{modelSourceText(asset.source)} · {formatFileSize(asset.byteSize)}</span></div>
                  <button aria-label={`加入场景 ${modelName(asset)}`} className="icon-button" disabled={!editable || draftScene.instances.length >= limits.maximumInstances} onClick={() => addModel(asset)} title="加入场景" type="button">＋</button>
                </article>
              ))}
            </div>
          </>
        )}
      </aside>

      <section className="standalone-3d-stage">
        {sceneView}
        {editable ? (
          <div
            aria-label="模型变换工具"
            className="standalone-transform-tools"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            role="toolbar"
          >
            <div className="standalone-transform-actions">
              <button
                aria-pressed={instanceTransformMode === "translate"}
                className={instanceTransformMode === "translate" ? "is-active" : ""}
                onClick={() => setInstanceTransformMode("translate")}
                title="移动模型（快捷键 W）"
                type="button"
              >移动 <kbd>W</kbd></button>
              <button
                aria-pressed={instanceTransformMode === "scale"}
                className={instanceTransformMode === "scale" ? "is-active" : ""}
                onClick={() => setInstanceTransformMode("scale")}
                title="缩放模型（快捷键 R）"
                type="button"
              >缩放 <kbd>R</kbd></button>
            </div>
            <span className="standalone-transform-hint">
              {selectedInstance
                ? instanceTransformMode === "translate"
                  ? "拖动箭头沿单轴移动，拖动色块沿平面移动"
                  : "拖动轴端方块缩放，拖动中心方块等比缩放"
                : "先点击一个模型，再拖动三维操作轴"}
            </span>
            <span className="standalone-axis-legend" aria-hidden="true"><i className="is-x" />X <i className="is-y" />Y <i className="is-z" />Z</span>
          </div>
        ) : null}
        {notice ? <div className="standalone-3d-toast" role="status">{notice}</div> : null}
        {error ? <div className="standalone-3d-toast is-error" role="alert">{error}</div> : null}
      </section>

      <aside className="standalone-3d-inspector">
        <nav aria-label="属性对象" className="standalone-panel-tabs standalone-inspector-tabs">
          <button
            aria-pressed={inspectorView === "model"}
            className={inspectorView === "model" ? "is-active" : ""}
            disabled={!selectedInstance}
            onClick={() => setInspectorView("model")}
            type="button"
          >模型属性</button>
          <button
            aria-pressed={inspectorView === "scene"}
            className={inspectorView === "scene" ? "is-active" : ""}
            onClick={() => {
              setSelectedInstanceId(null);
              setInspectorView("scene");
            }}
            type="button"
          >场景属性</button>
        </nav>

        {inspectorView === "model" && selectedInstance ? (
          <>
            <div className="standalone-inspector-title">
              <div><span>SELECTED MODEL</span><strong>{selectedInstance.label}</strong><small>{selectedModelAsset ? modelName(selectedModelAsset) : selectedInstance.modelAssetId}</small></div>
              <button className="inspector-action-button is-danger" disabled={!editable} onClick={removeSelected} type="button">移除</button>
            </div>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">01</span><div><h3>基础信息</h3><small>名称、用途与业务关联</small></div></header>
              <label><span>图层名称</span><input disabled={!editable} maxLength={80} onChange={(event) => updateInstance(selectedInstance.id, { label: event.target.value })} value={selectedInstance.label} /></label>
              <label><span>模型用途</span><select disabled={!editable} onChange={(event) => updateInstance(selectedInstance.id, { renderMode: event.target.value as StandaloneSceneInstance["renderMode"] })} value={selectedInstance.renderMode}><option value="background">静态背景</option><option value="interactive">交互设备</option></select></label>
              <label><span>绑定业务资产</span><select disabled={!editable || !draftScene.linked2dProjectId || selectedInstance.renderMode === "background"} onChange={(event) => updateInstance(selectedInstance.id, { assetId: event.target.value || null })} value={selectedInstance.assetId ?? ""}><option value="">不绑定</option>{linkedAssets.map((asset) => <option key={asset.id} value={asset.assetId}>{asset.name} · {asset.assetId}</option>)}</select></label>
              <label className="standalone-checkbox"><input checked={selectedInstance.visible} disabled={!editable} onChange={(event) => updateInstance(selectedInstance.id, { visible: event.target.checked })} type="checkbox" /> 在场景中显示</label>
            </section>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">02</span><div><h3>变换</h3><small>移动、旋转与三轴尺寸</small></div></header>
              <div className="standalone-property-actions">
                <div className="standalone-segmented-control">
                  <button aria-pressed={instanceTransformMode === "translate"} className={instanceTransformMode === "translate" ? "is-active" : ""} disabled={!editable} onClick={() => setInstanceTransformMode("translate")} type="button">移动 W</button>
                  <button aria-pressed={instanceTransformMode === "scale"} className={instanceTransformMode === "scale" ? "is-active" : ""} disabled={!editable} onClick={() => setInstanceTransformMode("scale")} type="button">缩放 R</button>
                </div>
                <button className="inspector-action-button" disabled={!editable} onClick={() => updateInstance(selectedInstance.id, { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } })} type="button">重置</button>
              </div>
              {(["position", "rotation", "scale"] as const).map((field) => (
                <fieldset key={field}>
                  <legend>{field === "position" ? "位置" : field === "rotation" ? "旋转（度）" : "尺寸比例"}</legend>
                  <div className="standalone-vector-inputs">{axisLabels.map((axis, index) => <label key={axis}><span>{axis}</span><input aria-label={`${field === "position" ? "位置" : field === "rotation" ? "旋转（度）" : "尺寸比例"} ${axis}`} disabled={!editable} min={field === "scale" ? 0.001 : undefined} onChange={(event) => updateVector(selectedInstance, field, index as 0 | 1 | 2, Number(event.target.value))} step={field === "rotation" ? 1 : 0.1} type="number" value={selectedInstance.transform[field][index]} /></label>)}</div>
                </fieldset>
              ))}
            </section>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">03</span><div><h3>外观</h3><small>实例颜色与透明度</small></div></header>
              <label className="standalone-checkbox"><input checked={selectedAppearance.color !== null} disabled={!editable} onChange={(event) => updateInstance(selectedInstance.id, { appearance: { ...selectedAppearance, color: event.target.checked ? "#3aa8c8" : null } })} type="checkbox" /> 使用自定义颜色</label>
              {selectedAppearance.color === null ? (
                <div className="standalone-readonly-field"><span>模型颜色</span><span className="inspector-readonly-value">原始材质</span></div>
              ) : (
                <label><span>模型颜色</span><span className="standalone-color-input"><input disabled={!editable} onChange={(event) => updateInstance(selectedInstance.id, { appearance: { ...selectedAppearance, color: event.target.value } })} type="color" value={selectedAppearance.color} /><code>{selectedAppearance.color.toUpperCase()}</code></span></label>
              )}
              <label><span>透明度 <output>{Math.round(selectedAppearance.opacity * 100)}%</output></span><input disabled={!editable} max="1" min="0" onChange={(event) => updateInstance(selectedInstance.id, { appearance: { ...selectedAppearance, opacity: Number(event.target.value) } })} step="0.01" type="range" value={selectedAppearance.opacity} /></label>
              <button className="secondary-button compact-button standalone-reset-button" disabled={!editable || (selectedAppearance.color === null && selectedAppearance.opacity === 1)} onClick={() => updateInstance(selectedInstance.id, { appearance: defaultStandaloneSceneInstanceAppearance() })} type="button">恢复原始外观</button>
            </section>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">04</span><div><h3>动画</h3><small>单模型播放状态与速度</small></div></header>
              {(selectedModelAsset?.inspection.animationCount ?? 0) > 0 ? (
                <>
                  <label className="standalone-checkbox"><input checked={selectedAnimation.enabled} disabled={!editable} onChange={(event) => updateInstanceAnimation(selectedInstance, { enabled: event.target.checked })} type="checkbox" /> 播放该模型动画</label>
                  <label><span>实例速度 <output>{selectedAnimation.speed.toFixed(2)}×</output></span><input disabled={!editable || !selectedAnimation.enabled} max="3" min="0.1" onChange={(event) => updateInstanceAnimation(selectedInstance, { speed: Number(event.target.value) })} step="0.05" type="range" value={selectedAnimation.speed} /></label>
                  {!draftScene.settings.playAnimations ? <p className="standalone-property-note">场景总动画当前已关闭；可在“场景属性 → 动态”中开启。</p> : null}
                </>
              ) : <p className="standalone-property-note">这个模型资源没有内嵌动画轨道。</p>}
            </section>
            <section className="standalone-property-group">
              <header><span aria-hidden="true">05</span><div><h3>交互事件</h3><small>在预览中点击模型时执行</small></div></header>
              {selectedInstance.renderMode === "background" ? <p className="standalone-property-note">将“模型用途”设为“交互设备”后可配置点击动作。</p> : null}
              {selectedInstance.clickActions === undefined && selectedInstance.assetId ? <p className="standalone-property-note">尚未自定义动作，点击时默认显示绑定设备。添加动作后以此处配置为准。</p> : null}
              <TwinActionEditor actions={selectedInstance.clickActions ?? []} onChange={(clickActions) => updateInstance(selectedInstance.id, { clickActions })}
                disabled={!editable || selectedInstance.renderMode === "background"} canvasDocument={linkedCanvas} assets={linkedAssets}
                scenes={[{ projectId, name: projectName, instances: draftScene.instances }]}
                loading={linkedAssetsLoading || linkedCanvasLoading} error={linkedCanvasError ?? linkedAssetLoadError} />
              {selectedInstance.clickActions === undefined && selectedInstance.assetId ? <button className="inspector-action-button" disabled={!editable} onClick={() => updateInstance(selectedInstance.id, { clickActions: [] })} type="button">关闭默认点击动作</button> : null}
              {draftScene.linked2dProjectId ? <a className="secondary-button compact-button" href={canvasRoutePath(draftScene.linked2dProjectId, "canvas")} target="_blank" rel="noreferrer">编辑关联 2D 面板 ↗</a> : null}
            </section>
          </>
        ) : (
          <>
            <div className="standalone-inspector-title">
              <div><span>SCENE SETTINGS</span><strong>场景属性</strong><small>影响整个 3D 画布</small></div>
            </div>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">01</span><div><h3>项目关联</h3><small>连接 2D 数据看板</small></div></header>
              <label><span>关联 2D 项目</span><select disabled={!editable} onChange={(event) => setDraftScene({ ...draftScene, linked2dProjectId: event.target.value || null })} value={draftScene.linked2dProjectId ?? ""}><option value="">暂不关联</option>{projects.filter((project) => project.projectType === "2d").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              {draftScene.linked2dProjectId ? <><p className="standalone-property-note">预览会透明叠加该项目已保存的 2D 组件，保留按钮与面板交互；不重复加载其中的 3D 视窗。两边分别保存。</p><a className="secondary-button compact-button" href={canvasRoutePath(draftScene.linked2dProjectId, "canvas")} target="_blank" rel="noreferrer">编辑关联 2D 面板 ↗</a></> : null}
              {linkedCanvasError ?? linkedAssetLoadError ? <p className="error-text" role="alert">{linkedCanvasError ?? linkedAssetLoadError}</p> : null}
            </section>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">02</span><div><h3>背景</h3><small>画布底色与地面辅助线</small></div></header>
              <label><span>背景颜色</span><span className="standalone-color-input"><input disabled={!editable} onChange={(event) => updateSettings("backgroundColor", event.target.value)} type="color" value={draftScene.settings.backgroundColor} /><code>{draftScene.settings.backgroundColor.toUpperCase()}</code></span></label>
              <label><span>背景不透明度 <output>{Math.round(draftScene.settings.backgroundOpacity * 100)}%</output></span><input disabled={!editable} max="1" min="0" onChange={(event) => updateSettings("backgroundOpacity", Number(event.target.value))} step="0.01" type="range" value={draftScene.settings.backgroundOpacity} /></label>
              <label className="standalone-checkbox"><input checked={draftScene.settings.showGrid} disabled={!editable} onChange={(event) => updateSettings("showGrid", event.target.checked)} type="checkbox" /> 显示地面网格</label>
            </section>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">03</span><div><h3>灯光</h3><small>环境补光与主方向光</small></div></header>
              <div className="standalone-two-column-fields">
                <label><span>环境光颜色</span><span className="standalone-color-input"><input disabled={!editable} onChange={(event) => updateSettings("environmentLightColor", event.target.value)} type="color" value={draftScene.settings.environmentLightColor} /><code>{draftScene.settings.environmentLightColor.toUpperCase()}</code></span></label>
                <label><span>主光颜色</span><span className="standalone-color-input"><input disabled={!editable} onChange={(event) => updateSettings("keyLightColor", event.target.value)} type="color" value={draftScene.settings.keyLightColor} /><code>{draftScene.settings.keyLightColor.toUpperCase()}</code></span></label>
              </div>
              <label><span>环境光强度 <output>{draftScene.settings.environmentLightIntensity.toFixed(1)}</output></span><input disabled={!editable} max="10" min="0" onChange={(event) => updateSettings("environmentLightIntensity", Number(event.target.value))} step="0.1" type="range" value={draftScene.settings.environmentLightIntensity} /></label>
              <label><span>主光强度 <output>{draftScene.settings.keyLightIntensity.toFixed(1)}</output></span><input disabled={!editable} max="10" min="0" onChange={(event) => updateSettings("keyLightIntensity", Number(event.target.value))} step="0.1" type="range" value={draftScene.settings.keyLightIntensity} /></label>
            </section>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">04</span><div><h3>相机</h3><small>初始观察方向与视野</small></div></header>
              <label className="standalone-checkbox"><input checked={draftScene.settings.preventBottomView} disabled={!editable} onChange={(event) => updateSettings("preventBottomView", event.target.checked)} type="checkbox" /> 禁止从底部查看</label>
              <p className="standalone-property-note">限制向下旋转，避免看到建筑或模型底部；取消勾选可自由查看。</p>
              <label><span>初始视角</span><select disabled={!editable} onChange={(event) => updateSettings("cameraView", event.target.value as StandaloneSceneSettings["cameraView"])} value={draftScene.settings.cameraView}><option value="isometric">右前等轴</option><option value="isometric-left">左前等轴</option><option value="front">正视</option><option value="top">俯视</option></select></label>
              <label><span>视野角度 <output>{draftScene.settings.cameraFov.toFixed(0)}°</output></span><input disabled={!editable} max="90" min="15" onChange={(event) => updateSettings("cameraFov", Number(event.target.value))} step="1" type="range" value={draftScene.settings.cameraFov} /></label>
              <label><span>初始镜头比例 <output>{draftScene.settings.modelScale.toFixed(2)}×</output></span><input disabled={!editable} max="4" min="0.25" onChange={(event) => updateSettings("modelScale", Number(event.target.value))} step="0.05" type="range" value={draftScene.settings.modelScale} /></label>
            </section>

            <section className="standalone-property-group">
              <header><span aria-hidden="true">05</span><div><h3>动态</h3><small>整场动画与自动旋转</small></div></header>
              <label className="standalone-checkbox"><input checked={draftScene.settings.playAnimations} disabled={!editable} onChange={(event) => updateSettings("playAnimations", event.target.checked)} type="checkbox" /> 播放已启用的模型动画</label>
              <label><span>全局动画速度 <output>{draftScene.settings.animationSpeed.toFixed(2)}×</output></span><input disabled={!editable || !draftScene.settings.playAnimations} max="3" min="0.1" onChange={(event) => updateSettings("animationSpeed", Number(event.target.value))} step="0.05" type="range" value={draftScene.settings.animationSpeed} /></label>
              <label className="standalone-checkbox"><input checked={draftScene.settings.autoRotate} disabled={!editable} onChange={(event) => updateSettings("autoRotate", event.target.checked)} type="checkbox" /> 自动旋转整个场景</label>
              <label><span>旋转速度 <output>{draftScene.settings.rotationSpeed.toFixed(2)}</output></span><input disabled={!editable || !draftScene.settings.autoRotate} max="5" min="0" onChange={(event) => updateSettings("rotationSpeed", Number(event.target.value))} step="0.05" type="range" value={draftScene.settings.rotationSpeed} /></label>
            </section>
          </>
        )}
      </aside>
      {previewModel ? <ModelAssetPreviewDialog asset={previewModel} key={previewModel.id} name={modelName(previewModel)} onClose={() => setPreviewModel(null)} projectId={projectId} /> : null}
    </main>
  );
}
