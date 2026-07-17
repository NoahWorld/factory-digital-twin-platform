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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
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
