import { useProjectEditorContext } from "../project-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, request } from "../api";
import { Model3DInspector } from "../canvas/Model3DInspector";
import { Model3DNode } from "../canvas/Model3DNode";
import { SceneAssignmentPanel } from "../canvas/SceneAssignmentPanel";
import { SceneModelEditor } from "../canvas/SceneModelEditor";
import { ModelReplacementDialog } from "../canvas/ModelReplacementDialog";
import { extractLegacyScene } from "../canvas/scene-conversion";
import { modelAssetsPath, type ModelAsset } from "../canvas/model-assets";
import { projectAssetsPath, type ProjectAssetListResponse } from "../canvas/assets";
import type { SceneDefinition } from "../../../../shared/scene-definition";
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
  const reusableScene = editor?.project.scenes.find((scene) => scene.id === node?.sceneId);
  const revision = editor?.project.revision ?? 0;
  const loadError = projectLoadError ?? (!loading && (!node || !isModel3DNodeType(node.type)) ? "此项目中没有对应的 3D 组件。" : null);
  const [modelScene, setModelScene] = useState<ModelSceneSnapshot | null>(null);
  const [selectedSceneNodePath, setSelectedSceneNodePath] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [legacyReplacement, setLegacyReplacement] = useState<{ scene: SceneDefinition; instanceId: string; newAssetId: string } | null>(null);
  const [preparingReplacement, setPreparingReplacement] = useState(false);
  const liveNode = useRef(node); liveNode.current = node;
  const liveSnapshot = useRef(modelScene); liveSnapshot.current = modelScene;
  const alive = useRef(true); const replacementRequest = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; replacementRequest.current++; }; }, []);

  useEffect(() => {
    if (modelPage && editor?.pageId !== modelPage.id) selectPage(modelPage.id);
  }, [modelPage?.id, editor?.pageId, selectPage]);
  useEffect(() => { setModelScene(null); setSelectedSceneNodePath(null); setConfigurationError(null); }, [nodeId]);
  const updateNode = useCallback((nextNode: CanvasNode) => {
    const current = liveNode.current;
    if (!alive.current || !modelPage || !current || current.id !== nextNode.id || current.sceneId) return;
    const targetId = nextNode.resourceRefs[0];
    if (current.resourceRefs[0] && targetId && current.resourceRefs[0] !== targetId) {
      const token = ++replacementRequest.current; const sourceId = current.resourceRefs[0];
      setPreparingReplacement(true); setSaveError(null);
      void Promise.all([request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}/${encodeURIComponent(sourceId)}/inspect`, { method: "POST" }), request<ProjectAssetListResponse>(projectAssetsPath(projectId))])
        .then(([model, assets]) => {
          if (!alive.current || token !== replacementRequest.current) return;
          const latest = liveNode.current;
          if (!latest || latest.id !== current.id || latest.sceneId || latest.resourceRefs[0] !== sourceId) throw new Error("当前模型已改变，请重新选择要替换的资源。");
          const scene = extractLegacyScene(latest, model.modelAsset, liveSnapshot.current, assets.assets);
          setLegacyReplacement({ scene, instanceId: scene.instances[0].id, newAssetId: targetId });
        }).catch((reason) => { if (alive.current && token === replacementRequest.current) setSaveError(errorMessage(reason)); })
        .finally(() => { if (alive.current && token === replacementRequest.current) setPreparingReplacement(false); });
      return;
    }
    const changedResource = current.resourceRefs[0] !== targetId;
    const updated = changedResource ? { ...current, resourceRefs: nextNode.resourceRefs, props: targetId ? current.props : { ...current.props, transformOverrides: {}, appearanceOverrides: {} } } : nextNode;
    execute({ type: "nodes.upsert", pageId: modelPage.id, nodes: [updated] });
  }, [modelPage?.id, projectId, execute, setSaveError]);

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

  const editable = canEdit && !saving && !preparingReplacement;
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

      <div className="canvas-message-stack">
      {draftNotice ? <div className="canvas-theme-notice" role="status">{draftNotice}</div> : null}
      {preparingReplacement ? <div className="canvas-theme-notice" role="status">正在读取旧模型的绑定与覆盖，准备替换预览…</div> : null}
      {saveError ? <div className="canvas-save-error" role="alert">保存失败：{saveError}</div> : null}
      {!canEdit ? <div className="canvas-readonly-notice">当前项目权限为只读，可以查看场景，但不能修改或保存配置。</div> : null}

      <SceneAssignmentPanel node={node} snapshot={modelScene} projectId={projectId} pageId={modelPage!.id} editable={editable} />
      </div>
      {reusableScene ? <SceneModelEditor key={reusableScene.id} projectId={projectId} scene={reusableScene} editable={editable} /> : <div className="model-editor-workbench">
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
      </div>}
      {legacyReplacement ? <ModelReplacementDialog projectId={projectId} scene={legacyReplacement.scene} instanceId={legacyReplacement.instanceId} initialAssetId={legacyReplacement.newAssetId} onClose={() => setLegacyReplacement(null)} onApply={(replacement) => !!execute({ type: "scene.extract", nodeId, pageId: modelPage!.id, scene: replacement.scene })} /> : null}
    </main>
  );
}
