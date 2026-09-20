import { useUiTheme } from "./ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, preference, setPreference } = useUiTheme();
  const nextTheme = theme === "light" ? "dark" : "light";
  const nextLabel = nextTheme === "light" ? "浅色" : "深色";
  const currentLabel = theme === "light" ? "浅色" : "深色";

  return (
    <div aria-label="界面主题" className={`ui-theme-controls ${className}`} role="group">
      <button
        aria-label={`切换到${nextLabel}模式，当前为${currentLabel}模式`}
        className="ui-theme-toggle"
        onClick={() => setPreference(nextTheme)}
        title={`切换到${nextLabel}模式`}
        type="button"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
          {nextTheme === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <path d="M20.4 14.1A8.5 8.5 0 0 1 9.9 3.6a8.5 8.5 0 1 0 10.5 10.5Z" />}
        </svg>
        <span>{nextLabel}</span>
      </button>
      <button
        aria-label="跟随系统主题"
        aria-pressed={preference === null}
        className="ui-theme-system"
        onClick={() => setPreference(null)}
        title={preference === null ? `正在跟随系统（${currentLabel}）` : "跟随系统主题"}
        type="button"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>
      </button>
    </div>
  );
}
