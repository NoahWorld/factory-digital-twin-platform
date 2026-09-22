import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, request } from "../api";
import type { TwinAction } from "../../../../shared/twin-actions";
import {
  STANDALONE_3D_LIMITS,
  standaloneScenePath,
  type StandaloneSceneDocument,
} from "../../../../shared/standalone-3d";
import { Model3DNode } from "./Model3DNode";
import { standaloneRendererNode } from "./standalone-renderer-node";
import {
  parseScene3DProps,
  type CanvasNode,
} from "./types";

type EmbeddedSceneResponse = {
  project: { id: string; name: string };
  scene: StandaloneSceneDocument;
  requestId: string;
};

export type EmbeddedSceneRuntimeSelection = {
  canvasNodeId: string;
  sceneProjectId: string;
  linked2dProjectId: string | null;
  instanceId: string;
  assetId: string | null;
  label: string;
};

type EmbeddedSceneNodeProps = {
  editable: boolean;
  interactive: boolean;
  node: CanvasNode;
  onSelectionChange: (selection: EmbeddedSceneRuntimeSelection | null) => void;
  onActions?: (selection: EmbeddedSceneRuntimeSelection, actions: TwinAction[]) => void;
  modelFocusRequest?: { projectId: string; instanceId: string; requestId: string } | null;
  selectedInstanceId: string | null;
};

const ignoreSceneNodeSelection = () => undefined;

export const EmbeddedSceneNode = memo(function EmbeddedSceneNode({
  editable,
  interactive,
  node,
  onSelectionChange,
  onActions,
  modelFocusRequest,
  selectedInstanceId,
}: EmbeddedSceneNodeProps) {
  const parsed = parseScene3DProps(node.props);
  const sceneProjectId = parsed.ok ? parsed.value.sceneProjectId : null;
  const [response, setResponse] = useState<EmbeddedSceneResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(sceneProjectId !== null);

  useEffect(() => {
    let active = true;
    setResponse(null);
    setLoadError(null);
    onSelectionChange(null);
    if (!sceneProjectId) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void request<EmbeddedSceneResponse>(standaloneScenePath(sceneProjectId))
      .then((result) => {
        if (active) setResponse(result);
      })
      .catch((reason) => {
        if (active) setLoadError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [editable, onSelectionChange, sceneProjectId]);

  const rendererNode = useMemo((): CanvasNode | null => {
    if (!response) return null;
    return standaloneRendererNode(response.scene, `${node.id}:embedded-scene`);
  }, [node.id, response]);

  const selectInstance = useCallback((_rendererNodeId: string, instanceId: string | null) => {
    if (!response || !instanceId) {
      onSelectionChange(null);
      return;
    }
    const instance = response.scene.instances.find((candidate) => candidate.id === instanceId);
    if (!instance || instance.renderMode !== "interactive") {
      onSelectionChange(null);
      return;
    }
    const selection: EmbeddedSceneRuntimeSelection = {
      canvasNodeId: node.id,
      sceneProjectId: response.scene.projectId,
      linked2dProjectId: response.scene.linked2dProjectId,
      instanceId: instance.id,
      // Missing actions preserve legacy device selection; an explicit list (including []) owns all effects.
      assetId: instance.clickActions === undefined ? instance.assetId : null,
      label: instance.label,
    };
    onSelectionChange(selection);
    if (instance.clickActions?.length) onActions?.(selection, instance.clickActions);
  }, [node.id, onActions, onSelectionChange, response]);

  if (!parsed.ok) {
    return <div className="embedded-scene-state is-error" data-cover-state="error" data-cover-error={parsed.message} role="alert"><strong>3D 场景配置无效</strong><span>{parsed.message}</span></div>;
  }
  if (!sceneProjectId) {
    return <div className="embedded-scene-state" data-cover-state="empty"><strong>选择一个 3D 场景</strong><span>在右侧属性栏绑定已搭建的独立 3D 项目。</span></div>;
  }
  if (loadError) {
    return <div className="embedded-scene-state is-error" data-cover-state="error" data-cover-error={loadError} role="alert"><strong>3D 场景加载失败</strong><span>{loadError}</span></div>;
  }
  if (loading || !rendererNode || !response || response.scene.projectId !== sceneProjectId) {
    return <div className="embedded-scene-state" data-cover-state="loading"><span className="model-loading-spinner" /><strong>正在加载 3D 场景</strong></div>;
  }

  return (
    <div className="embedded-scene-node" data-cover-state="ready">
      <Model3DNode
        fluids={response.scene.fluids ?? []}
        cameraControlsEnabled={!editable}
        editable={false}
        interactive={interactive && parsed.value.interactionEnabled}
        maximumModelInstances={STANDALONE_3D_LIMITS.maximumInstances}
        modelFocusRequest={modelFocusRequest?.projectId === sceneProjectId ? modelFocusRequest : null}
        node={rendererNode}
        onModelInstanceSelect={selectInstance}
        onSceneNodeSelect={ignoreSceneNodeSelection}
        projectId={sceneProjectId}
        runtimeControlsEnabled={false}
        selectionStyle={editable ? "none" : "runtime"}
        selectedModelInstanceId={modelFocusRequest?.projectId === sceneProjectId ? modelFocusRequest.instanceId : selectedInstanceId}
        selectedSceneNodePath={null}
      />
      {editable ? <div className="embedded-scene-reference">引用场景 · {response.project.name}</div> : null}
    </div>
  );
});
