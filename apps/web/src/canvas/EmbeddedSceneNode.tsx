import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, request } from "../api";
import {
  STANDALONE_3D_LIMITS,
  defaultStandaloneSceneInstanceAnimation,
  defaultStandaloneSceneInstanceAppearance,
  standaloneScenePath,
  type StandaloneSceneDocument,
} from "../../../../shared/standalone-3d";
import { Model3DNode } from "./Model3DNode";
import {
  createCanvasNode,
  parseScene3DProps,
  type CanvasNode,
  type Model3DProps,
  type ModelAssetInstance,
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
  selectedInstanceId: string | null;
};

const ignoreSceneNodeSelection = () => undefined;

export const EmbeddedSceneNode = memo(function EmbeddedSceneNode({
  editable,
  interactive,
  node,
  onSelectionChange,
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
  }, [onSelectionChange, sceneProjectId]);

  const rendererNode = useMemo((): CanvasNode | null => {
    if (!response) return null;
    const base = createCanvasNode("model-3d", 0, 0, 0);
    const baseProps = base.props as Model3DProps;
    const instances: ModelAssetInstance[] = response.scene.instances.map((instance) => ({
      animation: instance.animation ?? defaultStandaloneSceneInstanceAnimation(),
      appearance: instance.appearance ?? defaultStandaloneSceneInstanceAppearance(),
      assetId: instance.modelAssetId,
      id: instance.id,
      label: instance.label,
      transform: instance.transform,
      visible: instance.visible,
    }));
    return {
      ...base,
      id: `${node.id}:embedded-scene`,
      props: {
        ...baseProps,
        ...response.scene.settings,
        modelInstances: instances,
        presentation: { ...baseProps.presentation, lighting: "studio" },
        showControlPanel: false,
      } satisfies Model3DProps,
      resourceRefs: [...new Set(instances.map((instance) => instance.assetId))],
    };
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
    onSelectionChange({
      canvasNodeId: node.id,
      sceneProjectId: response.scene.projectId,
      linked2dProjectId: response.scene.linked2dProjectId,
      instanceId: instance.id,
      assetId: instance.assetId,
      label: instance.label,
    });
  }, [node.id, onSelectionChange, response]);

  if (!parsed.ok) {
    return <div className="embedded-scene-state is-error" role="alert"><strong>3D 场景配置无效</strong><span>{parsed.message}</span></div>;
  }
  if (!sceneProjectId) {
    return <div className="embedded-scene-state"><strong>选择一个 3D 场景</strong><span>在右侧属性栏绑定已搭建的独立 3D 项目。</span></div>;
  }
  if (loadError) {
    return <div className="embedded-scene-state is-error" role="alert"><strong>3D 场景加载失败</strong><span>{loadError}</span></div>;
  }
  if (loading || !rendererNode || !response) {
    return <div className="embedded-scene-state"><span className="model-loading-spinner" /><strong>正在加载 3D 场景</strong></div>;
  }

  return (
    <div className="embedded-scene-node">
      <Model3DNode
        cameraControlsEnabled={!editable}
        editable={false}
        interactive={interactive && parsed.value.interactionEnabled}
        maximumModelInstances={STANDALONE_3D_LIMITS.maximumInstances}
        node={rendererNode}
        onModelInstanceSelect={selectInstance}
        onSceneNodeSelect={ignoreSceneNodeSelection}
        projectId={sceneProjectId}
        runtimeControlsEnabled={false}
        selectionStyle={editable ? "none" : "runtime"}
        selectedModelInstanceId={selectedInstanceId}
        selectedSceneNodePath={null}
      />
      {editable ? <div className="embedded-scene-reference">引用场景 · {response.project.name}</div> : null}
    </div>
  );
});
