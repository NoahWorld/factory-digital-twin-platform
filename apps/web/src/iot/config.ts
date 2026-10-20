/** IoT and DTwin share one origin and the existing IoT session. */
export function sameOriginPath(value: string, name: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\s?#]/.test(value)
    || value.split("/").some(part => part === "." || part === "..")) {
    throw new Error(`${name} 必须是同源绝对路径。`);
  }
  return value.replace(/\/$/, "");
}

export const IOT_API_PREFIX = sameOriginPath(
  import.meta.env.VITE_IOT_API_PREFIX ?? (import.meta.env.DEV ? "/cloud" : "/cloudPro/api"),
  "VITE_IOT_API_PREFIX",
);
export const IOT_HOME_PATH = sameOriginPath(import.meta.env.VITE_IOT_HOME_PATH ?? "/", "VITE_IOT_HOME_PATH") || "/";
export const IOT_LOGIN_PATH = sameOriginPath(import.meta.env.VITE_IOT_LOGIN_PATH ?? "/user/login", "VITE_IOT_LOGIN_PATH");
export const TWIN_API_PREFIX = `${IOT_API_PREFIX}/twin`;

/** The editor retains domain paths; its sole transport is the IoT twin module. */
export function iotApiUrl(path: string): string {
  const translated = path.startsWith("/api/v1/") ? `${TWIN_API_PREFIX}/${path.slice("/api/v1/".length)}` : path;
  const url = new URL(translated, "https://iot.invalid");
  if (!translated.startsWith(`${IOT_API_PREFIX}/`) || url.origin !== "https://iot.invalid"
    || !url.pathname.startsWith(`${IOT_API_PREFIX}/`) || translated.includes("\\") || url.hash) {
    throw new Error("此接口不属于 IoT 数字孪生接口。");
  }
  const module = url.pathname.slice(`${TWIN_API_PREFIX}/`.length).split("/")[0];
  if (url.pathname.startsWith(`${TWIN_API_PREFIX}/`) && ["auth", "users", "publications"].includes(module)) {
    throw new Error("独立身份管理与匿名分享接口已停用。");
  }
  return `${url.pathname}${url.search}`;
}
