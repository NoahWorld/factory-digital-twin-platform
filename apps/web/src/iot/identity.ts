import type { ProjectType } from "../../../../shared/standalone-3d";
import { ApiRequestError, request } from "../api";
import { IOT_API_PREFIX } from "./config";

type Permission = { id: string; actions: string[] };
export type IotUser = {
  id: string;
  displayName: string;
  modules: ProjectType[];
  capabilities: { canCreateProject: boolean; canAccessResources: boolean };
};

export function parseIotIdentity(value: unknown): IotUser {
  const identity = value as { user?: { id?: unknown; name?: unknown }; permissions?: unknown } | null;
  if (!identity || typeof identity.user?.id !== "string" || !identity.user.id
    || typeof identity.user.name !== "string" || !identity.user.name
    || !Array.isArray(identity.permissions)
    || !identity.permissions.every((p): p is Permission => p && typeof p.id === "string"
      && Array.isArray(p.actions) && p.actions.every((action: unknown) => typeof action === "string"))) {
    throw new ApiRequestError("invalid_response", undefined, "Invalid IoT authorization response.");
  }
  const has = (id: string, action: string) =>
    (identity.permissions as Permission[]).some(permission => permission.id === id && permission.actions.includes(action));
  // Explicit IoT permissions only. Names, roles and cached hsweb-autz never grant access.
  const canRead = has("twin-project", "query");
  return {
    id: identity.user.id,
    displayName: identity.user.name,
    modules: canRead ? ["3d", "2d"] : [],
    capabilities: {
      canCreateProject: canRead && has("twin-project", "save"),
      canAccessResources: canRead && has("twin-resource", "query"),
    },
  };
}

export async function loadIotIdentity(signal?: AbortSignal): Promise<IotUser> {
  return parseIotIdentity(await request<unknown>(`${IOT_API_PREFIX}/authorize/me`, { signal }));
}
