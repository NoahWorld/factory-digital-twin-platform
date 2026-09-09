import { findBuiltinModel } from "../../../shared/builtin-models";
import {
  STANDALONE_3D_LIMITS,
  type StandaloneSceneDocument,
  type StandaloneSceneInstance,
  type StandaloneSceneSettings,
} from "../../../shared/standalone-3d";
import {
  AppError,
  hasGlobalRole,
  type AppEnv,
  type AuthenticatedUser,
} from "./auth";

type JsonObject = Record<string, unknown>;

type SceneRow = {
  animation_speed: number;
  auto_rotate: number;
  background_color: string;
  background_opacity: number;
  camera_fov: number;
  camera_view: StandaloneSceneSettings["cameraView"];
  environment_light_color: string;
  environment_light_intensity: number;
  key_light_color: string;
  key_light_intensity: number;
  linked_2d_project_id: string | null;
  model_scale: number;
  play_animations: number;
  project_id: string;
  revision: number;
  rotation_speed: number;
  show_grid: number;
  updated_at: string;
};

type InstanceRow = {
  business_asset_key: string | null;
  id: string;
  label: string;
  model_asset_id: string;
  position_x: number;
  position_y: number;
  position_z: number;
  render_mode: StandaloneSceneInstance["renderMode"];
  rotation_x: number;
  rotation_y: number;
  rotation_z: number;
  scale_x: number;
  scale_y: number;
  scale_z: number;
  sort_order: number;
  visible: number;
};

export type StandaloneScenePatch = {
  deleteInstanceIds: string[];
  expectedRevision: number;
  linked2dProjectId?: string | null;
  settings?: StandaloneSceneSettings;
  upsertInstances: StandaloneSceneInstance[];
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const BUSINESS_ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const scenePatchFields = new Set([
  "deleteInstanceIds",
  "expectedRevision",
  "linked2dProjectId",
  "settings",
  "upsertInstances",
]);

const validateNumber = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new AppError(400, "invalid_scene_number", `${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
};

const validateId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new AppError(400, "invalid_scene_identifier", `${label} must be a stable identifier.`);
  }
  return value;
};

const validateVector = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new AppError(400, "invalid_scene_vector", `${label} must contain exactly three numbers.`);
  }
  return [
    validateNumber(value[0], `${label}[0]`, minimum, maximum),
    validateNumber(value[1], `${label}[1]`, minimum, maximum),
    validateNumber(value[2], `${label}[2]`, minimum, maximum),
  ];
};

const validateSettings = (value: unknown): StandaloneSceneSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "invalid_scene_settings", "Scene settings must be an object.");
  }
  const settings = value as JsonObject;
  const expected = new Set([
    "animationSpeed", "autoRotate", "backgroundColor", "backgroundOpacity", "cameraFov",
    "cameraView", "environmentLightColor", "environmentLightIntensity", "keyLightColor",
    "keyLightIntensity", "modelScale", "playAnimations", "rotationSpeed", "showGrid",
  ]);
  const unknown = Object.keys(settings).find((field) => !expected.has(field));
  if (unknown) {
    throw new AppError(400, "unknown_scene_setting", `Unsupported scene setting: ${unknown}.`);
  }
  for (const field of expected) {
    if (!(field in settings)) {
      throw new AppError(400, "missing_scene_setting", `Scene setting ${field} is required.`);
    }
  }
  if (
    typeof settings.backgroundColor !== "string" || !HEX_COLOR_PATTERN.test(settings.backgroundColor)
    || typeof settings.environmentLightColor !== "string" || !HEX_COLOR_PATTERN.test(settings.environmentLightColor)
    || typeof settings.keyLightColor !== "string" || !HEX_COLOR_PATTERN.test(settings.keyLightColor)
  ) {
    throw new AppError(400, "invalid_scene_color", "Scene colors must be six-digit hexadecimal colors.");
  }
  if (
    settings.cameraView !== "isometric" && settings.cameraView !== "isometric-left"
    && settings.cameraView !== "front" && settings.cameraView !== "top"
  ) {
    throw new AppError(400, "invalid_scene_camera_view", "The scene camera view is not supported.");
  }
  if (
    typeof settings.autoRotate !== "boolean"
    || typeof settings.playAnimations !== "boolean"
    || typeof settings.showGrid !== "boolean"
  ) {
    throw new AppError(400, "invalid_scene_boolean", "Scene toggles must be booleans.");
  }
  return {
    animationSpeed: validateNumber(settings.animationSpeed, "animationSpeed", 0.1, 3),
    autoRotate: settings.autoRotate,
    backgroundColor: settings.backgroundColor,
    backgroundOpacity: validateNumber(settings.backgroundOpacity, "backgroundOpacity", 0, 1),
    cameraFov: validateNumber(settings.cameraFov, "cameraFov", 15, 90),
    cameraView: settings.cameraView,
    environmentLightColor: settings.environmentLightColor,
    environmentLightIntensity: validateNumber(settings.environmentLightIntensity, "environmentLightIntensity", 0, 10),
    keyLightColor: settings.keyLightColor,
    keyLightIntensity: validateNumber(settings.keyLightIntensity, "keyLightIntensity", 0, 10),
    modelScale: validateNumber(settings.modelScale, "modelScale", 0.25, 4),
    playAnimations: settings.playAnimations,
    rotationSpeed: validateNumber(settings.rotationSpeed, "rotationSpeed", 0, 5),
    showGrid: settings.showGrid,
  };
};

const validateInstance = (value: unknown, index: number): StandaloneSceneInstance => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "invalid_scene_instance", `upsertInstances[${index}] must be an object.`);
  }
  const instance = value as JsonObject;
  const id = validateId(instance.id, `upsertInstances[${index}].id`);
  const modelAssetId = validateId(instance.modelAssetId, `upsertInstances[${index}].modelAssetId`);
  if (
    typeof instance.label !== "string" || instance.label.trim().length < 1
    || instance.label.length > 80 || /[\u0000-\u001f\u007f]/.test(instance.label)
  ) {
    throw new AppError(400, "invalid_scene_instance_label", `upsertInstances[${index}].label must contain 1 to 80 printable characters.`);
  }
  if (instance.renderMode !== "background" && instance.renderMode !== "interactive") {
    throw new AppError(400, "invalid_scene_render_mode", `upsertInstances[${index}].renderMode is not supported.`);
  }
  if (typeof instance.visible !== "boolean") {
    throw new AppError(400, "invalid_scene_instance_visibility", `upsertInstances[${index}].visible must be a boolean.`);
  }
  const assetId = instance.assetId === null
    ? null
    : typeof instance.assetId === "string" && BUSINESS_ASSET_PATTERN.test(instance.assetId)
      ? instance.assetId
      : undefined;
  if (assetId === undefined) {
    throw new AppError(400, "invalid_business_asset_id", `upsertInstances[${index}].assetId is not a valid business asset ID.`);
  }
  if (!instance.transform || typeof instance.transform !== "object" || Array.isArray(instance.transform)) {
    throw new AppError(400, "invalid_scene_transform", `upsertInstances[${index}].transform must be an object.`);
  }
  const transform = instance.transform as JsonObject;
  const sortOrder = validateNumber(instance.sortOrder, `upsertInstances[${index}].sortOrder`, 0, 100_000);
  if (!Number.isInteger(sortOrder)) {
    throw new AppError(400, "invalid_scene_sort_order", `upsertInstances[${index}].sortOrder must be an integer.`);
  }
  return {
    assetId,
    id,
    label: instance.label.trim(),
    modelAssetId,
    renderMode: instance.renderMode,
    sortOrder,
    transform: {
      position: validateVector(transform.position, `upsertInstances[${index}].position`, -1_000_000, 1_000_000),
      rotation: validateVector(transform.rotation, `upsertInstances[${index}].rotation`, -3_600, 3_600),
      scale: validateVector(transform.scale, `upsertInstances[${index}].scale`, 0.001, 1_000),
    },
    visible: instance.visible,
  };
};

export const validateStandaloneScenePatch = (body: JsonObject): StandaloneScenePatch => {
  const unknown = Object.keys(body).find((field) => !scenePatchFields.has(field));
  if (unknown) {
    throw new AppError(400, "unknown_scene_patch_field", `Unsupported scene patch field: ${unknown}.`);
  }
  if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    throw new AppError(400, "invalid_scene_revision", "expectedRevision must be a non-negative integer.");
  }
  const rawUpserts = body.upsertInstances ?? [];
  const rawDeletes = body.deleteInstanceIds ?? [];
  if (!Array.isArray(rawUpserts) || !Array.isArray(rawDeletes)) {
    throw new AppError(400, "invalid_scene_patch_instances", "Scene instance changes must be arrays.");
  }
  if (rawUpserts.length + rawDeletes.length > STANDALONE_3D_LIMITS.maximumPatchInstances) {
    throw new AppError(
      400,
      "scene_patch_too_large",
      `A scene patch can change at most ${STANDALONE_3D_LIMITS.maximumPatchInstances} instances.`,
    );
  }
  const upsertInstances = rawUpserts.map(validateInstance);
  const deleteInstanceIds = rawDeletes.map((value, index) => validateId(value, `deleteInstanceIds[${index}]`));
  const upsertIds = new Set(upsertInstances.map((instance) => instance.id));
  if (upsertIds.size !== upsertInstances.length || new Set(deleteInstanceIds).size !== deleteInstanceIds.length) {
    throw new AppError(400, "duplicate_scene_instance_id", "Scene instance IDs must be unique within each patch list.");
  }
  const overlap = deleteInstanceIds.find((id) => upsertIds.has(id));
  if (overlap) {
    throw new AppError(400, "conflicting_scene_instance_change", `Scene instance ${overlap} cannot be updated and deleted together.`);
  }
  let linked2dProjectId: string | null | undefined;
  if ("linked2dProjectId" in body) {
    linked2dProjectId = body.linked2dProjectId === null
      ? null
      : validateId(body.linked2dProjectId, "linked2dProjectId");
  }
  if (!body.settings && upsertInstances.length === 0 && deleteInstanceIds.length === 0 && linked2dProjectId === undefined) {
    throw new AppError(400, "empty_scene_patch", "A scene patch must contain at least one change.");
  }
  return {
    deleteInstanceIds,
    expectedRevision: body.expectedRevision as number,
    linked2dProjectId,
    settings: body.settings === undefined ? undefined : validateSettings(body.settings),
    upsertInstances,
  };
};

const sceneColumns = `
  project_id, revision, linked_2d_project_id, background_color, background_opacity,
  environment_light_color, environment_light_intensity, key_light_color,
  key_light_intensity, camera_fov, camera_view, model_scale, auto_rotate,
  rotation_speed, play_animations, animation_speed, show_grid, updated_at
`;

const instanceColumns = `
  id, model_asset_id, business_asset_key, label, render_mode, visible,
  position_x, position_y, position_z, rotation_x, rotation_y, rotation_z,
  scale_x, scale_y, scale_z, sort_order
`;

const presentSettings = (row: SceneRow): StandaloneSceneSettings => ({
  animationSpeed: row.animation_speed,
  autoRotate: row.auto_rotate === 1,
  backgroundColor: row.background_color,
  backgroundOpacity: row.background_opacity,
  cameraFov: row.camera_fov,
  cameraView: row.camera_view,
  environmentLightColor: row.environment_light_color,
  environmentLightIntensity: row.environment_light_intensity,
  keyLightColor: row.key_light_color,
  keyLightIntensity: row.key_light_intensity,
  modelScale: row.model_scale,
  playAnimations: row.play_animations === 1,
  rotationSpeed: row.rotation_speed,
  showGrid: row.show_grid === 1,
});

const presentInstance = (row: InstanceRow): StandaloneSceneInstance => ({
  assetId: row.business_asset_key,
  id: row.id,
  label: row.label,
  modelAssetId: row.model_asset_id,
  renderMode: row.render_mode,
  sortOrder: row.sort_order,
  transform: {
    position: [row.position_x, row.position_y, row.position_z],
    rotation: [row.rotation_x, row.rotation_y, row.rotation_z],
    scale: [row.scale_x, row.scale_y, row.scale_z],
  },
  visible: row.visible === 1,
});

export const getStandaloneScene = async (
  env: AppEnv,
  projectId: string,
): Promise<StandaloneSceneDocument> => {
  const [scene, instances] = await Promise.all([
    env.DB.prepare(`SELECT ${sceneColumns} FROM standalone_3d_scenes WHERE project_id = ?`)
      .bind(projectId)
      .first<SceneRow>(),
    env.DB.prepare(`SELECT ${instanceColumns} FROM standalone_3d_instances WHERE project_id = ? ORDER BY sort_order ASC, id ASC`)
      .bind(projectId)
      .all<InstanceRow>(),
  ]);
  if (!scene) {
    throw new AppError(404, "standalone_scene_not_found", "The standalone 3D scene was not found for this project.");
  }
  return {
    instances: instances.results.map(presentInstance),
    linked2dProjectId: scene.linked_2d_project_id,
    projectId: scene.project_id,
    revision: scene.revision,
    settings: presentSettings(scene),
    updatedAt: scene.updated_at,
  };
};

const requireLinked2dProject = async (
  env: AppEnv,
  user: AuthenticatedUser,
  linkedProjectId: string,
): Promise<void> => {
  const isPlatformAdmin = hasGlobalRole(user, "platform_admin") ? 1 : 0;
  const linked = await env.DB.prepare(
    `SELECT p.project_type AS project_type
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.id = ? AND (? = 1 OR pm.user_id IS NOT NULL)`,
  ).bind(user.id, linkedProjectId, isPlatformAdmin).first<{ project_type: string }>();
  if (!linked) {
    throw new AppError(404, "linked_2d_project_not_found", "The linked 2D project was not found or is not accessible.");
  }
  if (linked.project_type !== "2d") {
    throw new AppError(409, "linked_project_type_mismatch", "A standalone 3D scene can only link to a 2D project.");
  }
};

const validateModelBudget = async (
  env: AppEnv,
  projectId: string,
  instances: StandaloneSceneInstance[],
  playAnimations: boolean,
): Promise<void> => {
  if (instances.length > STANDALONE_3D_LIMITS.maximumInstances) {
    throw new AppError(
      409,
      "scene_instance_budget_exceeded",
      `The scene contains ${instances.length} instances; the current runtime budget is ${STANDALONE_3D_LIMITS.maximumInstances}.`,
    );
  }
  const modelAssetIds = [...new Set(instances.map((instance) => instance.modelAssetId))];
  if (modelAssetIds.length > STANDALONE_3D_LIMITS.maximumUniqueModelAssets) {
    throw new AppError(
      409,
      "scene_unique_model_budget_exceeded",
      `The scene references ${modelAssetIds.length} unique model files; the current budget is ${STANDALONE_3D_LIMITS.maximumUniqueModelAssets}.`,
    );
  }
  const modelCosts = new Map<string, { animationCount: number; byteSize: number; meshCount: number }>();
  for (const modelAssetId of modelAssetIds) {
    const builtin = findBuiltinModel(modelAssetId);
    if (builtin) {
      modelCosts.set(modelAssetId, {
        animationCount: builtin.inspection.animationCount,
        byteSize: builtin.byteSize,
        meshCount: builtin.inspection.meshCount,
      });
      continue;
    }
    const row = await env.DB.prepare(
      "SELECT byte_size, inspection_json FROM model_assets WHERE project_id = ? AND id = ?",
    ).bind(projectId, modelAssetId).first<{ byte_size: number; inspection_json: string }>();
    if (!row) {
      throw new AppError(400, "scene_model_asset_not_found", `Model resource ${modelAssetId} does not exist in this project.`);
    }
    let inspection: unknown;
    try {
      inspection = JSON.parse(row.inspection_json);
    } catch (reason) {
      throw new AppError(
        500,
        "scene_model_inspection_invalid",
        `Model resource ${modelAssetId} has invalid inspection metadata: ${reason instanceof Error ? reason.message : String(reason)}.`,
      );
    }
    if (
      !inspection || typeof inspection !== "object"
      || !Number.isInteger((inspection as JsonObject).meshCount)
      || ((inspection as JsonObject).meshCount as number) < 0
      || !Number.isInteger((inspection as JsonObject).animationCount)
      || ((inspection as JsonObject).animationCount as number) < 0
    ) {
      throw new AppError(
        500,
        "scene_model_inspection_invalid",
        `Model resource ${modelAssetId} is missing valid mesh and animation counts.`,
      );
    }
    modelCosts.set(modelAssetId, {
      animationCount: (inspection as JsonObject).animationCount as number,
      byteSize: row.byte_size,
      meshCount: (inspection as JsonObject).meshCount as number,
    });
  }
  const totalBytes = [...modelCosts.values()].reduce((total, cost) => total + cost.byteSize, 0);
  if (totalBytes > STANDALONE_3D_LIMITS.maximumUniqueModelBytes) {
    throw new AppError(
      409,
      "scene_model_byte_budget_exceeded",
      `The scene references ${totalBytes} unique model bytes; the current budget is ${STANDALONE_3D_LIMITS.maximumUniqueModelBytes}.`,
    );
  }
  const estimatedMeshInstances = instances.reduce(
    (total, instance) => total + (modelCosts.get(instance.modelAssetId)?.meshCount ?? 0),
    0,
  );
  if (estimatedMeshInstances > STANDALONE_3D_LIMITS.maximumEstimatedMeshInstances) {
    throw new AppError(
      409,
      "scene_mesh_budget_exceeded",
      `The scene is estimated to render ${estimatedMeshInstances} mesh instances; the current budget is ${STANDALONE_3D_LIMITS.maximumEstimatedMeshInstances}.`,
    );
  }
  const animatedInstances = playAnimations
    ? instances.filter((instance) => (modelCosts.get(instance.modelAssetId)?.animationCount ?? 0) > 0).length
    : 0;
  if (animatedInstances > STANDALONE_3D_LIMITS.maximumAnimatedInstances) {
    throw new AppError(
      409,
      "scene_animation_budget_exceeded",
      `The scene would play ${animatedInstances} animated instances; the current budget is ${STANDALONE_3D_LIMITS.maximumAnimatedInstances}.`,
    );
  }
};

export const applyStandaloneScenePatch = async (
  env: AppEnv,
  projectId: string,
  user: AuthenticatedUser,
  patch: StandaloneScenePatch,
): Promise<StandaloneSceneDocument> => {
  const current = await getStandaloneScene(env, projectId);
  if (current.revision !== patch.expectedRevision) {
    throw new AppError(
      409,
      "scene_revision_conflict",
      `The scene changed after revision ${patch.expectedRevision}. Reload it before saving.`,
    );
  }
  const instancesById = new Map(current.instances.map((instance) => [instance.id, instance]));
  patch.deleteInstanceIds.forEach((id) => instancesById.delete(id));
  patch.upsertInstances.forEach((instance) => instancesById.set(instance.id, instance));
  const nextInstances = [...instancesById.values()].sort((left, right) =>
    left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));

  const linked2dProjectId = patch.linked2dProjectId === undefined
    ? current.linked2dProjectId
    : patch.linked2dProjectId;
  if (linked2dProjectId !== null) {
    await requireLinked2dProject(env, user, linked2dProjectId);
  }
  const settings = patch.settings ?? current.settings;
  await validateModelBudget(env, projectId, nextInstances, settings.playAnimations);
  const now = new Date().toISOString();
  const nextRevision = current.revision + 1;
  const guard = "EXISTS (SELECT 1 FROM standalone_3d_scenes WHERE project_id = ? AND revision = ? AND updated_by_user_id = ? AND updated_at = ?)";
  const statements = [
    env.DB.prepare(
      `UPDATE standalone_3d_scenes SET
        revision = revision + 1, linked_2d_project_id = ?, background_color = ?,
        background_opacity = ?, environment_light_color = ?, environment_light_intensity = ?,
        key_light_color = ?, key_light_intensity = ?, camera_fov = ?, camera_view = ?,
        model_scale = ?, auto_rotate = ?, rotation_speed = ?, play_animations = ?,
        animation_speed = ?, show_grid = ?, updated_by_user_id = ?, updated_at = ?
       WHERE project_id = ? AND revision = ?`,
    ).bind(
      linked2dProjectId,
      settings.backgroundColor,
      settings.backgroundOpacity,
      settings.environmentLightColor,
      settings.environmentLightIntensity,
      settings.keyLightColor,
      settings.keyLightIntensity,
      settings.cameraFov,
      settings.cameraView,
      settings.modelScale,
      settings.autoRotate ? 1 : 0,
      settings.rotationSpeed,
      settings.playAnimations ? 1 : 0,
      settings.animationSpeed,
      settings.showGrid ? 1 : 0,
      user.id,
      now,
      projectId,
      current.revision,
    ),
    ...patch.deleteInstanceIds.map((id) => env.DB.prepare(
      `DELETE FROM standalone_3d_instances WHERE project_id = ? AND id = ? AND ${guard}`,
    ).bind(projectId, id, projectId, nextRevision, user.id, now)),
    ...patch.upsertInstances.map((instance) => env.DB.prepare(
      `INSERT INTO standalone_3d_instances (
        id, project_id, model_asset_id, business_asset_key, label, render_mode, visible,
        position_x, position_y, position_z, rotation_x, rotation_y, rotation_z,
        scale_x, scale_y, scale_z, sort_order, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ${guard}
      ON CONFLICT(project_id, id) DO UPDATE SET
        model_asset_id = excluded.model_asset_id,
        business_asset_key = excluded.business_asset_key,
        label = excluded.label,
        render_mode = excluded.render_mode,
        visible = excluded.visible,
        position_x = excluded.position_x,
        position_y = excluded.position_y,
        position_z = excluded.position_z,
        rotation_x = excluded.rotation_x,
        rotation_y = excluded.rotation_y,
        rotation_z = excluded.rotation_z,
        scale_x = excluded.scale_x,
        scale_y = excluded.scale_y,
        scale_z = excluded.scale_z,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at`,
    ).bind(
      instance.id,
      projectId,
      instance.modelAssetId,
      instance.assetId,
      instance.label,
      instance.renderMode,
      instance.visible ? 1 : 0,
      ...instance.transform.position,
      ...instance.transform.rotation,
      ...instance.transform.scale,
      instance.sortOrder,
      now,
      projectId,
      nextRevision,
      user.id,
      now,
    )),
    env.DB.prepare(
      `UPDATE projects SET updated_at = ? WHERE id = ? AND ${guard}`,
    ).bind(now, projectId, projectId, nextRevision, user.id, now),
  ];
  const results = await env.DB.batch(statements);
  if (results[0]?.meta?.changes !== 1) {
    throw new AppError(409, "scene_revision_conflict", "The scene changed while it was being saved. Reload it before retrying.");
  }
  return getStandaloneScene(env, projectId);
};
