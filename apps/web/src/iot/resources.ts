import { builtinModels } from "../../../../shared/builtin-models";
import { builtinImages } from "../../../../shared/builtin-images";
import { apiUrl, ApiRequestError, request } from "../api";
import { TWIN_API_PREFIX } from "./config";
import { readIotToken, requireIotToken } from "./session";

export const publicAssetUrl = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const publicResources = new Set([...builtinModels, ...builtinImages].map(asset => publicAssetUrl(asset.contentPath)));
export type ResourceAccess = { url: string; expiresAt: number | null };
const cache = new Map<string, ResourceAccess>();
let cacheToken: string | null = null;

export function validateResourceAccess(value: unknown, now = Date.now()): ResourceAccess {
  const access = value as { url?: unknown; expiresAt?: unknown } | null;
  const invalid = () => new ApiRequestError("iot_resource_access_invalid", undefined, "Invalid IoT resource access response.");
  if (!access || typeof access.url !== "string" || typeof access.expiresAt !== "number"
    || !Number.isFinite(access.expiresAt) || access.expiresAt <= now + 30_000 || access.expiresAt > now + 300_000) throw invalid();
  let url: URL;
  try { url = new URL(access.url, window.location.origin); } catch { throw invalid(); }
  const allowedOrigins = [window.location.origin, ...(import.meta.env.VITE_IOT_RESOURCE_ORIGINS ?? "")
    .split(",").map(origin => origin.trim()).filter(Boolean)];
  if (!["http:", "https:"].includes(url.protocol) || (window.location.protocol === "https:" && url.protocol !== "https:")
    || !allowedOrigins.includes(url.origin) || url.username || url.password || url.hash
    || [...url.searchParams.keys()].some(key => /^(?:x[-_]access[-_]token|access[-_]?token|token|authorization)$/i.test(key))) throw invalid();
  return { url: url.href, expiresAt: access.expiresAt };
}

/** The IoT module authorizes each resource before signing a short-lived MinIO URL. */
export async function resolveResourceAccess(path: string, signal?: AbortSignal): Promise<ResourceAccess> {
  if (publicResources.has(path)) return { url: path, expiresAt: null };
  const endpoint = apiUrl(path);
  const parsed = new URL(endpoint, window.location.origin);
  const query = [...parsed.searchParams];
  if (!parsed.pathname.startsWith(`${TWIN_API_PREFIX}/projects/`)
    || !(parsed.pathname.endsWith("/content") || parsed.pathname.endsWith("/cover.png"))
    || (query.length > 0 && !(parsed.pathname.endsWith("/cover.png") && query.length === 1
      && query[0][0] === "revision" && /^\d+$/.test(query[0][1])))) {
    throw new ApiRequestError("iot_resource_access_invalid", undefined, "Resource is outside project scope.");
  }
  const token = requireIotToken();
  if (cacheToken !== token) { cache.clear(); cacheToken = token; }
  const cached = cache.get(endpoint);
  if (cached?.expiresAt && cached.expiresAt > Date.now() + 30_000) return cached;
  const access = validateResourceAccess(await request<unknown>(`${parsed.pathname}/access${parsed.search}`, { signal }));
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(endpoint, access);
  return access;
}

export function invalidateResourceAccess(path: string) {
  if (!publicResources.has(path)) cache.delete(apiUrl(path));
}

export async function loadResourceBytes(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const token = publicResources.has(path) ? null : requireIotToken();
  const { url } = await resolveResourceAccess(path, signal);
  const response = await fetch(url, { signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new ApiRequestError("iot_resource_access_invalid", undefined, "Resource download failed.",
    { status: response.status, method: "GET" });
  const bytes = await response.arrayBuffer();
  if (token && readIotToken() !== token) throw new ApiRequestError("iot_session_changed", undefined, "IoT account changed during resource download.");
  return bytes;
}
