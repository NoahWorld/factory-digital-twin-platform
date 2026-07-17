import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { errorMessage, request } from "../api";
import { CanvasSurface } from "../canvas/CanvasSurface";
import { CANVAS_DRAG_TYPE, componentLabels, createCanvasNode, type CanvasDocument, type CanvasNode, type CanvasNodeType, type CanvasPatchResponse, type CanvasResponse } from "../canvas/types";

type CanvasPageProps = { mode: "edit" | "preview"; projectId: string };
const projectPath = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/canvas`;
const routePath = (projectId: string, suffix: string) => `#/projects/${encodeURIComponent(projectId)}/${suffix}`;

export function CanvasPage({ mode, projectId }: CanvasPageProps) {
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [projectName, setProjectName] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyNodeIdsRef = useRef(new Set<string>());
  const deletedNodeIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setSelectedNodeId(null);
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

  const updateNode = useCallback((node: CanvasNode) => {
    setDocument((current) => current ? { ...current, nodes: current.nodes.map((item) => item.id === node.id ? node : item) } : current);
    markNodeDirty(node.id);
  }, [markNodeDirty]);

  const createNode = useCallback((type: CanvasNodeType, x: number, y: number) => {
    if (!document) return;
    const maxZIndex = document.nodes.reduce((maximum, node) => Math.max(maximum, node.zIndex), 0);
    const node = createCanvasNode(type, x, y, maxZIndex + 1);
    setDocument({ ...document, nodes: [...document.nodes, node] });
    setSelectedNodeId(node.id);
    markNodeDirty(node.id);
  }, [document, markNodeDirty]);

  const deleteSelectedNode = () => {
    if (!document || !selectedNodeId || !document.nodes.some((node) => node.id === selectedNodeId)) return;
    setDocument({ ...document, nodes: document.nodes.filter((node) => node.id !== selectedNodeId) });
    dirtyNodeIdsRef.current.delete(selectedNodeId);
    deletedNodeIdsRef.current.add(selectedNodeId);
    setSelectedNodeId(null);
    setDirty(true);
    setSaveError(null);
  };

  const save = async (): Promise<boolean> => {
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
  return (
    <main className={`canvas-page canvas-page-${mode}`}>
      <header className="canvas-toolbar">
        <div className="canvas-toolbar-title"><a aria-label="返回项目列表" className="canvas-back-link" href="#/projects">←</a><div><span>{mode === "edit" ? "2D 画布" : "可视化预览"}</span><strong>{projectName}</strong></div></div>
        <div className="canvas-document-meta"><span>{document.width} × {document.height}</span><span>版本 {document.revision}</span>{mode === "edit" ? <span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? "有未保存更改" : "已保存"}</span> : null}</div>
        <div className="canvas-toolbar-actions">
          {mode === "edit" ? <>
            <button className="secondary-button compact-button" disabled={!selectedNodeId || !canEdit || saving} onClick={deleteSelectedNode} type="button">删除组件</button>
            <button className="secondary-button compact-button" disabled={saving} onClick={() => void openPreview()} type="button">预览</button>
            <button className="primary-button compact-button" disabled={!dirty || saving || !canEdit} onClick={() => void save()} type="button">{saving ? "保存中…" : "保存画布"}</button>
          </> : <a className="secondary-button compact-button" href={routePath(projectId, "canvas")}>返回编辑</a>}
        </div>
      </header>
      {saveError ? <div className="canvas-save-error" role="alert">保存失败：{saveError}</div> : null}
      {mode === "edit" && !canEdit ? <div className="canvas-readonly-notice">当前项目权限为只读，不能移动或保存组件。</div> : null}
      <div className={`canvas-workbench${mode === "preview" ? " is-preview" : ""}`}>
        {mode === "edit" ? <aside className="component-palette">
          <div className="component-palette-heading"><span className="eyebrow">Components</span><h2>图表组件</h2><p>拖到画布中创建组件</p></div>
          <button className="palette-item palette-line-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "line-chart")} type="button"><span className="palette-icon" aria-hidden="true">⌁</span><span><strong>折线图</strong><small>连续趋势数据</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          <button className="palette-item palette-bar-chart" disabled={!canEdit || saving} draggable={canEdit && !saving} onDragStart={(event) => startPaletteDrag(event, "bar-chart")} type="button"><span className="palette-icon" aria-hidden="true">▥</span><span><strong>柱状图</strong><small>分类对比数据</small></span><span className="palette-drag-mark">⋮⋮</span></button>
          <div className="palette-note"><strong>轻量组件</strong><p>当前图表由 SVG 渲染，不引入大型图表运行库。后续绑定数据时只保存数据源引用。</p></div>
        </aside> : null}
        <CanvasSurface document={document} editable={editable} onCreateNode={createNode} onNodeChange={updateNode} onSelectNode={setSelectedNodeId} selectedNodeId={selectedNodeId} />
      </div>
    </main>
  );
}
