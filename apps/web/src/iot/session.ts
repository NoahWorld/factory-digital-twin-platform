import { ApiRequestError } from "../errors";

export const IOT_TOKEN_KEY = "x-access-token";
export const IOT_SESSION_EVENT = "iot-session-changed";

export function readIotToken(): string | null {
  const token = window.localStorage.getItem(IOT_TOKEN_KEY);
  return token && token !== "null" && token !== "undefined" && token.trim() ? token : null;
}

export function requireIotToken(): string {
  const token = readIotToken();
  if (!token) throw new ApiRequestError("unauthenticated", undefined, "IoT session is missing.");
  return token;
}

export function invalidateIotSession(requestToken: string): void {
  // An expired request from an earlier login must not invalidate a newer IoT session.
  if (readIotToken() === requestToken) window.dispatchEvent(new Event(IOT_SESSION_EVENT));
}
