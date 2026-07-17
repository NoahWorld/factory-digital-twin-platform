import type { CanvasNode } from "./types";

export type SnapTargets = { vertical: number[]; horizontal: number[] };
export type SnappedPosition = {
  x: number;
  y: number;
  verticalGuide: number | null;
  horizontalGuide: number | null;
};

const sortedUnique = (values: number[]): number[] =>
  [...new Set(values)].sort((left, right) => left - right);

export const buildSnapTargets = (
  nodes: CanvasNode[],
  movingNodeId: string,
  canvasWidth: number,
  canvasHeight: number,
): SnapTargets => {
  const vertical = [0, canvasWidth / 2, canvasWidth];
  const horizontal = [0, canvasHeight / 2, canvasHeight];

  for (const node of nodes) {
    if (node.id === movingNodeId) continue;
    vertical.push(node.x, node.x + node.width / 2, node.x + node.width);
    horizontal.push(node.y, node.y + node.height / 2, node.y + node.height);
  }

  return { vertical: sortedUnique(vertical), horizontal: sortedUnique(horizontal) };
};

const snapAxis = (
  position: number,
  size: number,
  maxPosition: number,
  targets: number[],
  threshold: number,
) => {
  const anchors = [
    { offset: 0, value: position },
    { offset: size / 2, value: position + size / 2 },
    { offset: size, value: position + size },
  ];
  let bestDistance = threshold + 1;
  let bestPosition = position;
  let guide: number | null = null;

  for (const target of targets) {
    for (const anchor of anchors) {
      const distance = Math.abs(target - anchor.value);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = target - anchor.offset;
        guide = target;
      }
    }
  }

  return {
    position: Math.min(
      Math.max(bestDistance <= threshold ? bestPosition : position, 0),
      Math.max(maxPosition, 0),
    ),
    guide: bestDistance <= threshold ? guide : null,
  };
};

export const snapNodePosition = (
  x: number,
  y: number,
  node: CanvasNode,
  targets: SnapTargets,
  canvasWidth: number,
  canvasHeight: number,
  threshold = 7,
): SnappedPosition => {
  const horizontal = snapAxis(x, node.width, canvasWidth - node.width, targets.vertical, threshold);
  const vertical = snapAxis(y, node.height, canvasHeight - node.height, targets.horizontal, threshold);
  return {
    x: horizontal.position,
    y: vertical.position,
    verticalGuide: horizontal.guide,
    horizontalGuide: vertical.guide,
  };
};
