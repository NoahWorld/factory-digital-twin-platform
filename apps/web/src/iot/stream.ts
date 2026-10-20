import { apiUrl, ApiRequestError, request } from "../api";

/** IoT must issue a single-use, project-scoped ticket; its login token never enters a URL. */
export async function iotStreamUrl(projectId: string, signal?: AbortSignal): Promise<string> {
  const access = await request<{ ticket: string; expiresAt: number }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/twin-drive/stream-ticket`,
    { method: "POST", signal },
  );
  const now = Date.now();
  if (!access || typeof access.ticket !== "string" || !/^[A-Za-z0-9_-]{24,512}$/.test(access.ticket)
    || !Number.isFinite(access.expiresAt) || access.expiresAt <= now || access.expiresAt > now + 60_000) {
    throw new ApiRequestError("invalid_response", undefined, "Invalid IoT stream authorization.");
  }
  const url = new URL(apiUrl("/api/v1/twin-drive"), window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("ticket", access.ticket);
  return url.href;
}
