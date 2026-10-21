import type { ProjectType } from "../../../../shared/standalone-3d";
import { ApiRequestError, request } from "../api";
import { IOT_API_PREFIX } from "./config";

export type IotUser = {
  id: string;
  displayName: string;
  modules: ProjectType[];
  capabilities: { canCreateProject: boolean; canAccessResources: boolean };
};

export function parseIotIdentity(value: unknown): IotUser {
  const identity = value as { user?: { id?: unknown; name?: unknown }; permissions?: unknown } | null;
  if (!identity || typeof identity.user?.id !== "string" || !identity.user.id
    || typeof identity.user.name !== "string" || !identity.user.name) {
    throw new ApiRequestError("invalid_response", undefined, "Invalid IoT authorization response.");
  }
  // IoT owns authentication. Every authenticated IoT account can use the twin;
  // no additional module permissions, user records or project memberships exist.
  return {
    id: identity.user.id,
    displayName: identity.user.name,
    modules: ["3d", "2d"],
    capabilities: {
      canCreateProject: true,
      canAccessResources: true,
    },
  };
}

export async function loadIotIdentity(signal?: AbortSignal): Promise<IotUser> {
  return parseIotIdentity(await request<unknown>(`${IOT_API_PREFIX}/authorize/me`, { signal }));
}
