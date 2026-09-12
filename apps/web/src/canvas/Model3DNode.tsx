import { useInteractionContext } from "../interaction-session";
import type { SceneViewportRuntime } from "./scene-viewport-runtime";
import { memo, useCallback, useMemo } from "react";
import { SceneViewport } from "./SceneViewport";
import { useSceneCatalog } from "./scene-context";
import { parseModel3DProps, type CanvasNode, type ModelNodeAppearance } from "./types";
import type { ModelSceneSnapshot } from "./model-scene";
import { IDENTITY_TRANSFORM, type SceneDefinition } from "../../../../shared/scene-definition";
import type { ObjectTarget } from "./model-instance";

type Model3DNodeProps = {
  cameraControlsEnabled?: boolean; editable: boolean; interactive?: boolean; interactionHint?: string;
  node: CanvasNode; projectId: string;
  onSceneChange?: (canvasNodeId: string, snapshot: ModelSceneSnapshot | null) => void;
  onSceneNodeSelect: (canvasNodeId: string, sceneNodePath: string | null) => void;
  selectedSceneNodePath: string | null;
  runtimeAppearanceOverrides?: Record<string, ModelNodeAppearance>;
  selectedTarget?: ObjectTarget | null;
  selectedTargets?: ObjectTarget[];
  onObjectSelect?: (target: ObjectTarget | null, ancestors: ObjectTarget[]) => void;
  runtimeSceneAppearances?: Record<string, Record<string, ModelNodeAppearance>>;
};

export const Model3DNode = memo(function Model3DNode({ cameraControlsEnabled, editable, interactive = false, interactionHint, node, projectId,
  onSceneChange, onSceneNodeSelect, selectedSceneNodePath, runtimeAppearanceOverrides, selectedTarget, selectedTargets, onObjectSelect, runtimeSceneAppearances }: Model3DNodeProps) {
  const catalog = useSceneCatalog();
  const interactions = useInteractionContext();
  const onReady = useCallback((engine: SceneViewportRuntime | null) => interactions?.registerViewport(node.id,engine),[node.id,interactions?.registerViewport]);
  const parsed = parseModel3DProps(node.props);
  const scene = useMemo<SceneDefinition | null>(() => {
    if (node.sceneId) return catalog.find((scene) => scene.id === node.sceneId) ?? null;
    if (!parsed.ok || !node.resourceRefs[0]) return null;
    const { transformOverrides, appearanceOverrides, ...settings } = parsed.value;
    return { id: node.id, name: "模型视窗", settings, assetBindings: [], instances: [{ id: node.id, name: "模型", modelAssetId: node.resourceRefs[0],
      transform: IDENTITY_TRANSFORM, visible: true, appearance: null, objectTransforms: transformOverrides, objectAppearances: appearanceOverrides }] };
  }, [node.id, node.sceneId, node.resourceRefs[0], JSON.stringify(node.props), catalog]);
  const onSnapshot = useCallback((instanceId: string, snapshot: ModelSceneSnapshot | null) => {
    if (!node.sceneId && instanceId === node.id) onSceneChange?.(node.id, snapshot);
  }, [node.sceneId, node.id, onSceneChange]);
  const runtime = useMemo(() => node.sceneId ? runtimeSceneAppearances : { [node.id]: runtimeAppearanceOverrides ?? {} }, [node.sceneId, node.id, runtimeAppearanceOverrides, runtimeSceneAppearances]);
  if (!parsed.ok) return <div className="model-3d-message is-error" role="alert"><strong>3D 配置错误</strong><span>{parsed.message}</span></div>;
  if (!scene) return <div className="model-3d-message" role={node.sceneId ? "alert" : undefined}><strong>{node.sceneId ? "引用的三维场景不存在" : "尚未绑定模型"}</strong><span>请在 3D 编辑器配置模型或关联场景</span></div>;
  return <SceneViewport scene={scene} projectId={projectId} legacyNames={!node.sceneId} cameraControlsEnabled={cameraControlsEnabled ?? !editable}
    selectedTarget={selectedTarget} selectedTargets={selectedTargets} selectedLegacyPath={!node.sceneId ? selectedSceneNodePath : null} selectedDisplayPath={selectedSceneNodePath}
    onReady={onReady} interactive={editable || interactive} runtimeAppearances={runtime} onSnapshot={onSnapshot}
    onPick={(target, path, ancestors) => { if (node.sceneId) onObjectSelect?.(target, ancestors); else onSceneNodeSelect(node.id, path); }}
    hint={editable || interactive ? interactionHint ?? (interactive && !editable ? "点击设备查看 2D 详情 · 拖动旋转视角" : "点击对象选中 · 拖动可移动组件") : undefined} />;
});
