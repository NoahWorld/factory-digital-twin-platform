import { useEffect, useState, type CSSProperties } from "react";
import {
  asCustomCanvasTheme,
  canvasThemePresetLabels,
  canvasThemePresets,
  type BuiltInCanvasThemePresetId,
} from "./themes";
import type {
  CanvasBackgroundPattern,
  CanvasFontFamily,
  CanvasTheme,
} from "./types";

type ThemeDialogProps = {
  currentTheme: CanvasTheme;
  editable: boolean;
  onApply: (theme: CanvasTheme) => void;
  onClose: () => void;
};

type ColorField =
  | "backgroundColor"
  | "surfaceColor"
  | "textColor"
  | "accentColor"
  | "borderColor";

const builtInPresetIds: BuiltInCanvasThemePresetId[] = [
  "deep-blue",
  "steel-orange",
  "energy-green",
  "command-gold",
  "light-industrial",
];

const customColorFields: Array<{ key: ColorField; label: string }> = [
  { key: "backgroundColor", label: "画布背景" },
  { key: "surfaceColor", label: "组件背景" },
  { key: "textColor", label: "文字颜色" },
  { key: "accentColor", label: "强调颜色" },
  { key: "borderColor", label: "边框颜色" },
];

const patternLabels: Record<CanvasBackgroundPattern, string> = {
  none: "纯色",
  grid: "工业网格",
  dots: "数据点阵",
  circuit: "科技电路",
};

const fontLabels: Record<CanvasFontFamily, string> = {
  system: "系统黑体",
  industrial: "工业标题",
  data: "数据仪表",
};

function ThemePreview({ label, theme }: { label: string; theme: CanvasTheme }) {
  return (
    <div
      className="theme-preview"
      data-pattern={theme.backgroundPattern}
      style={{
        "--theme-preview-accent": theme.accentColor,
        "--theme-preview-background": theme.backgroundColor,
        "--theme-preview-border": theme.borderColor,
        "--theme-preview-glow": theme.glowIntensity,
        "--theme-preview-radius": `${theme.panelRadius}px`,
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

export function ThemeDialog({ currentTheme, editable, onApply, onClose }: ThemeDialogProps) {
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

  const updateCustomTheme = (patch: Partial<CanvasTheme>) => {
    setCustomTheme((current) => asCustomCanvasTheme({ ...current, ...patch }));
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
            <h2 id="theme-dialog-title">整屏行业主题</h2>
            <p>统一配置配色、纹理、字体、辉光和面板圆角；3D 模型、灯光与材质保持独立。</p>
          </div>
          <button aria-label="关闭主题选择器" className="icon-button" onClick={onClose} type="button">×</button>
        </header>

        <div className="theme-preset-grid">
          {builtInPresetIds.map((presetId) => {
            const theme = canvasThemePresets[presetId];
            const label = canvasThemePresetLabels[presetId];
            return (
              <article className="theme-preset-card" key={presetId}>
                <ThemePreview label={label} theme={theme} />
                <div>
                  <strong>{label}</strong>
                  <span>{presetId === currentTheme.presetId ? "当前主题" : `${patternLabels[theme.backgroundPattern]} · ${fontLabels[theme.fontFamily]}`}</span>
                </div>
                <button className="secondary-button" disabled={!editable} onClick={() => apply(theme)} type="button">应用</button>
              </article>
            );
          })}
        </div>

        <section className="theme-custom-section">
          <div className="theme-custom-heading">
            <div>
              <strong>自定义视觉体系</strong>
              <span>全局主题只保存一份；单个组件仍可在属性栏覆盖自己的颜色。</span>
            </div>
            <ThemePreview label="自定义预览" theme={customTheme} />
          </div>

          <div className="theme-advanced-grid">
            <label>
              <span>背景纹理</span>
              <select disabled={!editable} onChange={(event) => updateCustomTheme({ backgroundPattern: event.target.value as CanvasBackgroundPattern })} value={customTheme.backgroundPattern}>
                {Object.entries(patternLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>字体风格</span>
              <select disabled={!editable} onChange={(event) => updateCustomTheme({ fontFamily: event.target.value as CanvasFontFamily })} value={customTheme.fontFamily}>
                {Object.entries(fontLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>辉光强度 <em>{Math.round(customTheme.glowIntensity * 100)}%</em></span>
              <input disabled={!editable} max={1} min={0} onChange={(event) => updateCustomTheme({ glowIntensity: Number(event.target.value) })} step={0.05} type="range" value={customTheme.glowIntensity} />
            </label>
            <label>
              <span>统一圆角 <em>{customTheme.panelRadius}px</em></span>
              <input disabled={!editable} max={24} min={0} onChange={(event) => updateCustomTheme({ panelRadius: Number(event.target.value) })} step={1} type="range" value={customTheme.panelRadius} />
            </label>
          </div>

          <div className="theme-color-grid">
            {customColorFields.map(({ key, label }) => (
              <label className="theme-color-field" key={key}>
                <span>{label}</span>
                <span className="theme-color-control">
                  <input aria-label={label} disabled={!editable} onInput={(event) => updateCustomTheme({ [key]: event.currentTarget.value })} type="color" value={customTheme[key]} />
                  <code>{customTheme[key].toUpperCase()}</code>
                </span>
              </label>
            ))}
          </div>
          <button className="primary-button theme-custom-apply" disabled={!editable} onClick={() => apply(customTheme)} type="button">应用自定义主题</button>
        </section>
      </section>
    </div>
  );
}
