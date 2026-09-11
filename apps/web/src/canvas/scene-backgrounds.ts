import type { ModelAsset } from "./model-assets";

export type SceneBackgroundGenerationRequest = {
  knownScaleMeters: number | null;
  movement: "fixed" | "limited";
  name: string;
  quality: "lightweight" | "balanced" | "detail";
  sourceImageAssetId: string;
};

export type SceneBackgroundGenerationResponse = {
  modelAsset: ModelAsset;
  requestId: string;
};

export const sceneBackgroundsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/scene-backgrounds`;
