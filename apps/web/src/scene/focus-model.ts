import { Box3, MathUtils, Vector3, type Object3D, type PerspectiveCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Reframes the existing scene camera; does not load resources or create a render loop. */
export function focusSceneObject(camera: PerspectiveCamera, controls: OrbitControls, object: Object3D, preventBottomView: boolean) {
  object.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(object);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  if (bounds.isEmpty() || ![...center.toArray(), ...size.toArray(), camera.aspect, camera.getEffectiveFOV()].every(Number.isFinite) || camera.aspect <= 0) {
    throw new Error("无法聚焦模型：模型包围盒或相机参数无效");
  }
  const halfVerticalFov = MathUtils.degToRad(camera.getEffectiveFOV()) / 2;
  const halfFov = Math.min(halfVerticalFov, Math.atan(Math.tan(halfVerticalFov) * camera.aspect));
  if (halfFov <= 0 || halfFov >= Math.PI / 2) throw new Error("无法聚焦模型：相机视场角无效");
  // Drain the previous gesture's damping before applying this explicit navigation request.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  try {
    controls.update();
    const direction = camera.position.clone().sub(controls.target);
    if (!direction.toArray().every(Number.isFinite) || direction.lengthSq() === 0) throw new Error("无法聚焦模型：相机位置或观察目标无效");
    direction.normalize();
    if (preventBottomView) direction.y = Math.max(direction.y, 0.08);
    const distance = Math.max(size.length() / 2, 0.01) / Math.sin(halfFov) * 1.15;
    camera.up.set(0, 1, 0);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction.normalize(), distance);
    camera.lookAt(center);
    controls.update();
    camera.updateMatrixWorld();
  } finally {
    controls.enableDamping = damping;
  }
}
