import { ApiRequestError, type RequestContext } from "./errors";
import { iotApiUrl, TWIN_API_PREFIX } from "./iot/config";
import { invalidateIotSession, readIotToken, requireIotToken } from "./iot/session";
export { ApiRequestError, UserFacingError, errorMessage, errorPresentation, reportError } from "./errors";

export const apiUrl = iotApiUrl;
type IotEnvelope = { status?: unknown; result?: unknown; code?: unknown; error?: unknown; message?: unknown; requestId?: unknown };

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = apiUrl(path);
  const token = requireIotToken();
  const headers = new Headers(init.headers);
  headers.set("X-Access-Token", token);

  if (init.body && !(typeof FormData !== "undefined" && init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  // Never store headers, request bodies, query strings or signed URLs in diagnostics.
  const context: RequestContext = {
    method: (init.method ?? "GET").toUpperCase(),
    path: url.split("?")[0],
  };
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "omit",
      redirect: "error",
      headers,
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    if (!(cause instanceof TypeError)) throw cause;
    throw new ApiRequestError("network_error", undefined, "IoT request failed.", { ...context, cause });
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
      if (response.status === 401) {
        invalidateIotSession(token);
        throw new ApiRequestError("unauthenticated", headerRequestId, "IoT session expired.", context);
      }
      if (init.signal?.aborted) throw cause;
      if (!(cause instanceof SyntaxError) && !(cause instanceof TypeError)) throw cause;
      const code = cause instanceof SyntaxError ? "invalid_response" : "network_error";
      throw new ApiRequestError(code, headerRequestId, cause.message, { ...context, cause });
    }
  } else if (response.ok && !emptyResponse) {
    throw new ApiRequestError("invalid_response", headerRequestId,
      `Expected a JSON response; received ${contentType || "no Content-Type"}.`, context);
  }

  const body = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as IotEnvelope : null;
  const requestId = typeof body?.requestId === "string" && body.requestId ? body.requestId : headerRequestId;
  const status = response.ok && typeof body?.status === "number" ? body.status : response.status;
  if (!response.ok || status >= 400) {
    if (status === 401) invalidateIotSession(token);
    const serverCode = typeof body?.code === "string" ? body.code : typeof body?.error === "string" ? body.error : null;
    const code = status === 401 ? "unauthenticated"
      : status === 403 ? serverCode ?? "forbidden"
        : status === 404 && context.path?.startsWith(TWIN_API_PREFIX) && (!serverCode || serverCode === "not_found")
          ? "iot_twin_endpoint_unavailable" : serverCode ?? "request_failed";
    throw new ApiRequestError(
      code, requestId,
      typeof body?.message === "string" ? body.message : `IoT returned status ${status}.`,
      context,
    );
  }

  if (readIotToken() !== token) {
    throw new ApiRequestError("iot_session_changed", requestId, "IoT account changed during the request.", context);
  }
  if (emptyResponse) return null as T;
  if (!body || body.status !== 200 || !Object.hasOwn(body, "result")) {
    throw new ApiRequestError("invalid_response", requestId, "Expected IoT {status:200,result} envelope.", context);
  }
  return body.result as T;
}
