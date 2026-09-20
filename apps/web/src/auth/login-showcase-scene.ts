import { findBuiltinModel } from "../../../../shared/builtin-models";
import { createCanvasNode, type Model3DProps, type ModelAssetInstance } from "../canvas/types";

// A public display scene. Only bundled models are allowed on the login page.
function model(
  kind: string,
  label: string,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
): ModelAssetInstance {
  const assetId = `builtin:workshop-${kind}`;
  if (!findBuiltinModel(assetId)) throw new Error(`登录展示引用了未注册的公开模型：${assetId}`);
  return {
    id: `login-${kind}`,
    assetId,
    label,
    visible: true,
    animation: { enabled: kind === "robot-arm-v2", speed: 0.75 },
    transform: { position, rotation: [0, 0, 0], scale },
  };
}

const instances = [
  model("floor-v3", "工位地坪", [-0.5, 0, -0.35], [0.32, 1, 0.36]),
  model("production-machine-v2", "加工设备", [-2.5, 0, -1.2]),
  model("robot-arm-v2", "工业机械臂", [0, 0, -0.7]),
  model("workbench-v2", "装配工作台", [-2.15, 0, 0.85]),
  model("conveyor-v2", "滚筒输送线", [2, 0, 0.4]),
  model("electrical-cabinet-v2", "控制柜", [2.5, 0, -2.5]),
];
const base = createCanvasNode("model-3d", 0, 0, 0);
const defaults = base.props as Model3DProps;

export const loginShowcaseNode = {
  ...base,
  id: "public-login-showcase",
  resourceRefs: instances.map((instance) => instance.assetId),
  props: {
    ...defaults,
    modelInstances: instances,
    presentation: { ...defaults.presentation, lighting: "studio" },
    backgroundColor: "#0b1c2d",
    backgroundOpacity: 0,
    environmentLightColor: "#d8edff",
    environmentLightIntensity: 1.4,
    keyLightColor: "#fff5e8",
    keyLightIntensity: 2.8,
    cameraView: "isometric-left",
    cameraFov: 38,
    modelScale: 1.45,
    autoRotate: true,
    rotationSpeed: 0.06,
    playAnimations: true,
    showGrid: false,
    showControlPanel: false,
  } satisfies Model3DProps,
};
