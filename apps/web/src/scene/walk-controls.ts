import { Euler, type PerspectiveCamera } from "three";
import { WALK_EYE_HEIGHT, type WalkPhysics } from "./walk-physics";

/** Focus-scoped desktop input. Owns listeners; the scene runtime owns the physics world. */
export function createWalkControls(canvas: HTMLCanvasElement, camera: PerspectiveCamera, physics: WalkPhysics, initialYaw: number, onExit: () => void) {
  const keys = new Set<string>();
  const movementKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const previousTabIndex = canvas.getAttribute("tabindex");
  canvas.tabIndex = 0;
  let yaw = initialYaw;
  let pitch = 0;
  let drag: { id: number; x: number; y: number } | null = null;
  const clear = () => {
    keys.clear();
    if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
    physics.pause();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") { event.preventDefault(); event.stopPropagation(); onExit(); return; }
    if (!movementKeys.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); event.stopPropagation(); keys.add(event.code);
  };
  const keyUp = (event: KeyboardEvent) => {
    if (!movementKeys.has(event.code)) return;
    event.preventDefault(); event.stopPropagation(); keys.delete(event.code);
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType !== "mouse") return;
    canvas.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    yaw -= (event.clientX - drag.x) * 0.003;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch - (event.clientY - drag.y) * 0.003));
    drag.x = event.clientX; drag.y = event.clientY;
  };
  const pointerUp = () => {
    if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
  };
  const syncCamera = (feet: number[]) => {
    camera.position.set(feet[0]!, feet[1]! + WALK_EYE_HEIGHT, feet[2]!);
    camera.quaternion.setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
  };
  canvas.addEventListener("keydown", keyDown);
  canvas.addEventListener("keyup", keyUp);
  canvas.addEventListener("blur", clear);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", clear);
  canvas.addEventListener("lostpointercapture", pointerUp);
  window.addEventListener("blur", clear);
  canvas.focus({ preventScroll: true });
  syncCamera(physics.feet());
  return {
    update(delta: number) {
      const right = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      const forward = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown"));
      syncCamera(physics.advance(delta, right, forward, yaw));
    },
    pause: clear,
    dispose() {
      clear();
      canvas.removeEventListener("keydown", keyDown);
      canvas.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("blur", clear);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", clear);
      canvas.removeEventListener("lostpointercapture", pointerUp);
      window.removeEventListener("blur", clear);
      if (previousTabIndex === null) canvas.removeAttribute("tabindex");
      else canvas.setAttribute("tabindex", previousTabIndex);
    },
  };
}
