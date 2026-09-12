import { AppError, type AppEnv } from "./auth";
import type { CanvasNode, Model3DProps } from "../../../shared/canvas-schema";

export async function validateCanvasResources(env: AppEnv, projectId: string, nodes: CanvasNode[]) {
  const modelNodes = nodes.filter((node) => node.type === "model-3d");
  const modelAssetRefs = [...new Set(modelNodes.flatMap((node) => node.resourceRefs))];
  const duplicateNamesByAssetId = new Map<string, Set<string>>();
  for (const assetId of modelAssetRefs) {
    const row = await env.DB.prepare(
      "SELECT id, inspection_json FROM model_assets WHERE id = ? AND project_id = ?",
    ).bind(assetId, projectId).first<{ id: string; inspection_json: string }>();
    if (!row) {
      throw new AppError(
        400,
        "invalid_model_asset_reference",
        `Model asset ${assetId} does not belong to project ${projectId}.`,
      );
    }
    let inspection: unknown;
    try {
      inspection = JSON.parse(row.inspection_json);
    } catch (error) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} has invalid inspection JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} inspection is not a JSON object.`,
      );
    }
    const inspectionObject = inspection as Record<string, unknown>;
    if (
      !Array.isArray(inspectionObject.duplicateNodeNames)
      || inspectionObject.duplicateNodeNames.some((name) => typeof name !== "string")
    ) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} inspection does not contain a valid duplicateNodeNames list.`,
      );
    }
    duplicateNamesByAssetId.set(
      assetId,
      new Set(inspectionObject.duplicateNodeNames as string[]),
    );
  }

  for (const node of modelNodes) {
    const transformOverrides = (node.props as Model3DProps).transformOverrides;
    const appearanceOverrides = (node.props as Model3DProps).appearanceOverrides;
    const transformedNodeNames = Object.keys(transformOverrides);
    const appearanceNodeNames = Object.keys(appearanceOverrides);
    if (transformedNodeNames.length === 0 && appearanceNodeNames.length === 0) continue;

    const assetId = node.resourceRefs[0];
    if (!assetId) {
      const hasAppearanceOverride = appearanceNodeNames.length > 0;
      throw new AppError(
        400,
        hasAppearanceOverride
          ? "model_appearance_without_asset"
          : "model_transform_without_asset",
        `Canvas node ${node.id} cannot store model node ${
          hasAppearanceOverride ? "appearances" : "transforms"
        } without a model asset.`,
      );
    }
    const duplicateNames = duplicateNamesByAssetId.get(assetId);
    const duplicateTransformName = transformedNodeNames.find((name) => duplicateNames?.has(name));
    if (duplicateTransformName) {
      throw new AppError(
        400,
        "ambiguous_model_node_transform",
        `Canvas node ${node.id} cannot transform duplicate model node name ${JSON.stringify(duplicateTransformName)}. Rename the model nodes and upload the model again.`,
      );
    }
    const duplicateAppearanceName = appearanceNodeNames.find((name) => duplicateNames?.has(name));
    if (duplicateAppearanceName) {
      throw new AppError(
        400,
        "ambiguous_model_node_appearance",
        `Canvas node ${node.id} cannot configure the appearance of duplicate model node name ${JSON.stringify(duplicateAppearanceName)}. Rename the model nodes and upload the model again.`,
      );
    }
  }

  const imageAssetRefs = [...new Set(
    nodes
      .filter((node) => node.type === "image" || node.type === "carousel")
      .flatMap((node) => node.resourceRefs),
  )];
  for (const assetId of imageAssetRefs) {
    const imageAsset = await env.DB.prepare(
      "SELECT id FROM image_assets WHERE id = ? AND project_id = ?",
    ).bind(assetId, projectId).first<{ id: string }>();
    if (!imageAsset) {
      throw new AppError(
        400,
        "invalid_image_asset_reference",
        `Image asset ${assetId} does not belong to project ${projectId}.`,
      );
    }
  }

}
