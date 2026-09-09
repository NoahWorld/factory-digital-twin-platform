import { builtinModels, findBuiltinModel } from "../../../../shared/builtin-models";
import { ModelPresentationPanel } from "./ModelPresentationPanel";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import { errorMessage, request } from "../api";
import {
  projectAssetPath,
  projectAssetsPath,
  type ProjectAsset,
  type ProjectAssetListResponse,
  type ProjectAssetResponse,
} from "./assets";
import { AssetDataBindingSection } from "./AssetDataBindingSection";
import {
  formatFileSize,
  modelAssetsPath,
  type ModelAsset,
  type ModelAssetListResponse,
  type ModelAssetUploadResponse,
} from "./model-assets";
import {
  findModelSceneNode,
  type ModelSceneNode,
  type ModelSceneSnapshot,
} from "./model-scene";
import {
  MAX_MODEL_INSTANCES,
  componentLabels,
  identityModelTransform,
  parseModel3DProps,
  resolveModelInstances,
  type CanvasNode,
  type ModelAssetInstance,
  type Model3DProps,
  type ModelNodeAppearance,
  type ModelNodeTransform,
  type Vector3Tuple,
} from "./types";

type Model3DInspectorProps = {
  editable: boolean;
  modelScene: ModelSceneSnapshot | null;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onSceneNodeSelect: (path: string | null) => void;
  onValidationChange: (message: string | null) => void;
  projectId: string;
  selectedSceneNodePath: string | null;
};

const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const MAX_VISIBLE_TREE_ROWS = 400;

type SceneTreeRow = {
  depth: number;
  node: ModelSceneNode;
};

type AssetBindingDraft = {
  assetId: string;
  name: string;
  assetType: string;
};

const newAssetBindingDraft = (modelNode: string): AssetBindingDraft => ({
  assetId: "",
  name: modelNode,
  assetType: "equipment",
});

const nodeLabel = (node: ModelSceneNode): string =>
  node.label || node.name || `未命名 ${node.objectType}`;

const filterTree = (
  nodes: ModelSceneNode[],
  normalizedQuery: string,
): ModelSceneNode[] =>
  nodes.flatMap((node) => {
    const children = filterTree(node.children, normalizedQuery);
    const matches = `${node.name} ${node.label} ${node.objectType}`.toLocaleLowerCase().includes(normalizedQuery);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });

const flattenTree = (
  nodes: ModelSceneNode[],
  expandedPaths: Set<string>,
  expandAll: boolean,
  depth = 0,
  rows: SceneTreeRow[] = [],
): SceneTreeRow[] => {
  for (const node of nodes) {
    if (rows.length >= MAX_VISIBLE_TREE_ROWS) break;
    rows.push({ depth, node });
    if (node.children.length > 0 && (expandAll || expandedPaths.has(node.path))) {
      flattenTree(node.children, expandedPaths, expandAll, depth + 1, rows);
    }
  }
  return rows;
};

export function Model3DInspector({
  editable,
  modelScene,
  node,
  onNodeChange,
  onSceneNodeSelect,
  onValidationChange,
  projectId,
  selectedSceneNodePath,
}: Model3DInspectorProps) {
  const parsed = parseModel3DProps(node.props);
  const [modelAssets, setModelAssets] = useState<ModelAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const [loadingProjectAssets, setLoadingProjectAssets] = useState(true);
  const [projectAssetLoadError, setProjectAssetLoadError] = useState<string | null>(null);
  const [assetBindingError, setAssetBindingError] = useState<string | null>(null);
  const [assetBindingNotice, setAssetBindingNotice] = useState<string | null>(null);
  const [savingAssetBinding, setSavingAssetBinding] = useState(false);
  const [assetBindingChoice, setAssetBindingChoice] = useState("new");
  const [assetBindingDraft, setAssetBindingDraft] = useState<AssetBindingDraft>(
    () => newAssetBindingDraft(""),
  );
  const [sceneSearch, setSceneSearch] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAssetId = node.resourceRefs[0] ?? "";
  const selectedModelAsset = useMemo(
    () => modelAssets.find((asset) => asset.id === selectedAssetId) ?? null,
    [modelAssets, selectedAssetId],
  );
  const embeddedAnimationCount = selectedModelAsset?.inspection.animationCount ?? 0;
  const activeScene = modelScene?.assetId === selectedAssetId ? modelScene : null;
  const normalizedSceneSearch = sceneSearch.trim().toLocaleLowerCase();
  const visibleSceneTree = useMemo(
    () => normalizedSceneSearch && activeScene
      ? filterTree(activeScene.roots, normalizedSceneSearch)
      : activeScene?.roots ?? [],
    [activeScene, normalizedSceneSearch],
  );
  const visibleSceneRows = useMemo(
    () => flattenTree(
      visibleSceneTree,
      expandedPaths,
      normalizedSceneSearch.length > 0,
    ),
    [expandedPaths, normalizedSceneSearch, visibleSceneTree],
  );
  const selectedSceneNode = useMemo(
    () => findModelSceneNode(activeScene?.roots ?? [], selectedSceneNodePath),
    [activeScene, selectedSceneNodePath],
  );
  const selectedModelNodeName = selectedSceneNode?.name ?? "";
  const selectedNameIsDuplicate = selectedModelNodeName.length > 0
    && selectedModelAsset?.inspection.duplicateNodeNames.includes(selectedModelNodeName) === true;
  const boundProjectAsset = useMemo(
    () => projectAssets.find((asset) => asset.modelNode === selectedModelNodeName) ?? null,
    [projectAssets, selectedModelNodeName],
  );
  const unboundProjectAssets = useMemo(
    () => projectAssets.filter((asset) => asset.modelNode === null),
    [projectAssets],
  );

  useEffect(() => {
    onValidationChange(parsed.ok ? null : parsed.message);
    return () => onValidationChange(null);
  }, [onValidationChange, parsed.ok ? null : parsed.message]);

  useEffect(() => {
    let active = true;
    setLoadingAssets(true);
    setAssetError(null);
    void request<ModelAssetListResponse>(modelAssetsPath(projectId))
      .then((result) => {
        if (active) setModelAssets(result.modelAssets);
      })
      .catch((reason) => {
        if (active) setAssetError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoadingAssets(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setLoadingProjectAssets(true);
    setProjectAssetLoadError(null);
    void request<ProjectAssetListResponse>(projectAssetsPath(projectId))
      .then((result) => {
        if (active) setProjectAssets(result.assets);
      })
      .catch((reason) => {
        if (active) setProjectAssetLoadError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoadingProjectAssets(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    setSceneSearch("");
    setExpandedPaths(new Set(activeScene?.roots.map((root) => root.path) ?? []));
    onSceneNodeSelect(null);
  }, [activeScene?.assetId, onSceneNodeSelect]);

  useEffect(() => {
    if (selectedSceneNodePath !== null && activeScene && selectedSceneNode === null) {
      onSceneNodeSelect(null);
    }
  }, [activeScene, onSceneNodeSelect, selectedSceneNode, selectedSceneNodePath]);

  useEffect(() => {
    setAssetBindingError(null);
    setAssetBindingNotice(null);
  }, [selectedModelNodeName]);

  useEffect(() => {
    if (boundProjectAsset) {
      setAssetBindingChoice(boundProjectAsset.id);
      setAssetBindingDraft({
        assetId: boundProjectAsset.assetId,
        name: boundProjectAsset.name,
        assetType: boundProjectAsset.assetType,
      });
      return;
    }
    setAssetBindingChoice("new");
    setAssetBindingDraft(newAssetBindingDraft(selectedModelNodeName));
  }, [
    boundProjectAsset?.assetId,
    boundProjectAsset?.assetType,
    boundProjectAsset?.id,
    boundProjectAsset?.name,
    selectedModelNodeName,
  ]);

  if (!parsed.ok) {
    return <section className="component-inspector"><div className="inspector-empty is-error"><strong>3D 组件配置无效</strong><p>{parsed.message}</p></div></section>;
  }

  const updateProps = (patch: Partial<Model3DProps>) => {
    onNodeChange({ ...node, props: { ...parsed.value, ...patch } });
  };

  const modelInstances = resolveModelInstances(
    node.resourceRefs,
    parsed.value.modelInstances,
  );

  const modelAssetLabel = (assetId: string): string => {
    const asset = modelAssets.find((candidate) => candidate.id === assetId);
    return findBuiltinModel(assetId)?.name ?? asset?.originalFilename ?? assetId;
  };

  const modelViewDefaults = (assetId: string) => {
    const builtin = findBuiltinModel(assetId);
    const asset = modelAssets.find((candidate) => candidate.id === assetId);
    return {
      autoRotate: asset?.source === "scene-background" ? false : true,
      cameraView: asset?.source === "scene-background" ? "front" as const : "isometric" as const,
      modelScale: asset?.source === "scene-background" ? 2.2 : 1,
      showGrid: asset?.source === "scene-background" ? false : true,
      ...(builtin?.defaults ?? {}),
    };
  };

  const saveModelInstances = (nextInstances: ModelAssetInstance[]) => {
    const nextResourceRefs = [...new Set(nextInstances.map((instance) => instance.assetId))];
    const nextPrimaryAssetId = nextInstances[0]?.assetId ?? "";
    const primaryChanged = nextPrimaryAssetId !== selectedAssetId;
    if (primaryChanged) onSceneNodeSelect(null);

    const nextProps: Model3DProps = primaryChanged
      ? {
          ...parsed.value,
          appearanceOverrides: {},
          transformOverrides: {},
          presentation: {
            lighting: "standard",
            shellMode: "original",
            showFlow: true,
            explosion: 0,
          },
          ...modelViewDefaults(nextPrimaryAssetId),
          modelInstances: nextInstances,
        }
      : { ...parsed.value, modelInstances: nextInstances };

    onNodeChange({
      ...node,
      props: nextProps,
      resourceRefs: nextResourceRefs,
    });
  };

  const addModelInstance = (assetId: string, preferredLabel?: string) => {
    if (!assetId) return;
    if (modelInstances.length >= MAX_MODEL_INSTANCES) {
      setAssetError(`单个 3D 场景最多支持 ${MAX_MODEL_INSTANCES} 个模型实例。`);
      return;
    }
    const instanceNumber = modelInstances.length + 1;
    saveModelInstances([
      ...modelInstances,
      {
        id: `model-${crypto.randomUUID()}`,
        assetId,
        label: `${preferredLabel ?? modelAssetLabel(assetId)} ${instanceNumber}`,
        transform: {
          ...identityModelTransform(),
          position: [(instanceNumber - 1) * 2.5, 0, 0],
        },
        visible: true,
      },
    ]);
    setAssetError(null);
  };

  const updateModelInstance = (
    instanceId: string,
    patch: Partial<ModelAssetInstance>,
  ) => {
    saveModelInstances(modelInstances.map((instance) =>
      instance.id === instanceId ? { ...instance, ...patch } : instance));
  };

  const updateModelInstanceTransform = (
    instance: ModelAssetInstance,
    field: keyof ModelNodeTransform,
    axis: 0 | 1 | 2,
    rawValue: string,
  ) => {
    if (rawValue.trim() === "") return;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || (field === "scale" && value < 0.001)) return;
    const values = [...instance.transform[field]] as Vector3Tuple;
    values[axis] = value;
    updateModelInstance(instance.id, {
      transform: { ...instance.transform, [field]: values },
    });
  };

  const updateNumberProp = (
    field:
      | "backgroundOpacity"
      | "environmentLightIntensity"
      | "keyLightIntensity"
      | "cameraFov"
      | "modelScale"
      | "rotationSpeed"
      | "animationSpeed",
    rawValue: string,
  ) => {
    if (rawValue.trim() === "") return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    updateProps({ [field]: value });
  };

  const canConfigureSelectedNode = editable
    && selectedModelNodeName.length > 0
    && !selectedNameIsDuplicate;
  const selectedTransformOverride = selectedModelNodeName
    ? parsed.value.transformOverrides[selectedModelNodeName]
    : undefined;
  const selectedTransform = selectedTransformOverride ?? selectedSceneNode?.transform ?? null;
  const selectedAppearanceOverride = selectedModelNodeName
    ? parsed.value.appearanceOverrides[selectedModelNodeName]
    : undefined;
  const selectedAppearance: ModelNodeAppearance | null = selectedSceneNode
    ? selectedAppearanceOverride ?? {
        color: selectedSceneNode.appearance.materialColor ?? "#ffffff",
        opacity: selectedSceneNode.appearance.materialOpacity ?? 1,
        visible: selectedSceneNode.appearance.visible,
      }
    : null;
  const canConfigureMaterialColor = canConfigureSelectedNode
    && selectedSceneNode?.isMesh === true
    && selectedSceneNode.appearance.materialColor !== null;
  const canConfigureMaterialOpacity = canConfigureSelectedNode
    && selectedSceneNode?.isMesh === true
    && selectedSceneNode.appearance.materialOpacity !== null;

  const updateSelectedTransform = (
    field: keyof ModelNodeTransform,
    axis: 0 | 1 | 2,
    rawValue: string,
  ) => {
    if (!canConfigureSelectedNode || !selectedTransform || rawValue.trim() === "") return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;

    const values = [...selectedTransform[field]] as Vector3Tuple;
    values[axis] = value;
    updateProps({
      transformOverrides: {
        ...parsed.value.transformOverrides,
        [selectedModelNodeName]: {
          position: [...selectedTransform.position] as Vector3Tuple,
          rotation: [...selectedTransform.rotation] as Vector3Tuple,
          scale: [...selectedTransform.scale] as Vector3Tuple,
          [field]: values,
        },
      },
    });
  };

  const resetSelectedTransform = () => {
    if (!selectedModelNodeName || !selectedTransformOverride) return;
    const nextOverrides = { ...parsed.value.transformOverrides };
    delete nextOverrides[selectedModelNodeName];
    updateProps({ transformOverrides: nextOverrides });
  };

  const updateSelectedAppearance = (
    patch: Partial<ModelNodeAppearance>,
  ) => {
    if (!canConfigureSelectedNode || !selectedAppearance) return;
    updateProps({
      appearanceOverrides: {
        ...parsed.value.appearanceOverrides,
        [selectedModelNodeName]: {
          ...selectedAppearance,
          ...patch,
        },
      },
    });
  };

  const updateSelectedOpacity = (rawValue: string) => {
    if (!canConfigureMaterialOpacity || rawValue.trim() === "") return;
    const opacity = Number(rawValue);
    if (!Number.isFinite(opacity)) return;
    updateSelectedAppearance({ opacity });
  };

  const resetSelectedAppearance = () => {
    if (!selectedModelNodeName || !selectedAppearanceOverride) return;
    const nextOverrides = { ...parsed.value.appearanceOverrides };
    delete nextOverrides[selectedModelNodeName];
    updateProps({ appearanceOverrides: nextOverrides });
  };

  const replaceProjectAsset = (nextAsset: ProjectAsset) => {
    setProjectAssets((current) => [
      nextAsset,
      ...current.filter((asset) => asset.id !== nextAsset.id),
    ]);
  };

  const chooseAssetBinding = (recordId: string) => {
    setAssetBindingChoice(recordId);
    setAssetBindingError(null);
    setAssetBindingNotice(null);
    if (recordId === "new") {
      setAssetBindingDraft(newAssetBindingDraft(selectedModelNodeName));
      return;
    }

    const existing = projectAssets.find((asset) => asset.id === recordId);
    if (!existing) {
      setAssetBindingError("所选资产已不在当前资产列表中，请重新加载页面。");
      return;
    }
    setAssetBindingDraft({
      assetId: existing.assetId,
      name: existing.name,
      assetType: existing.assetType,
    });
  };

  const saveAssetBinding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canConfigureSelectedNode) return;

    setSavingAssetBinding(true);
    setAssetBindingError(null);
    setAssetBindingNotice(null);
    try {
      const existing = assetBindingChoice === "new"
        ? null
        : projectAssets.find((asset) => asset.id === assetBindingChoice) ?? null;
      if (assetBindingChoice !== "new" && !existing) {
        throw new Error("所选资产已不存在，请刷新页面后重试。");
      }

      const payload = {
        assetId: assetBindingDraft.assetId,
        assetType: assetBindingDraft.assetType,
        modelNode: selectedModelNodeName,
        name: assetBindingDraft.name,
      };
      const result = await request<ProjectAssetResponse>(
        existing
          ? projectAssetPath(projectId, existing.id)
          : projectAssetsPath(projectId),
        {
          method: existing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      replaceProjectAsset(result.asset);
      setAssetBindingChoice(result.asset.id);
      setAssetBindingNotice(
        existing ? "资产信息与模型节点绑定已保存。" : "资产已创建并绑定到当前模型节点。",
      );
    } catch (reason) {
      setAssetBindingError(errorMessage(reason));
    } finally {
      setSavingAssetBinding(false);
    }
  };

  const unbindSelectedAsset = async () => {
    if (!canConfigureSelectedNode || !boundProjectAsset) return;

    setSavingAssetBinding(true);
    setAssetBindingError(null);
    setAssetBindingNotice(null);
    try {
      const result = await request<ProjectAssetResponse>(
        projectAssetPath(projectId, boundProjectAsset.id),
        {
          method: "PATCH",
          body: JSON.stringify({ modelNode: null }),
        },
      );
      replaceProjectAsset(result.asset);
      setAssetBindingNotice("已解除模型节点绑定，资产台账记录仍然保留。");
    } catch (reason) {
      setAssetBindingError(errorMessage(reason));
    } finally {
      setSavingAssetBinding(false);
    }
  };

  const chooseAsset = (assetId: string) => {
    if (assetId === selectedAssetId) return;
    if (parsed.value.modelInstances.length === 0) {
      onSceneNodeSelect(null);
      onNodeChange({ ...node, resourceRefs: assetId ? [assetId] : [], props: {
        ...parsed.value,
        // Node names belong to the selected resource; never carry overrides to another model.
        appearanceOverrides: {}, transformOverrides: {},
        presentation: { lighting: "standard", shellMode: "original", showFlow: true, explosion: 0 },
        ...modelViewDefaults(assetId),
        modelInstances: [],
      } });
      return;
    }

    if (!assetId) {
      saveModelInstances(modelInstances.slice(1));
      return;
    }
    saveModelInstances(modelInstances.map((instance, index) => index === 0
      ? { ...instance, assetId, label: modelAssetLabel(assetId) }
      : instance));
  };

  const toggleSceneNode = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (extension !== "glb" && extension !== "gltf") {
      setAssetError("只支持 .glb 和 .gltf 模型文件。");
      return;
    }
    if (file.size === 0) {
      setAssetError("不能上传空模型文件。");
      return;
    }
    if (file.size > MAX_MODEL_BYTES) {
      setAssetError(`模型不能超过 ${formatFileSize(MAX_MODEL_BYTES)}。`);
      return;
    }

    setUploading(true);
    setAssetError(null);
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
      setModelAssets((current) => [
        result.modelAsset,
        ...current.filter((asset) => asset.id !== result.modelAsset.id),
      ]);
      addModelInstance(
        result.modelAsset.id,
        findBuiltinModel(result.modelAsset.id)?.name ?? result.modelAsset.originalFilename,
      );
    } catch (reason) {
      setAssetError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  return (
    <aside className="component-inspector">
      <div className="inspector-heading">
        <span className="eyebrow">3D component</span>
        <h2>{componentLabels[node.type]}</h2>
        <p>一个场景可组合多个模型实例，并独立控制位置、旋转、缩放与显隐。</p>
      </div>

      <section className="inspector-section model-builtin-library" aria-label="内置模型样例">
        <div className="inspector-section-title"><strong>内置样例</strong><span>项目自带 · 无需上传</span></div>
        {builtinModels.map((sample) => <article className={`model-builtin-card${selectedAssetId === sample.id ? " is-active" : ""}`} key={sample.id}>
          <img src={sample.thumbnailPath} alt="AQUA HELIX 水冷机组透明检视" loading="lazy" />
          <div><strong>{sample.name}</strong><p>{sample.description}</p>
            <button className="secondary-button" type="button" disabled={!editable || uploading || selectedAssetId === sample.id}
              onClick={() => chooseAsset(sample.id)}>{selectedAssetId === sample.id ? "正在使用" : "使用此样例"}</button>
          </div>
        </article>)}
      </section>

      <section className="inspector-section">
        <label className="model-presentation-flow"><input type="checkbox" disabled={!editable} checked={parsed.value.showControlPanel}
          onChange={(event) => updateProps({ showControlPanel: event.target.checked })} />展示控制面板</label>
        <p className="inspector-help">开启后，预览用户可调整检查效果；下方配置作为初始预设。</p>
      </section>

      {selectedAssetId ? <ModelPresentationPanel settings={parsed.value} scene={activeScene}
        animationCount={embeddedAnimationCount} editable={editable} onChange={updateProps} /> : null}

      <div className="inspector-section">
        <label className="inspector-label" htmlFor={`model-asset-${node.id}`}>主模型资源</label>
        <select
          disabled={!editable || uploading || loadingAssets}
          id={`model-asset-${node.id}`}
          onChange={(event) => chooseAsset(event.target.value)}
          value={selectedAssetId}
        >
          <option value="">{loadingAssets ? "正在读取模型…" : "请选择模型"}</option>
          {modelAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {findBuiltinModel(asset.id)?.name ?? asset.originalFilename} · {formatFileSize(asset.byteSize)}
            </option>
          ))}
        </select>
        <input
          accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          className="model-file-input"
          disabled={!editable || uploading}
          onChange={(event) => void upload(event)}
          ref={fileInputRef}
          type="file"
        />
        <button
          className="secondary-button model-upload-button"
          disabled={!editable || uploading}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          {uploading ? "正在检查并上传…" : "导入 GLB / GLTF"}
        </button>
        <p className="inspector-help">导入后会添加到当前场景；单文件最大 25 MB，GLTF 必须内嵌纹理与二进制资源。</p>
        {assetError ? <p className="inspector-inline-error" role="alert">模型资源错误：{assetError}</p> : null}
      </div>

      <section className="inspector-section model-instance-section">
        <div className="inspector-section-title">
          <strong>场景模型</strong>
          <span>{modelInstances.length}/{MAX_MODEL_INSTANCES} 个实例 · {node.resourceRefs.length} 种资源</span>
        </div>
        <label className="inspector-label" htmlFor={`model-instance-add-${node.id}`}>添加模型实例</label>
        <select
          disabled={!editable || uploading || loadingAssets || modelInstances.length >= MAX_MODEL_INSTANCES}
          id={`model-instance-add-${node.id}`}
          onChange={(event) => addModelInstance(event.target.value)}
          value=""
        >
          <option value="">{loadingAssets ? "正在读取模型…" : "+ 从资源库添加模型"}</option>
          {modelAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {findBuiltinModel(asset.id)?.name ?? asset.originalFilename} · {formatFileSize(asset.byteSize)}
            </option>
          ))}
        </select>
        <p className="inspector-help">相同资源可重复添加，渲染时只解析一次；第一个实例是主模型，节点树与外观设置作用于它。</p>
        <div className="model-instance-list">
          {modelInstances.map((instance, instanceIndex) => (
            <article className="model-instance-card" key={instance.id}>
              <header>
                <strong>{instanceIndex === 0 ? "主模型" : `实例 ${instanceIndex + 1}`}</strong>
                <span title={modelAssetLabel(instance.assetId)}>{modelAssetLabel(instance.assetId)}</span>
                <button
                  aria-label={`删除 ${instance.label}`}
                  className="model-instance-remove"
                  disabled={!editable}
                  onClick={() => saveModelInstances(modelInstances.filter((candidate) => candidate.id !== instance.id))}
                  title="从场景中移除"
                  type="button"
                >
                  ×
                </button>
              </header>
              <label className="model-instance-name">
                <span>名称</span>
                <input
                  disabled={!editable}
                  maxLength={80}
                  onChange={(event) => {
                    const label = event.target.value;
                    if (label.length > 0 && label === label.trim()) {
                      updateModelInstance(instance.id, { label });
                    }
                  }}
                  value={instance.label}
                />
              </label>
              <label className="model-presentation-flow">
                <input
                  checked={instance.visible}
                  disabled={!editable}
                  onChange={(event) => updateModelInstance(instance.id, { visible: event.target.checked })}
                  type="checkbox"
                />
                在场景中显示
              </label>
              {(["position", "rotation", "scale"] as const).map((field) => (
                <div className="model-instance-transform" key={field}>
                  <span>{field === "position" ? "位置" : field === "rotation" ? "旋转 °" : "缩放"}</span>
                  {([0, 1, 2] as const).map((axis) => (
                    <label key={axis}>
                      <span>{["X", "Y", "Z"][axis]}</span>
                      <input
                        disabled={!editable}
                        min={field === "scale" ? 0.001 : undefined}
                        onChange={(event) => updateModelInstanceTransform(instance, field, axis, event.target.value)}
                        step={field === "rotation" ? 1 : 0.1}
                        type="number"
                        value={instance.transform[field][axis]}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </article>
          ))}
          {modelInstances.length === 0 ? <p className="model-instance-empty">选择或导入模型后，可在同一场景中继续添加。</p> : null}
        </div>
      </section>

      {selectedModelAsset ? (
        <div className="model-inspection-card">
          <strong>{selectedModelAsset.originalFilename}</strong>
          <span>{selectedModelAsset.format.toUpperCase()} 2.x · {formatFileSize(selectedModelAsset.byteSize)}</span>
          <dl>
            <div><dt>节点</dt><dd>{selectedModelAsset.inspection.nodeCount}</dd></div>
            <div><dt>网格</dt><dd>{selectedModelAsset.inspection.meshCount}</dd></div>
            <div><dt>材质</dt><dd>{selectedModelAsset.inspection.materialCount}</dd></div>
            <div><dt>动画</dt><dd>{selectedModelAsset.inspection.animationCount}</dd></div>
          </dl>
          {selectedModelAsset.inspection.duplicateNodeNames.length > 0 ? (
            <p className="model-inspection-warning">存在 {selectedModelAsset.inspection.duplicateNodeNames.length} 个重复节点名，发布前必须处理。</p>
          ) : <p className="model-inspection-ok">节点名称检查通过</p>}
        </div>
      ) : null}

      {selectedModelAsset ? (
        <section className="inspector-section model-scene-tree-section">
          <div className="inspector-section-title">
            <strong>模型节点树</strong>
            <span>
              {activeScene
                ? `${activeScene.namedNodeCount}/${activeScene.totalNodeCount} 已命名`
                : "正在解析场景…"}
            </span>
          </div>
          <label className="model-scene-search">
            <span className="sr-only">搜索模型节点</span>
            <input
              disabled={!activeScene}
              onChange={(event) => setSceneSearch(event.target.value)}
              placeholder="搜索节点名称或类型"
              type="search"
              value={sceneSearch}
            />
          </label>
          {activeScene ? (
            <>
              <div
                aria-label="模型节点树"
                className="model-scene-tree"
                role="tree"
              >
                {visibleSceneRows.map(({ depth, node: sceneNode }) => {
                  const expanded = expandedPaths.has(sceneNode.path);
                  const selected = selectedSceneNodePath === sceneNode.path;
                  return (
                    <div
                      aria-level={depth + 1}
                      aria-selected={selected}
                      className={`model-scene-tree-row${selected ? " is-selected" : ""}`}
                      key={sceneNode.path}
                      role="treeitem"
                      style={{ "--scene-depth": depth } as CSSProperties}
                    >
                      {sceneNode.children.length > 0 ? (
                        <button
                          aria-label={`${expanded ? "收起" : "展开"} ${nodeLabel(sceneNode)}`}
                          className="model-scene-tree-toggle"
                          onClick={() => toggleSceneNode(sceneNode.path)}
                          type="button"
                        >
                          {expanded || normalizedSceneSearch ? "⌄" : "›"}
                        </button>
                      ) : <span className="model-scene-tree-toggle is-placeholder" />}
                      <button
                        className="model-scene-tree-select"
                        onClick={() => onSceneNodeSelect(sceneNode.path)}
                        title={`${nodeLabel(sceneNode)} · ${sceneNode.objectType}`}
                        type="button"
                      >
                        <span className={`model-scene-node-icon${sceneNode.isMesh ? " is-mesh" : ""}`}>
                          {sceneNode.isMesh ? "◆" : "◇"}
                        </span>
                        <span>{nodeLabel(sceneNode)}</span>
                        <small>{sceneNode.objectType}</small>
                      </button>
                    </div>
                  );
                })}
              </div>
              {visibleSceneRows.length === 0 ? (
                <p className="model-scene-empty">没有匹配的模型节点。</p>
              ) : null}
              {visibleSceneRows.length >= MAX_VISIBLE_TREE_ROWS ? (
                <p className="model-inspection-warning">
                  当前最多展示 {MAX_VISIBLE_TREE_ROWS} 行，请通过搜索缩小范围。
                </p>
              ) : null}
              {selectedSceneNode ? (
                <div className="model-scene-selection">
                  <span>当前节点</span>
                  <strong>{nodeLabel(selectedSceneNode)}</strong>
                  <code>{selectedSceneNode.path}</code>
                </div>
              ) : (
                <p className="inspector-help">选择节点后，后续位置、材质和数据绑定都将作用于该节点。</p>
              )}
            </>
          ) : (
            <div className="model-scene-tree-loading">
              <span className="model-loading-spinner" />
              <span>等待模型渲染器返回实际场景层级…</span>
            </div>
          )}
        </section>
      ) : null}

      {selectedSceneNode ? (
        <section className="inspector-section model-asset-binding-section">
          <div className="inspector-section-title">
            <strong>资产绑定</strong>
            <span>{boundProjectAsset ? "已绑定" : "未绑定"}</span>
          </div>
          {!selectedModelNodeName ? (
            <p className="model-inspection-warning">
              未命名节点不能绑定资产。请先在建模软件中设置唯一名称后重新导出。
            </p>
          ) : null}
          {selectedNameIsDuplicate ? (
            <p className="model-inspection-warning">
              节点名“{selectedModelNodeName}”不唯一，无法建立稳定资产映射。
            </p>
          ) : null}
          {loadingProjectAssets ? (
            <div className="model-scene-tree-loading">
              <span className="model-loading-spinner" />
              <span>正在读取资产台账…</span>
            </div>
          ) : null}
          {projectAssetLoadError ? (
            <p className="inspector-inline-error" role="alert">
              资产台账读取失败：{projectAssetLoadError}
            </p>
          ) : null}
          {!loadingProjectAssets
            && !projectAssetLoadError
            && selectedModelNodeName
            && !selectedNameIsDuplicate ? (
            <form className="model-asset-binding-form" onSubmit={(event) => void saveAssetBinding(event)}>
              {boundProjectAsset ? (
                <div className="model-asset-binding-summary">
                  <span>当前模型节点</span>
                  <strong>{selectedModelNodeName}</strong>
                  <code>{boundProjectAsset.assetId}</code>
                </div>
              ) : (
                <label>
                  <span>资产来源</span>
                  <select
                    disabled={!editable || savingAssetBinding}
                    onChange={(event) => chooseAssetBinding(event.target.value)}
                    value={assetBindingChoice}
                  >
                    <option value="new">新建资产并绑定</option>
                    {unboundProjectAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        绑定已有资产 · {asset.assetId} · {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>资产编号 assetId</span>
                <input
                  autoComplete="off"
                  disabled={!editable || savingAssetBinding}
                  maxLength={80}
                  onChange={(event) => setAssetBindingDraft((current) => ({
                    ...current,
                    assetId: event.target.value,
                  }))}
                  pattern="[A-Za-z0-9][A-Za-z0-9._:-]*"
                  placeholder="例如：LINE01-PUMP-001"
                  required
                  value={assetBindingDraft.assetId}
                />
              </label>
              <label>
                <span>资产名称</span>
                <input
                  disabled={!editable || savingAssetBinding}
                  maxLength={120}
                  onChange={(event) => setAssetBindingDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))}
                  placeholder="例如：一线循环泵"
                  required
                  value={assetBindingDraft.name}
                />
              </label>
              <label>
                <span>资产类型</span>
                <input
                  autoComplete="off"
                  disabled={!editable || savingAssetBinding}
                  maxLength={64}
                  onChange={(event) => setAssetBindingDraft((current) => ({
                    ...current,
                    assetType: event.target.value,
                  }))}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                  placeholder="例如：pump"
                  required
                  value={assetBindingDraft.assetType}
                />
              </label>
              <p className="inspector-help">
                <code>assetId</code> 是后续 3D 状态、2D 详情和实时数据共用的稳定业务编号。
              </p>
              <div className="model-asset-binding-actions">
                {boundProjectAsset ? (
                  <button
                    className="secondary-button"
                    disabled={!editable || savingAssetBinding}
                    onClick={() => void unbindSelectedAsset()}
                    type="button"
                  >
                    解除绑定
                  </button>
                ) : null}
                <button
                  className="primary-button"
                  disabled={!editable || savingAssetBinding}
                  type="submit"
                >
                  {savingAssetBinding
                    ? "保存中…"
                    : boundProjectAsset
                      ? "保存资产"
                      : "绑定资产"}
                </button>
              </div>
            </form>
          ) : null}
          {assetBindingError ? (
            <p className="inspector-inline-error" role="alert">
              资产绑定错误：{assetBindingError}
            </p>
          ) : null}
          {assetBindingNotice ? (
            <p className="model-asset-binding-notice" role="status">{assetBindingNotice}</p>
          ) : null}
        </section>
      ) : null}

      {selectedSceneNode && boundProjectAsset ? (
        <AssetDataBindingSection
          asset={boundProjectAsset}
          editable={editable}
          projectId={projectId}
        />
      ) : null}

      {selectedSceneNode && selectedTransform ? (
        <section className="inspector-section model-transform-section">
          <div className="inspector-section-title">
            <strong>节点变换</strong>
            <span>
              {selectedTransformOverride ? "已覆盖模型原值" : "模型原值"}
              {" · "}
              {Object.keys(parsed.value.transformOverrides).length}/100
            </span>
          </div>
          {!selectedModelNodeName ? (
            <p className="model-inspection-warning">
              未命名节点只能临时选择，不能保存变换。请先在建模软件中设置唯一名称后重新导出。
            </p>
          ) : null}
          {selectedNameIsDuplicate ? (
            <p className="model-inspection-warning">
              节点名“{selectedModelNodeName}”不唯一，无法确定持久化目标。请修正模型后重新导入。
            </p>
          ) : null}
          {([
            ["position", "位置", "-1000000", "1000000", "0.1"],
            ["rotation", "旋转", "-3600", "3600", "1"],
            ["scale", "缩放", "0.001", "1000", "0.01"],
          ] as const).map(([field, label, min, max, step]) => (
            <fieldset className="model-transform-fieldset" key={field}>
              <legend>{label}{field === "rotation" ? "（度）" : ""}</legend>
              <div className="model-transform-axis-grid">
                {(["X", "Y", "Z"] as const).map((axisLabel, axis) => (
                  <label key={axisLabel}>
                    <span>{axisLabel}</span>
                    <input
                      aria-label={`${label} ${axisLabel}`}
                      disabled={!canConfigureSelectedNode}
                      max={max}
                      min={min}
                      onChange={(event) =>
                        updateSelectedTransform(
                          field,
                          axis as 0 | 1 | 2,
                          event.target.value,
                        )}
                      step={step}
                      type="number"
                      value={selectedTransform[field][axis]}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <button
            className="secondary-button model-transform-reset"
            disabled={!editable || !selectedTransformOverride}
            onClick={resetSelectedTransform}
            type="button"
          >
            重置为模型原值
          </button>
        </section>
      ) : null}

      {selectedSceneNode && selectedAppearance ? (
        <section className="inspector-section model-appearance-section">
          <div className="inspector-section-title">
            <strong>节点外观</strong>
            <span>
              {selectedAppearanceOverride ? "已覆盖模型原值" : "模型原值"}
              {" · "}
              {Object.keys(parsed.value.appearanceOverrides).length}/100
            </span>
          </div>
          {!selectedModelNodeName ? (
            <p className="model-inspection-warning">
              未命名节点不能保存外观，请先在建模软件中设置唯一名称后重新导出。
            </p>
          ) : null}
          {selectedNameIsDuplicate ? (
            <p className="model-inspection-warning">
              节点名“{selectedModelNodeName}”不唯一，无法确定持久化目标。
            </p>
          ) : null}
          <label className="model-appearance-visibility">
            <input
              checked={selectedAppearance.visible}
              disabled={!canConfigureSelectedNode}
              onChange={(event) =>
                updateSelectedAppearance({ visible: event.target.checked })}
              type="checkbox"
            />
            <span>显示节点</span>
          </label>
          <div className="inspector-grid-two model-appearance-material">
            <label>
              <span>材质颜色</span>
              <input
                aria-label="材质颜色"
                disabled={!canConfigureMaterialColor}
                onChange={(event) =>
                  updateSelectedAppearance({ color: event.target.value })}
                type="color"
                value={selectedAppearance.color}
              />
            </label>
            <label>
              <span>材质透明度</span>
              <input
                aria-label="材质透明度"
                disabled={!canConfigureMaterialOpacity}
                max="1"
                min="0"
                onChange={(event) => updateSelectedOpacity(event.target.value)}
                step="0.05"
                type="number"
                value={selectedAppearance.opacity}
              />
            </label>
          </div>
          {selectedSceneNode.appearance.materialCount > 1 ? (
            <p className="inspector-help">
              此节点有 {selectedSceneNode.appearance.materialCount} 个材质，颜色和透明度会统一应用。
            </p>
          ) : null}
          {!selectedSceneNode.isMesh || selectedSceneNode.appearance.materialCount === 0 ? (
            <p className="inspector-help">
              当前节点没有可编辑材质，但仍可配置节点显隐。
            </p>
          ) : null}
          {selectedSceneNode.isMesh
            && selectedSceneNode.appearance.materialCount > 0
            && selectedSceneNode.appearance.materialColor === null ? (
              <p className="inspector-help">
                当前着色器不支持通用颜色属性，只能配置透明度和显隐。
              </p>
            ) : null}
          <button
            className="secondary-button model-appearance-reset"
            disabled={!editable || !selectedAppearanceOverride}
            onClick={resetSelectedAppearance}
            type="button"
          >
            重置为模型原值
          </button>
        </section>
      ) : null}

      <section className="inspector-section model-scene-settings">
        <div className="inspector-section-title">
          <strong>场景外观</strong>
          <span>即时预览</span>
        </div>
        <div className="inspector-grid-two">
          <label>
            <span>背景色</span>
            <input
              disabled={!editable}
              onChange={(event) => updateProps({ backgroundColor: event.target.value })}
              type="color"
              value={parsed.value.backgroundColor}
            />
          </label>
          <label>
            <span>背景透明度</span>
            <input
              disabled={!editable}
              max="1"
              min="0"
              onChange={(event) => updateNumberProp("backgroundOpacity", event.target.value)}
              step="0.05"
              type="number"
              value={parsed.value.backgroundOpacity}
            />
          </label>
          <label>
            <span>环境光颜色</span>
            <input
              disabled={!editable}
              onChange={(event) => updateProps({ environmentLightColor: event.target.value })}
              type="color"
              value={parsed.value.environmentLightColor}
            />
          </label>
          <label>
            <span>环境光强度</span>
            <input
              disabled={!editable}
              max="10"
              min="0"
              onChange={(event) =>
                updateNumberProp("environmentLightIntensity", event.target.value)}
              step="0.1"
              type="number"
              value={parsed.value.environmentLightIntensity}
            />
          </label>
          <label>
            <span>主光源颜色</span>
            <input
              disabled={!editable}
              onChange={(event) => updateProps({ keyLightColor: event.target.value })}
              type="color"
              value={parsed.value.keyLightColor}
            />
          </label>
          <label>
            <span>主光源强度</span>
            <input
              disabled={!editable}
              max="10"
              min="0"
              onChange={(event) => updateNumberProp("keyLightIntensity", event.target.value)}
              step="0.1"
              type="number"
              value={parsed.value.keyLightIntensity}
            />
          </label>
        </div>
        <p className="inspector-help">
          背景透明度设为 0，可叠加在 2D 背景上。摄影棚模式使用内置环境反射，无需外部贴图。
        </p>
      </section>

      <section className="inspector-section model-camera-settings">
        <div className="inspector-section-title">
          <strong>镜头与运动</strong>
          <span>自动适配模型边界</span>
        </div>
        <div className="inspector-grid-two">
          <label>
            <span>初始视角</span>
            <select
              disabled={!editable}
              onChange={(event) =>
                updateProps({ cameraView: event.target.value as Model3DProps["cameraView"] })}
              value={parsed.value.cameraView}
            >
              <option value="isometric">右前视角</option>
              <option value="isometric-left">左前视角</option>
              <option value="front">正面视角</option>
              <option value="top">顶部视角</option>
            </select>
          </label>
          <label>
            <span>视野角度 FOV</span>
            <input
              disabled={!editable}
              max="90"
              min="15"
              onChange={(event) => updateNumberProp("cameraFov", event.target.value)}
              step="1"
              type="number"
              value={parsed.value.cameraFov}
            />
          </label>
          <label>
            <span>模型显示比例</span>
            <input
              disabled={!editable}
              max="4"
              min="0.25"
              onChange={(event) => updateNumberProp("modelScale", event.target.value)}
              step="0.05"
              type="number"
              value={parsed.value.modelScale}
            />
          </label>
          <label>
            <span>旋转速度</span>
            <input
              disabled={!editable}
              max="5"
              min="0"
              onChange={(event) => updateNumberProp("rotationSpeed", event.target.value)}
              step="0.05"
              type="number"
              value={parsed.value.rotationSpeed}
            />
          </label>
        </div>
        <p className="inspector-help">
          模型显示比例会随画布保存并在预览中还原；视口中的滚轮缩放只用于临时查看。
        </p>
      </section>

      <div className="inspector-section inspector-switches">
        <label>
          <input
            checked={parsed.value.autoRotate}
            disabled={!editable}
            onChange={(event) => updateProps({ autoRotate: event.target.checked })}
            type="checkbox"
          />
          <span>自动旋转</span>
        </label>
        <label>
          <input
            checked={parsed.value.showGrid}
            disabled={!editable}
            onChange={(event) => updateProps({ showGrid: event.target.checked })}
            type="checkbox"
          />
          <span>显示地面网格</span>
        </label>
      </div>


    </aside>
  );
}
