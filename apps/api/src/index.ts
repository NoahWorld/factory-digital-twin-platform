import {
  AppError,
  applySessionCookie,
  capabilitiesFor,
  createSession,
  createUser,
  destroyCurrentSession,
  getAuthenticatedUser,
  hasGlobalRole,
  INITIAL_ADMIN_LOGIN_NAME,
  isBootstrapRequired,
  validateDisplayName,
  validateEmail,
  validateLoginIdentifier,
  validateLoginName,
  validatePassword,
  verifyBootstrapToken,
  verifyCredentials,
  type AppEnv,
  type AuthenticatedUser,
} from "./auth";
import {
  createAsset,
  listAssets,
  updateAsset,
  validateAssetCreate,
  validateAssetPatch,
} from "./assets";
import {
  createAssetDataBinding,
  deleteAssetDataBinding,
  listAssetDataBindings,
  updateAssetDataBinding,
  validateAssetDataBindingCreate,
} from "./asset-data-bindings";
import { applyCanvasPatch, getCanvas, validateCanvasPatch } from "./canvas";
import {
  createDataSource,
  listDataSources,
  updateDataSource,
  validateDataSourceCreate,
} from "./data-sources";
import {
  deleteModelAsset,
  listModelAssets,
  modelAssetContentResponse,
  uploadModelAsset,
} from "./model-assets";
import {
  deleteImageAsset,
  imageAssetContentResponse,
  listImageAssets,
  uploadImageAsset,
} from "./image-assets";
import {
  deleteMediaAsset,
  listMediaAssets,
  mediaAssetContentResponse,
  uploadMediaAsset,
} from "./media-assets";
import {
  generateSceneBackground,
  validateSceneBackgroundGenerationInput,
} from "./scene-backgrounds";
import { projectCoverResponse } from "./project-covers";
import { collectAssetRuntimeState, probeRestDataSource } from "./runtime-state";
import {
  applyStandaloneScenePatch,
  getStandaloneScene,
  validateStandaloneScenePatch,
} from "./standalone-scenes";
import {
  STANDALONE_3D_LIMITS,
  isProjectType,
  type ProjectType,
} from "../../../shared/standalone-3d";

type ProjectStatus = "draft" | "published" | "archived";

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  project_role: "owner" | "editor" | "viewer" | null;
  cover_revision: number | null;
  project_type: ProjectType;
};

type JsonObject = Record<string, unknown>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });

const errorResponse = (error: AppError, requestId: string): Response =>
  json(
    {
      error: error.code,
      message: error.message,
      requestId,
    },
    error.status,
  );

const readJsonObject = async (request: Request, maximumBytes = 64 * 1024): Promise<JsonObject> => {
  let body: unknown;
  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new AppError(413, "request_body_too_large", `Request body cannot exceed ${maximumBytes} bytes.`);
  }

  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "invalid_request_body", "Request body must be a JSON object.");
  }

  return body as JsonObject;
};

const validateProjectName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_project_name", "Project name is required.");
  }

  const name = value.trim();

  if (name.length < 2 || name.length > 100) {
    throw new AppError(
      400,
      "invalid_project_name",
      "Project name must contain 2 to 100 characters.",
    );
  }

  return name;
};

const decodePathSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AppError(400, "invalid_path_parameter", "The project ID path segment is not valid URL encoding.");
  }
};

const referencedDeletionConfirmed = (url: URL): boolean => {
  const value = url.searchParams.get("confirmReferenced");
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  throw new AppError(
    400,
    "invalid_delete_confirmation",
    "The confirmReferenced query parameter must be either true or false.",
  );
};

const presentUser = (user: AuthenticatedUser) => ({
  id: user.id,
  email: user.email,
  loginName: user.loginName,
  displayName: user.displayName,
  roles: user.roles,
  capabilities: capabilitiesFor(user),
});

const presentProject = (project: ProjectRow) => ({
  id: project.id,
  name: project.name,
  status: project.status,
  projectType: project.project_type,
  createdAt: project.created_at,
  updatedAt: project.updated_at,
  projectRole: project.project_role,
  coverUrl: project.cover_revision && project.cover_revision > 0
    ? `/api/v1/projects/${encodeURIComponent(project.id)}/cover.svg?revision=${project.cover_revision}`
    : null,
});

const requireProjectAccess = async (
  env: AppEnv,
  user: AuthenticatedUser,
  projectId: string,
): Promise<ProjectRow> => {
  const isPlatformAdmin = hasGlobalRole(user, "platform_admin") ? 1 : 0;
  const project = await env.DB.prepare(
    `SELECT p.id, p.name, p.status, p.project_type, p.created_at, p.updated_at,
       pm.role AS project_role, pc.revision AS cover_revision
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN project_canvases pc ON pc.project_id = p.id
     WHERE p.id = ? AND (? = 1 OR pm.user_id IS NOT NULL)`,
  )
    .bind(user.id, projectId, isPlatformAdmin)
    .first<ProjectRow>();

  if (!project) {
    throw new AppError(404, "project_not_found", "Project was not found or is not accessible.");
  }

  return project;
};

const canEditProject = (user: AuthenticatedUser, project: ProjectRow): boolean =>
  hasGlobalRole(user, "platform_admin") || project.project_role === "owner" || project.project_role === "editor";

const canDeleteProject = (user: AuthenticatedUser, project: ProjectRow): boolean =>
  hasGlobalRole(user, "platform_admin") || project.project_role === "owner";

const listProjects = async (env: AppEnv, user: AuthenticatedUser): Promise<ProjectRow[]> => {
  const isPlatformAdmin = hasGlobalRole(user, "platform_admin") ? 1 : 0;
  const result = await env.DB.prepare(
    `SELECT p.id, p.name, p.status, p.project_type, p.created_at, p.updated_at,
       pm.role AS project_role, pc.revision AS cover_revision
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN project_canvases pc ON pc.project_id = p.id
     WHERE ? = 1 OR pm.user_id IS NOT NULL
     ORDER BY p.updated_at DESC, p.name ASC`,
  )
    .bind(user.id, isPlatformAdmin)
    .all<ProjectRow>();

  return result.results ?? [];
};

const createProject = async (
  env: AppEnv,
  user: AuthenticatedUser,
  name: string,
  projectType: ProjectType,
): Promise<ProjectRow> => {
  if (!hasGlobalRole(user, "platform_admin", "delivery_manager")) {
    throw new AppError(403, "permission_denied", "You do not have permission to create projects.");
  }

  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();

  const statements = [
    env.DB
      .prepare(
        `INSERT INTO projects (
          id, name, status, project_type, created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
      )
      .bind(projectId, name, projectType, user.id, now, now),
    env.DB
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
         VALUES (?, ?, 'owner', ?, ?)`,
      )
      .bind(projectId, user.id, now, now),
  ];
  if (projectType === "3d") {
    statements.push(env.DB.prepare(
      `INSERT INTO standalone_3d_scenes (project_id, updated_by_user_id, updated_at)
       VALUES (?, ?, ?)`,
    ).bind(projectId, user.id, now));
  }
  await env.DB.batch(statements);

  return {
    id: projectId,
    name,
    status: "draft",
    created_at: now,
    updated_at: now,
    project_role: "owner",
    cover_revision: null,
    project_type: projectType,
  };
};

const updateProjectName = async (
  env: AppEnv,
  project: ProjectRow,
  name: string,
): Promise<ProjectRow> => {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
  ).bind(name, now, project.id).run();

  if (result.meta?.changes !== 1) {
    throw new AppError(
      409,
      "project_update_conflict",
      "The project could not be renamed because it changed or was deleted.",
    );
  }

  return { ...project, name, updated_at: now };
};

type ProjectDeletionResult = {
  deletedProjectId: string;
  deletedImageObjectCount: number;
  deletedMediaObjectCount: number;
  deletedModelObjectCount: number;
  warning: string | null;
};

const deleteProject = async (
  env: AppEnv,
  projectId: string,
): Promise<ProjectDeletionResult> => {
  const modelObjectRows = await env.DB.prepare(
    "SELECT object_key FROM model_assets WHERE project_id = ? ORDER BY object_key ASC",
  ).bind(projectId).all<{ object_key: string }>();
  const imageObjectRows = await env.DB.prepare(
    "SELECT object_key FROM image_assets WHERE project_id = ? ORDER BY object_key ASC",
  ).bind(projectId).all<{ object_key: string }>();
  const mediaObjectRows = await env.DB.prepare(
    "SELECT object_key FROM media_assets WHERE project_id = ? ORDER BY object_key ASC",
  ).bind(projectId).all<{ object_key: string }>();

  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM asset_data_bindings
       WHERE asset_id IN (SELECT id FROM assets WHERE project_id = ?)`,
    ).bind(projectId),
    env.DB.prepare(
      `DELETE FROM asset_data_bindings
       WHERE data_source_id IN (SELECT id FROM data_sources WHERE project_id = ?)`,
    ).bind(projectId),
    env.DB.prepare("DELETE FROM assets WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM data_sources WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM project_versions WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM media_assets WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM image_assets WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM model_assets WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM standalone_3d_instances WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM standalone_3d_scenes WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM project_canvases WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projectId),
    env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(projectId),
  ]);

  if (results.at(-1)?.meta?.changes !== 1) {
    throw new AppError(
      409,
      "project_delete_conflict",
      "The project could not be deleted because it changed or was already deleted.",
    );
  }

  let deletedImageObjectCount = 0;
  let deletedMediaObjectCount = 0;
  let deletedModelObjectCount = 0;
  let warning: string | null = null;
  const projectFiles = env.PROJECT_FILES;
  const objectCount = modelObjectRows.results.length
    + imageObjectRows.results.length
    + mediaObjectRows.results.length;
  if (objectCount > 0 && !projectFiles) {
    warning = `The project was deleted, but ${objectCount} project file object(s) could not be removed because PROJECT_FILES storage is not configured.`;
  } else if (projectFiles) {
    try {
      for (const row of imageObjectRows.results) {
        await projectFiles.delete(row.object_key);
        deletedImageObjectCount += 1;
      }
      for (const row of modelObjectRows.results) {
        await projectFiles.delete(row.object_key);
        deletedModelObjectCount += 1;
      }
      for (const row of mediaObjectRows.results) {
        await projectFiles.delete(row.object_key);
        deletedMediaObjectCount += 1;
      }
    } catch (error) {
      warning = `The project was deleted, but project file cleanup stopped after ${deletedImageObjectCount + deletedModelObjectCount + deletedMediaObjectCount} of ${objectCount} object(s): ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return {
    deletedProjectId: projectId,
    deletedImageObjectCount,
    deletedMediaObjectCount,
    deletedModelObjectCount,
    warning,
  };
};

const handleApiRequest = async (
  request: Request,
  env: AppEnv,
  requestId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const { method } = request;
  const { pathname } = url;

  if (method === "GET" && pathname === "/health") {
    const projectFileStorageConfigured = Boolean(env.PROJECT_FILES);
    return json({
      status: projectFileStorageConfigured ? "ok" : "degraded",
      service: "factory-digital-twin-api",
      dependencies: {
        database: "configured",
        projectFileStorage: projectFileStorageConfigured ? "configured" : "not_configured",
      },
      timestamp: new Date().toISOString(),
      requestId,
    });
  }

  if (method === "GET" && pathname === "/api/v1/auth/bootstrap-status") {
    return json({ setupRequired: await isBootstrapRequired(env), requestId });
  }

  if (method === "POST" && pathname === "/api/v1/auth/bootstrap") {
    if (!(await isBootstrapRequired(env))) {
      throw new AppError(409, "bootstrap_completed", "The initial administrator already exists.");
    }

    await verifyBootstrapToken(env, request.headers.get("x-bootstrap-token"));
    const body = await readJsonObject(request);
    const user = await createUser(env, {
      email: validateEmail(body.email),
      loginName: validateLoginName(INITIAL_ADMIN_LOGIN_NAME),
      displayName: validateDisplayName(body.displayName),
      password: validatePassword(body.password),
      roles: ["platform_admin"],
    });
    const session = await createSession(env, user.id);

    return applySessionCookie(
      json({ user: presentUser(user), requestId }, 201),
      request,
      session,
    );
  }

  if (method === "POST" && pathname === "/api/v1/auth/login") {
    const body = await readJsonObject(request);
    const identifier = body.identifier ?? body.email;
    const user = await verifyCredentials(
      env,
      validateLoginIdentifier(identifier),
      validatePassword(body.password),
    );
    const session = await createSession(env, user.id);

    return applySessionCookie(json({ user: presentUser(user), requestId }), request, session);
  }

  if (method === "POST" && pathname === "/api/v1/auth/logout") {
    await destroyCurrentSession(env, request);
    return applySessionCookie(new Response(null, { status: 204 }), request, null);
  }

  if (method === "GET" && pathname === "/api/v1/auth/me") {
    const user = await getAuthenticatedUser(env, request);
    return json({ user: presentUser(user), requestId });
  }

  if (method === "GET" && pathname === "/api/v1/projects") {
    const user = await getAuthenticatedUser(env, request);
    const projects = await listProjects(env, user);
    return json({ projects: projects.map(presentProject), requestId });
  }

  if (method === "POST" && pathname === "/api/v1/projects") {
    const user = await getAuthenticatedUser(env, request);
    const body = await readJsonObject(request);
    const projectType = body.projectType ?? "2d";
    if (!isProjectType(projectType)) {
      throw new AppError(400, "invalid_project_type", "Project type must be either 2d or 3d.");
    }
    const project = await createProject(env, user, validateProjectName(body.name), projectType);
    return json({ project: presentProject(project), requestId }, 201);
  }

  const projectCoverMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/cover\.svg$/);

  if (method === "GET" && projectCoverMatch) {
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(projectCoverMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (project.project_type !== "2d") {
      throw new AppError(409, "project_type_mismatch", "Standalone 3D projects do not use 2D canvas covers.");
    }
    const canvas = await getCanvas(env, projectId);
    if (canvas.revision < 1) {
      throw new AppError(
        404,
        "project_cover_not_available",
        "Save the project canvas before requesting its cover.",
      );
    }
    return projectCoverResponse(request, canvas);
  }

  const sceneBackgroundsMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/scene-backgrounds$/);

  if (method === "POST" && sceneBackgroundsMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(sceneBackgroundsMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to generate backgrounds for this project.");
    }
    const input = validateSceneBackgroundGenerationInput(await readJsonObject(request));
    const generated = await generateSceneBackground(env, projectId, user.id, input);
    console.log(JSON.stringify({
      event: "scene_background_generated",
      requestId,
      projectId,
      userId: user.id,
      sourceImageAssetId: input.sourceImageAssetId,
      modelAssetId: generated.modelAsset.id,
      algorithm: generated.modelAsset.generation?.algorithm,
      imageWidth: generated.modelAsset.generation?.imageWidth,
      imageHeight: generated.modelAsset.generation?.imageHeight,
      planeWidthMeters: generated.modelAsset.generation?.planeWidthMeters,
      planeHeightMeters: generated.modelAsset.generation?.planeHeightMeters,
      byteSize: generated.modelAsset.byteSize,
      durationMs: Date.now() - startedAt,
    }));
    return json({ ...generated, requestId }, 201);
  }

  const modelAssetContentMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/model-assets\/([^/]+)\/content$/,
  );

  if (method === "GET" && modelAssetContentMatch) {
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(modelAssetContentMatch[1]);
    await requireProjectAccess(env, user, projectId);
    return modelAssetContentResponse(
      request,
      env,
      projectId,
      decodePathSegment(modelAssetContentMatch[2]),
    );
  }

  const modelAssetsMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/model-assets$/);

  if ((method === "GET" || method === "POST") && modelAssetsMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(modelAssetsMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);

    if (method === "GET") {
      return json({ modelAssets: await listModelAssets(env, projectId), requestId });
    }

    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to upload models to this project.");
    }

    const modelAsset = await uploadModelAsset(
      request,
      env,
      projectId,
      user.id,
      url.searchParams.get("filename"),
    );
    console.log(JSON.stringify({
      event: "model_asset_uploaded",
      requestId,
      projectId,
      userId: user.id,
      modelAssetId: modelAsset.id,
      format: modelAsset.format,
      byteSize: modelAsset.byteSize,
      nodeCount: modelAsset.inspection.nodeCount,
      meshCount: modelAsset.inspection.meshCount,
      duplicateNodeNameCount: modelAsset.inspection.duplicateNodeNames.length,
      durationMs: Date.now() - startedAt,
    }));
    return json({ modelAsset, requestId }, 201);
  }

  const modelAssetMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/model-assets\/([^/]+)$/);

  if (method === "DELETE" && modelAssetMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(modelAssetMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to delete models from this project.");
    }
    const deletion = await deleteModelAsset(
      env,
      projectId,
      decodePathSegment(modelAssetMatch[2]),
      referencedDeletionConfirmed(url),
    );
    const logContext = {
      event: deletion.warning ? "model_asset_deleted_with_cleanup_warning" : "model_asset_deleted",
      requestId,
      projectId,
      userId: user.id,
      modelAssetId: deletion.deletedModelAssetId,
      referenceCount: deletion.usage.count,
      warning: deletion.warning,
      durationMs: Date.now() - startedAt,
    };
    if (deletion.warning) console.error(JSON.stringify(logContext));
    else console.log(JSON.stringify(logContext));
    return json({ ...deletion, requestId });
  }

  const imageAssetContentMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/image-assets\/([^/]+)\/content$/,
  );

  if (method === "GET" && imageAssetContentMatch) {
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(imageAssetContentMatch[1]);
    await requireProjectAccess(env, user, projectId);
    return imageAssetContentResponse(
      request,
      env,
      projectId,
      decodePathSegment(imageAssetContentMatch[2]),
    );
  }

  const imageAssetsMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/image-assets$/);

  if ((method === "GET" || method === "POST") && imageAssetsMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(imageAssetsMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);

    if (method === "GET") {
      return json({ imageAssets: await listImageAssets(env, projectId), requestId });
    }

    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to upload images to this project.");
    }

    const imageAsset = await uploadImageAsset(
      request,
      env,
      projectId,
      user.id,
      url.searchParams.get("filename"),
    );
    console.log(JSON.stringify({
      event: "image_asset_uploaded",
      requestId,
      projectId,
      userId: user.id,
      imageAssetId: imageAsset.id,
      format: imageAsset.format,
      byteSize: imageAsset.byteSize,
      durationMs: Date.now() - startedAt,
    }));
    return json({ imageAsset, requestId }, 201);
  }

  const imageAssetMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/image-assets\/([^/]+)$/);

  if (method === "DELETE" && imageAssetMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(imageAssetMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to delete images from this project.");
    }
    const deletion = await deleteImageAsset(
      env,
      projectId,
      decodePathSegment(imageAssetMatch[2]),
      referencedDeletionConfirmed(url),
    );
    const logContext = {
      event: deletion.warning ? "image_asset_deleted_with_cleanup_warning" : "image_asset_deleted",
      requestId,
      projectId,
      userId: user.id,
      imageAssetId: deletion.deletedImageAssetId,
      referenceCount: deletion.usage.count,
      warning: deletion.warning,
      durationMs: Date.now() - startedAt,
    };
    if (deletion.warning) console.error(JSON.stringify(logContext));
    else console.log(JSON.stringify(logContext));
    return json({ ...deletion, requestId });
  }

  const mediaAssetContentMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/media-assets\/([^/]+)\/content$/,
  );

  if (method === "GET" && mediaAssetContentMatch) {
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(mediaAssetContentMatch[1]);
    await requireProjectAccess(env, user, projectId);
    return mediaAssetContentResponse(
      request,
      env,
      projectId,
      decodePathSegment(mediaAssetContentMatch[2]),
    );
  }

  const mediaAssetsMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/media-assets$/);

  if ((method === "GET" || method === "POST") && mediaAssetsMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(mediaAssetsMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (method === "GET") {
      return json({ mediaAssets: await listMediaAssets(env, projectId), requestId });
    }
    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to upload media to this project.");
    }
    const mediaAsset = await uploadMediaAsset(
      request,
      env,
      projectId,
      user.id,
      url.searchParams.get("filename"),
    );
    console.log(JSON.stringify({
      event: "media_asset_uploaded",
      requestId,
      projectId,
      userId: user.id,
      mediaAssetId: mediaAsset.id,
      mediaType: mediaAsset.mediaType,
      format: mediaAsset.format,
      byteSize: mediaAsset.byteSize,
      durationMs: Date.now() - startedAt,
    }));
    return json({ mediaAsset, requestId }, 201);
  }

  const mediaAssetMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/media-assets\/([^/]+)$/);

  if (method === "DELETE" && mediaAssetMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(mediaAssetMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to delete media from this project.");
    }
    const deletion = await deleteMediaAsset(
      env,
      projectId,
      decodePathSegment(mediaAssetMatch[2]),
      referencedDeletionConfirmed(url),
    );
    const logContext = {
      event: deletion.warning ? "media_asset_deleted_with_cleanup_warning" : "media_asset_deleted",
      requestId,
      projectId,
      userId: user.id,
      mediaAssetId: deletion.deletedMediaAssetId,
      referenceCount: deletion.usage.count,
      warning: deletion.warning,
      durationMs: Date.now() - startedAt,
    };
    if (deletion.warning) console.error(JSON.stringify(logContext));
    else console.log(JSON.stringify(logContext));
    return json({ ...deletion, requestId });
  }

  const assetsMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/assets$/);

  if ((method === "GET" || method === "POST") && assetsMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(assetsMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);

    if (method === "GET") {
      return json({ assets: await listAssets(env, projectId), requestId });
    }

    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to create assets in this project.");
    }

    const asset = await createAsset(
      env,
      projectId,
      validateAssetCreate(await readJsonObject(request)),
    );
    console.log(JSON.stringify({
      event: "asset_created",
      requestId,
      projectId,
      userId: user.id,
      assetRecordId: asset.id,
      assetId: asset.assetId,
      modelNode: asset.modelNode,
      durationMs: Date.now() - startedAt,
    }));
    return json({ asset, requestId }, 201);
  }

  const assetMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)$/);

  if (method === "PATCH" && assetMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(assetMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(403, "permission_denied", "You do not have permission to edit assets in this project.");
    }

    const asset = await updateAsset(
      env,
      projectId,
      decodePathSegment(assetMatch[2]),
      validateAssetPatch(await readJsonObject(request)),
    );
    console.log(JSON.stringify({
      event: "asset_updated",
      requestId,
      projectId,
      userId: user.id,
      assetRecordId: asset.id,
      assetId: asset.assetId,
      modelNode: asset.modelNode,
      durationMs: Date.now() - startedAt,
    }));
    return json({ asset, requestId });
  }

  const assetRuntimeStateMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/runtime-state$/,
  );

  if (method === "GET" && assetRuntimeStateMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(assetRuntimeStateMatch[1]);
    const assetRecordId = decodePathSegment(assetRuntimeStateMatch[2]);
    await requireProjectAccess(env, user, projectId);
    try {
      const runtimeState = await collectAssetRuntimeState(
        env,
        projectId,
        assetRecordId,
        requestId,
      );
      console.log(JSON.stringify({
        event: "asset_runtime_collected",
        requestId,
        projectId,
        assetRecordId,
        assetId: runtimeState.asset.assetId,
        metricCount: runtimeState.metrics.length,
        sourceCount: runtimeState.sources.length,
        durationMs: Date.now() - startedAt,
      }));
      return json({ runtimeState, requestId });
    } catch (error) {
      console.error(JSON.stringify({
        event: "asset_runtime_collection_failed",
        requestId,
        projectId,
        assetRecordId,
        errorCode: error instanceof AppError ? error.code : "unhandled_error",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      }));
      throw error;
    }
  }

  const assetDataBindingsMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/data-bindings$/,
  );

  if ((method === "GET" || method === "POST") && assetDataBindingsMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(assetDataBindingsMatch[1]);
    const assetRecordId = decodePathSegment(assetDataBindingsMatch[2]);
    const project = await requireProjectAccess(env, user, projectId);

    if (method === "GET") {
      return json({
        dataBindings: await listAssetDataBindings(env, projectId, assetRecordId),
        requestId,
      });
    }

    if (!canEditProject(user, project)) {
      throw new AppError(
        403,
        "permission_denied",
        "You do not have permission to create asset data bindings in this project.",
      );
    }
    const dataBinding = await createAssetDataBinding(
      env,
      projectId,
      assetRecordId,
      validateAssetDataBindingCreate(await readJsonObject(request)),
    );
    console.log(JSON.stringify({
      event: "asset_data_binding_created",
      requestId,
      projectId,
      userId: user.id,
      assetRecordId,
      assetDataBindingId: dataBinding.id,
      dataSourceId: dataBinding.dataSourceId,
      metricKey: dataBinding.metricKey,
      durationMs: Date.now() - startedAt,
    }));
    return json({ dataBinding, requestId }, 201);
  }

  const assetDataBindingMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/data-bindings\/([^/]+)$/,
  );

  if (
    (method === "PATCH" || method === "DELETE")
    && assetDataBindingMatch
  ) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(assetDataBindingMatch[1]);
    const assetRecordId = decodePathSegment(assetDataBindingMatch[2]);
    const bindingId = decodePathSegment(assetDataBindingMatch[3]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(
        403,
        "permission_denied",
        "You do not have permission to edit asset data bindings in this project.",
      );
    }

    if (method === "DELETE") {
      const dataBinding = await deleteAssetDataBinding(
        env,
        projectId,
        assetRecordId,
        bindingId,
      );
      console.log(JSON.stringify({
        event: "asset_data_binding_deleted",
        requestId,
        projectId,
        userId: user.id,
        assetRecordId,
        assetDataBindingId: dataBinding.id,
        dataSourceId: dataBinding.dataSourceId,
        metricKey: dataBinding.metricKey,
        durationMs: Date.now() - startedAt,
      }));
      return new Response(null, { status: 204 });
    }

    const dataBinding = await updateAssetDataBinding(
      env,
      projectId,
      assetRecordId,
      bindingId,
      await readJsonObject(request),
    );
    console.log(JSON.stringify({
      event: "asset_data_binding_updated",
      requestId,
      projectId,
      userId: user.id,
      assetRecordId,
      assetDataBindingId: dataBinding.id,
      dataSourceId: dataBinding.dataSourceId,
      metricKey: dataBinding.metricKey,
      durationMs: Date.now() - startedAt,
    }));
    return json({ dataBinding, requestId });
  }

  const dataSourcesMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/data-sources$/);

  if ((method === "GET" || method === "POST") && dataSourcesMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(dataSourcesMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);

    if (method === "GET") {
      return json({ dataSources: await listDataSources(env, projectId), requestId });
    }
    if (!canEditProject(user, project)) {
      throw new AppError(
        403,
        "permission_denied",
        "You do not have permission to create data sources in this project.",
      );
    }

    const dataSource = await createDataSource(
      env,
      projectId,
      validateDataSourceCreate(await readJsonObject(request)),
    );
    console.log(JSON.stringify({
      event: "data_source_created",
      requestId,
      projectId,
      userId: user.id,
      dataSourceId: dataSource.id,
      sourceType: dataSource.sourceType,
      durationMs: Date.now() - startedAt,
    }));
    return json({ dataSource, requestId }, 201);
  }

  const dataSourceMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/data-sources\/([^/]+)$/,
  );

  const dataSourceProbeMatch = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/data-sources\/([^/]+)\/test$/,
  );

  if (method === "POST" && dataSourceProbeMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(dataSourceProbeMatch[1]);
    const dataSourceId = decodePathSegment(dataSourceProbeMatch[2]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(
        403,
        "permission_denied",
        "You do not have permission to test data sources in this project.",
      );
    }

    try {
      const probe = await probeRestDataSource(
        env,
        projectId,
        dataSourceId,
        requestId,
      );
      console.log(JSON.stringify({
        event: "data_source_test_succeeded",
        requestId,
        projectId,
        userId: user.id,
        dataSourceId,
        responseBytes: probe.responseBytes,
        fieldCount: probe.fields.length,
        fieldsTruncated: probe.fieldsTruncated,
        sourceAgeSeconds: probe.sourceAgeSeconds,
        durationMs: Date.now() - startedAt,
      }));
      return json({ probe, requestId });
    } catch (error) {
      console.error(JSON.stringify({
        event: "data_source_test_failed",
        requestId,
        projectId,
        userId: user.id,
        dataSourceId,
        errorCode: error instanceof AppError ? error.code : "unhandled_error",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      }));
      throw error;
    }
  }

  if (method === "PATCH" && dataSourceMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(dataSourceMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (!canEditProject(user, project)) {
      throw new AppError(
        403,
        "permission_denied",
        "You do not have permission to edit data sources in this project.",
      );
    }

    const dataSource = await updateDataSource(
      env,
      projectId,
      decodePathSegment(dataSourceMatch[2]),
      await readJsonObject(request),
    );
    console.log(JSON.stringify({
      event: "data_source_updated",
      requestId,
      projectId,
      userId: user.id,
      dataSourceId: dataSource.id,
      sourceType: dataSource.sourceType,
      durationMs: Date.now() - startedAt,
    }));
    return json({ dataSource, requestId });
  }

  const canvasMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/canvas$/);

  if ((method === "GET" || method === "PATCH") && canvasMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(canvasMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (project.project_type !== "2d") {
      throw new AppError(409, "project_type_mismatch", "This project uses the standalone 3D scene editor, not the 2D canvas editor.");
    }
    const editable = canEditProject(user, project);

    if (method === "GET") {
      return json({ project: presentProject(project), canvas: await getCanvas(env, projectId), editable, requestId });
    }

    if (!editable) {
      throw new AppError(403, "permission_denied", "You do not have permission to edit this canvas.");
    }

    const body = await readJsonObject(request, 512 * 1024);
    const patch = validateCanvasPatch(body);
    const canvas = await applyCanvasPatch(env, projectId, user.id, patch);
    console.log(JSON.stringify({
      event: "canvas_saved",
      requestId,
      projectId,
      userId: user.id,
      revision: canvas.revision,
      themeChanged: patch.theme !== undefined,
      themeMode: patch.theme?.mode ?? null,
      upsertedNodeCount: patch.upsertNodes.length,
      deletedNodeCount: patch.deleteNodeIds.length,
      durationMs: Date.now() - startedAt,
    }));
    return json({ canvas, requestId });
  }

  const standaloneSceneMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/scene$/);

  if ((method === "GET" || method === "PATCH") && standaloneSceneMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(standaloneSceneMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
    if (project.project_type !== "3d") {
      throw new AppError(409, "project_type_mismatch", "This project uses the 2D canvas editor, not the standalone 3D scene editor.");
    }
    const editable = canEditProject(user, project);

    if (method === "GET") {
      return json({
        project: presentProject(project),
        scene: await getStandaloneScene(env, projectId),
        editable,
        limits: STANDALONE_3D_LIMITS,
        requestId,
      });
    }
    if (!editable) {
      throw new AppError(403, "permission_denied", "You do not have permission to edit this 3D scene.");
    }
    const patch = validateStandaloneScenePatch(await readJsonObject(request, 512 * 1024));
    const scene = await applyStandaloneScenePatch(env, projectId, user, patch);
    console.log(JSON.stringify({
      event: "standalone_3d_scene_saved",
      requestId,
      projectId,
      userId: user.id,
      revision: scene.revision,
      settingsChanged: patch.settings !== undefined,
      linkChanged: patch.linked2dProjectId !== undefined,
      upsertedInstanceCount: patch.upsertInstances.length,
      deletedInstanceCount: patch.deleteInstanceIds.length,
      totalInstanceCount: scene.instances.length,
      durationMs: Date.now() - startedAt,
    }));
    return json({ scene, limits: STANDALONE_3D_LIMITS, requestId });
  }

  const projectMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);

  if ((method === "GET" || method === "PATCH" || method === "DELETE") && projectMatch) {
    const startedAt = Date.now();
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(projectMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);

    if (method === "GET") {
      return json({ project: presentProject(project), requestId });
    }

    if (method === "PATCH") {
      if (!canEditProject(user, project)) {
        throw new AppError(
          403,
          "permission_denied",
          "You do not have permission to rename this project.",
        );
      }
      const renamedProject = await updateProjectName(
        env,
        project,
        validateProjectName((await readJsonObject(request)).name),
      );
      console.log(JSON.stringify({
        event: "project_renamed",
        requestId,
        projectId,
        userId: user.id,
        durationMs: Date.now() - startedAt,
      }));
      return json({ project: presentProject(renamedProject), requestId });
    }

    if (!canDeleteProject(user, project)) {
      throw new AppError(
        403,
        "permission_denied",
        "Only a project owner or platform administrator can delete this project.",
      );
    }

    const deletion = await deleteProject(env, projectId);
    const logContext = {
      event: deletion.warning ? "project_deleted_with_cleanup_warning" : "project_deleted",
      requestId,
      projectId,
      userId: user.id,
      deletedImageObjectCount: deletion.deletedImageObjectCount,
      deletedMediaObjectCount: deletion.deletedMediaObjectCount,
      deletedModelObjectCount: deletion.deletedModelObjectCount,
      warning: deletion.warning,
      durationMs: Date.now() - startedAt,
    };
    if (deletion.warning) {
      console.error(JSON.stringify(logContext));
    } else {
      console.log(JSON.stringify(logContext));
    }
    return json({ ...deletion, requestId });
  }

  throw new AppError(404, "route_not_found", `No route matches ${method} ${pathname}.`);
};

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const requestId = crypto.randomUUID();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    try {
      return await handleApiRequest(request, env, requestId);
    } catch (error) {
      if (error instanceof AppError) {
        return errorResponse(error, requestId);
      }

      console.error(
        JSON.stringify({
          event: "unhandled_api_error",
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      return errorResponse(
        new AppError(500, "internal_error", "The server could not complete this request."),
        requestId,
      );
    }
  },
};
