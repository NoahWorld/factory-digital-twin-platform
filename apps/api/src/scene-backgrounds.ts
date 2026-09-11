import { AppError, type AppEnv } from "./auth";
import { readStoredImageAsset } from "./image-assets";
import {
  createGeneratedBackgroundModelAsset,
  type ModelAsset,
  type SceneBackgroundGeneration,
} from "./model-assets";
import { buildTexturedBackgroundPlaneGlb } from "./scene-background-glb";

export type SceneBackgroundQuality = "lightweight" | "balanced" | "detail";
export type SceneBackgroundMovement = "fixed";

export type SceneBackgroundGenerationInput = {
  knownScaleMeters: number | null;
  movement: SceneBackgroundMovement;
  name: string;
  quality: SceneBackgroundQuality;
  sourceImageAssetId: string;
};

export type GeneratedSceneBackground = {
  modelAsset: ModelAsset;
};

const qualities = new Set<SceneBackgroundQuality>(["lightweight", "balanced", "detail"]);
const DEFAULT_BACKGROUND_WIDTH_METERS = 10;

export const validateSceneBackgroundGenerationInput = (
  body: Record<string, unknown>,
): SceneBackgroundGenerationInput => {
  if (typeof body.sourceImageAssetId !== "string" || body.sourceImageAssetId.trim().length < 1) {
    throw new AppError(400, "invalid_background_source_image", "A sourceImageAssetId is required.");
  }
  const sourceImageAssetId = body.sourceImageAssetId.trim();
  if (sourceImageAssetId.length > 128 || sourceImageAssetId.includes("/") || sourceImageAssetId.includes("\\")) {
    throw new AppError(400, "invalid_background_source_image", "The source image asset ID is invalid.");
  }

  if (typeof body.name !== "string") {
    throw new AppError(400, "invalid_background_name", "A background name is required.");
  }
  const name = body.name.trim();
  if (
    name.length < 2
    || name.length > 80
    || name.includes("/")
    || name.includes("\\")
    || name.includes("\0")
  ) {
    throw new AppError(
      400,
      "invalid_background_name",
      "The background name must contain 2 to 80 characters and cannot contain path separators.",
    );
  }

  if (typeof body.quality !== "string" || !qualities.has(body.quality as SceneBackgroundQuality)) {
    throw new AppError(400, "invalid_background_quality", "Background quality must be lightweight, balanced or detail.");
  }
  if (body.movement !== "fixed") {
    throw new AppError(400, "invalid_background_movement", "The current single-image background generator supports fixed-view backgrounds only.");
  }

  let knownScaleMeters: number | null = null;
  if (body.knownScaleMeters !== null && body.knownScaleMeters !== undefined) {
    if (
      typeof body.knownScaleMeters !== "number"
      || !Number.isFinite(body.knownScaleMeters)
      || body.knownScaleMeters <= 0
      || body.knownScaleMeters > 100_000
    ) {
      throw new AppError(
        400,
        "invalid_background_scale",
        "knownScaleMeters must be greater than 0 and no more than 100000.",
      );
    }
    knownScaleMeters = body.knownScaleMeters;
  }

  return {
    knownScaleMeters,
    movement: body.movement as SceneBackgroundMovement,
    name,
    quality: body.quality as SceneBackgroundQuality,
    sourceImageAssetId,
  };
};

export const generateSceneBackground = async (
  env: AppEnv,
  projectId: string,
  userId: string,
  input: SceneBackgroundGenerationInput,
): Promise<GeneratedSceneBackground> => {
  const source = await readStoredImageAsset(env, projectId, input.sourceImageAssetId);
  let generated;
  try {
    generated = buildTexturedBackgroundPlaneGlb({
      imageBytes: source.bytes,
      imageFormat: source.asset.format,
      planeWidthMeters: input.knownScaleMeters ?? DEFAULT_BACKGROUND_WIDTH_METERS,
    });
  } catch (error) {
    throw new AppError(
      422,
      "background_image_generation_failed",
      `The source image could not be converted into a background model: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (generated.imageWidth > 16_384 || generated.imageHeight > 16_384) {
    throw new AppError(
      422,
      "background_image_dimensions_too_large",
      `The source image is ${generated.imageWidth}×${generated.imageHeight}; each side must be no more than 16384 pixels for WebGL compatibility.`,
    );
  }

  const generation: SceneBackgroundGeneration = {
    algorithm: "textured-plane-v1",
    imageHeight: generated.imageHeight,
    imageWidth: generated.imageWidth,
    movement: input.movement,
    planeHeightMeters: generated.planeHeightMeters,
    planeWidthMeters: generated.planeWidthMeters,
    quality: input.quality,
    sourceImageAssetId: source.asset.id,
  };
  const modelAsset = await createGeneratedBackgroundModelAsset(
    env,
    projectId,
    userId,
    `${input.name}.glb`,
    generated.bytes,
    generation,
  );
  return { modelAsset };
};
