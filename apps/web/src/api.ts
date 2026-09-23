type ApiFailure = {
  error?: string;
  message?: string;
  requestId?: string;
};

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    readonly requestId: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

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

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: share ? "omit" : "include",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    const failure = payload as ApiFailure | null;
    throw new ApiRequestError(
      failure?.error ?? "request_failed",
      failure?.requestId,
      failure?.message ?? `API request failed with HTTP ${response.status}.`,
    );
  }

  return payload as T;
}

export const errorMessage = (reason: unknown): string => {
  if (reason instanceof ApiRequestError) {
    return reason.requestId
      ? `${reason.message}（请求 ID：${reason.requestId}）`
      : reason.message;
  }

  return reason instanceof Error ? reason.message : String(reason);
};
