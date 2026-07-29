import type { Object3D } from "three";
import type { ModelNodeTransform } from "./types";

export type ModelSceneNode = {
  path: string;
  name: string;
  objectType: string;
  isMesh: boolean;
  transform: ModelNodeTransform;
  children: ModelSceneNode[];
};

export type ModelSceneSnapshot = {
  assetId: string;
  roots: ModelSceneNode[];
  totalNodeCount: number;
  namedNodeCount: number;
};

type SceneTreeResult = Omit<ModelSceneSnapshot, "assetId">;

const toSceneNode = (
  object: Object3D,
  path: string,
  counts: { total: number; named: number },
): ModelSceneNode => {
  const name = object.name.trim();
  counts.total += 1;
  if (name) counts.named += 1;

  return {
    path,
    name,
    objectType: object.type,
    isMesh: "isMesh" in object && object.isMesh === true,
    transform: {
      position: [object.position.x, object.position.y, object.position.z],
      rotation: [
        object.rotation.x * 180 / Math.PI,
        object.rotation.y * 180 / Math.PI,
        object.rotation.z * 180 / Math.PI,
      ],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    },
    children: object.children.map((child, index) =>
      toSceneNode(child, `${path}/${index}`, counts),
    ),
  };
};

export const buildModelSceneTree = (sceneRoot: Object3D): SceneTreeResult => {
  const counts = { total: 0, named: 0 };
  const roots = sceneRoot.children.map((child, index) =>
    toSceneNode(child, String(index), counts),
  );

  return {
    roots,
    totalNodeCount: counts.total,
    namedNodeCount: counts.named,
  };
};

export const findModelSceneNode = (
  roots: ModelSceneNode[],
  path: string | null,
): ModelSceneNode | null => {
  if (path === null) return null;

  const indexes = path.split("/").map((part) => Number(part));
  if (
    indexes.length === 0
    || indexes.some((index) => !Number.isSafeInteger(index) || index < 0)
  ) {
    return null;
  }

  let level = roots;
  let current: ModelSceneNode | null = null;
  for (const index of indexes) {
    current = level[index] ?? null;
    if (!current) return null;
    level = current.children;
  }
  return current;
};
