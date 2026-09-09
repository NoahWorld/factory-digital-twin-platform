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
  standaloneScenePath,
  standaloneSceneRoutePath,
  type ProjectType,
  type StandaloneSceneDocument,
  type StandaloneSceneInstance,
  type StandaloneSceneSettings,
  type TwinInteractionEvent,
} from "../../../../shared/standalone-3d";
import { errorMessage, request } from "../api";
import { findBuiltinModel, latestBuiltinModel } from "../../../../shared/builtin-models";
import { workshopInstances, workshopSettings } from "../../../../shared/workshop-layout";
import { projectAssetsPath, type ProjectAsset, type ProjectAssetListResponse } from "../canvas/assets";
import { Model3DNode } from "../canvas/Model3DNode";
import {
  formatFileSize,
  modelAssetsPath,
  type ModelAsset,
  type ModelAssetListResponse,
  type ModelAssetUploadResponse,
} from "../canvas/model-assets";
import {
  createCanvasNode,
  type CanvasNode,
  type Model3DProps,
  type ModelAssetInstance,
  type ModelNodeTransform,
  type Vector3Tuple,
} from "../canvas/types";
import type { InstanceTransformMode } from "../scene/instance-transform";

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

const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const axisLabels = ["X", "Y", "Z"] as const;
const ignoreSceneNodeSelection = () => undefined;

const modelName = (asset: ModelAsset): string => {
  const name = findBuiltinModel(asset.id)?.name ?? asset.originalFilename;
  return latestBuiltinModel(asset.id)?.id !== asset.id && findBuiltinModel(asset.id) ? `${name}（旧版）` : name;
};

const modelSourceText = (source: ModelAsset["source"]): string =>
  source === "system" ? "系统模型" : source === "scene-background" ? "背景模型" : "上传模型";

const publishTwinInteraction = (projectId: string, targetProjectId: string, assetId: string) => {
  const event: TwinInteractionEvent = {
    assetId,
    correlationId: crypto.randomUUID(),
    originProjectId: projectId,
    targetProjectId,
    timestamp: new Date().toISOString(),
    type: "asset-selected",
  };
  window.dispatchEvent(new CustomEvent("factory-twin:interaction", { detail: event }));
  try {
    const channel = new BroadcastChannel("factory-twin:interaction");
    channel.postMessage(event);
    channel.close();
  } catch (reason) {
    console.error("Failed to broadcast the 3D asset selection to another tab.", {
      assetId,
      projectId,
      reason,
    });
  }
};

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
  const baseNodeRef = useRef<CanvasNode | null>(null);
  if (baseNodeRef.current === null) {
    baseNodeRef.current = {
      ...createCanvasNode("model-3d", 0, 0, 0),
      id: "standalone-3d-scene-root",
    };
  }

  const [projectName, setProjectName] = useState("");
  const [savedScene, setSavedScene] = useState<StandaloneSceneDocument | null>(null);
  const [draftScene, setDraftScene] = useState<StandaloneSceneDocument | null>(null);
  const [editable, setEditable] = useState(false);
  const [limits, setLimits] = useState<typeof STANDALONE_3D_LIMITS>(STANDALONE_3D_LIMITS);
  const [models, setModels] = useState<ModelAsset[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [linkedAssets, setLinkedAssets] = useState<ProjectAsset[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [instanceTransformMode, setInstanceTransformMode] = useState<InstanceTransformMode>("translate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draftSceneRef = useRef<StandaloneSceneDocument | null>(null);

  useEffect(() => {
    draftSceneRef.current = draftScene;
  }, [draftScene]);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
    const linkedProjectId = draftScene?.linked2dProjectId;
    if (!linkedProjectId) return () => { active = false; };
    void request<ProjectAssetListResponse>(projectAssetsPath(linkedProjectId))
      .then((result) => {
        if (active) setLinkedAssets(result.assets);
      })
      .catch((reason) => {
        if (active) setError(`关联 2D 项目的资产加载失败：${errorMessage(reason)}`);
      });
    return () => { active = false; };
  }, [draftScene?.linked2dProjectId]);

  useEffect(() => {
    setSelectedInstanceId(null);
    setNotice(null);
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit") return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.key.toLowerCase() === "w") setInstanceTransformMode("translate");
      if (event.key.toLowerCase() === "r") setInstanceTransformMode("scale");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [mode]);

  const dirty = savedScene !== null && draftScene !== null && !sameJson(savedScene, draftScene);
  const selectedInstance = draftScene?.instances.find((item) => item.id === selectedInstanceId) ?? null;
  const selectedAsset = selectedInstance?.assetId
    ? linkedAssets.find((asset) => asset.assetId === selectedInstance.assetId) ?? null
    : null;
  const scenePerformance = useMemo(
    () => measureScenePerformance(draftScene?.instances ?? [], models),
    [draftScene?.instances, models],
  );

  const rendererNode = useMemo((): CanvasNode | null => {
    if (!draftScene || !baseNodeRef.current) return null;
    const baseProps = baseNodeRef.current.props as Model3DProps;
    const instances: ModelAssetInstance[] = draftScene.instances.map((instance) => ({
      assetId: instance.modelAssetId,
      id: instance.id,
      label: instance.label,
      transform: instance.transform,
      visible: instance.visible,
    }));
    return {
      ...baseNodeRef.current,
      props: {
        ...baseProps,
        ...draftScene.settings,
        autoRotate: draftScene.settings.autoRotate,
        modelInstances: instances,
        presentation: { ...baseProps.presentation, lighting: "studio" },
        showControlPanel: false,
      } satisfies Model3DProps,
      resourceRefs: [...new Set(instances.map((instance) => instance.assetId))],
    };
  }, [draftScene]);

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
    setNotice(null);
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
    if (mode !== "preview" || !instanceId) return;
    const instance = draftScene?.instances.find((item) => item.id === instanceId);
    if (!instance?.assetId || !draftScene?.linked2dProjectId) {
      setNotice("该模型实例尚未绑定关联 2D 项目的业务资产。");
      return;
    }
    publishTwinInteraction(projectId, draftScene.linked2dProjectId, instance.assetId);
    setNotice(`已发送资产 ${instance.assetId} 的联动事件。`);
  }, [draftScene?.instances, draftScene?.linked2dProjectId, mode, projectId]);

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
      node={rendererNode}
      onModelInstanceSelect={selectModelInstance}
      onModelInstanceTransform={commitInstanceTransform}
      onSceneNodeSelect={ignoreSceneNodeSelection}
      projectId={projectId}
      runtimeControlsEnabled={false}
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
          <a className="primary-button compact-button" href={standaloneSceneRoutePath(projectId, "edit")}>编辑场景</a>
        </header>
        <section className="standalone-3d-preview-stage">{sceneView}</section>
        {notice ? <div className="standalone-3d-toast" role="status">{notice}</div> : null}
        {selectedAsset && draftScene.linked2dProjectId ? (
          <aside className="standalone-3d-asset-card">
            <span>已选择业务资产</span>
            <strong>{selectedAsset.name}</strong>
            <small>{selectedAsset.assetId} · {selectedAsset.assetType}</small>
            <a
              className="primary-button compact-button"
              href={`#/projects/${encodeURIComponent(draftScene.linked2dProjectId)}/preview?asset=${encodeURIComponent(selectedAsset.assetId)}`}
            >打开关联 2D 看板</a>
          </aside>
        ) : null}
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
        <div className="standalone-panel-heading">
          <div><span>资源库</span><strong>模型积木</strong></div>
          <label className={`secondary-button compact-button${uploading ? " is-disabled" : ""}`}>
            {uploading ? "上传中…" : "上传模型"}
            <input accept=".glb,.gltf,model/gltf-binary,model/gltf+json" disabled={uploading || !editable} onChange={(event) => void upload(event)} type="file" />
          </label>
        </div>
        <p className="standalone-panel-copy">同一个资源可以复用多次；渲染器只下载和解析一份。</p>
        <div className="standalone-model-list">
          {models.map((asset) => (
            <article key={asset.id}>
              <div><strong>{modelName(asset)}</strong><span>{modelSourceText(asset.source)} · {formatFileSize(asset.byteSize)}</span></div>
              <button className="icon-button" disabled={!editable || draftScene.instances.length >= limits.maximumInstances} onClick={() => addModel(asset)} title="加入场景" type="button">＋</button>
            </article>
          ))}
        </div>
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
        {draftScene.instances.length === 0 ? <div className="standalone-3d-empty"><strong>从左侧加入第一个模型</strong><span>模型会自动排列，随后可在右侧精确调整。</span>{editable && savedScene?.instances.length === 0 ? <button className="primary-button compact-button" style={{ pointerEvents: "auto", marginTop: 12 }} onClick={() => assembleWorkshop()} type="button">搭建示例车间</button> : null}</div> : null}
        {notice ? <div className="standalone-3d-toast" role="status">{notice}</div> : null}
        {error ? <div className="standalone-3d-toast is-error" role="alert">{error}</div> : null}
      </section>

      <aside className="standalone-3d-inspector">
        <section>
          <div className="standalone-panel-heading"><div><span>场景</span><strong>全局设置</strong></div></div>
          <label><span>关联 2D 项目</span><select disabled={!editable} onChange={(event) => setDraftScene({ ...draftScene, linked2dProjectId: event.target.value || null })} value={draftScene.linked2dProjectId ?? ""}><option value="">暂不关联</option>{projects.filter((project) => project.projectType === "2d").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <div className="standalone-toggle-row">
            <label><input checked={draftScene.settings.playAnimations} disabled={!editable} onChange={(event) => updateSettings("playAnimations", event.target.checked)} type="checkbox" /> 播放模型动画</label>
            <label><input checked={draftScene.settings.showGrid} disabled={!editable} onChange={(event) => updateSettings("showGrid", event.target.checked)} type="checkbox" /> 显示地面网格</label>
          </div>
          <label><span>整体显示比例 {draftScene.settings.modelScale.toFixed(2)}</span><input disabled={!editable} max="4" min="0.25" onChange={(event) => updateSettings("modelScale", Number(event.target.value))} step="0.05" type="range" value={draftScene.settings.modelScale} /></label>
        </section>

        <section>
          <div className="standalone-panel-heading"><div><span>实例</span><strong>{selectedInstance?.label ?? "尚未选择"}</strong></div>{selectedInstance ? <button className="text-button danger-text" disabled={!editable} onClick={removeSelected} type="button">移除</button> : null}</div>
          {selectedInstance ? (
            <>
              <label><span>名称</span><input disabled={!editable} maxLength={80} onChange={(event) => updateInstance(selectedInstance.id, { label: event.target.value })} value={selectedInstance.label} /></label>
              <label><span>用途</span><select disabled={!editable} onChange={(event) => updateInstance(selectedInstance.id, { renderMode: event.target.value as StandaloneSceneInstance["renderMode"] })} value={selectedInstance.renderMode}><option value="background">静态背景</option><option value="interactive">交互设备</option></select></label>
              <label><span>绑定业务资产</span><select disabled={!editable || !draftScene.linked2dProjectId || selectedInstance.renderMode === "background"} onChange={(event) => updateInstance(selectedInstance.id, { assetId: event.target.value || null })} value={selectedInstance.assetId ?? ""}><option value="">不绑定</option>{linkedAssets.map((asset) => <option key={asset.id} value={asset.assetId}>{asset.name} · {asset.assetId}</option>)}</select></label>
              <label className="standalone-checkbox"><input checked={selectedInstance.visible} disabled={!editable} onChange={(event) => updateInstance(selectedInstance.id, { visible: event.target.checked })} type="checkbox" /> 在场景中显示</label>
              {(["position", "rotation", "scale"] as const).map((field) => (
                <fieldset key={field}><legend>{field === "position" ? "位置" : field === "rotation" ? "旋转（度）" : "缩放"}</legend><div className="standalone-vector-inputs">{axisLabels.map((axis, index) => <label key={axis}><span>{axis}</span><input disabled={!editable} min={field === "scale" ? 0.001 : undefined} onChange={(event) => updateVector(selectedInstance, field, index as 0 | 1 | 2, Number(event.target.value))} step={field === "rotation" ? 1 : 0.1} type="number" value={selectedInstance.transform[field][index]} /></label>)}</div></fieldset>
              ))}
            </>
          ) : <p className="standalone-panel-copy">点击场景中的模型，或从左侧加入一个模型。</p>}
        </section>
      </aside>
    </main>
  );
}
