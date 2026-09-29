import { MathUtils, type Object3D } from "three";
import type { ModelNodeTransform, Vector3Tuple } from "../canvas/types";
import { SCENE_DECORATION_LIMITS } from "../../../../shared/scene-decorations";

export type InstanceTransformMode = "translate" | "scale";

export const INSTANCE_SCALE_MINIMUM = 0.001;
export const INSTANCE_SCALE_MAXIMUM = 1_000;

const roundEditorValue = (value: number): number => {
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const vectorTuple = (
  label: string,
  values: readonly number[],
  minimum: number,
  maximum: number,
): Vector3Tuple => {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value) || value < minimum || value > maximum)) {
    throw new Error(`${label}超出可保存范围`);
  }
  return values.map(roundEditorValue) as Vector3Tuple;
};

/** Keep mouse scaling inside the same contract enforced by inputs and the scene API. */
export const constrainEditableInstanceScale = (object: Object3D): void => {
  constrainScale(object, INSTANCE_SCALE_MINIMUM, INSTANCE_SCALE_MAXIMUM, "模型实例");
};

const constrainScale = (object: Object3D, minimum: number, maximum: number, label: string): void => {
  const values = [object.scale.x, object.scale.y, object.scale.z];
  if (values.some((value) => !Number.isFinite(value))) throw new Error(`${label}缩放产生了非有限数值`);
  object.scale.set(
    Math.min(maximum, Math.max(minimum, object.scale.x)),
    Math.min(maximum, Math.max(minimum, object.scale.y)),
    Math.min(maximum, Math.max(minimum, object.scale.z)),
  );
};

/** Convert a Three.js object transform to the persisted degree-based scene contract. */
export const readEditableInstanceTransform = (object: Object3D): ModelNodeTransform => ({
  position: vectorTuple("模型实例位置", object.position.toArray(), -1_000_000, 1_000_000),
  rotation: vectorTuple("模型实例旋转", [
    MathUtils.radToDeg(object.rotation.x),
    MathUtils.radToDeg(object.rotation.y),
    MathUtils.radToDeg(object.rotation.z),
  ], -3_600, 3_600),
  scale: vectorTuple("模型实例缩放", object.scale.toArray(), INSTANCE_SCALE_MINIMUM, INSTANCE_SCALE_MAXIMUM),
});

/** Procedural library models keep their existing, narrower saved-scene contract. */
export const constrainEditableDecorationScale = (object: Object3D): void => {
  constrainScale(object, SCENE_DECORATION_LIMITS.minimumScale, SCENE_DECORATION_LIMITS.maximumScale, "场景对象");
};

export const readEditableDecorationTransform = (object: Object3D): ModelNodeTransform => ({
  position: vectorTuple("场景对象位置", object.position.toArray(), -SCENE_DECORATION_LIMITS.maximumCoordinate, SCENE_DECORATION_LIMITS.maximumCoordinate),
  rotation: vectorTuple("场景对象旋转", [
    MathUtils.radToDeg(object.rotation.x),
    MathUtils.radToDeg(object.rotation.y),
    MathUtils.radToDeg(object.rotation.z),
  ], -SCENE_DECORATION_LIMITS.maximumRotation, SCENE_DECORATION_LIMITS.maximumRotation),
  scale: vectorTuple("场景对象缩放", object.scale.toArray(), SCENE_DECORATION_LIMITS.minimumScale, SCENE_DECORATION_LIMITS.maximumScale),
});
