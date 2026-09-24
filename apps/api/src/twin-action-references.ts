import type { TwinAction, CanvasNodeInteraction } from "../../../shared/twin-actions";
import { AppError, canAccessModule, hasGlobalRole, type AppEnv, type AuthenticatedUser } from "./auth";

type ActionNode = { id: string; type: string; props: object; interaction?: CanvasNodeInteraction };
type ActionInstance = { id: string; clickActions?: TwinAction[] };
type Source =
  | { kind: "canvas"; projectId: string; nodes: ActionNode[] }
  | { kind: "scene"; projectId: string; linked2dProjectId: string | null; instances: ActionInstance[] };

/** Checks the final merged document. Queries are cached per target project/asset, never per frame. */
export const validateTwinActionReferences = async (env: AppEnv, user: AuthenticatedUser, source: Source): Promise<void> => {
  const sources = source.kind === "canvas"
    ? source.nodes.map((node) => ({ id: node.id, actions: node.interaction?.clickActions ?? [] }))
    : source.instances.map((instance) => ({ id: instance.id, actions: instance.clickActions ?? [] }));
  if (!sources.some((item) => item.actions.length)) return;
  const readable = new Map<string, string>();
  const nodes = new Map<string, Map<string, string>>();
  const scenes = new Map<string, { linked2dProjectId: string | null; instances: Set<string> }>();
  const assets = new Set<string>();
  if (source.kind === "canvas") nodes.set(source.projectId, new Map(source.nodes.map((node) => [node.id, node.type])));
  else scenes.set(source.projectId, { linked2dProjectId: source.linked2dProjectId, instances: new Set(source.instances.map((instance) => instance.id)) });
  const requireProject = async (projectId: string, type: "2d" | "3d", fail: (message: string) => never) => {
    if (!canAccessModule(user, type)) fail(`Access to the ${type} module is not granted.`);
    if (!readable.has(projectId)) {
      const row = await env.DB.prepare(`SELECT p.project_type FROM projects p
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ? AND (? = 1 OR pm.user_id IS NOT NULL)`)
        .bind(user.id, projectId, hasGlobalRole(user, "platform_admin") ? 1 : 0).first<{ project_type: string }>();
      if (!row) fail(`Target project ${projectId} does not exist or is not readable.`);
      readable.set(projectId, row!.project_type);
    }
    if (readable.get(projectId) !== type) fail(`Target project ${projectId} must be ${type}.`);
  };
  for (const item of sources) for (const [index, action] of item.actions.entries()) {
    const fail = (message: string): never => { throw new AppError(400, "invalid_twin_action_reference", `${source.kind} ${source.projectId}, item ${item.id}, clickActions[${index}]: ${message}`); };
    if (action.type === "message") continue;
    if (action.type === "focus-model") {
      if (source.kind === "scene" && action.projectId !== source.projectId) fail("A 3D model can only focus another model in its own scene.");
      await requireProject(action.projectId, "3d", fail);
      if (!scenes.has(action.projectId)) {
        const scene = await env.DB.prepare("SELECT linked_2d_project_id FROM standalone_3d_scenes WHERE project_id = ?")
          .bind(action.projectId).first<{ linked_2d_project_id: string | null }>();
        if (!scene) fail(`Target scene ${action.projectId} does not exist.`);
        const rows = await env.DB.prepare("SELECT id FROM standalone_3d_instances WHERE project_id = ?")
          .bind(action.projectId).all<{ id: string }>();
        scenes.set(action.projectId, { linked2dProjectId: scene!.linked_2d_project_id, instances: new Set(rows.results.map((row) => row.id)) });
      }
      const target = scenes.get(action.projectId)!;
      if (source.kind === "canvas" && target.linked2dProjectId !== source.projectId
        && !source.nodes.some((node) => node.type === "scene-3d" && (node.props as Record<string, unknown>).sceneProjectId === action.projectId)) fail(`Scene ${action.projectId} is not linked to or referenced by this canvas.`);
      if (!target.instances.has(action.instanceId)) fail(`Model instance ${action.instanceId} does not exist in scene ${action.projectId}.`);
      continue;
    }
    const projectId = source.kind === "canvas" ? source.projectId : source.linked2dProjectId;
    if (!projectId) fail("This action requires a linked 2D project.");
    await requireProject(projectId!, "2d", fail);
    if (action.type === "select-asset") {
      const key = `${projectId}/${action.assetId}`;
      if (!assets.has(key)) {
        const asset = await env.DB.prepare("SELECT id FROM assets WHERE project_id = ? AND asset_key = ?")
          .bind(projectId, action.assetId).first<{ id: string }>();
        if (!asset) fail(`Business asset ${action.assetId} does not exist in 2D project ${projectId}.`);
        assets.add(key);
      }
      continue;
    }
    if (!nodes.has(projectId!)) {
      const rows = await env.DB.prepare("SELECT id, node_type FROM canvas_nodes WHERE project_id = ?")
        .bind(projectId).all<{ id: string; node_type: string }>();
      nodes.set(projectId!, new Map(rows.results.map((row) => [row.id, row.node_type])));
    }
    const type = nodes.get(projectId!)!.get(action.nodeId);
    if (!type) fail(`Component ${action.nodeId} does not exist in 2D project ${projectId}.`);
    if (action.type === "set-text" && type !== "plain-text") fail(`Component ${action.nodeId} is not a plain-text component.`);
    if (action.type === "panel" && (type === "scene-3d" || type === "model-3d")) fail(`Component ${action.nodeId} must be a pure 2D component.`);
  }
};
