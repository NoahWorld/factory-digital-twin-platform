export type UiTheme = "light" | "dark";

export const UI_THEME_STORAGE_KEY = "kingdom.ui-theme";
export const UI_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type UiThemeState = {
  preference: UiTheme | null;
  systemTheme: UiTheme;
  storageIssue: string | null;
};

/** null means the interface follows the operating system, not the project canvas. */
export function parseUiThemePreference(value: string | null): UiTheme | null {
  if (value === null || value === "light" || value === "dark") return value;
  throw new Error(`界面主题偏好无效：${JSON.stringify(value)}；只允许 light、dark 或未设置。`);
}

export function resolveUiTheme(preference: UiTheme | null, systemTheme: UiTheme): UiTheme {
  return preference ?? systemTheme;
}

export function uiThemeMetaColor(theme: UiTheme): string {
  return theme === "light" ? "#f3f6fb" : "#0a1422";
}

export function applyUiTheme(theme: UiTheme): void {
  document.documentElement.dataset.uiTheme = theme;
  document.documentElement.style.colorScheme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = uiThemeMetaColor(theme);
}

export function reportUiThemeStorageIssue(operation: "read" | "write" | "sync", reason: unknown): string {
  console.warn("[ui-theme] 界面主题偏好存储失败", { operation, key: UI_THEME_STORAGE_KEY, reason });
  return operation === "write"
    ? "主题已在当前页面切换，但浏览器未能保存偏好；刷新后可能恢复系统设置。"
    : "浏览器中的主题偏好无法读取或同步；当前使用系统主题，仍可手动切换。";
}

/** Call before React renders so native controls and the page share the first theme. */
export function initializeUiTheme(): UiThemeState {
  const systemTheme: UiTheme = window.matchMedia(UI_THEME_MEDIA_QUERY).matches ? "dark" : "light";
  let preference: UiTheme | null = null;
  let storageIssue: string | null = null;
  try {
    preference = parseUiThemePreference(window.localStorage.getItem(UI_THEME_STORAGE_KEY));
  } catch (reason) {
    storageIssue = reportUiThemeStorageIssue("read", reason);
  }
  applyUiTheme(resolveUiTheme(preference, systemTheme));
  return { preference, systemTheme, storageIssue };
}
