import { Box3, Raycaster, Vector2, type Camera, type Object3D } from "three";
import type { InstanceRecord } from "./instance-manager";

export type SceneTarget = { instanceId: string; path: string | null };

export function createPickingService(camera: Camera, canvas: HTMLCanvasElement) {
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const pointer = new Vector2();
  const bounds = new Box3();
  return (clientX: number, clientY: number, records: InstanceRecord[], paths: Map<Object3D, string>): SceneTarget | null => {
    const viewport = canvas.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0) throw new Error("3D 视窗尺寸无效，无法执行对象命中测试");
    pointer.set(((clientX - viewport.left) / viewport.width) * 2 - 1, -((clientY - viewport.top) / viewport.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    const candidates: Object3D[] = [];
    const ownerByObject = new Map<Object3D, InstanceRecord>();
    for (const record of records) {
      if (!record.wrapper.visible) continue;
      record.wrapper.updateWorldMatrix(true, true);
      // Animated geometry can leave its static bound; do not reject it using a stale AABB.
      if (!record.mixer && !raycaster.ray.intersectsBox(bounds.setFromObject(record.wrapper))) continue;
      record.wrapper.traverseVisible((object) => {
        if (!("isMesh" in object || "isLine" in object || "isPoints" in object)) return;
        candidates.push(object);
        ownerByObject.set(object, record);
      });
    }
    // Background remains in the candidate set: walls still occlude equipment behind them.
    const hit = raycaster.intersectObjects(candidates, false)[0];
    if (!hit) return null;
    return { instanceId: ownerByObject.get(hit.object)!.id, path: paths.get(hit.object) ?? null };
  };
}
