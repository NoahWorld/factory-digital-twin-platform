import { isSquareNodeType, minimumNodeSizes, type CanvasNode } from "./types";

export type SnapTargets = { vertical: number[]; horizontal: number[] };
export type SnappedPosition = {
  x: number;
  y: number;
  verticalGuide: number | null;
  horizontalGuide: number | null;
};

export type ResizeDirection = "north-west" | "north-east" | "south-east" | "south-west";

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

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export const resizeCanvasNode = (
  node: CanvasNode,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
  canvasWidth: number,
  canvasHeight: number,
): CanvasNode => {
  const west = direction === "north-west" || direction === "south-west";
  const north = direction === "north-west" || direction === "north-east";
  const fixedRight = Math.min(node.x + node.width, canvasWidth);
  const fixedBottom = Math.min(node.y + node.height, canvasHeight);
  const minimumSize = minimumNodeSizes[node.type];

  if (isSquareNodeType(node.type)) {
    const horizontalChange = west ? -deltaX : deltaX;
    const verticalChange = north ? -deltaY : deltaY;
    const requestedChange = Math.abs(horizontalChange) >= Math.abs(verticalChange)
      ? horizontalChange
      : verticalChange;
    const maximumSize = Math.min(
      west ? fixedRight : canvasWidth - node.x,
      north ? fixedBottom : canvasHeight - node.y,
    );
    const size = clamp(
      Math.round(node.width + requestedChange),
      Math.max(minimumSize.width, minimumSize.height),
      maximumSize,
    );
    return {
      ...node,
      x: west ? fixedRight - size : node.x,
      y: north ? fixedBottom - size : node.y,
      width: size,
      height: size,
    };
  }

  let x = node.x;
  let y = node.y;
  let width = node.width;
  let height = node.height;

  if (west) {
    x = clamp(Math.round(node.x + deltaX), 0, fixedRight - minimumSize.width);
    width = fixedRight - x;
  } else {
    width = clamp(Math.round(node.width + deltaX), minimumSize.width, canvasWidth - node.x);
  }

  if (north) {
    y = clamp(Math.round(node.y + deltaY), 0, fixedBottom - minimumSize.height);
    height = fixedBottom - y;
  } else {
    height = clamp(Math.round(node.height + deltaY), minimumSize.height, canvasHeight - node.y);
  }

  return { ...node, x, y, width, height };
};
