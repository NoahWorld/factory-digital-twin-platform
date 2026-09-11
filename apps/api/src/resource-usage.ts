import { AppError, type AppEnv } from "./auth";

export type ResourceUsageNode = {
  id: string;
  type: string;
};

export type ResourceUsage = {
  count: number;
  nodes: ResourceUsageNode[];
};

type ResourceReferenceRow = {
  id: string;
  node_type: string;
  resource_refs_json: string;
};

type StandaloneModelReferenceRow = {
  id: string;
  model_asset_id: string;
};

const MAX_USAGE_DETAILS = 20;

export const emptyResourceUsage = (): ResourceUsage => ({ count: 0, nodes: [] });

export const listProjectResourceUsage = async (
  env: AppEnv,
  projectId: string,
): Promise<Map<string, ResourceUsage>> => {
  const [canvasResult, standaloneResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, node_type, resource_refs_json
       FROM canvas_nodes
       WHERE project_id = ?
       ORDER BY z_index ASC, id ASC`,
    ).bind(projectId).all<ResourceReferenceRow>(),
    env.DB.prepare(
      `SELECT id, model_asset_id
       FROM standalone_3d_instances
       WHERE project_id = ?
       ORDER BY sort_order ASC, id ASC`,
    ).bind(projectId).all<StandaloneModelReferenceRow>(),
  ]);
  const usageByResourceId = new Map<string, ResourceUsage>();

  for (const row of canvasResult.results) {
    let resourceRefs: unknown;
    try {
      resourceRefs = JSON.parse(row.resource_refs_json);
    } catch (error) {
      throw new AppError(
        500,
        "invalid_canvas_resource_references",
        `Canvas node ${row.id} has invalid resource reference JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(resourceRefs) || resourceRefs.some((value) => typeof value !== "string")) {
      throw new AppError(
        500,
        "invalid_canvas_resource_references",
        `Canvas node ${row.id} does not contain a valid resource reference list.`,
      );
    }

    for (const resourceId of new Set(resourceRefs)) {
      const usage = usageByResourceId.get(resourceId) ?? emptyResourceUsage();
      usage.count += 1;
      if (usage.nodes.length < MAX_USAGE_DETAILS) {
        usage.nodes.push({ id: row.id, type: row.node_type });
      }
      usageByResourceId.set(resourceId, usage);
    }
  }

  for (const row of standaloneResult.results) {
    const usage = usageByResourceId.get(row.model_asset_id) ?? emptyResourceUsage();
    usage.count += 1;
    if (usage.nodes.length < MAX_USAGE_DETAILS) {
      usage.nodes.push({ id: row.id, type: "standalone-3d-instance" });
    }
    usageByResourceId.set(row.model_asset_id, usage);
  }

  return usageByResourceId;
};

export const resourceUsageFor = (
  usageByResourceId: Map<string, ResourceUsage>,
  resourceId: string,
): ResourceUsage => usageByResourceId.get(resourceId) ?? emptyResourceUsage();

export const requireResourceDeletionConfirmation = (
  resourceName: string,
  usage: ResourceUsage,
  confirmed: boolean,
) => {
  if (usage.count > 0 && !confirmed) {
    throw new AppError(
      409,
      "resource_in_use",
      `Resource ${JSON.stringify(resourceName)} is referenced by ${usage.count} project item(s). Deleting it may prevent the project from displaying. Confirm the referenced-resource deletion to continue.`,
    );
  }
};
