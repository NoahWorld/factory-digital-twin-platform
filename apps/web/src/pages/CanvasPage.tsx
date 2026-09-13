import { PublicationPanel } from "../PublicationPanel";
import type { SceneViewportRuntime } from "../canvas/scene-viewport-runtime";
import { flushSync } from "react-dom";
import { InteractionEditor } from "../canvas/InteractionEditor";
import { InteractionDebugger } from "../canvas/InteractionDebugger";
import { InteractionContext, useInteractionSession } from "../interaction-session";
import { interactionAssetIds } from "../../../../shared/interactions";
import type { InteractionHost } from "../../../../shared/interaction-runtime";
import { ProjectPageBar } from "../canvas/ProjectPageBar";
import { useProjectEditorContext } from "../project-editor";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { errorMessage, request } from "../api";
import { ComponentInspector } from "../canvas/ComponentInspector";
import { CanvasSurface } from "../canvas/CanvasSurface";
import type { ObjectTarget } from "../canvas/model-instance";
import type { ProjectAsset } from "../canvas/assets";
import { AssetPanel } from "../AssetPanel";
import { ProjectRuntimeContext, runtimeCatalogPath, useProjectRuntime, type RuntimeCatalog } from "../project-runtime";
import type { ComponentBinding, MetricCatalogEntry } from "../../../../shared/component-bindings";
import { findModelSceneNode, type ModelSceneSnapshot } from "../canvas/model-scene";
import { canvasRoutePath, modelEditorRoutePath, projectCanvasPath } from "../canvas/routes";
import { TemplateDialog } from "../canvas/TemplateDialog";
import { getCanvasTemplate, instantiateCanvasTemplate, type CanvasTemplateId } from "../canvas/templates";
import { ThemeDialog } from "../canvas/ThemeDialog";
import { applyCanvasThemeToNode, applyCanvasThemeToNodes, canvasThemePresetLabels } from "../canvas/themes";
import { CANVAS_DRAG_TYPE, componentLabels, createCanvasNode, isBackgroundNodeType, isModel3DNodeType, type CanvasDocument, type CanvasNode, type CanvasNodeType, type CanvasPatchResponse, type CanvasResponse, type CanvasTheme, type ModelNodeAppearance } from "../canvas/types";
import { DataSourcePanel } from "../DataSourcePanel";
import { deviceVisualStatus, deviceVisualStatusLabel, type DeviceVisualStatus, type RuntimeMetricValue } from "../runtime-state";

type CanvasPageProps = {
  versionId?:string;
  initialTemplateId?: CanvasTemplateId;
  mode: "edit" | "preview";
  projectId: string;
};

const runtimeAppearances: Partial<Record<DeviceVisualStatus, ModelNodeAppearance>> = {
  alarm: { color: "#ff4d5f", opacity: 1, visible: true },
  offline: { color: "#697386", opacity: 0.48, visible: true },
  running: { color: "#35d07f", opacity: 1, visible: true },
  stopped: { color: "#8492a6", opacity: 0.82, visible: true },
  warning: { color: "#f6c344", opacity: 1, visible: true },
};

const formatRuntimeValue = (value: RuntimeMetricValue): string => {
  if (value === null) return "空值";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
};

const formatRuntimeTime = (value: string | undefined): string => {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(timestamp)
    : value;
};

export function CanvasPage({ initialTemplateId, mode, projectId,versionId }: CanvasPageProps) {
  const { publishedVersion,editor, document, projectName, canEdit, loading, loadError, saveError, setSaveError, saving, dirty,
    execute, travel: travelProject, selectPage: choosePage, save: saveProject, pendingDraft, draftNotice, draftDifferences, restoreDraft, discardDraft } = useProjectEditorContext();
  const viewports = useRef(new Map<string,SceneViewportRuntime>());
  const motionCommands = useRef(new Map<string,{ nodeId: string; controller: AbortController }>());
  const viewportWaiters = useRef(new Set<() => void>());
  const registerViewport = useCallback((id: string,engine: SceneViewportRuntime | null) => { if (engine) viewports.current.set(id,engine); else { viewports.current.delete(id); motionCommands.current.forEach((command) => { if (command.nodeId === id) command.controller.abort(); }); } viewportWaiters.current.forEach((notify) => notify()); },[]);
  const [hiddenInteractionNodes, setHiddenInteractionNodes] = useState<Set<string>>(new Set());
  const previewRoute = (pageId?:string) => versionId ? `#/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/run${pageId ? `?page=${encodeURIComponent(pageId)}` : ""}` : canvasRoutePath(projectId,"preview",pageId);
  const [showInteractions, setShowInteractions] = useState(false);
  const [showInteractionDebug, setShowInteractionDebug] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedModelSceneNodePath, setSelectedModelSceneNodePath] = useState<string | null>(null);
  const [selectedSceneObject, setSelectedSceneObject] = useState<{ nodeId: string; target: ObjectTarget } | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [showPublications,setShowPublications] = useState(false);
  const [showDataSources, setShowDataSources] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [catalogProjectId, setCatalogProjectId] = useState<string | null>(null);
  const [metricCatalog, setMetricCatalog] = useState<MetricCatalogEntry[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [themeNotice, setThemeNotice] = useState<string | null>(null);
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const [assetLoadError, setAssetLoadError] = useState<string | null>(null);
  const [assetListLoading, setAssetListLoading] = useState(mode === "preview");
  const [modelScenes, setModelScenes] = useState<Record<string, ModelSceneSnapshot>>({});
  const [showRuntimeDetails, setShowRuntimeDetails] = useState(false);
  const [selectedRuntimeAssetId, setSelectedRuntimeAssetId] = useState<string | null>(null);
  const runtimeAssetRef = useRef(selectedRuntimeAssetId); runtimeAssetRef.current = selectedRuntimeAssetId;
  const [runtimeSelectionMessage, setRuntimeSelectionMessage] = useState<string | null>(null);
  const initialTemplateAppliedRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setProjectAssets([]); setMetricCatalog([]); setCatalogProjectId(null);
    setAssetLoadError(null); setAssetListLoading(true);
    void request<RuntimeCatalog>(versionId ? `/api/v1/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/runtime-catalog` : runtimeCatalogPath(projectId), { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setProjectAssets(result.assets); setMetricCatalog(result.metrics); setCatalogProjectId(projectId);
      })
      .catch((reason) => { if (!controller.signal.aborted) setAssetLoadError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setAssetListLoading(false); });
    return () => controller.abort();
  }, [projectId,versionId, catalogRevision]);

  useEffect(() => {
    setModelScenes({}); runtimeAssetRef.current = null; setSelectedRuntimeAssetId(null); setRuntimeSelectionMessage(null);
  }, [projectId, mode]);

  const model3DNodeCount = document?.nodes.filter((node) => isModel3DNodeType(node.type)).length ?? 0;
  const legacyModelCount = document?.nodes.filter((node) => isModel3DNodeType(node.type) && !node.sceneId).length ?? 0;
  const visibleScenes = useMemo(() => {
    const ids = new Set(document?.nodes.map((node) => node.sceneId));
    return editor?.project.scenes.filter((scene) => ids.has(scene.id)) ?? [];
  }, [document?.nodes, editor?.project.scenes]);
  const mappedRuntimeAssets = useMemo(() => projectAssets.filter((asset) => asset.modelNode !== null), [projectAssets]);
  const activeBindings = useMemo(() => {
    const refs = new Set(document?.nodes.flatMap((node) => node.dataBindingRefs) ?? []);
    return (document?.dataBindings ?? []).filter((binding) => refs.has(binding.id));
  }, [document]);
  const neededAssetIds = useMemo(() => {
    if (catalogProjectId !== projectId || document?.projectId !== projectId) return [];
    const ids = new Set<string>();
    for (const binding of activeBindings) {
      if (binding.selection === "fixed") binding.assetIds.forEach((id) => ids.add(id));
      else if (selectedRuntimeAssetId && binding.assetIds.includes(selectedRuntimeAssetId)) ids.add(selectedRuntimeAssetId);
    }
    if (mode === "preview") {
      if (editor) interactionAssetIds({ ...editor.project.interactions, rules: editor.project.interactions.rules.filter((rule) => rule.enabled && (rule.pageId === null || rule.pageId === document?.pageId)) }).forEach((id) => ids.add(id));
      if (editor?.project.interactions.rules.some((rule) => rule.enabled && (rule.pageId === null || rule.pageId === document?.pageId) && ["data.change", "connection.change"].includes(rule.trigger.type) && !rule.trigger.sourceId)) projectAssets.forEach((asset) => ids.add(asset.assetId));
      if (legacyModelCount > 0) mappedRuntimeAssets.forEach((asset) => ids.add(asset.assetId));
      visibleScenes.forEach((scene) => scene.assetBindings.forEach((binding) => ids.add(binding.assetId)));
    }
    return [...ids];
  }, [editor?.project.interactions, document?.pageId, activeBindings, catalogProjectId, document?.projectId, mappedRuntimeAssets, mode, legacyModelCount, visibleScenes, projectId, selectedRuntimeAssetId]);
  const runtimeConnections = useProjectRuntime(projectId, catalogProjectId === projectId ? projectAssets : [], neededAssetIds,versionId);
  const interactionHost: InteractionHost["perform"] = (action, value, signal) => {
    if (signal.aborted) throw new Error("交互已取消。");
    if (action.type === "motion.play" || action.type === "motion.stop") {
      const key = JSON.stringify([action.nodeId,action.motionId]);
      motionCommands.current.get(key)?.controller.abort();
      if (action.type === "motion.stop") { viewports.current.get(action.nodeId)?.stopMotion(action.motionId); return; }
      const controller = new AbortController(), parentSignal = signal;
      const abortCommand = () => controller.abort(); parentSignal.addEventListener("abort",abortCommand,{ once: true });
      signal = controller.signal; motionCommands.current.set(key,{ nodeId: action.nodeId,controller });
      const wait = new Promise<SceneViewportRuntime>((resolve,reject) => {
        const cleanup = () => { clearTimeout(timer); viewportWaiters.current.delete(check); signal.removeEventListener("abort",abort); };
        const abort = () => { cleanup(); reject(Object.assign(new Error("动画视窗等待已取消。"),{ name: "AbortError" })); };
        const check = () => { if (signal.aborted) { abort(); return; } const engine = viewports.current.get(action.nodeId); if (engine) { cleanup(); resolve(engine); } };
        const timer = setTimeout(() => { cleanup(); reject(new Error("等待三维视窗超过5秒。")); },5000);
        signal.addEventListener("abort",abort,{ once: true }); viewportWaiters.current.add(check); check();
      });
      return wait.then(async (engine) => { if (signal.aborted) throw Object.assign(new Error("动画已取消。"),{ name: "AbortError" }); await engine.playMotion(action.motionId,signal); })
        .finally(() => { parentSignal.removeEventListener("abort",abortCommand); if (motionCommands.current.get(key)?.controller === controller) motionCommands.current.delete(key); });
    }
    if (action.type === "asset.select") {
      if (value !== null && (typeof value !== "string" || !projectAssets.some((asset) => asset.assetId === value))) throw new Error("目标设备不存在或资产列表尚未就绪。");
      const assetId = value as string | null;
      const previous = runtimeAssetRef.current; runtimeAssetRef.current = assetId;
      setSelectedRuntimeAssetId(assetId); setRuntimeSelectionMessage(null); setShowRuntimeDetails(action.details && assetId !== null);
      setSelectedModelSceneNodePath(null); setSelectedSceneObject(null);
      return previous === assetId ? [] : [{ type: "asset.select", sourceId: assetId ?? undefined, assetId: assetId ?? undefined, value: assetId, previous }];
    }
    if (action.type === "node.visible") {
      if (!editor?.project.pages.find((page) => page.id === document?.pageId)?.nodes.some((node) => node.id === action.nodeId)) throw new Error("目标组件不在当前页面。");
      setHiddenInteractionNodes((current) => { const next = new Set(current); if (action.visible) next.delete(action.nodeId); else next.add(action.nodeId); return next; }); return;
    }
    if (action.type === "page.navigate") {
      if (!editor?.project.pages.some((page) => page.id === action.pageId)) throw new Error("目标页面不存在。");
      flushSync(() => { choosePage(action.pageId); setHiddenInteractionNodes(new Set()); }); window.location.hash = previewRoute(action.pageId).slice(1); return;
    }
    throw new Error("该交互动作尚未连接运行宿主。");
  };
  const interactions = useInteractionSession(editor?.project.interactions, mode === "preview" && !!editor && catalogProjectId === projectId, document?.pageId, runtimeConnections, interactionHost);
  useEffect(() => { setHiddenInteractionNodes(new Set()); }, [document?.pageId, mode]);
  const emitAssetSelection = (assetId: string | null) => { const previous = runtimeAssetRef.current; runtimeAssetRef.current = assetId; if (assetId !== previous) interactions.emit({ type: "asset.select", sourceId: assetId ?? undefined, assetId: assetId ?? undefined, value: assetId, previous }); };
  const runtimeSetupError = assetLoadError ? `资产与指标加载失败：${assetLoadError}` : null;

  const runtimeAppearanceOverrides = useMemo(() => {
    const overrides: Record<string, ModelNodeAppearance> = {};
    if (mode !== "preview" || runtimeSetupError) return overrides;
    for (const asset of mappedRuntimeAssets) {
      if (!asset.modelNode) continue;
      const appearance = runtimeAppearances[deviceVisualStatus(runtimeConnections[asset.assetId])];
      if (appearance) overrides[asset.modelNode] = appearance;
    }
    return overrides;
  }, [mappedRuntimeAssets, mode, runtimeConnections, runtimeSetupError]);
  const sceneAppearances = useMemo(() => {
    const result: Record<string, Record<string, Record<string, ModelNodeAppearance>>> = {};
    if (mode !== "preview" || runtimeSetupError) return result;
    for (const scene of visibleScenes) for (const binding of scene.assetBindings) {
      const appearance = runtimeAppearances[deviceVisualStatus(runtimeConnections[binding.assetId])];
      if (appearance) ((result[scene.id] ??= {})[binding.instanceId] ??= {})[binding.objectId] = appearance;
    }
    return result;
  }, [visibleScenes, mode, runtimeSetupError, runtimeConnections]);
  const sceneTargets = useMemo(() => {
    const result: Record<string, ObjectTarget[]> = {};
    for (const node of document?.nodes ?? []) if (node.sceneId) {
      const scene = visibleScenes.find((scene) => scene.id === node.sceneId);
      result[node.id] = selectedRuntimeAssetId ? (scene?.assetBindings.filter((binding) => binding.assetId === selectedRuntimeAssetId).map((binding) => ({ instanceId: binding.instanceId, objectId: binding.objectId })) ?? [])
        : selectedSceneObject?.nodeId === node.id ? [selectedSceneObject.target] : [];
    }
    return result;
  }, [document?.nodes, visibleScenes, selectedRuntimeAssetId, selectedSceneObject]);
  const selectSceneObject = useCallback((nodeId: string, target: ObjectTarget | null, ancestors: ObjectTarget[]) => {
    setSelectedNodeId(nodeId); setSelectedNodeIds([nodeId]); setSelectedSceneObject(target ? { nodeId, target } : null);
    if (mode !== "preview") return;
    const node = document?.nodes.find((node) => node.id === nodeId); const scene = visibleScenes.find((scene) => scene.id === node?.sceneId);
    const binding = (ancestors.length ? ancestors : target ? [target] : []).map((target) => scene?.assetBindings.find((binding) => binding.instanceId === target.instanceId && binding.objectId === target.objectId)).find(Boolean);
    emitAssetSelection(binding?.assetId ?? null);
    interactions.emit({ type: "node.click", sourceId: nodeId, assetId: binding?.assetId });
    setSelectedRuntimeAssetId(binding?.assetId ?? null); setShowRuntimeDetails(!!binding);
    setRuntimeSelectionMessage(target && !binding ? "所选模型对象尚未绑定资产。" : null);
  }, [document?.nodes, mode, visibleScenes, interactions.emit, selectedRuntimeAssetId]);

  const selectedRuntimeAsset = selectedRuntimeAssetId
    ? projectAssets.find((asset) => asset.assetId === selectedRuntimeAssetId) ?? null
    : null;
  const selectedRuntimeConnection = selectedRuntimeAsset
    ? runtimeConnections[selectedRuntimeAsset.assetId]
    : undefined;
  const selectedDeviceStatus = deviceVisualStatus(selectedRuntimeConnection);
  const runtimeConnectionList = Object.values(runtimeConnections);
  const offlineDeviceCount = runtimeConnectionList.filter((state) => state.status === "offline").length;
  const staleDeviceCount = runtimeConnectionList.filter(
    (state) => state.status === "offline" && state.errorCode === "data_source_stale",
  ).length;
  const disconnectedDeviceCount = offlineDeviceCount - staleDeviceCount;
  const liveDeviceCount = runtimeConnectionList.filter((state) => state.status === "live").length;
  const selectedRuntimeIsStale = selectedRuntimeConnection?.errorCode === "data_source_stale";
  const offlineSummary = staleDeviceCount > 0 && disconnectedDeviceCount > 0
    ? `数据异常 ${offlineDeviceCount} 台（陈旧 ${staleDeviceCount} / 失联 ${disconnectedDeviceCount}）`
    : staleDeviceCount > 0
      ? `数据陈旧 ${staleDeviceCount} 台`
      : `数据失联 ${disconnectedDeviceCount} 台`;

  const selectCanvasNode = useCallback((nodeId: string | null, additive = false, individual = false) => {
    setSelectedModelSceneNodePath(null);
    if (!nodeId) { setSelectedNodeIds([]); setSelectedNodeId(null); return; }
    const node = document?.nodes.find((node) => node.id === nodeId);
    const cohort = !individual && node?.groupId ? document!.nodes.filter((item) => item.groupId === node.groupId).map((item) => item.id) : [nodeId];
    const next = additive
      ? cohort.every((id) => selectedNodeIds.includes(id)) ? selectedNodeIds.filter((id) => !cohort.includes(id)) : [...new Set([...selectedNodeIds, ...cohort])]
      : !individual && selectedNodeIds.includes(nodeId) ? selectedNodeIds : cohort;
    setSelectedNodeIds(next); setSelectedNodeId(next.includes(nodeId) ? nodeId : next.at(-1) ?? null);
  }, [document, selectedNodeIds]);

  useEffect(() => {
    if (!document) return;
    const ids = new Set(document.nodes.map((node) => node.id));
    setSelectedNodeIds((current) => current.every((id) => ids.has(id)) ? current : current.filter((id) => ids.has(id)));
    setSelectedNodeId((current) => current && ids.has(current) ? current : null);
    setModelScenes((current) => Object.keys(current).every((id) => ids.has(id)) ? current : Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
  }, [document?.nodes]);

  const selectModelSceneNode = useCallback((
    canvasNodeId: string,
    sceneNodePath: string | null,
  ) => {
    setSelectedNodeId(canvasNodeId); setSelectedNodeIds([canvasNodeId]);
    setSelectedModelSceneNodePath(sceneNodePath);
    if (mode !== "preview") return;
    if (sceneNodePath === null) {
      emitAssetSelection(null);
      interactions.emit({ type: "node.click",sourceId: canvasNodeId });
      setSelectedRuntimeAssetId(null);
      setRuntimeSelectionMessage(null);
      return;
    }

    const snapshot = modelScenes[canvasNodeId];
    if (!snapshot) {
      emitAssetSelection(null);
      interactions.emit({ type: "node.click",sourceId: canvasNodeId });
      setSelectedRuntimeAssetId(null);
      setRuntimeSelectionMessage("3D 场景节点树尚未就绪，请等待模型加载完成后重试。");
      return;
    }
    const pathParts = sceneNodePath.split("/");
    for (let length = pathParts.length; length > 0; length -= 1) {
      const candidate = findModelSceneNode(snapshot.roots, pathParts.slice(0, length).join("/"));
      const asset = candidate?.name
        ? projectAssets.find((item) => item.modelNode === candidate.name)
        : undefined;
      if (asset) {
        emitAssetSelection(asset.assetId);
        interactions.emit({ type: "node.click", sourceId: canvasNodeId, assetId: asset.assetId });
        setSelectedRuntimeAssetId(asset.assetId);
        setShowRuntimeDetails(true);
        setRuntimeSelectionMessage(null);
        return;
      }
    }
    emitAssetSelection(null);
    interactions.emit({ type: "node.click", sourceId: canvasNodeId });
    setSelectedRuntimeAssetId(null);
    setRuntimeSelectionMessage("所点模型对象及其父节点尚未绑定资产，无法打开设备详情。");
  }, [mode, modelScenes, projectAssets, interactions.emit, selectedRuntimeAssetId]);

  const handleModelSceneChange = useCallback((
    canvasNodeId: string,
    snapshot: ModelSceneSnapshot | null,
  ) => {
    setModelScenes((current) => {
      if (snapshot) return { ...current, [canvasNodeId]: snapshot };
      const next = { ...current };
      delete next[canvasNodeId];
      return next;
    });
  }, []);

  const updateNode = useCallback((node: CanvasNode) => { execute({ type: "nodes.upsert", nodes: [node] }); }, [execute]);
  const updateNodes = useCallback((nodes: CanvasNode[]) => { execute({ type: "nodes.upsert", nodes }); }, [execute]);
  const changeBinding = useCallback((node: CanvasNode, binding: ComponentBinding | null) => {
    execute({ type: "binding.set", nodeId: node.id, binding });
  }, [execute]);

  const selectRuntimeAsset = useCallback((assetId: string | null) => {
    emitAssetSelection(assetId);
    setSelectedRuntimeAssetId(assetId); setRuntimeSelectionMessage(null); setShowRuntimeDetails(false);
    setSelectedModelSceneNodePath(null);
    setSelectedSceneObject(null);
  }, [interactions.emit, selectedRuntimeAssetId]);

  // A table selection can happen before GLTF finishes loading. Reconcile it
  // when the scene arrives as well as when the selected asset changes.
  useEffect(() => {
    if (!selectedRuntimeAssetId || mode !== "preview") return;
    const asset = projectAssets.find((item) => item.assetId === selectedRuntimeAssetId);
    if (!asset?.modelNode) return;
    const matches: Array<{ nodeId: string; path: string }> = [];
    const visit = (nodeId: string, nodes: ModelSceneSnapshot["roots"]) => {
      for (const node of nodes) {
        if (node.name === asset.modelNode) matches.push({ nodeId, path: node.path });
        visit(nodeId, node.children);
      }
    };
    Object.entries(modelScenes).forEach(([nodeId, scene]) => visit(nodeId, scene.roots));
    if (matches.length === 1) { setSelectedNodeId(matches[0].nodeId); setSelectedNodeIds([matches[0].nodeId]); setSelectedModelSceneNodePath(matches[0].path); }
    else if (matches.length > 1) setRuntimeSelectionMessage("该设备匹配多个模型对象，请修正映射；二维数据仍可使用。");
  }, [modelScenes, projectAssets, selectedRuntimeAssetId, mode]);

  const createNode = useCallback((type: CanvasNodeType, x: number, y: number) => {
    if (!document) return;
    const maxZIndex = document.nodes.reduce((maximum, node) => Math.max(maximum, node.zIndex), 0);
    const node = applyCanvasThemeToNode(
      createCanvasNode(type, x, y, isBackgroundNodeType(type) ? 0 : maxZIndex + 1),
      document.theme,
    );
    if (execute({ type: "nodes.upsert", nodes: [node] })) selectCanvasNode(node.id);
  }, [document, execute, selectCanvasNode]);

  const deleteSelectedNode = () => {
    if (selectedNodeIds.length && execute({ type: "nodes.delete", nodeIds: selectedNodeIds })) selectCanvasNode(null);
  };
  const duplicateSelectedNode = () => {
    if (!selectedNodeIds.length || !document) return;
    const previous = new Set(document.nodes.map((node) => node.id));
    const next = execute({ type: "nodes.duplicate", nodeIds: selectedNodeIds });
    if (next) { const copies = next.nodes.filter((node) => !previous.has(node.id)).map((node) => node.id); setSelectedNodeIds(copies); setSelectedNodeId(copies.at(-1) ?? null); }
  };
  const travel = (direction: "undo" | "redo") => {
    if (!editor || !canEdit || mode !== "edit" || saving) return;
    const next = travelProject(direction);
    if (!next) return;
    if (next.pageId !== document?.pageId) window.location.hash = canvasRoutePath(projectId, "canvas", next.pageId).slice(1);
    const restored = next.nodes.find((node) => !editor.document.nodes.some((item) => item.id === node.id));
    setConfigurationError(null);
    if (restored) { const ids = next.nodes.filter((node) => !editor.document.nodes.some((item) => item.id === node.id)).map((node) => node.id); setSelectedNodeIds(ids); setSelectedNodeId(restored.id); }
    else if (!next.nodes.some((node) => node.id === selectedNodeId)) selectCanvasNode(null);
  };

  const save = async (): Promise<boolean> => {
    if (configurationError) {
      setSaveError(`组件配置无效：${configurationError}`);
      return false;
    }
    return saveProject();
  };

  const openPreview = async () => {
    if (dirty && !(await save())) return;
    window.location.hash = canvasRoutePath(projectId, "preview", document?.pageId).slice(1);
  };

  const openModelEditor = async (nodeId: string) => {
    if (dirty && !(await save())) return;
    window.location.hash = modelEditorRoutePath(projectId, nodeId, document?.pageId).slice(1);
  };

  const startPaletteDrag = (event: DragEvent<HTMLButtonElement>, type: CanvasNodeType) => {
    event.dataTransfer.setData(CANVAS_DRAG_TYPE, type);
    event.dataTransfer.setData("text/plain", componentLabels[type]);
    event.dataTransfer.effectAllowed = "copy";
  };

  const applyTemplate = useCallback((templateId: CanvasTemplateId) => {
    if (!document || !canEdit || saving) return;
    const nextNodes = instantiateCanvasTemplate(templateId, document.nodes);
    const template = getCanvasTemplate(templateId);
    const patchNodeCount = document.nodes.length + nextNodes.length;
    if (patchNodeCount > 100) {
      setSaveError(`无法套用模板：替换操作包含 ${patchNodeCount} 个节点，超过单次保存上限 100。请先保存并删除部分旧组件。`);
      return;
    }

    if (!execute({ type: "canvas.replace", nodes: nextNodes, theme: template.canvasTheme })) return;
    selectCanvasNode(null);
    setConfigurationError(null);
    setSaveError(null);
    setThemeNotice(`已应用“${template.name}”配色；模板中的 3D 组件沿用原有 3D 配置。`);
    setShowTemplates(false);
  }, [canEdit, document, execute, saving, selectCanvasNode]);

  const applyTheme = useCallback((theme: CanvasTheme) => {
    if (!document || !canEdit || saving) return;
    const nextNodes = applyCanvasThemeToNodes(document.nodes, theme);
    const themedNodes = nextNodes.filter((node) => !isModel3DNodeType(node.type));
    if (!execute({ type: "canvas.replace", nodes: nextNodes, theme })) return;
    setSaveError(null);
    setThemeNotice(
      `已切换为${canvasThemePresetLabels[theme.presetId]}主题，联动更新 ${themedNodes.length} 个非 3D 组件；3D 组件保持不变。`,
    );
    setShowThemes(false);
  }, [canEdit, document, execute, saving]);

  useEffect(() => {
    if (!initialTemplateId || loading || !document || document.projectId !== projectId || initialTemplateAppliedRef.current) return;
    initialTemplateAppliedRef.current = true;

    if (mode !== "edit") {
      setSaveError("模板只能在 2D 画布编辑模式中套用。");
    } else if (!canEdit) {
      setSaveError("当前项目是只读项目，不能套用模板。");
    } else {
      applyTemplate(initialTemplateId);
    }

    window.history.replaceState(null, "", canvasRoutePath(projectId, "canvas", document?.pageId));
  }, [applyTemplate, canEdit, document, initialTemplateId, loading, mode, projectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!canEdit || mode !== "edit" || saving || target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); travel(event.shiftKey ? "redo" : "undo"); }
      else if (key === "y") { event.preventDefault(); travel("redo"); }
      else if (key === "d") { event.preventDefault(); duplicateSelectedNode(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, canEdit, mode, saving, selectedNodeId, selectedNodeIds]);

  if (loading) return <main className="canvas-page-state"><p className="eyebrow">Canvas</p><h1>正在加载画布…</h1></main>;
  if (loadError || !document || !editor) {
    return <main className="canvas-page-state error-state"><p className="eyebrow">Canvas error</p><h1>画布加载失败</h1><p>{loadError ?? "接口没有返回画布文档。"}</p><a className="secondary-button" href="#/projects">返回项目列表</a></main>;
  }

  const editable = mode === "edit" && canEdit && !saving;
  const selectedNode = selectedNodeId ? document.nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  return (
    <InteractionContext.Provider value={{ emit: interactions.emit, hiddenNodes: hiddenInteractionNodes, registerViewport }}>
    <ProjectRuntimeContext.Provider value={{ assets: projectAssets, metrics: metricCatalog, enabled: true, loading: assetListLoading, error: assetLoadError, bindings: activeBindings, connections: runtimeConnections, selectedAssetId: selectedRuntimeAssetId, selectAsset: selectRuntimeAsset, changeBinding }}>
    <main className={`canvas-page canvas-page-${mode}`}>
      <header className="canvas-toolbar">
        <div className="canvas-toolbar-title"><a aria-label="返回项目列表" className="canvas-back-link" href="#/projects">←</a><div><span>{mode === "edit" ? "2D 画布" : "可视化预览"}</span><strong>{projectName}</strong></div></div>
        <div className="canvas-document-meta"><span>{document.width} × {document.height}</span><span>{canvasThemePresetLabels[document.theme.presetId]}</span><span>版本 {document.revision}</span>{mode === "edit" ? <span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? "有未保存更改" : "已保存"}</span> : null}</div>
        <div className="canvas-toolbar-actions">
          {mode === "edit" ? <>
            <button className="secondary-button compact-button" disabled={!canEdit || saving || !editor?.past.length} onClick={() => travel("undo")} title="撤销（⌘/Ctrl+Z）" type="button">撤销</button>
            <button className="secondary-button compact-button" disabled={!canEdit || saving || !editor?.future.length} onClick={() => travel("redo")} title="重做（⌘/Ctrl+Shift+Z）" type="button">重做</button>
            <button className="secondary-button compact-button" disabled={!canEdit || saving || selectedNodeIds.length < 2} onClick={() => execute({ type: "nodes.group", nodeIds: selectedNodeIds })} type="button">分组</button>
            <button className="secondary-button compact-button" disabled={!canEdit || saving || !document.nodes.some((node) => selectedNodeIds.includes(node.id) && node.groupId)} onClick={() => execute({ type: "nodes.ungroup", nodeIds: selectedNodeIds })} type="button">解组</button>
            <button className="secondary-button compact-button" disabled={!selectedNodeIds.length || !canEdit || saving} onClick={duplicateSelectedNode} title="复制组件（⌘/Ctrl+D）" type="button">复制组件</button>
            <button className="secondary-button compact-button" disabled={!canEdit || saving} onClick={() => setShowTemplates(true)} type="button">模板</button>
            <button className="secondary-button compact-button canvas-theme-button" disabled={!canEdit || saving} onClick={() => setShowThemes(true)} type="button">
              <span aria-hidden="true" style={{ backgroundColor: document.theme.accentColor }} />
              主题
            </button>
            <button className="secondary-button compact-button" disabled={saving} onClick={() => setShowInteractions(true)} type="button">交互编排</button>
            <button className="secondary-button compact-button" onClick={() => setShowAssets(true)} type="button">资产与指标</button>
            <button className="secondary-button compact-button" onClick={() => setShowDataSources(true)} type="button">数据源</button>
            <button className="secondary-button compact-button" disabled={saving || dirty} title={dirty ? "请先保存画布" : undefined} onClick={() => setShowPublications(true)} type="button">发布与版本</button>
            <button className="secondary-button compact-button" disabled={!selectedNodeId || !canEdit || saving} onClick={deleteSelectedNode} type="button">删除组件</button>
            <button className="secondary-button compact-button" disabled={saving || configurationError !== null} onClick={() => void openPreview()} title={configurationError ?? undefined} type="button">预览</button>
            <button className="primary-button compact-button" disabled={!dirty || saving || !canEdit || configurationError !== null} onClick={() => void save()} title={configurationError ?? undefined} type="button">{saving ? "保存中…" : "保存画布"}</button>
          </> : <>{versionId ? <span className="published-version-label">固定发布版本 V{publishedVersion?.versionNumber ?? "…"}</span> : null}<button className="secondary-button compact-button" onClick={() => setShowInteractionDebug(true)} type="button">交互调试</button><a className="secondary-button compact-button" href={canvasRoutePath(projectId, "canvas", document?.pageId)}>返回编辑</a></>}
        </div>
      </header>
      <div className="canvas-message-stack">
          <ProjectPageBar project={editor.project} pageId={editor.pageId} editable={mode === "edit" && canEdit && !saving} selectedIds={selectedNodeIds}
            onSelect={(id) => { choosePage(id); window.location.hash = (mode === "edit" ? canvasRoutePath(projectId,"canvas",id) : previewRoute(id)).slice(1); }}
            onOperation={(operation) => { const next = execute(operation); if (next?.pageId) window.location.hash = canvasRoutePath(projectId, "canvas", next.pageId).slice(1); }} />
          {mode === "edit" && draftNotice ? <div className="project-draft-notice" role="status"><span>{draftNotice}</span>
            {pendingDraft ? <><span>草稿含 {pendingDraft.content.pages.length} 页、{pendingDraft.content.pages.reduce((count, page) => count + page.nodes.length, 0)} 个组件。</span><details><summary>恢复后的差异</summary><ul>{draftDifferences.map((line, index) => <li key={index}>{line}</li>)}</ul></details><button onClick={restoreDraft} type="button">恢复草稿到编辑器</button></> : null}
            <button onClick={discardDraft} type="button">{pendingDraft ? "放弃此冲突草稿" : "使用服务器内容"}</button>
          </div> : null}
          {saveError ? <div className="canvas-save-error" role="alert">操作失败：{saveError}</div> : null}
          {themeNotice ? <div className="canvas-theme-notice" role="status"><span>{themeNotice}</span><button aria-label="关闭主题提示" onClick={() => setThemeNotice(null)} type="button">×</button></div> : null}
          {mode === "edit" && !canEdit ? <div className="canvas-readonly-notice">当前项目权限为只读，不能移动或保存组件。</div> : null}
        </div>
      <div className={`canvas-workbench${mode === "preview" ? " is-preview" : ""}`}>
        {mode === "edit" ? <aside className="component-palette">
          <div className="component-palette-heading"><span className="eyebrow">Components</span><h2>组件库</h2><p>拖到画布中创建组件</p></div>
          <section aria-labelledby="palette-3d-title" className="palette-group is-model">
            <h3 className="palette-group-title" id="palette-3d-title"><span>3D 场景</span><em>1</em></h3>
            <button aria-label="3D 模型，导入 GLB 或 GLTF" className="palette-item palette-model-3d" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "model-3d")} title="3D 模型 · 导入 GLB 或 GLTF" type="button"><span className="palette-icon" aria-hidden="true">⬡</span><span><strong>3D 模型</strong><small>导入 GLB 或 GLTF</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-charts-title" className="palette-group is-chart">
            <h3 className="palette-group-title" id="palette-charts-title"><span>图表</span><em>6</em></h3>
            <button aria-label="折线图，连续趋势数据" className="palette-item palette-line-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "line-chart")} title="折线图 · 连续趋势数据" type="button"><span className="palette-icon" aria-hidden="true">⌁</span><span><strong>折线图</strong><small>连续趋势数据</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="柱状图，分类对比数据" className="palette-item palette-bar-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "bar-chart")} title="柱状图 · 分类对比数据" type="button"><span className="palette-icon" aria-hidden="true">▥</span><span><strong>柱状图</strong><small>分类对比数据</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="面积图，展示趋势与累计变化" className="palette-item palette-area-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "area-chart")} title="面积图 · 趋势与累计变化" type="button"><span className="palette-icon" aria-hidden="true">◒</span><span><strong>面积图</strong><small>趋势与累计变化</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="饼图，展示分类占比构成" className="palette-item palette-pie-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "pie-chart")} title="饼图 · 分类占比构成" type="button"><span className="palette-icon" aria-hidden="true">◔</span><span><strong>饼图</strong><small>分类占比构成</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="环形图，展示占比与总量" className="palette-item palette-donut-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "donut-chart")} title="环形图 · 占比与总量" type="button"><span className="palette-icon" aria-hidden="true">◎</span><span><strong>环形图</strong><small>占比与总量</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="雷达图，展示多维能力对比" className="palette-item palette-radar-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "radar-chart")} title="雷达图 · 多维能力对比" type="button"><span className="palette-icon" aria-hidden="true">◇</span><span><strong>雷达图</strong><small>多维能力对比</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-basic-title" className="palette-group is-basic">
            <h3 className="palette-group-title" id="palette-basic-title"><span>内容与交互</span><em>9</em></h3>
            <button aria-label="纯文本，支持静态与滚动文字" className="palette-item palette-plain-text" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "plain-text")} title="纯文本 · 静态与滚动文字" type="button"><span className="palette-icon" aria-hidden="true">Aa</span><span><strong>纯文本</strong><small>静态与滚动文字</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="文字超链接，预览时打开网页" className="palette-item palette-text-link" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "text-link")} title="文字超链接 · 预览时打开网页" type="button"><span className="palette-icon" aria-hidden="true">↗</span><span><strong>文字超链接</strong><small>预览时打开网页</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="图片，绑定项目图片资源" className="palette-item palette-image" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "image")} title="图片 · 绑定项目资源" type="button"><span className="palette-icon" aria-hidden="true">▧</span><span><strong>图片</strong><small>绑定项目资源</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="轮播图，多张项目图片自动轮播" className="palette-item palette-carousel" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "carousel")} title="轮播图 · 多图自动轮播" type="button"><span className="palette-icon" aria-hidden="true">▤</span><span><strong>轮播图</strong><small>多图自动轮播</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="按钮，预览时执行链接动作" className="palette-item palette-button" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "button")} title="按钮 · 预览时执行动作" type="button"><span className="palette-icon" aria-hidden="true">▰</span><span><strong>按钮</strong><small>预览时执行动作</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="Switch 切换按钮，预览时可操作" className="palette-item palette-switch" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "switch")} title="Switch · 预览时可操作" type="button"><span className="palette-icon" aria-hidden="true">◉</span><span><strong>Switch</strong><small>开关状态切换</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="多选框，预览时可多项选择" className="palette-item palette-checkbox-group" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "checkbox-group")} title="多选框 · 多项选择" type="button"><span className="palette-icon" aria-hidden="true">☑</span><span><strong>多选框</strong><small>多项选择</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="单选框，预览时单项选择" className="palette-item palette-radio-group" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "radio-group")} title="单选框 · 单项选择" type="button"><span className="palette-icon" aria-hidden="true">◉</span><span><strong>单选框</strong><small>单项选择</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="下拉菜单，预览时选择选项" className="palette-item palette-select" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "select")} title="下拉菜单 · 选项选择" type="button"><span className="palette-icon" aria-hidden="true">⌄</span><span><strong>下拉菜单</strong><small>选项选择</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-dashboard-title" className="palette-group is-dashboard">
            <h3 className="palette-group-title" id="palette-dashboard-title"><span>数据展示</span><em>4</em></h3>
            <button aria-label="指标卡，展示核心数字和摘要" className="palette-item palette-metric-card" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "metric-card")} title="指标卡 · 核心数字与摘要" type="button"><span className="palette-icon" aria-hidden="true">#</span><span><strong>指标卡</strong><small>核心数字与摘要</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="环形进度，展示完成率和消耗率" className="palette-item palette-radial-gauge" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "radial-gauge")} title="环形进度 · 完成率与消耗率" type="button"><span className="palette-icon" aria-hidden="true">◉</span><span><strong>环形进度</strong><small>完成率与消耗率</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="流程排行，多行进度与排行" className="palette-item palette-progress-list" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "progress-list")} title="流程排行 · 多行进度与排行" type="button"><span className="palette-icon" aria-hidden="true">≡</span><span><strong>流程排行</strong><small>多行进度与排行</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="状态矩阵，展示设备、人员或告警状态" className="palette-item palette-status-grid" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "status-grid")} title="状态矩阵 · 设备、人员或告警" type="button"><span className="palette-icon" aria-hidden="true">▦</span><span><strong>状态矩阵</strong><small>设备、人员或告警</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-business-title" className="palette-group is-business">
            <h3 className="palette-group-title" id="palette-business-title"><span>业务组件</span><em>4</em></h3>
            <button aria-label="数据排名，展示业务排行与变化趋势" className="palette-item palette-ranking-list" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "ranking-list")} title="数据排名 · 业务排行与趋势" type="button"><span className="palette-icon" aria-hidden="true">№</span><span><strong>数据排名</strong><small>业务排行与趋势</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="实时告警，展示故障、预警和失联事件" className="palette-item palette-alarm-list" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "alarm-list")} title="实时告警 · 故障与失联事件" type="button"><span className="palette-icon" aria-hidden="true">!</span><span><strong>实时告警</strong><small>故障与失联事件</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="业务表格，展示结构化业务明细" className="palette-item palette-data-table" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "data-table")} title="业务表格 · 结构化业务明细" type="button"><span className="palette-icon" aria-hidden="true">▦</span><span><strong>业务表格</strong><small>结构化业务明细</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="事件时间线，展示流程和操作记录" className="palette-item palette-event-timeline" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "event-timeline")} title="事件时间线 · 流程与操作记录" type="button"><span className="palette-icon" aria-hidden="true">◷</span><span><strong>事件时间线</strong><small>流程与操作记录</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-shapes-title" className="palette-group is-shape">
            <h3 className="palette-group-title" id="palette-shapes-title"><span>基础图形</span><em>2</em></h3>
            <button aria-label="矩形，可配置填充和圆角" className="palette-item palette-rectangle" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "rectangle")} title="矩形 · 可配置填充和圆角" type="button"><span className="palette-icon" aria-hidden="true"><i className="palette-shape-icon is-rectangle" /></span><span><strong>矩形</strong><small>可配置填充和圆角</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="圆形，固定比例缩放" className="palette-item palette-circle" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "circle")} title="圆形 · 固定比例缩放" type="button"><span className="palette-icon" aria-hidden="true"><i className="palette-shape-icon is-circle" /></span><span><strong>圆形</strong><small>固定比例缩放</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-decorations-title" className="palette-group is-decoration">
            <h3 className="palette-group-title" id="palette-decorations-title"><span>界面点缀</span><em>7</em></h3>
            <button aria-label="大屏标题，主标题与英文副标题" className="palette-item palette-screen-title" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "screen-title")} title="大屏标题 · 主标题与英文副标题" type="button"><span className="palette-icon" aria-hidden="true">T</span><span><strong>大屏标题</strong><small>主标题与英文副标题</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="背景点缀，网格与科技光环" className="palette-item palette-background-decoration" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "background-decoration")} title="背景点缀 · 网格与科技光环" type="button"><span className="palette-icon" aria-hidden="true">◇</span><span><strong>背景点缀</strong><small>网格与科技光环</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="时间日期，实时日期与时钟" className="palette-item palette-datetime" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "datetime")} title="时间日期 · 实时日期与时钟" type="button"><span className="palette-icon" aria-hidden="true">◷</span><span><strong>时间日期</strong><small>实时日期与时钟</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="标题，看板区块标题" className="palette-item palette-section-title" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "section-title")} title="标题 · 看板区块标题" type="button"><span className="palette-icon" aria-hidden="true">▰</span><span><strong>标题</strong><small>看板区块标题</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="小卡片背景，轻量面板底框" className="palette-item palette-card-background" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "card-background")} title="小卡片背景 · 轻量面板底框" type="button"><span className="palette-icon" aria-hidden="true">▣</span><span><strong>小卡片背景</strong><small>轻量面板底框</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="科技面板，可配置标题与五种边框风格" className="palette-item palette-panel-frame" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "panel-frame")} title="科技面板 · 五种边框样式" type="button"><span className="palette-icon" aria-hidden="true">⌗</span><span><strong>科技面板</strong><small>标题与科技边框</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="小图标背景，固定比例图标底座" className="palette-item palette-icon-background" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "icon-background")} title="小图标背景 · 固定比例图标底座" type="button"><span className="palette-icon" aria-hidden="true">◆</span><span><strong>小图标背景</strong><small>固定比例图标底座</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <div className="palette-note"><strong>资源分离</strong><p>模型文件独立存储；画布节点只保存配置、资源 ID 与数据绑定 ID。</p></div>
        </aside> : null}
        <CanvasSurface
          document={document}
          editable={editable}
          modelInteractionEnabled={mode === "preview"}
          onCreateNode={createNode}
          onModelSceneChange={mode === "preview" ? handleModelSceneChange : undefined}
          onModelSceneNodeSelect={selectModelSceneNode}
          onModelObjectSelect={selectSceneObject}
          sceneTargets={sceneTargets}
          sceneAppearances={sceneAppearances}
          onNodesChange={updateNodes}
          onNodeChange={updateNode}
          onSelectNode={selectCanvasNode}
          runtimeAppearanceOverrides={runtimeAppearanceOverrides}
          selectedModelSceneNodePath={selectedModelSceneNodePath}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
        />
        {mode === "preview" ? (
          <>
            <div
              className={`runtime-status-banner${runtimeSetupError ? " is-error" : offlineDeviceCount > 0 ? staleDeviceCount === offlineDeviceCount ? " is-stale" : " is-offline" : liveDeviceCount > 0 ? " is-live" : " is-loading"}`}
              role={runtimeSetupError || offlineDeviceCount > 0 ? "alert" : "status"}
            >
              <strong>{projectAssets.some((asset) => neededAssetIds.includes(asset.assetId) && asset.metadata.simulated === true) ? "项目数据 · 含模拟设备" : "项目数据"}</strong>
              <span>
                {assetListLoading
                  ? "🟡 正在读取资产映射…"
                  : runtimeSetupError
                    ? `⚠ ${runtimeSetupError}`
                    : offlineDeviceCount > 0
                      ? `${staleDeviceCount === offlineDeviceCount ? "🟠" : "🔴"} ${offlineSummary} · 正在重连（第 ${Math.max(...runtimeConnectionList.map((state) => state.failureCount))} 次）`
                      : liveDeviceCount > 0
                        ? `🟢 在线 ${liveDeviceCount} 台 · 共享设备数据`
                        : neededAssetIds.length === 0 ? "未选择设备或未配置数据绑定" : "🟡 正在连接设备数据…"}
              </span>
              <label className="runtime-asset-picker"><span>当前设备</span><select aria-label="当前设备" value={selectedRuntimeAssetId ?? ""} onChange={(event) => selectRuntimeAsset(event.target.value || null)}><option value="">请选择设备</option>{projectAssets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}</select></label>
              {selectedRuntimeAsset ? <button className="secondary-button compact-button" onClick={() => setShowRuntimeDetails((value) => !value)} type="button">设备详情</button> : null}
            </div>
            {runtimeSelectionMessage ? (
              <div className="runtime-selection-message" role="alert">
                <span>{runtimeSelectionMessage}</span>
                <button aria-label="关闭提示" onClick={() => setRuntimeSelectionMessage(null)} type="button">×</button>
              </div>
            ) : null}
            {selectedRuntimeAsset && showRuntimeDetails ? (
              <aside className="runtime-detail-panel" aria-label={`${selectedRuntimeAsset.name} 设备详情`}>
                <header>
                  <div>
                    <span className="eyebrow">2D DEVICE DETAIL</span>
                    <h2>{selectedRuntimeAsset.name}</h2>
                  </div>
                  <button aria-label="关闭设备详情" onClick={() => setShowRuntimeDetails(false)} type="button">×</button>
                </header>
                <div className={`runtime-device-state is-${selectedDeviceStatus}${selectedRuntimeIsStale ? " is-stale" : ""}`}>
                  <i aria-hidden="true" />
                  <strong>{selectedRuntimeIsStale ? "数据陈旧" : deviceVisualStatusLabel[selectedDeviceStatus]}</strong>
                  <span>{selectedRuntimeConnection?.status === "offline" ? `重连第 ${selectedRuntimeConnection.failureCount} 次` : "实时状态"}</span>
                </div>
                <dl className="runtime-device-meta">
                  <div><dt>assetId</dt><dd>{selectedRuntimeAsset.assetId}</dd></div>
                  <div><dt>模型节点</dt><dd>{selectedRuntimeAsset.modelNode ?? "未绑定"}</dd></div>
                  <div><dt>最近成功</dt><dd>{formatRuntimeTime(selectedRuntimeConnection?.lastSuccessAt)}</dd></div>
                </dl>
                {selectedRuntimeConnection?.status === "offline" ? (
                  <div className={`runtime-offline-alert${selectedRuntimeIsStale ? " is-stale" : ""}`} role="alert">
                    <strong>{selectedRuntimeIsStale ? "设备数据已陈旧" : "设备数据已失联"}</strong>
                    <p>{selectedRuntimeConnection.errorMessage ?? "采集请求失败。"}</p>
                    <small>最后数据保留用于排查，不代表当前实时值。</small>
                  </div>
                ) : null}
                <section className="runtime-metric-section">
                  <div className="runtime-section-heading">
                    <h3>映射指标</h3>
                    {selectedRuntimeConnection?.status === "offline" && selectedRuntimeConnection.snapshot
                      ? <span>最后一次成功值</span>
                      : null}
                  </div>
                  {selectedRuntimeConnection?.snapshot?.metrics.length ? (
                    <div className="runtime-metric-grid">
                      {selectedRuntimeConnection.snapshot.metrics.map((metric) => (
                        <div className="runtime-metric-card" key={metric.bindingId}>
                          <span>{metric.metricKey}</span>
                          <strong>{formatRuntimeValue(metric.value)}{metric.unit ? <small>{metric.unit}</small> : null}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="runtime-empty-metrics">
                      {selectedRuntimeConnection?.status === "loading" ? "正在读取映射数据…" : "尚无可显示指标。"}
                    </p>
                  )}
                </section>
              </aside>
            ) : null}
          </>
        ) : null}
        {mode === "edit" && selectedNodeIds.length > 1 ? <aside className="component-inspector"><h2>已选择 {selectedNodeIds.length} 个组件</h2><p>拖动任意已选组件一起移动；Shift 增减选择，Alt 可选组内单个组件。复制、删除、分组和跨页移动都会进入同一撤销链。</p></aside> : mode === "edit" ? <ComponentInspector editable={editable} node={selectedNode} onModelEditorOpen={(nodeId) => void openModelEditor(nodeId)} onNodeChange={updateNode} onValidationChange={setConfigurationError} projectId={projectId} /> : null}
      </div>
      {showInteractions ? <InteractionEditor project={editor.project} pageId={editor.pageId} assets={projectAssets} metrics={metricCatalog} editable={canEdit && !saving} onApply={(interactions) => !!execute({ type: "interactions.set", interactions })} onClose={() => setShowInteractions(false)} /> : null}
      {showInteractionDebug && mode === "preview" ? <InteractionDebugger runtime={interactions.runtime} snapshot={interactions.snapshot} config={editor.project.interactions} onClose={() => setShowInteractionDebug(false)} /> : null}
      {mode === "preview" && !showInteractionDebug && interactions.snapshot.traces.some((trace) => trace.status === "failed" || trace.status === "limited") ? <button className="interaction-error-notice" type="button" onClick={() => setShowInteractionDebug(true)}>交互执行有失败或限制，查看调试记录</button> : null}
      {showAssets ? <AssetPanel projectId={projectId} editable={canEdit && !saving} onClose={() => { setShowAssets(false); setCatalogRevision((value) => value + 1); }} /> : null}
      {showPublications ? <PublicationPanel projectId={projectId} editable={canEdit} onClose={() => setShowPublications(false)} /> : null}
      {showDataSources ? (
        <DataSourcePanel
          editable={canEdit && !saving}
          onClose={() => { setShowDataSources(false); setCatalogRevision((value) => value + 1); }}
          projectId={projectId}
        />
      ) : null}
      {showTemplates ? (
        <TemplateDialog
          editable={canEdit && !saving}
          onApply={applyTemplate}
          onClose={() => setShowTemplates(false)}
        />
      ) : null}
      {showThemes ? (
        <ThemeDialog
          currentTheme={document.theme}
          editable={canEdit && !saving}
          onApply={applyTheme}
          onClose={() => setShowThemes(false)}
        />
      ) : null}
    </main>
    </ProjectRuntimeContext.Provider>
    </InteractionContext.Provider>
  );
}
