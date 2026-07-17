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
import { applyCanvasPatch, getCanvas, validateCanvasPatch } from "./canvas";

type ProjectStatus = "draft" | "published" | "archived";

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  project_role: "owner" | "editor" | "viewer" | null;
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
});

const requireProjectAccess = async (
  env: AppEnv,
  user: AuthenticatedUser,
  projectId: string,
): Promise<ProjectRow> => {
  const isPlatformAdmin = hasGlobalRole(user, "platform_admin") ? 1 : 0;
  const project = await env.DB.prepare(
    `SELECT p.id, p.name, p.status, p.created_at, p.updated_at, pm.role AS project_role
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
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

const listProjects = async (env: AppEnv, user: AuthenticatedUser): Promise<ProjectRow[]> => {
  const isPlatformAdmin = hasGlobalRole(user, "platform_admin") ? 1 : 0;
  const result = await env.DB.prepare(
    `SELECT p.id, p.name, p.status, p.created_at, p.updated_at, pm.role AS project_role
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
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
      upsertedNodeCount: patch.upsertNodes.length,
      deletedNodeCount: patch.deleteNodeIds.length,
      durationMs: Date.now() - startedAt,
    }));
    return json({ canvas, requestId });
  }

  const projectMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);

  if (method === "GET" && projectMatch) {
    const user = await getAuthenticatedUser(env, request);
    const project = await requireProjectAccess(env, user, decodePathSegment(projectMatch[1]));
    return json({ project: presentProject(project), requestId });
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
