import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { errorMessage, request } from "../api";
import { ComponentInspector } from "../canvas/ComponentInspector";
import { CanvasSurface } from "../canvas/CanvasSurface";
import type { ModelSceneSnapshot } from "../canvas/model-scene";
import { CANVAS_DRAG_TYPE, componentLabels, createCanvasNode, isBackgroundNodeType, type CanvasDocument, type CanvasNode, type CanvasNodeType, type CanvasPatchResponse, type CanvasResponse } from "../canvas/types";

type CanvasPageProps = { mode: "edit" | "preview"; projectId: string };
const projectPath = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/canvas`;
const routePath = (projectId: string, suffix: string) => `#/projects/${encodeURIComponent(projectId)}/${suffix}`;

export function CanvasPage({ mode, projectId }: CanvasPageProps) {
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [projectName, setProjectName] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedModelSceneNodePath, setSelectedModelSceneNodePath] = useState<string | null>(null);
  const [modelScenes, setModelScenes] = useState<Record<string, ModelSceneSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyNodeIdsRef = useRef(new Set<string>());
  const deletedNodeIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setSelectedNodeId(null);
    setSelectedModelSceneNodePath(null);
    setModelScenes({});
    setConfigurationError(null);
    dirtyNodeIdsRef.current.clear();
    deletedNodeIdsRef.current.clear();
    setDirty(false);
    void request<CanvasResponse>(projectPath(projectId))
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

  const updateModelScene = useCallback((
    canvasNodeId: string,
    snapshot: ModelSceneSnapshot | null,
  ) => {
    setModelScenes((current) => {
      if (snapshot === null) {
        if (!(canvasNodeId in current)) return current;
        const next = { ...current };
        delete next[canvasNodeId];
        return next;
      }
      if (current[canvasNodeId] === snapshot) return current;
      return { ...current, [canvasNodeId]: snapshot };
    });
  }, []);

  const updateNode = useCallback((node: CanvasNode) => {
    setDocument((current) => current ? { ...current, nodes: current.nodes.map((item) => item.id === node.id ? node : item) } : current);
    markNodeDirty(node.id);
  }, [markNodeDirty]);

  const createNode = useCallback((type: CanvasNodeType, x: number, y: number) => {
    if (!document) return;
    const maxZIndex = document.nodes.reduce((maximum, node) => Math.max(maximum, node.zIndex), 0);
    const node = createCanvasNode(type, x, y, isBackgroundNodeType(type) ? 0 : maxZIndex + 1);
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
      const result = await request<CanvasPatchResponse>(projectPath(projectId), {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: document.revision,
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
    window.location.hash = routePath(projectId, "preview").slice(1);
  };

  const startPaletteDrag = (event: DragEvent<HTMLButtonElement>, type: CanvasNodeType) => {
    event.dataTransfer.setData(CANVAS_DRAG_TYPE, type);
    event.dataTransfer.setData("text/plain", componentLabels[type]);
    event.dataTransfer.effectAllowed = "copy";
  };

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
        <div className="canvas-document-meta"><span>{document.width} × {document.height}</span><span>版本 {document.revision}</span>{mode === "edit" ? <span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? "有未保存更改" : "已保存"}</span> : null}</div>
        <div className="canvas-toolbar-actions">
          {mode === "edit" ? <>
            <button className="secondary-button compact-button" disabled={!selectedNodeId || !canEdit || saving} onClick={deleteSelectedNode} type="button">删除组件</button>
            <button className="secondary-button compact-button" disabled={saving || configurationError !== null} onClick={() => void openPreview()} title={configurationError ?? undefined} type="button">预览</button>
            <button className="primary-button compact-button" disabled={!dirty || saving || !canEdit || configurationError !== null} onClick={() => void save()} title={configurationError ?? undefined} type="button">{saving ? "保存中…" : "保存画布"}</button>
          </> : <a className="secondary-button compact-button" href={routePath(projectId, "canvas")}>返回编辑</a>}
        </div>
      </header>
      {saveError ? <div className="canvas-save-error" role="alert">保存失败：{saveError}</div> : null}
      {mode === "edit" && !canEdit ? <div className="canvas-readonly-notice">当前项目权限为只读，不能移动或保存组件。</div> : null}
      <div className={`canvas-workbench${mode === "preview" ? " is-preview" : ""}`}>
        {mode === "edit" ? <aside className="component-palette">
          <div className="component-palette-heading"><span className="eyebrow">Components</span><h2>组件库</h2><p>拖到画布中创建组件</p></div>
          <section aria-labelledby="palette-3d-title" className="palette-group is-model">
            <h3 className="palette-group-title" id="palette-3d-title"><span>3D 场景</span><em>1</em></h3>
            <button aria-label="3D 模型，导入 GLB 或 GLTF" className="palette-item palette-model-3d" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "model-3d")} title="3D 模型 · 导入 GLB 或 GLTF" type="button"><span className="palette-icon" aria-hidden="true">⬡</span><span><strong>3D 模型</strong><small>导入 GLB 或 GLTF</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-charts-title" className="palette-group is-chart">
            <h3 className="palette-group-title" id="palette-charts-title"><span>图表</span><em>2</em></h3>
            <button aria-label="折线图，连续趋势数据" className="palette-item palette-line-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "line-chart")} title="折线图 · 连续趋势数据" type="button"><span className="palette-icon" aria-hidden="true">⌁</span><span><strong>折线图</strong><small>连续趋势数据</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="柱状图，分类对比数据" className="palette-item palette-bar-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "bar-chart")} title="柱状图 · 分类对比数据" type="button"><span className="palette-icon" aria-hidden="true">▥</span><span><strong>柱状图</strong><small>分类对比数据</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-shapes-title" className="palette-group is-shape">
            <h3 className="palette-group-title" id="palette-shapes-title"><span>基础图形</span><em>2</em></h3>
            <button aria-label="矩形，可配置填充和圆角" className="palette-item palette-rectangle" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "rectangle")} title="矩形 · 可配置填充和圆角" type="button"><span className="palette-icon" aria-hidden="true"><i className="palette-shape-icon is-rectangle" /></span><span><strong>矩形</strong><small>可配置填充和圆角</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="圆形，固定比例缩放" className="palette-item palette-circle" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "circle")} title="圆形 · 固定比例缩放" type="button"><span className="palette-icon" aria-hidden="true"><i className="palette-shape-icon is-circle" /></span><span><strong>圆形</strong><small>固定比例缩放</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <section aria-labelledby="palette-decorations-title" className="palette-group is-decoration">
            <h3 className="palette-group-title" id="palette-decorations-title"><span>界面点缀</span><em>6</em></h3>
            <button aria-label="大屏标题，主标题与英文副标题" className="palette-item palette-screen-title" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "screen-title")} title="大屏标题 · 主标题与英文副标题" type="button"><span className="palette-icon" aria-hidden="true">T</span><span><strong>大屏标题</strong><small>主标题与英文副标题</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="背景点缀，网格与科技光环" className="palette-item palette-background-decoration" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "background-decoration")} title="背景点缀 · 网格与科技光环" type="button"><span className="palette-icon" aria-hidden="true">◇</span><span><strong>背景点缀</strong><small>网格与科技光环</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="时间日期，实时日期与时钟" className="palette-item palette-datetime" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "datetime")} title="时间日期 · 实时日期与时钟" type="button"><span className="palette-icon" aria-hidden="true">◷</span><span><strong>时间日期</strong><small>实时日期与时钟</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="标题，看板区块标题" className="palette-item palette-section-title" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "section-title")} title="标题 · 看板区块标题" type="button"><span className="palette-icon" aria-hidden="true">▰</span><span><strong>标题</strong><small>看板区块标题</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="小卡片背景，轻量面板底框" className="palette-item palette-card-background" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "card-background")} title="小卡片背景 · 轻量面板底框" type="button"><span className="palette-icon" aria-hidden="true">▣</span><span><strong>小卡片背景</strong><small>轻量面板底框</small></span><span className="palette-drag-mark">⋮⋮</span></button>
            <button aria-label="小图标背景，固定比例图标底座" className="palette-item palette-icon-background" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "icon-background")} title="小图标背景 · 固定比例图标底座" type="button"><span className="palette-icon" aria-hidden="true">◆</span><span><strong>小图标背景</strong><small>固定比例图标底座</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          </section>
          <div className="palette-note"><strong>资源分离</strong><p>模型文件独立存储；画布节点只保存配置、资源 ID 与数据绑定 ID。</p></div>
        </aside> : null}
        <CanvasSurface document={document} editable={editable} onCreateNode={createNode} onModelSceneChange={updateModelScene} onNodeChange={updateNode} onSelectNode={selectCanvasNode} selectedNodeId={selectedNodeId} />
        {mode === "edit" ? <ComponentInspector editable={editable} modelScene={selectedNode ? modelScenes[selectedNode.id] ?? null : null} node={selectedNode} onModelSceneNodeSelect={setSelectedModelSceneNodePath} onNodeChange={updateNode} onValidationChange={setConfigurationError} projectId={projectId} selectedModelSceneNodePath={selectedModelSceneNodePath} /> : null}
      </div>
    </main>
  );
}
