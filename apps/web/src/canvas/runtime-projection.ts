import type { CanvasNode } from "./types";

/** Native controls retain their own behavior; decorative nodes pass through to the 3D stage. */
export const runtimeControlNodeTypes = new Set<CanvasNode["type"]>([
  "button", "text-link", "fullscreen-toggle", "switch", "checkbox-group", "radio-group", "select", "carousel",
]);

export const isOverlayNode = (node: CanvasNode) => node.type !== "model-3d" && node.type !== "scene-3d";

export const isRuntimeNodeVisible = (node: CanvasNode, visibility: Record<string, boolean>) =>
  visibility[node.id] ?? !node.interaction?.hiddenInPreview;

export const runtimeNodeCapturesPointer = (node: CanvasNode) =>
  runtimeControlNodeTypes.has(node.type) || (node.interaction?.clickActions.length ?? 0) > 0;

/** Overrides are session state only. Never change the persisted document or its props in place. */
export const projectRuntimeNode = (node: CanvasNode, textOverrides: Record<string, string>): CanvasNode => {
  const text = textOverrides[node.id];
  return text === undefined ? node : { ...node, props: { ...node.props, text } };
};

export const canvasViewportScale = (width: number, height: number, canvasWidth: number, canvasHeight: number, overlay: boolean, fullscreen: boolean) => {
  const inset = overlay || fullscreen ? 0 : 48;
  const widthScale = Math.max(width - inset, 1) / canvasWidth;
  const heightScale = Math.max(height - inset, 1) / canvasHeight;
  return fullscreen ? Math.max(widthScale, heightScale) : overlay ? Math.min(widthScale, heightScale) : Math.min(widthScale, heightScale, 1);
};
