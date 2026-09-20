import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyUiTheme,
  parseUiThemePreference,
  reportUiThemeStorageIssue,
  resolveUiTheme,
  UI_THEME_MEDIA_QUERY,
  UI_THEME_STORAGE_KEY,
  type UiTheme,
  type UiThemeState,
} from "./ui-theme";
import "./theme-controls.css";

type UiThemeContextValue = {
  theme: UiTheme;
  preference: UiTheme | null;
  setPreference: (preference: UiTheme | null) => void;
};

const UiThemeContext = createContext<UiThemeContextValue | null>(null);

export function ThemeProvider({ children, initialState }: { children: ReactNode; initialState: UiThemeState }) {
  const [state, setState] = useState(initialState);
  const theme = resolveUiTheme(state.preference, state.systemTheme);

  useLayoutEffect(() => applyUiTheme(theme), [theme]);

  useEffect(() => {
    const media = window.matchMedia(UI_THEME_MEDIA_QUERY);
    const updateSystemTheme = () => setState(current => ({ ...current, systemTheme: media.matches ? "dark" : "light" }));
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== UI_THEME_STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea !== window.localStorage) return;
        const preference = parseUiThemePreference(event.newValue);
        setState(current => ({ ...current, preference, storageIssue: null }));
      } catch (reason) {
        const storageIssue = reportUiThemeStorageIssue("sync", reason);
        setState(current => ({ ...current, preference: null, storageIssue }));
      }
    };
    media.addEventListener("change", updateSystemTheme);
    window.addEventListener("storage", syncPreference);
    // The system can change between the pre-render read and this subscription.
    updateSystemTheme();
    return () => {
      media.removeEventListener("change", updateSystemTheme);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  const setPreference = useCallback((preference: UiTheme | null) => {
    let storageIssue: string | null = null;
    try {
      if (preference === null) window.localStorage.removeItem(UI_THEME_STORAGE_KEY);
      else window.localStorage.setItem(UI_THEME_STORAGE_KEY, preference);
    } catch (reason) {
      storageIssue = reportUiThemeStorageIssue("write", reason);
    }
    setState(current => ({ ...current, preference, storageIssue }));
  }, []);

  const context = useMemo(() => ({ theme, preference: state.preference, setPreference }), [theme, state.preference, setPreference]);

  return (
    <UiThemeContext.Provider value={context}>
      {children}
      {state.storageIssue ? (
        <div className="ui-theme-storage-notice" role="status">
          <span>{state.storageIssue}</span>
          <button aria-label="关闭主题设置提示" onClick={() => setState(current => ({ ...current, storageIssue: null }))} type="button">×</button>
        </div>
      ) : null}
    </UiThemeContext.Provider>
  );
}

export function useUiTheme(): UiThemeContextValue {
  const context = useContext(UiThemeContext);
  if (!context) throw new Error("useUiTheme 必须在 ThemeProvider 中使用。");
  return context;
}
