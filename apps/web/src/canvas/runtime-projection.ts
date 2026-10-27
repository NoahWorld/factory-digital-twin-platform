import type { CanvasNode } from "./types";
import type { PlaybackSelection } from "../../../../shared/scene-playback";

/** Native controls retain their own behavior; decorative nodes pass through to the 3D stage. */
export const runtimeControlNodeTypes = new Set<CanvasNode["type"]>([
  "button", "text-link", "fullscreen-toggle", "switch", "checkbox-group", "radio-group", "select", "carousel",
]);

export const isOverlayNode = (node: CanvasNode) => node.type !== "model-3d" && node.type !== "scene-3d";

export const isRuntimeNodeVisible = (node: CanvasNode, visibility: Record<string, boolean>) =>
  visibility[node.id] ?? !node.interaction?.hiddenInPreview;

export const runtimeNodeCapturesPointer = (node: CanvasNode) =>
  runtimeControlNodeTypes.has(node.type) || (node.interaction?.clickActions.length ?? 0) > 0;

/** A single explicit focus target also identifies a selectable visual for that model. */
export const runtimeNodeModelSelected = (node: CanvasNode, selection: PlaybackSelection): boolean | undefined => {
  if (node.type !== "button" && node.type !== "vector-icon") return undefined;
  const targets = node.interaction?.clickActions.filter((action) => action.type === "focus-model") ?? [];
  if (targets.length !== 1) return undefined;
  const target = targets[0];
  return selection[target.projectId] === target.instanceId;
};

/** Overrides are session state only. Never change the persisted document or its props in place. */
export const projectRuntimeNode = (node: CanvasNode, textOverrides: Record<string, string>): CanvasNode => {
  const text = textOverrides[node.id];
  return text === undefined ? node : { ...node, props: { ...node.props, text } };
};

export const canvasViewportScale = (width: number, height: number, canvasWidth: number, canvasHeight: number, mode: "editor" | "contain" | "cover") => {
  const inset = mode === "editor" ? 48 : 0;
  const widthScale = Math.max(width - inset, 1) / canvasWidth;
  const heightScale = Math.max(height - inset, 1) / canvasHeight;
  return mode === "cover" ? Math.max(widthScale, heightScale) : mode === "contain" ? Math.min(widthScale, heightScale) : Math.min(widthScale, heightScale, 1);
};
