import {
  AppError,
  applySessionCookie,
  capabilitiesFor,
  createSession,
  createUser,
  destroyCurrentSession,
  getAuthenticatedUser,
  hasGlobalRole,
  isBootstrapRequired,
  validateDisplayName,
  validateEmail,
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
  listModelAssets,
  modelAssetContentResponse,
  uploadModelAsset,
} from "./model-assets";
import { projectCoverResponse } from "./project-covers";

type ProjectStatus = "draft" | "published" | "archived";

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  project_role: "owner" | "editor" | "viewer" | null;
  cover_revision: number | null;
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

const presentUser = (user: AuthenticatedUser) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  roles: user.roles,
  capabilities: capabilitiesFor(user),
});

const presentProject = (project: ProjectRow) => ({
  id: project.id,
  name: project.name,
  status: project.status,
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
    `SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
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
    `SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
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
): Promise<ProjectRow> => {
  if (!hasGlobalRole(user, "platform_admin", "delivery_manager")) {
    throw new AppError(403, "permission_denied", "You do not have permission to create projects.");
  }

  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO projects (
          id, name, status, created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, 'draft', ?, ?, ?)`,
      )
      .bind(projectId, name, user.id, now, now),
    env.DB
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
         VALUES (?, ?, 'owner', ?, ?)`,
      )
      .bind(projectId, user.id, now, now),
  ]);

  return {
    id: projectId,
    name,
    status: "draft",
    created_at: now,
    updated_at: now,
    project_role: "owner",
    cover_revision: null,
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
  deletedModelObjectCount: number;
  warning: string | null;
};

const deleteProject = async (
  env: AppEnv,
  projectId: string,
): Promise<ProjectDeletionResult> => {
  const objectRows = await env.DB.prepare(
    "SELECT object_key FROM model_assets WHERE project_id = ? ORDER BY object_key ASC",
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
    env.DB.prepare("DELETE FROM model_assets WHERE project_id = ?").bind(projectId),
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

  let deletedModelObjectCount = 0;
  let warning: string | null = null;
  try {
    for (const row of objectRows.results) {
      await env.MODEL_ASSETS.delete(row.object_key);
      deletedModelObjectCount += 1;
    }
  } catch (error) {
    warning = `The project was deleted, but model object cleanup stopped after ${deletedModelObjectCount} of ${objectRows.results.length} object(s): ${error instanceof Error ? error.message : String(error)}`;
  }

  return { deletedProjectId: projectId, deletedModelObjectCount, warning };
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
    return json({
      status: "ok",
      service: "factory-digital-twin-api",
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
    const user = await verifyCredentials(
      env,
      validateEmail(body.email),
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
    const project = await createProject(env, user, validateProjectName(body.name));
    return json({ project: presentProject(project), requestId }, 201);
  }

  const projectCoverMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/cover\.svg$/);

  if (method === "GET" && projectCoverMatch) {
    const user = await getAuthenticatedUser(env, request);
    const projectId = decodePathSegment(projectCoverMatch[1]);
    const project = await requireProjectAccess(env, user, projectId);
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
