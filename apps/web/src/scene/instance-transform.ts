import { MathUtils, type Object3D } from "three";
import type { ModelNodeTransform, Vector3Tuple } from "../canvas/types";

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
  const values = [object.scale.x, object.scale.y, object.scale.z];
  if (values.some((value) => !Number.isFinite(value))) throw new Error("模型实例缩放产生了非有限数值");
  object.scale.set(
    Math.min(INSTANCE_SCALE_MAXIMUM, Math.max(INSTANCE_SCALE_MINIMUM, object.scale.x)),
    Math.min(INSTANCE_SCALE_MAXIMUM, Math.max(INSTANCE_SCALE_MINIMUM, object.scale.y)),
    Math.min(INSTANCE_SCALE_MAXIMUM, Math.max(INSTANCE_SCALE_MINIMUM, object.scale.z)),
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
