import { useProjectEditorContext } from "../project-editor";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, request } from "../api";
import { Model3DInspector } from "../canvas/Model3DInspector";
import { Model3DNode } from "../canvas/Model3DNode";
import type { ModelSceneSnapshot } from "../canvas/model-scene";
import { canvasRoutePath, projectCanvasPath } from "../canvas/routes";
import {
  isModel3DNodeType,
  type CanvasNode,
  type CanvasPatchResponse,
  type CanvasResponse,
} from "../canvas/types";

type Model3DEditorPageProps = {
  nodeId: string;
  projectId: string;
};

export default function Model3DEditorPage({
  nodeId,
  projectId,
}: Model3DEditorPageProps) {
  const { editor, projectName, canEdit, loading, loadError: projectLoadError, saveError, setSaveError, saving, dirty, execute, travel, selectPage, save: saveProject, draftNotice } = useProjectEditorContext();
  const modelPage = editor?.project.pages.find((page) => page.nodes.some((node) => node.id === nodeId));
  const node = modelPage?.nodes.find((node) => node.id === nodeId) ?? null;
  const revision = editor?.project.revision ?? 0;
  const loadError = projectLoadError ?? (!loading && (!node || !isModel3DNodeType(node.type)) ? "此项目中没有对应的 3D 组件。" : null);
  const [modelScene, setModelScene] = useState<ModelSceneSnapshot | null>(null);
  const [selectedSceneNodePath, setSelectedSceneNodePath] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);

  useEffect(() => {
    if (modelPage && editor?.pageId !== modelPage.id) selectPage(modelPage.id);
  }, [modelPage?.id, editor?.pageId, selectPage]);
  useEffect(() => { setModelScene(null); setSelectedSceneNodePath(null); setConfigurationError(null); }, [nodeId]);
  const updateNode = useCallback((nextNode: CanvasNode) => {
    if (modelPage) execute({ type: "nodes.upsert", pageId: modelPage.id, nodes: [nextNode] });
  }, [modelPage?.id, execute]);

  const updateModelScene = useCallback((
    canvasNodeId: string,
    snapshot: ModelSceneSnapshot | null,
  ) => {
    if (canvasNodeId === nodeId) setModelScene(snapshot);
  }, [nodeId]);

  const save = async (): Promise<boolean> => {
    if (configurationError) {
      setSaveError(`3D 配置无效：${configurationError}`);
      return false;
    }
    return saveProject();
  };

  const returnToCanvas = () => {
    window.location.hash = canvasRoutePath(projectId, "canvas", modelPage?.id).slice(1);
  };

  const saveAndReturn = async () => {
    if (dirty && !(await save())) return;
    window.location.hash = canvasRoutePath(projectId, "canvas", modelPage?.id).slice(1);
  };

  if (loading) {
    return <main className="canvas-page-state"><p className="eyebrow">3D editor</p><h1>正在加载 3D 编辑器…</h1></main>;
  }

  if (loadError || !node) {
    return (
      <main className="canvas-page-state error-state">
        <p className="eyebrow">3D editor error</p>
        <h1>3D 编辑器加载失败</h1>
        <p>{loadError ?? "接口没有返回 3D 组件。"}</p>
        <a className="secondary-button" href={canvasRoutePath(projectId, "canvas", modelPage?.id)}>返回画布</a>
      </main>
    );
  }

  const editable = canEdit && !saving;
  return (
    <main className="model-editor-page">
      <header className="canvas-toolbar model-editor-toolbar">
        <div className="canvas-toolbar-title">
          <button aria-label="返回画布" className="canvas-back-link" onClick={returnToCanvas} type="button">←</button>
          <div><span>独立工作区 / 3D 场景</span><strong>{projectName}</strong></div>
        </div>
        <div className="canvas-document-meta">
          <span>{modelPage?.name}</span><span>组件 {node.id.slice(0, 8)}</span>
          <span>版本 {revision}</span>
          <span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? "有未保存更改" : "已同步到画布"}</span>
        </div>
        <div className="canvas-toolbar-actions">
          <button className="secondary-button compact-button" disabled={!canEdit || saving || !editor?.past.length} onClick={() => travel("undo")} type="button">撤销</button>
          <button className="secondary-button compact-button" disabled={!canEdit || saving || !editor?.future.length} onClick={() => travel("redo")} type="button">重做</button>
          <button className="secondary-button compact-button" onClick={returnToCanvas} type="button">返回画布</button>
          <button
            className="secondary-button compact-button"
            disabled={!dirty || saving || !canEdit || configurationError !== null}
            onClick={() => void save()}
            title={configurationError ?? undefined}
            type="button"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            className="primary-button compact-button"
            disabled={saving || !canEdit || configurationError !== null}
            onClick={() => void saveAndReturn()}
            title={configurationError ?? undefined}
            type="button"
          >
            {saving ? "保存中…" : "保存并返回"}
          </button>
        </div>
      </header>

      {draftNotice ? <div className="canvas-theme-notice" role="status">{draftNotice}</div> : null}
      {saveError ? <div className="canvas-save-error" role="alert">保存失败：{saveError}</div> : null}
      {!canEdit ? <div className="canvas-readonly-notice">当前项目权限为只读，可以查看场景，但不能修改或保存配置。</div> : null}

      <div className="model-editor-workbench">
        <section className="model-editor-stage" aria-label="3D 场景编辑视口">
          <header className="model-editor-stage-heading">
            <div>
              <span className="eyebrow">Scene viewport</span>
              <h1>场景预览</h1>
            </div>
            <div className="model-editor-stage-status">
              <span>{node.resourceRefs.length > 0 ? "模型已绑定" : "等待导入模型"}</span>
              <span>{selectedSceneNodePath ? "已选择模型节点" : "未选择节点"}</span>
            </div>
          </header>
          <div className="model-editor-viewport">
            <Model3DNode
              cameraControlsEnabled
              editable={editable}
              interactionHint="点击对象选中 · 拖动旋转视角 · 滚轮缩放"
              node={node}
              onSceneChange={updateModelScene}
              onSceneNodeSelect={(_, path) => setSelectedSceneNodePath(path)}
              projectId={projectId}
              selectedSceneNodePath={selectedSceneNodePath}
            />
          </div>
          <footer className="model-editor-stage-footer">
            <span><i className="is-cyan" /> 点击模型或右侧节点树可同步选择</span>
            <span><i className="is-amber" /> 场景配置只保存资源 ID 和稀疏覆盖</span>
          </footer>
        </section>

        <Model3DInspector
          editable={editable}
          modelScene={modelScene}
          node={node}
          onNodeChange={updateNode}
          onSceneNodeSelect={setSelectedSceneNodePath}
          onValidationChange={setConfigurationError}
          projectId={projectId}
          selectedSceneNodePath={selectedSceneNodePath}
        />
      </div>
    </main>
  );
}
