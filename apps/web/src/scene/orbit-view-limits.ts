import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Cameras stay Y-up for every preset, including top view. No extra render loop. */
export function applyOrbitViewLimits(controls: OrbitControls, preventBottomView: boolean) {
  controls.maxPolarAngle = preventBottomView ? Math.PI / 2 : Math.PI;
  // Ground-plane pan preserves elevation; screen-space pan could move below a building.
  controls.screenSpacePanning = !preventBottomView;
}
