import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { Model3DProps } from "../canvas/types";

export const EMPTY_SCENE_GRID_SIZE = 10;

/** Frame the real ground grid even before the scene has model bounds. */
export function fitEmptySceneCamera(camera: PerspectiveCamera, target: Vector3, view: Model3DProps["cameraView"]) {
  const halfSize = EMPTY_SCENE_GRID_SIZE / 2;
  const vertical = Math.tan(MathUtils.degToRad(camera.fov / 2));
  const horizontal = vertical * camera.aspect;
  if (!Number.isFinite(horizontal) || horizontal <= 0 || vertical <= 0) {
    throw new Error("空场景相机的视野或宽高比无效");
  }
  const top = view === "top";
  const direction = top ? new Vector3(0, 1, 0.001).normalize() : new Vector3(view === "front" ? 0 : view === "isometric-left" ? -0.08 : 0.08, 0.4, 1).normalize();
  camera.up.set(0, 1, 0);
  target.set(0, top ? 0 : 1.2, 0);
  const right = new Vector3().crossVectors(camera.up, direction).normalize();
  const up = new Vector3().crossVectors(direction, right);
  let distance = 0;
  for (const x of [-halfSize, halfSize]) for (const z of [-halfSize, halfSize]) {
    const corner = new Vector3(x, 0, z).sub(target);
    distance = Math.max(distance,
      Math.abs(corner.dot(right)) / (horizontal * 0.92) + corner.dot(direction),
      Math.abs(corner.dot(up)) / (vertical * 0.92) + corner.dot(direction));
  }
  camera.position.copy(direction.multiplyScalar(distance).add(target));
  camera.lookAt(target);
  camera.updateMatrixWorld();
}
