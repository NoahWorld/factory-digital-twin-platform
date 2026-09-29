type ApiFailure = {
  error?: string;
  message?: string;
  requestId?: string;
};

import { ApiRequestError, type RequestContext } from "./errors";
export { ApiRequestError, UserFacingError, errorMessage, errorPresentation, reportError } from "./errors";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export const publicShareToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/^#\/share\/([^/?#]+)$/);
  return match ? match[1] : null;
};

export const apiUrl = (path: string): string => {
  const share = publicShareToken();
  if (share && /^\/api\/v1\/projects(?:\/|\?|$)/.test(path)) {
    const publicPath = path.replace(/^\/api\/v1\/projects/, "/api/v1/publications/projects");
    return `${apiBaseUrl}${publicPath}${publicPath.includes("?") ? "&" : "?"}share=${encodeURIComponent(share)}`;
  }
  return `${apiBaseUrl}${path}`;
};

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const share = publicShareToken();
  if (share && init.method && init.method.toUpperCase() !== "GET") {
    throw new ApiRequestError("publication_read_only", undefined, "公开链接只允许查看项目。");
  }
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  // Never store headers, request bodies, query strings or share tokens in diagnostics.
  const context: RequestContext = {
    method: (init.method ?? "GET").toUpperCase(),
    path: new URL(path, "http://dtwin.invalid").pathname,
  };
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: share ? "omit" : "include",
      headers,
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    if (!(cause instanceof TypeError)) throw cause;
    throw new ApiRequestError("network_error", undefined, cause.message, { ...context, cause });
  }
  context.status = response.status;
  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  const emptyResponse = response.status === 204 || response.status === 205 || context.method === "HEAD";
  if (!emptyResponse && contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      if (!(cause instanceof SyntaxError) && !(cause instanceof TypeError)) throw cause;
      const code = cause instanceof SyntaxError ? "invalid_response" : "network_error";
      throw new ApiRequestError(code, headerRequestId, cause.message, { ...context, cause });
    }
  } else if (response.ok && !emptyResponse) {
    throw new ApiRequestError("invalid_response", headerRequestId,
      `Expected a JSON response; received ${contentType || "no Content-Type"}.`, context);
  }

  if (!response.ok) {
    const failure = payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? payload as ApiFailure : null;
    throw new ApiRequestError(
      typeof failure?.error === "string" && failure.error ? failure.error : "request_failed",
      typeof failure?.requestId === "string" && failure.requestId ? failure.requestId : headerRequestId,
      typeof failure?.message === "string" && failure.message ? failure.message : `API request failed with HTTP ${response.status}.`,
      context,
    );
  }

  return payload as T;
}
