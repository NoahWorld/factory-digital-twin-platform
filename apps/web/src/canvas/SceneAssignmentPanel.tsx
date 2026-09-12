import { useEffect, useRef, useState } from "react";
import { useProjectEditorContext } from "../project-editor";
import { request, errorMessage } from "../api";
import type { CanvasNode } from "./types";
import { modelAssetsPath, type ModelAsset } from "./model-assets";
import { projectAssetsPath, type ProjectAssetListResponse } from "./assets";
import type { ModelSceneSnapshot } from "./model-scene";
import { extractLegacyScene } from "./scene-conversion";

export function SceneAssignmentPanel({ node, snapshot, projectId, pageId, editable }: { node: CanvasNode; snapshot: ModelSceneSnapshot | null; projectId: string; pageId: string; editable: boolean }) {
  const { editor, execute, setSaveError } = useProjectEditorContext();
  const [choice, setChoice] = useState(node.sceneId ?? ""); const [busy, setBusy] = useState(false);
  const active = useRef(true); useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => setChoice(node.sceneId ?? ""), [node.sceneId]);
  const extract = async () => {
    setBusy(true); setSaveError(null);
    try {
      const [model, assets] = await Promise.all([
        node.resourceRefs[0] ? request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}/${encodeURIComponent(node.resourceRefs[0])}/inspect`, { method: "POST" }).then((result) => result.modelAsset) : Promise.resolve(null),
        request<ProjectAssetListResponse>(projectAssetsPath(projectId)),
      ]);
      if (active.current) execute({ type: "scene.extract", nodeId: node.id, pageId, scene: extractLegacyScene(node, model, snapshot, assets.assets) });
    } catch (reason) { if (active.current) setSaveError(errorMessage(reason)); }
    finally { if (active.current) setBusy(false); }
  };
  return <section className="scene-assignment-bar" aria-label="场景关联">
    <label>可复用场景<select aria-label="关联场景" value={choice} disabled={!editable || busy} onChange={(event) => setChoice(event.target.value)}><option value="">选择项目场景</option>{editor?.project.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></label>
    <button type="button" disabled={!editable || busy || !choice || choice === node.sceneId} onClick={() => execute({ type: "scene.attach", sceneId: choice, nodeId: node.id, pageId })}>关联到此视窗</button>
    {!node.sceneId ? <button type="button" disabled={!editable || busy || (!!node.resourceRefs[0] && !snapshot)} onClick={() => void extract()}>{busy ? "正在转换…" : "创建可复用场景"}</button> : <>
      <button type="button" disabled={!editable || busy} onClick={() => execute({ type: "scene.duplicate", sceneId: node.sceneId!, nodeId: node.id, pageId })}>创建独立场景副本</button>
      <button type="button" disabled={!editable || busy} onClick={() => execute({ type: "scene.detach", nodeId: node.id, pageId })}>解除场景关联</button>
      <button type="button" disabled={!editable || busy} onClick={() => execute({ type: "scene.delete", sceneId: node.sceneId!, detachReferences: true })}>删除场景并解除全部关联</button>
    </>}
    <span>{node.sceneId ? "修改场景会同步到所有引用它的页面。" : "转换保留当前模型、覆盖和匹配的资产映射，可撤销。"}</span>
  </section>;
}
