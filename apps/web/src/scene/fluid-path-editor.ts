import * as THREE from "three";
import { FLUID_LIMITS, type FluidPoint } from "../../../../shared/fluids";

export type FluidEditorState = {
  points: FluidPoint[];
  plane: "xz" | "xy" | "yz";
  offset: number;
  active: boolean;
  direction: "forward" | "reverse";
  selectedPointIndex: number | null;
};

/** Intersect in scene-local coordinates, even when the presentation rotates the scene. */
export function fluidPointOnPlane(worldRay: THREE.Ray, localToWorld: THREE.Matrix4, editor: Pick<FluidEditorState, "plane" | "offset">): FluidPoint {
  if (!Number.isFinite(editor.offset) || Math.abs(editor.offset) > FLUID_LIMITS.maximumCoordinate) throw new Error("绘制平面坐标超出允许范围");
  const normal = editor.plane === "xz" ? new THREE.Vector3(0, 1, 0) : editor.plane === "xy" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const ray = worldRay.clone().applyMatrix4(localToWorld.clone().invert());
  if (Math.abs(ray.direction.dot(normal)) < 1e-7) throw new Error("当前视角与绘制平面平行，请旋转视角或切换绘制平面");
  const point = ray.intersectPlane(new THREE.Plane(normal, -editor.offset), new THREE.Vector3());
  if (!point) throw new Error("绘制平面位于视角后方，请调整视角或平面位置");
  const result = point.toArray().map(value => Math.round(value * 1000) / 1000) as FluidPoint;
  if (result.some(value => !Number.isFinite(value) || Math.abs(value) > FLUID_LIMITS.maximumCoordinate)) throw new Error("选点坐标超出允许范围，请调整视角后重试");
  return result;
}

/** Editor-only guide. Never part of persisted geometry, scene bounds or covers. */
export class FluidPathGuide {
  private root = new THREE.Group();
  constructor(private parent: THREE.Group) { parent.add(this.root); }
  clear() {
    this.root.traverse(object => {
      const drawable = object as THREE.Mesh;
      drawable.geometry?.dispose();
      if (drawable.material) (Array.isArray(drawable.material) ? drawable.material : [drawable.material]).forEach(material => material.dispose());
    });
    this.root.clear();
  }
  update(editor: FluidEditorState | null, points: FluidPoint[] = [], radius = 0.25) {
    this.clear();
    const path = editor?.points ?? points;
    const reverse = editor?.direction === "reverse";
    const markerSize = Math.max(0.045, Math.min(radius * 0.32, 0.35));
    if (editor?.active) {
      const size = Math.max(20, ...path.flatMap(point => point.map(Math.abs))) * 2;
      const grid = new THREE.GridHelper(size, 20, 0x4cbce3, 0x3d6475);
      if (editor.plane === "xz") grid.position.y = editor.offset;
      else if (editor.plane === "xy") { grid.rotation.x = Math.PI / 2; grid.position.z = editor.offset; }
      else { grid.rotation.z = Math.PI / 2; grid.position.x = editor.offset; }
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => { material.transparent = true; material.opacity = 0.35; material.depthWrite = false; });
      this.root.add(grid);
    }
    if (path.length > 1) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.map(point => new THREE.Vector3(...point))), new THREE.LineBasicMaterial({ color: 0x67e8f9, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }));
      line.renderOrder = 10001;
      this.root.add(line);
    }
    path.forEach((point, index) => {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(markerSize, 10, 8), new THREE.MeshBasicMaterial({ color: index === editor?.selectedPointIndex ? 0xfacc15 : index === (reverse ? path.length - 1 : 0) ? 0x4ade80 : 0x67e8f9, depthTest: false, toneMapped: false }));
      marker.position.set(...point);
      marker.renderOrder = 10002;
      this.root.add(marker);
      if (index === 0) return;
      const start = new THREE.Vector3(...path[reverse ? index : index - 1]);
      const direction = new THREE.Vector3(...path[reverse ? index - 1 : index]).sub(start);
      const length = direction.length();
      if (length <= 1e-6) return;
      const arrow = new THREE.ArrowHelper(direction.normalize(), start.addScaledVector(direction, length * 0.45), Math.min(length * 0.3, markerSize * 6), 0x67e8f9);
      // ArrowHelper shares global primitives; clone to give this disposable guide ownership.
      arrow.line.geometry = arrow.line.geometry.clone();
      arrow.cone.geometry = arrow.cone.geometry.clone();
      this.root.add(arrow);
    });
  }
  dispose() { this.clear(); this.parent.remove(this.root); }
}
