import { findBuiltinModel } from "../../../../shared/builtin-models";
import { createCanvasNode, type Model3DProps, type ModelAssetInstance } from "../canvas/types";

// Public, bundled models only. This scene must never resolve a project resource or call a data API.
const instances: ModelAssetInstance[] = [];
function add(id: string, kind: string, label: string, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
  const assetId = `builtin:workshop-${kind}`;
  if (!findBuiltinModel(assetId)) throw new Error(`宣传场景引用了未注册的公共模型：${assetId}`);
  instances.push({ id, assetId, label, visible: true, animation: { enabled: kind === "robot-arm-v2" || kind === "production-machine-v2", speed: 0.6 }, transform: { position, rotation: [0, 0, 0], scale } });
}

add("floor", "floor-v3", "车间地坪", [0, 0, 0], [0.7, 1, 0.68]);
for (let index = 0; index < 7; index += 1) {
  add(`wall-${index}`, "wall-v2", "车间围护结构", [(index - 3) * 2.7, 0, -6.4], [0.9, 0.85, 1]);
}
for (const [index, x] of [-5, 0].entries()) {
  add(`rack-${index}`, "rack-v2", "物料货架", [x, 0, -4.9]);
  for (let shelf = 0; shelf < 3; shelf += 1) {
    add(`box-${index}-${shelf}`, "box-v2", "仓储物料", [x - 0.8, 0.31 + shelf * 0.87, -4.9]);
  }
}
for (const [index, x] of [-5, 3].entries()) {
  add(`machine-${index}`, "production-machine-v2", `CNC 加工设备 0${index + 1}`, [x, 0, -1.2]);
  add(`robot-${index}`, "robot-arm-v2", `工业机械臂 0${index + 1}`, [x + 2.35, 0, -0.7]);
  add(`bench-${index}`, "workbench-v2", `装配工作台 0${index + 1}`, [x + 0.35, 0, 0.85]);
  add(`conveyor-${index}`, "conveyor-v2", `滚筒输送线 0${index + 1}`, [x + 4.05, 0, 0.4]);
}
add("agv-0", "agv-v2", "AGV 物流小车 01", [0, 0, 3.8]);
add("pallet-0", "pallet-v2", "待入库托盘", [-6.2, 0, 4.7]);
add("pallet-1", "pallet-v2", "待入库托盘", [-4, 0, 4.7]);
add("cabinet", "electrical-cabinet-v2", "动力控制柜", [5.8, 0, -4.9]);

const baseNode = createCanvasNode("model-3d", 0, 0, 0);
const baseProps = baseNode.props as Model3DProps;
export const industrialDemoNode = {
  ...baseNode,
  id: "public-industrial-demo",
  props: {
    ...baseProps,
    presentation: { ...baseProps.presentation, lighting: "studio" },
    modelInstances: instances,
    backgroundColor: "#eef4fb",
    backgroundOpacity: 0,
    environmentLightColor: "#edf4ff",
    environmentLightIntensity: 1.35,
    keyLightColor: "#ffffff",
    keyLightIntensity: 2.8,
    cameraView: "isometric-left",
    cameraFov: 38,
    modelScale: 1.9,
    showGrid: false,
    autoRotate: false,
    playAnimations: true,
    showControlPanel: false,
  } satisfies Model3DProps,
  resourceRefs: [...new Set(instances.map((instance) => instance.assetId))],
};

export const demoDevices = [
  { id: "robot-0", kind: "robot-arm-v2", shortName: "工业机械臂", icon: "cog", code: "ROBOT · 01", category: "装配单元 / 机械臂", status: "运行中", metrics: [{ label: "工作节拍", value: "12.8", unit: "s" }, { label: "关节温度", value: "42.6", unit: "°C" }], note: "在场景里找到设备，同时查看它的运行信息。", points: "0,34 15,31 30,36 45,23 60,28 75,18 90,22 105,13 120,18 135,8 150,14 165,9 180,12 200,6" },
  { id: "machine-0", kind: "production-machine-v2", shortName: "CNC 加工设备", icon: "cpu", code: "CNC · 01", category: "加工单元 / 数控设备", status: "加工中", metrics: [{ label: "主轴转速", value: "2,400", unit: "rpm" }, { label: "运行功率", value: "6.8", unit: "kW" }], note: "把设备模型与资产信息、业务指标关联起来。", points: "0,30 15,30 30,22 45,22 60,10 75,10 90,21 105,21 120,12 135,12 150,7 165,7 180,14 200,14" },
  { id: "agv-0", kind: "agv-v2", shortName: "AGV 物流小车", icon: "truck", code: "AGV · 01", category: "物流单元 / 自动搬运", status: "待命中", metrics: [{ label: "剩余电量", value: "86", unit: "%" }, { label: "当班任务", value: "24", unit: "次" }], note: "设备位置与任务信息，在同一个画面里呈现。", points: "0,5 15,8 30,6 45,11 60,13 75,12 90,17 105,18 120,17 135,23 150,23 165,27 180,25 200,29" },
] as const;

export function getDemoSelection(id: string | null) {
  const instance = instances.find((item) => item.id === id);
  const device = instance ? demoDevices.find((item) => instance.assetId === `builtin:workshop-${item.kind}`) : undefined;
  return { instance, device };
}
