import { useEffect, useState, type CSSProperties } from "react";
import {
  asCustomCanvasTheme,
  darkCanvasTheme,
  lightCanvasTheme,
} from "./themes";
import type { CanvasTheme } from "./types";

type ThemeDialogProps = {
  currentTheme: CanvasTheme;
  editable: boolean;
  onApply: (theme: CanvasTheme) => void;
  onClose: () => void;
};

type ColorField = Exclude<keyof CanvasTheme, "mode">;

const customColorFields: Array<{ key: ColorField; label: string }> = [
  { key: "backgroundColor", label: "画布背景" },
  { key: "surfaceColor", label: "组件背景" },
  { key: "textColor", label: "文字颜色" },
  { key: "accentColor", label: "强调颜色" },
  { key: "borderColor", label: "边框颜色" },
];

function ThemePreview({
  label,
  theme,
}: {
  label: string;
  theme: CanvasTheme;
}) {
  return (
    <div
      className="theme-preview"
      style={{
        "--theme-preview-accent": theme.accentColor,
        "--theme-preview-background": theme.backgroundColor,
        "--theme-preview-border": theme.borderColor,
        "--theme-preview-surface": theme.surfaceColor,
        "--theme-preview-text": theme.textColor,
      } as CSSProperties}
    >
      <span className="theme-preview-title">{label}</span>
      <span className="theme-preview-card is-wide" />
      <span className="theme-preview-card" />
      <span className="theme-preview-card" />
    </div>
  );
}

export function ThemeDialog({
  currentTheme,
  editable,
  onApply,
  onClose,
}: ThemeDialogProps) {
  const [customTheme, setCustomTheme] = useState<CanvasTheme>(
    asCustomCanvasTheme(currentTheme),
  );

  useEffect(() => {
    setCustomTheme(asCustomCanvasTheme(currentTheme));
  }, [currentTheme]);

  const apply = (theme: CanvasTheme) => {
    if (!editable) return;
    onApply(theme);
  };

  return (
    <div className="template-dialog-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="theme-dialog-title"
        aria-modal="true"
        className="template-dialog theme-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="template-dialog-header">
          <div>
            <span className="eyebrow">Canvas theme</span>
            <h2 id="theme-dialog-title">一键切换画布主题</h2>
            <p>统一更新画布与非 3D 组件的颜色；3D 模型、灯光和材质配置保持不变。</p>
          </div>
          <button aria-label="关闭主题选择器" className="icon-button" onClick={onClose} type="button">×</button>
        </header>

        <div className="theme-preset-grid">
          {[
            { label: "深色主题", theme: darkCanvasTheme },
            { label: "浅色主题", theme: lightCanvasTheme },
          ].map(({ label, theme }) => (
            <article className="theme-preset-card" key={theme.mode}>
              <ThemePreview label={label} theme={theme} />
              <div>
                <strong>{label}</strong>
                <span>{theme.mode === currentTheme.mode ? "当前主题" : "内置主题"}</span>
              </div>
              <button className="secondary-button" disabled={!editable} onClick={() => apply(theme)} type="button">
                应用{label}
              </button>
            </article>
          ))}
        </div>

        <section className="theme-custom-section">
          <div className="theme-custom-heading">
            <div>
              <strong>用户自选色</strong>
              <span>选择 5 个基础色，所有非 3D 组件会立即联动。</span>
            </div>
            <ThemePreview label="自选色预览" theme={customTheme} />
          </div>
          <div className="theme-color-grid">
            {customColorFields.map(({ key, label }) => (
              <label className="theme-color-field" key={key}>
                <span>{label}</span>
                <span className="theme-color-control">
                  <input
                    aria-label={label}
                    disabled={!editable}
                    onInput={(event) => {
                      const value = event.currentTarget.value;
                      setCustomTheme((current) => ({
                        ...current,
                        [key]: value,
                      }));
                    }}
                    type="color"
                    value={customTheme[key]}
                  />
                  <code>{customTheme[key].toUpperCase()}</code>
                </span>
              </label>
            ))}
          </div>
          <button className="primary-button theme-custom-apply" disabled={!editable} onClick={() => apply(customTheme)} type="button">
            应用自选主题
          </button>
        </section>
      </section>
    </div>
  );
}
