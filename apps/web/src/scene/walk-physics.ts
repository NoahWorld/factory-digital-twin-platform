import type RAPIER from "@dimforge/rapier3d-compat";

export type Vec3Tuple = [number, number, number];
/** World coordinates: metres, Y up; collision data is independent of display meshes. */
export type WalkSceneConfig = {
  version: 1;
  units: "meters";
  spawn: Vec3Tuple; // Feet position, with a 2 cm clearance above the floor.
  yaw: number; // Radians; zero looks towards -Z.
  bounds: { min: Vec3Tuple; max: Vec3Tuple };
  colliders: Array<{
    id: string;
    role: "floor" | "obstacle";
    center: Vec3Tuple;
    halfExtents: Vec3Tuple;
    rotation?: [number, number, number, number]; // Unit quaternion x/y/z/w.
  }>;
};
export type WalkPhysics = Awaited<ReturnType<typeof createWalkPhysics>>;
export const WALK_STEP = 1 / 60;
export const WALK_EYE_HEIGHT = 1.6;
const HALF_HEIGHT = 0.9;
const RADIUS = 0.3;
const SPEED = 2.5;
const MAX_STEPS = 6;

let initialization: Promise<typeof RAPIER> | undefined;
function loadRapier() {
  initialization ??= import("@dimforge/rapier3d-compat").then(async ({ default: rapier }) => {
    await rapier.init();
    return rapier;
  }).catch((reason) => {
    initialization = undefined; // A later explicit entry may retry; do not hide this failure.
    throw new Error("Rapier WASM 初始化失败", { cause: reason });
  });
  return initialization;
}

function finiteTuple(value: number[], length: number, name: string) {
  if (!Array.isArray(value) || value.length !== length || !Array.from(value).every((number) => Number.isFinite(number) && Number.isFinite(Math.fround(number)))) {
    throw new Error(`${name} 必须为 ${length} 个有限数值`);
  }
}
function inside(position: Vec3Tuple, bounds: WalkSceneConfig["bounds"]) {
  return position.every((value, axis) => value >= bounds.min[axis]! && value <= bounds.max[axis]!);
}
export function validateWalkScene(config: WalkSceneConfig) {
  if (config.version !== 1 || config.units !== "meters") throw new Error("行走场景必须使用 version=1、米制坐标和 Y 轴向上");
  finiteTuple(config.spawn, 3, "出生点");
  if (!Number.isFinite(config.yaw)) throw new Error("出生朝向必须是有限弧度");
  finiteTuple(config.bounds.min, 3, "通行边界 min");
  finiteTuple(config.bounds.max, 3, "通行边界 max");
  if (config.bounds.min.some((value, axis) => value >= config.bounds.max[axis]!)) throw new Error("通行边界 min 必须小于 max");
  if (!inside(config.spawn, config.bounds)) throw new Error("出生点超出通行边界");
  if (!Array.isArray(config.colliders) || config.colliders.length < 1 || config.colliders.length > 2048) throw new Error("行走场景需要 1–2048 个简化碰撞体");
  const ids = new Set<string>();
  for (const collider of config.colliders) {
    if (typeof collider.id !== "string" || !collider.id.trim() || ids.has(collider.id)) throw new Error(`碰撞体 ID 缺失或重复：${collider.id}`);
    ids.add(collider.id);
    if (collider.role !== "floor" && collider.role !== "obstacle") throw new Error(`碰撞体 ${collider.id} 的角色无效`);
    finiteTuple(collider.center, 3, `${collider.id}.center`);
    finiteTuple(collider.halfExtents, 3, `${collider.id}.halfExtents`);
    if (collider.halfExtents.some((value) => value <= 0)) throw new Error(`碰撞体 ${collider.id} 的半尺寸必须大于零`);
    if (collider.rotation) {
      finiteTuple(collider.rotation, 4, `${collider.id}.rotation`);
      if (Math.abs(Math.hypot(...collider.rotation) - 1) > 0.0001) throw new Error(`碰撞体 ${collider.id} 必须使用单位四元数`);
    }
  }
  if (!config.colliders.some((collider) => collider.role === "floor")) throw new Error("行走场景缺少显式地面碰撞体");
}

export async function createWalkPhysics(input: WalkSceneConfig) {
  // Do not retain caller-owned mutable configuration across the asynchronous WASM load.
  const config = structuredClone(input);
  validateWalkScene(config);
  const rapier = await loadRapier();
  const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.timestep = WALK_STEP;
    const ids = new Map<number, string>();
    const floors = new Set<number>();
    for (const item of config.colliders) {
      const desc = rapier.ColliderDesc.cuboid(...item.halfExtents).setTranslation(...item.center);
      if (item.rotation) {
        const [x, y, z, w] = item.rotation;
        desc.setRotation({ x, y, z, w });
      }
      const collider = world.createCollider(desc);
      ids.set(collider.handle, item.id);
      if (item.role === "floor") floors.add(collider.handle);
    }
    const [x, y, z] = config.spawn;
    const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HALF_HEIGHT, z));
    const character = world.createCollider(rapier.ColliderDesc.capsule(HALF_HEIGHT - RADIUS, RADIUS), body);
    const controller = world.createCharacterController(0.01);
    // A 5 mm separation nudge avoids repeated zero-time floor contacts at metre scale.
    controller.setNormalNudgeFactor(0.005);
    controller.setMaxSlopeClimbAngle(Math.PI / 4);
    controller.setMinSlopeSlideAngle(Math.PI / 4);
    controller.enableAutostep(0.25, 0.3, false);
    controller.enableSnapToGround(0.2);
    world.step(); // Populate the query structures before validating the spawn.
    const overlap = world.intersectionWithShape(character.translation(), character.rotation(), character.shape, undefined, undefined, character);
    if (overlap) throw new Error(`出生点胶囊与碰撞体 ${ids.get(overlap.handle)} 重叠`);
    const support = world.castRayAndGetNormal(new rapier.Ray({ x, y: y + 0.01, z }, { x: 0, y: -1, z: 0 }), 0.21, true, undefined, undefined, character);
    if (!support || !floors.has(support.collider.handle) || support.normal.y < Math.SQRT1_2) throw new Error("出生点下方 0.2 米内没有可行走的显式地面");

    let disposed = false;
    let accumulator = 0;
    let velocityY = 0;
    let grounded = false;
    let steps = 0;
    let droppedSeconds = 0;
    let collisions: string[] = [];
    const ensureAlive = () => { if (disposed) throw new Error("Rapier 行走世界已释放"); };
    const feet = (): Vec3Tuple => {
      ensureAlive();
      const position = body.translation();
      return [position.x, position.y - HALF_HEIGHT, position.z];
    };
    return {
      advance(delta: number, right: number, forward: number, yaw: number) {
        ensureAlive();
        if (![delta, right, forward, yaw].every(Number.isFinite) || delta < 0 || Math.abs(right) > 1 || Math.abs(forward) > 1) throw new Error("行走步进参数必须是有限数值，时间不能为负，移动输入必须在 -1 到 1 之间");
        const budget = WALK_STEP * MAX_STEPS;
        const elapsed = accumulator + delta;
        droppedSeconds += Math.max(0, elapsed - budget);
        accumulator = Math.min(elapsed, budget);
        const length = Math.max(1, Math.hypot(right, forward));
        const dx = (Math.cos(yaw) * right - Math.sin(yaw) * forward) / length * SPEED * WALK_STEP;
        const dz = (-Math.sin(yaw) * right - Math.cos(yaw) * forward) / length * SPEED * WALK_STEP;
        steps = 0;
        while (accumulator + 1e-10 >= WALK_STEP && steps < MAX_STEPS) {
          velocityY -= 9.81 * WALK_STEP;
          controller.computeColliderMovement(character, { x: dx, y: velocityY * WALK_STEP, z: dz });
          const movement = controller.computedMovement();
          const current = body.translation();
          body.setNextKinematicTranslation({ x: current.x + movement.x, y: current.y + movement.y, z: current.z + movement.z });
          grounded = controller.computedGrounded();
          if (grounded) velocityY = 0;
          collisions = [];
          for (let i = 0; i < controller.numComputedCollisions(); i++) {
            const collision = controller.computedCollision(i);
            if (collision?.collider) collisions.push(ids.get(collision.collider.handle)!);
          }
          world.step();
          accumulator -= WALK_STEP;
          steps++;
          const position = feet();
          if (!position.every(Number.isFinite) || !inside(position, config.bounds)) throw new Error(`角色离开通行边界：${position.join(", ")}；请检查碰撞体与地面覆盖`);
        }
        return feet();
      },
      feet,
      pause() { ensureAlive(); accumulator = 0; },
      diagnostics() { ensureAlive(); return { grounded, steps, droppedSeconds, collisions, colliderCount: config.colliders.length, feet: feet() }; },
      dispose() { if (!disposed) { disposed = true; world.free(); } },
    };
  } catch (reason) {
    world.free();
    throw reason;
  }
}
