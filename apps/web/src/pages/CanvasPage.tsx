import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ApiRequestError, errorMessage, request } from "../api";
import { ComponentPalette } from "../canvas/ComponentPalette";
import { ComponentInspector } from "../canvas/ComponentInspector";
import { CanvasSurface } from "../canvas/CanvasSurface";
import { projectAssetsPath, type ProjectAsset, type ProjectAssetListResponse } from "../canvas/assets";
import { findModelSceneNode, type ModelSceneSnapshot } from "../canvas/model-scene";
import { canvasRoutePath, modelEditorRoutePath, projectCanvasPath } from "../canvas/routes";
import { TemplateDialog } from "../canvas/TemplateDialog";
import { getCanvasTemplate, instantiateCanvasTemplate, type CanvasTemplateId } from "../canvas/templates";
import { ThemeDialog } from "../canvas/ThemeDialog";
import { applyCanvasThemeToNode, applyCanvasThemeToNodes, canvasThemePresetLabels } from "../canvas/themes";
import { CANVAS_DRAG_TYPE, componentLabels, createCanvasNode, isBackgroundNodeType, isModel3DNodeType, type CanvasDocument, type CanvasNode, type CanvasNodeType, type CanvasPatchResponse, type CanvasResponse, type CanvasTheme, type ModelNodeAppearance } from "../canvas/types";
import { DataSourcePanel } from "../DataSourcePanel";
import { assetRuntimeStatePath, deviceVisualStatus, deviceVisualStatusLabel, type AssetRuntimeStateResponse, type DeviceVisualStatus, type RuntimeAssetConnection, type RuntimeMetricValue } from "../runtime-state";

type CanvasPageProps = {
  initialTemplateId?: CanvasTemplateId;
  mode: "edit" | "preview";
  projectId: string;
};

type AssetRuntimePollOutcome =
  | { asset: ProjectAsset; kind: "success"; result: AssetRuntimeStateResponse }
  | { asset: ProjectAsset; failureCount: number; kind: "failure"; reason: unknown };

const runtimeAppearances: Partial<Record<DeviceVisualStatus, ModelNodeAppearance>> = {
  alarm: { color: "#ff4d5f", opacity: 1, visible: true },
  offline: { color: "#697386", opacity: 0.48, visible: true },
  running: { color: "#35d07f", opacity: 1, visible: true },
  stopped: { color: "#8492a6", opacity: 0.82, visible: true },
  warning: { color: "#f6c344", opacity: 1, visible: true },
};

const formatRuntimeValue = (value: RuntimeMetricValue): string => {
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

export function CanvasPage({ initialTemplateId, mode, projectId }: CanvasPageProps) {
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [projectName, setProjectName] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedModelSceneNodePath, setSelectedModelSceneNodePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [showDataSources, setShowDataSources] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [themeNotice, setThemeNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const [assetLoadError, setAssetLoadError] = useState<string | null>(null);
  const [assetListLoading, setAssetListLoading] = useState(mode === "preview");
  const [modelScenes, setModelScenes] = useState<Record<string, ModelSceneSnapshot>>({});
  const [runtimeConnections, setRuntimeConnections] = useState<Record<string, RuntimeAssetConnection>>({});
  const [selectedRuntimeAssetId, setSelectedRuntimeAssetId] = useState<string | null>(null);
  const [runtimeSelectionMessage, setRuntimeSelectionMessage] = useState<string | null>(null);
  const dirtyNodeIdsRef = useRef(new Set<string>());
  const deletedNodeIdsRef = useRef(new Set<string>());
  const initialTemplateAppliedRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setSelectedNodeId(null);
    setSelectedModelSceneNodePath(null);
    setConfigurationError(null);
    dirtyNodeIdsRef.current.clear();
    deletedNodeIdsRef.current.clear();
    setDirty(false);
    void request<CanvasResponse>(projectCanvasPath(projectId))
      .then((result) => {
        if (!active) return;
        setDocument(result.canvas);
        setProjectName(result.project.name);
        setCanEdit(result.editable);
      })
      .catch((reason) => { if (active) setLoadError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setProjectAssets([]);
    setAssetLoadError(null);
    setRuntimeConnections({});
    setModelScenes({});
    setSelectedRuntimeAssetId(null);
    setRuntimeSelectionMessage(null);
    if (mode !== "preview") {
      setAssetListLoading(false);
      return () => { active = false; };
    }

    setAssetListLoading(true);
    void request<ProjectAssetListResponse>(projectAssetsPath(projectId))
      .then((result) => {
        if (active) setProjectAssets(result.assets);
      })
      .catch((reason) => {
        if (active) setAssetLoadError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setAssetListLoading(false);
      });
    return () => { active = false; };
  }, [mode, projectId]);

  const model3DNodeCount = useMemo(
    () => document?.nodes.filter((node) => isModel3DNodeType(node.type)).length ?? 0,
    [document],
  );
  const mappedRuntimeAssets = useMemo(
    () => projectAssets.filter((asset) => asset.modelNode !== null),
    [projectAssets],
  );
  const runtimeSetupError = useMemo(() => {
    if (mode !== "preview" || assetListLoading) return null;
    if (assetLoadError) return `资产台账加载失败：${assetLoadError}`;
    if (model3DNodeCount !== 1) {
      return `本地纵向测试要求画布中恰好有 1 个 3D 组件，当前为 ${model3DNodeCount} 个。`;
    }
    if (mappedRuntimeAssets.length === 0) {
      return "没有绑定模型节点的资产，请先在 3D 编辑器中完成设备与模型节点绑定。";
    }
    if (mappedRuntimeAssets.length > 50) {
      return `当前有 ${mappedRuntimeAssets.length} 个模型资产；本地直连轮询上限为 50，请使用服务端批量采集器。`;
    }
    return null;
  }, [assetListLoading, assetLoadError, mappedRuntimeAssets.length, mode, model3DNodeCount]);

  useEffect(() => {
    if (
      mode !== "preview"
      || assetListLoading
      || runtimeSetupError
      || mappedRuntimeAssets.length === 0
    ) {
      return;
    }

    let cancelled = false;
    let nextPollTimer: number | null = null;
    const failureCounts = new Map<string, number>();
    setRuntimeConnections(Object.fromEntries(
      mappedRuntimeAssets.map((asset) => [
        asset.id,
        { status: "loading", failureCount: 0 } satisfies RuntimeAssetConnection,
      ]),
    ));

    const poll = async () => {
      const outcomes: AssetRuntimePollOutcome[] = await Promise.all(mappedRuntimeAssets.map(async (asset) => {
        try {
          const result = await request<AssetRuntimeStateResponse>(
            assetRuntimeStatePath(projectId, asset.id),
          );
          failureCounts.set(asset.id, 0);
          return { asset, kind: "success", result } as const;
        } catch (reason) {
          const failureCount = (failureCounts.get(asset.id) ?? 0) + 1;
          failureCounts.set(asset.id, failureCount);
          const apiError = reason instanceof ApiRequestError ? reason : null;
          console.error("Asset runtime polling failed.", {
            assetId: asset.assetId,
            assetRecordId: asset.id,
            errorCode: apiError?.code ?? "runtime_request_failed",
            failureCount,
            projectId,
            reason,
            requestId: apiError?.requestId,
          });
          return { asset, failureCount, kind: "failure", reason } as const;
        }
      }));

      if (cancelled) return;
      setRuntimeConnections((current) => {
        const next = { ...current };
        for (const outcome of outcomes) {
          if (outcome.kind === "success") {
            next[outcome.asset.id] = {
              status: "live",
              snapshot: outcome.result.runtimeState,
              failureCount: 0,
              lastSuccessAt: outcome.result.runtimeState.timestamp,
            };
          } else {
            const previous = current[outcome.asset.id];
            const apiError = outcome.reason instanceof ApiRequestError
              ? outcome.reason
              : null;
            next[outcome.asset.id] = {
              status: "offline",
              snapshot: previous?.snapshot,
              errorCode: apiError?.code ?? "runtime_request_failed",
              errorMessage: errorMessage(outcome.reason),
              failedAt: new Date().toISOString(),
              failureCount: outcome.failureCount,
              lastSuccessAt: previous?.lastSuccessAt,
            };
          }
        }
        return next;
      });

      const successfulIntervals = outcomes.flatMap((outcome) => (
        outcome.kind === "success" ? [outcome.result.runtimeState.pollAfterSeconds] : []
      ));
      const maximumFailureCount = Math.max(0, ...failureCounts.values());
      const nextSeconds = successfulIntervals.length > 0
        ? Math.min(...successfulIntervals)
        : Math.min(2 ** Math.max(maximumFailureCount - 1, 0), 30);
      nextPollTimer = window.setTimeout(() => void poll(), nextSeconds * 1000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (nextPollTimer !== null) window.clearTimeout(nextPollTimer);
    };
  }, [assetListLoading, mappedRuntimeAssets, mode, projectId, runtimeSetupError]);

  const runtimeAppearanceOverrides = useMemo(() => {
    const overrides: Record<string, ModelNodeAppearance> = {};
    if (mode !== "preview" || runtimeSetupError) return overrides;
    for (const asset of mappedRuntimeAssets) {
      if (!asset.modelNode) continue;
      const appearance = runtimeAppearances[deviceVisualStatus(runtimeConnections[asset.id])];
      if (appearance) overrides[asset.modelNode] = appearance;
    }
    return overrides;
  }, [mappedRuntimeAssets, mode, runtimeConnections, runtimeSetupError]);

  const selectedRuntimeAsset = selectedRuntimeAssetId
    ? projectAssets.find((asset) => asset.id === selectedRuntimeAssetId) ?? null
    : null;
  const selectedRuntimeConnection = selectedRuntimeAsset
    ? runtimeConnections[selectedRuntimeAsset.id]
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

  const markNodeDirty = useCallback((nodeId: string) => {
    dirtyNodeIdsRef.current.add(nodeId);
    deletedNodeIdsRef.current.delete(nodeId);
    setDirty(true);
    setSaveError(null);
  }, []);

  const selectCanvasNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedModelSceneNodePath(null);
  }, []);

  const selectModelSceneNode = useCallback((
    canvasNodeId: string,
    sceneNodePath: string | null,
  ) => {
    setSelectedNodeId(canvasNodeId);
    setSelectedModelSceneNodePath(sceneNodePath);
    if (mode !== "preview") return;
    if (sceneNodePath === null) {
      setSelectedRuntimeAssetId(null);
      setRuntimeSelectionMessage(null);
      return;
    }

    const snapshot = modelScenes[canvasNodeId];
    if (!snapshot) {
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
        setSelectedRuntimeAssetId(asset.id);
        setRuntimeSelectionMessage(null);
        return;
      }
    }
    setSelectedRuntimeAssetId(null);
    setRuntimeSelectionMessage("所点模型对象及其父节点尚未绑定资产，无法打开设备详情。");
  }, [mode, modelScenes, projectAssets]);

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

  const updateNode = useCallback((node: CanvasNode) => {
    setDocument((current) => current ? { ...current, nodes: current.nodes.map((item) => item.id === node.id ? node : item) } : current);
    markNodeDirty(node.id);
  }, [markNodeDirty]);

  const createNode = useCallback((type: CanvasNodeType, x: number, y: number) => {
    if (!document) return;
    const maxZIndex = document.nodes.reduce((maximum, node) => Math.max(maximum, node.zIndex), 0);
    const node = applyCanvasThemeToNode(
      createCanvasNode(type, x, y, isBackgroundNodeType(type) ? 0 : maxZIndex + 1),
      document.theme,
    );
    setDocument({ ...document, nodes: [...document.nodes, node] });
    selectCanvasNode(node.id);
    markNodeDirty(node.id);
  }, [document, markNodeDirty, selectCanvasNode]);

  const deleteSelectedNode = () => {
    if (!document || !selectedNodeId || !document.nodes.some((node) => node.id === selectedNodeId)) return;
    setDocument({ ...document, nodes: document.nodes.filter((node) => node.id !== selectedNodeId) });
    dirtyNodeIdsRef.current.delete(selectedNodeId);
    deletedNodeIdsRef.current.add(selectedNodeId);
    selectCanvasNode(null);
    setDirty(true);
    setSaveError(null);
  };

  const save = async (): Promise<boolean> => {
    if (configurationError) {
      setSaveError(`组件配置无效：${configurationError}`);
      return false;
    }
    if (!document || !dirty || saving || !canEdit) return !dirty;
    setSaving(true);
    setSaveError(null);
    const dirtyNodeIds = new Set(dirtyNodeIdsRef.current);
    try {
      const result = await request<CanvasPatchResponse>(projectCanvasPath(projectId), {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: document.revision,
          theme: document.theme,
          upsertNodes: document.nodes.filter((node) => dirtyNodeIds.has(node.id)),
          deleteNodeIds: [...deletedNodeIdsRef.current],
        }),
      });
      setDocument(result.canvas);
      dirtyNodeIdsRef.current.clear();
      deletedNodeIdsRef.current.clear();
      setDirty(false);
      return true;
    } catch (reason) {
      setSaveError(errorMessage(reason));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openPreview = async () => {
    if (dirty && !(await save())) return;
    window.location.hash = canvasRoutePath(projectId, "preview").slice(1);
  };

  const openModelEditor = async (nodeId: string) => {
    if (dirty && !(await save())) return;
    window.location.hash = modelEditorRoutePath(projectId, nodeId).slice(1);
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

    dirtyNodeIdsRef.current.clear();
    deletedNodeIdsRef.current.clear();
    nextNodes.forEach((node) => dirtyNodeIdsRef.current.add(node.id));
    document.nodes.forEach((node) => deletedNodeIdsRef.current.add(node.id));
    setDocument({ ...document, nodes: nextNodes, theme: template.canvasTheme });
    selectCanvasNode(null);
    setConfigurationError(null);
    setSaveError(null);
    setThemeNotice(`已应用“${template.name}”配色；模板中的 3D 组件沿用原有 3D 配置。`);
    setDirty(true);
    setShowTemplates(false);
  }, [canEdit, document, saving, selectCanvasNode]);

  const applyTheme = useCallback((theme: CanvasTheme) => {
    if (!document || !canEdit || saving) return;
    const nextNodes = applyCanvasThemeToNodes(document.nodes, theme);
    const themedNodes = nextNodes.filter((node) => !isModel3DNodeType(node.type));
    themedNodes.forEach((node) => dirtyNodeIdsRef.current.add(node.id));
    setDocument({ ...document, nodes: nextNodes, theme });
    setSaveError(null);
    setThemeNotice(
      `已切换为${canvasThemePresetLabels[theme.presetId]}主题，联动更新 ${themedNodes.length} 个非 3D 组件；3D 组件保持不变。`,
    );
    setDirty(true);
    setShowThemes(false);
  }, [canEdit, document, saving]);

  useEffect(() => {
    if (!initialTemplateId || loading || !document || initialTemplateAppliedRef.current) return;
    initialTemplateAppliedRef.current = true;

    if (mode !== "edit") {
      setSaveError("模板只能在 2D 画布编辑模式中套用。");
    } else if (!canEdit) {
      setSaveError("当前项目是只读项目，不能套用模板。");
    } else {
      applyTemplate(initialTemplateId);
    }

    window.history.replaceState(null, "", canvasRoutePath(projectId, "canvas"));
  }, [applyTemplate, canEdit, document, initialTemplateId, loading, mode, projectId]);

  if (loading) return <main className="canvas-page-state"><p className="eyebrow">Canvas</p><h1>正在加载画布…</h1></main>;
  if (loadError || !document) {
    return <main className="canvas-page-state error-state"><p className="eyebrow">Canvas error</p><h1>画布加载失败</h1><p>{loadError ?? "接口没有返回画布文档。"}</p><a className="secondary-button" href="#/projects">返回项目列表</a></main>;
  }

  const editable = mode === "edit" && canEdit && !saving;
  const selectedNode = selectedNodeId ? document.nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  return (
    <main className={`canvas-page canvas-page-${mode}`}>
      <header className="canvas-toolbar">
        <div className="canvas-toolbar-title"><a aria-label="返回项目列表" className="canvas-back-link" href="#/projects">←</a><div><span>{mode === "edit" ? "2D 画布" : "可视化预览"}</span><strong>{projectName}</strong></div></div>
        <div className="canvas-document-meta"><span>{document.width} × {document.height}</span><span>{canvasThemePresetLabels[document.theme.presetId]}</span><span>版本 {document.revision}</span>{mode === "edit" ? <span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? "有未保存更改" : "已保存"}</span> : null}</div>
        <div className="canvas-toolbar-actions">
          {mode === "edit" ? <>
            <button className="secondary-button compact-button" disabled={!canEdit || saving} onClick={() => setShowTemplates(true)} type="button">模板</button>
            <button className="secondary-button compact-button canvas-theme-button" disabled={!canEdit || saving} onClick={() => setShowThemes(true)} type="button">
              <span aria-hidden="true" style={{ backgroundColor: document.theme.accentColor }} />
              主题
            </button>
            <button className="secondary-button compact-button" onClick={() => setShowDataSources(true)} type="button">数据源</button>
            <button className="secondary-button compact-button" disabled={!selectedNodeId || !canEdit || saving} onClick={deleteSelectedNode} type="button">删除组件</button>
            <button className="secondary-button compact-button" disabled={saving || configurationError !== null} onClick={() => void openPreview()} title={configurationError ?? undefined} type="button">预览</button>
            <button className="primary-button compact-button" disabled={!dirty || saving || !canEdit || configurationError !== null} onClick={() => void save()} title={configurationError ?? undefined} type="button">{saving ? "保存中…" : "保存画布"}</button>
          </> : <a className="secondary-button compact-button" href={canvasRoutePath(projectId, "canvas")}>返回编辑</a>}
        </div>
      </header>
      {saveError || themeNotice || (mode === "edit" && !canEdit) ? (
        <div className="canvas-message-stack">
          {saveError ? <div className="canvas-save-error" role="alert">保存失败：{saveError}</div> : null}
          {themeNotice ? <div className="canvas-theme-notice" role="status"><span>{themeNotice}</span><button aria-label="关闭主题提示" onClick={() => setThemeNotice(null)} type="button">×</button></div> : null}
          {mode === "edit" && !canEdit ? <div className="canvas-readonly-notice">当前项目权限为只读，不能移动或保存组件。</div> : null}
        </div>
      ) : null}
      <div className={`canvas-workbench${mode === "preview" ? " is-preview" : ""}`}>
        {mode === "edit" ? <ComponentPalette editable={editable} onDragStart={startPaletteDrag} /> : null}
        <CanvasSurface
          document={document}
          editable={editable}
          modelInteractionEnabled={mode === "preview"}
          onCreateNode={createNode}
          onModelSceneChange={mode === "preview" ? handleModelSceneChange : undefined}
          onModelSceneNodeSelect={selectModelSceneNode}
          onNodeChange={updateNode}
          onSelectNode={selectCanvasNode}
          runtimeAppearanceOverrides={runtimeAppearanceOverrides}
          selectedModelSceneNodePath={selectedModelSceneNodePath}
          selectedNodeId={selectedNodeId}
        />
        {mode === "preview" ? (
          <>
            <div
              className={`runtime-status-banner${runtimeSetupError ? " is-error" : offlineDeviceCount > 0 ? staleDeviceCount === offlineDeviceCount ? " is-stale" : " is-offline" : liveDeviceCount > 0 ? " is-live" : " is-loading"}`}
              role={runtimeSetupError || offlineDeviceCount > 0 ? "alert" : "status"}
            >
              <strong>REST 模拟采集</strong>
              <span>
                {assetListLoading
                  ? "🟡 正在读取资产映射…"
                  : runtimeSetupError
                    ? `⚠ ${runtimeSetupError}`
                    : offlineDeviceCount > 0
                      ? `${staleDeviceCount === offlineDeviceCount ? "🟠" : "🔴"} ${offlineSummary} · 正在重连（第 ${Math.max(...runtimeConnectionList.map((state) => state.failureCount))} 次）`
                      : liveDeviceCount > 0
                        ? `🟢 在线 ${liveDeviceCount} 台 · 字段映射与 3D 状态已生效`
                        : "🟡 正在连接设备数据…"}
              </span>
            </div>
            {runtimeSelectionMessage ? (
              <div className="runtime-selection-message" role="alert">
                <span>{runtimeSelectionMessage}</span>
                <button aria-label="关闭提示" onClick={() => setRuntimeSelectionMessage(null)} type="button">×</button>
              </div>
            ) : null}
            {selectedRuntimeAsset ? (
              <aside className="runtime-detail-panel" aria-label={`${selectedRuntimeAsset.name} 设备详情`}>
                <header>
                  <div>
                    <span className="eyebrow">2D DEVICE DETAIL</span>
                    <h2>{selectedRuntimeAsset.name}</h2>
                  </div>
                  <button aria-label="关闭设备详情" onClick={() => setSelectedRuntimeAssetId(null)} type="button">×</button>
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
                          <code>{metric.sourcePath}</code>
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
        {mode === "edit" ? <ComponentInspector editable={editable} node={selectedNode} onModelEditorOpen={(nodeId) => void openModelEditor(nodeId)} onNodeChange={updateNode} onValidationChange={setConfigurationError} projectId={projectId} /> : null}
      </div>
      {showDataSources ? (
        <DataSourcePanel
          editable={canEdit && !saving}
          onClose={() => setShowDataSources(false)}
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
  );
}
