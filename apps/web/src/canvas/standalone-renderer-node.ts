import {
  defaultStandaloneSceneInstanceAnimation,
  defaultStandaloneSceneInstanceAppearance,
  type StandaloneSceneDocument,
} from "../../../../shared/standalone-3d";
import {
  createCanvasNode,
  type CanvasNode,
  type Model3DProps,
  type ModelAssetInstance,
} from "./types";

/** Shared presentation adapter for the workspace, embedded scenes and project captures. */
export function standaloneRendererNode(
  scene: StandaloneSceneDocument,
  id = "standalone-3d-scene-root",
): CanvasNode {
  const base = createCanvasNode("model-3d", 0, 0, 0);
  const baseProps = base.props as Model3DProps;
  const instances: ModelAssetInstance[] = scene.instances.map((instance) => ({
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
    id,
    props: {
      ...baseProps,
      ...scene.settings,
      modelInstances: instances,
      presentation: { ...baseProps.presentation, lighting: "studio" },
      showControlPanel: false,
    } satisfies Model3DProps,
    resourceRefs: [...new Set(instances.map((instance) => instance.assetId))],
  };
}
