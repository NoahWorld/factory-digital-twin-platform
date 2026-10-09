import type { StandaloneSceneInstance, StandaloneSceneSettings } from "../../../../shared/standalone-3d";
import type { TwinDriveConfig, TwinMotionBinding, TwinPoint, TwinVector } from "../../../../shared/twin-drive";
import geometry from "../../../../shared/handling-cell-geometry.json";

export const BUSINESS_API_EXAMPLE_ID = "handling-cell-api";
export const businessApiExampleSettings: StandaloneSceneSettings = {
  animationSpeed: 1, autoRotate: false, backgroundColor: "#102331", backgroundOpacity: 1,
  cameraFov: 42, cameraView: "isometric", preventBottomView: true,
  environmentLightColor: "#e0ecf5", environmentLightIntensity: .9,
  keyLightColor: "#fff2db", keyLightIntensity: 2.1, modelScale: 1.2,
  playAnimations: false, rotationSpeed: .35, showGrid: false,
};
export const businessApiExampleInstances: StandaloneSceneInstance[] = [{
  id: "handling-cell", label: "送检与回收工作站", modelAssetId: geometry.modelId,
  assetId: null, visible: true, renderMode: "interactive", sortOrder: 0,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  animation: { enabled: false, speed: 1 }, appearance: { color: null, opacity: 1 },
}];
const vector = (value: number[]): TwinVector => [value[0]!, value[1]!, value[2]!];
const point = (id: string, label: string, sourcePath: string, unit: string, min: number, max: number): TwinPoint => ({
  id, label, sourcePath, assetId: "", metricKey: id, unit, min, max, initialValue: 0, maxSpeed: 0, staleAfterMs: 3000,
});
const motion = (id: string, label: string, pointId: string, nodeName: string, kind: "translation" | "rotation", axis: number[],
  pivot: number[], parentBindingId: string | null = null, valueScale = 1, valueOffset = 0): TwinMotionBinding => ({
  id, label, pointId, target: { instanceId: "handling-cell", modelAssetId: geometry.modelId, nodeName },
  kind, axis: vector(axis), pivot: vector(pivot), parentBindingId, useNodeRestPose: true, valueScale, valueOffset, poses: [],
});

/** Every visible motion is bound to actual API feedback; no browser business clock or simulated controller. */
export function businessApiExampleConfig(protocol: "rest" | "websocket" = "rest"): TwinDriveConfig {
  const { agv, robot, cargo } = geometry;
  const distance = agv.dockZM - agv.startZM;
  return {
    version: 1, enabled: true, source: "api",
    connection: { protocol, url: protocol === "rest" ? "/api/v1/test-business/handling-cell/state" : "/api/v1/test-business/handling-cell/live",
      timestampPath: "timestamp", intervalMs: 200, timeoutMs: 5000 },
    description: "送检与回收：小车送件到站并停稳，机械臂夹取、抬升、放入检验台，空车返回；检验后空车接件，机械臂装回，小车带件返回。同一件工件全程可见。位置、车轮、关节、夹爪和当前步骤均由后端接口返回；接入真实设备时替换地址及对应字段。",
    points: [
      point("agv-position", "小车行程", "agv.positionM", "m", 0, distance),
      point("wheel-angle", "车轮转角", "agv.wheelAngleDeg", "°", 0, distance / agv.wheelRadiusM * 180 / Math.PI),
      point("robot-yaw", "机械臂转台", "robot.baseYawDeg", "°", 0, 90),
      point("robot-shoulder", "机械臂肩关节", "robot.shoulderDeg", "°", -180, 180),
      point("robot-elbow", "机械臂肘关节", "robot.elbowDeg", "°", 0, 180),
      point("robot-wrist", "机械臂腕关节", "robot.wristDeg", "°", -360, 360),
      point("gripper-opening", "夹爪开口", "gripper.openingM", "m", robot.closedGapM, robot.openGapM),
      point("cargo-x", "工件横向位置", "cargo.xM", "m", -5, 5),
      point("cargo-y", "工件高度", "cargo.yM", "m", 0, 3),
      point("cargo-z", "工件纵向位置", "cargo.zM", "m", -5, 5),
      point("cargo-yaw", "工件方向", "cargo.yawDeg", "°", 0, 90),
      { ...point("business-phase", "送检与回收 · 当前步骤", "cycle.phaseCode", "", 0, geometry.phases.length - 1),
        valueLabels: geometry.phases.map(phase => ({ value: phase.code, label: phase.label })) },
    ],
    bindings: [
      motion("agv-travel", "小车沿轮子滚动方向行驶", "agv-position", agv.node, "translation", agv.travelAxis, [0, 0, 0], null, 1, agv.startZM),
      ...agv.wheelNodes.map((node, index) => motion(`wheel-${index}`, "车轮随行程滚动", "wheel-angle", node, "rotation", agv.wheelAxis, agv.wheelCenters[index]!, "agv-travel")),
      motion("robot-base", "机械臂面向取放工位", "robot-yaw", robot.nodes.turret, "rotation", robot.turretAxis, robot.restPivots.turret),
      motion("robot-shoulder", "机械臂肩关节", "robot-shoulder", robot.nodes.shoulder, "rotation", robot.jointAxis, robot.restPivots.shoulder, "robot-base"),
      motion("robot-elbow", "机械臂肘关节", "robot-elbow", robot.nodes.elbow, "rotation", robot.jointAxis, robot.restPivots.elbow, "robot-shoulder"),
      motion("robot-wrist", "夹爪保持竖直", "robot-wrist", robot.nodes.wrist, "rotation", robot.jointAxis, robot.restPivots.wrist, "robot-elbow"),
      motion("gripper-left", "左夹指开合", "gripper-opening", robot.nodes.fingerLeft, "translation", robot.fingerLeftCloseAxis, [0, 0, 0], "robot-wrist", -.5, robot.openGapM / 2),
      motion("gripper-right", "右夹指开合", "gripper-opening", robot.nodes.fingerRight, "translation", robot.fingerRightCloseAxis, [0, 0, 0], "robot-wrist", -.5, robot.openGapM / 2),
      motion("cargo-x", "工件横向位置", "cargo-x", cargo.nodeX, "translation", [1, 0, 0], [0, 0, 0]),
      motion("cargo-y", "工件高度", "cargo-y", cargo.nodeY, "translation", [0, 1, 0], [0, 0, 0], "cargo-x", 1, cargo.yBindingOffsetM),
      motion("cargo-z", "工件纵向位置", "cargo-z", cargo.nodeZ, "translation", [0, 0, 1], [0, 0, 0], "cargo-y"),
      motion("cargo-yaw", "工件随夹爪转向", "cargo-yaw", cargo.nodeYaw, "rotation", [0, 1, 0], cargo.restPosition, "cargo-z"),
    ],
    colliders: [], collisionRules: [], procedures: [],
  };
}
