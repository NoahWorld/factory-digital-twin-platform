import { useEffect, useMemo, useState } from "react";
import {
  componentLabels,
  parsePanelFrameProps,
  type CanvasNode,
  type PanelFrameProps,
  type PanelFrameStyle,
} from "./types";

type PanelFrameInspectorProps = {
  editable: boolean;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onValidationChange: (message: string | null) => void;
};

type PanelFrameDraft = Omit<PanelFrameProps, "opacity" | "glowStrength" | "headerHeight" | "cornerSize"> & {
  opacity: string;
  glowStrength: string;
  headerHeight: string;
  cornerSize: string;
};

const styleLabels: Record<PanelFrameStyle, string> = {
  outline: "简洁描边",
  corners: "科技角标",
  cut: "工业切角",
  glass: "透明玻璃",
  neon: "霓虹辉光",
};

const toDraft = (props: PanelFrameProps): PanelFrameDraft => ({
  ...props,
  opacity: String(props.opacity),
  glowStrength: String(props.glowStrength),
  headerHeight: String(props.headerHeight),
  cornerSize: String(props.cornerSize),
});

const parseDraftNumber = (value: string): number => value.trim() === "" ? Number.NaN : Number(value);

export function PanelFrameInspector({ editable, node, onNodeChange, onValidationChange }: PanelFrameInspectorProps) {
  const initial = parsePanelFrameProps(node.props);
  const [draft, setDraft] = useState<PanelFrameDraft>(() => toDraft(initial.ok ? initial.value : {
    title: "",
    subtitle: "",
    showHeader: true,
    style: "corners",
    textColor: "#eafaff",
    accentColor: "#55d8ff",
    fillColor: "#0b2638",
    borderColor: "#286783",
    opacity: 0.88,
    glowStrength: 0.55,
    headerHeight: 54,
    cornerSize: 24,
  }));
  const propsSignature = JSON.stringify(node.props);

  useEffect(() => {
    const parsed = parsePanelFrameProps(node.props);
    if (parsed.ok) setDraft(toDraft(parsed.value));
  }, [node.id, propsSignature]);

  const validation = useMemo(() => parsePanelFrameProps({
    ...draft,
    opacity: parseDraftNumber(draft.opacity),
    glowStrength: parseDraftNumber(draft.glowStrength),
    headerHeight: parseDraftNumber(draft.headerHeight),
    cornerSize: parseDraftNumber(draft.cornerSize),
  }), [draft]);

  useEffect(() => {
    onValidationChange(validation.ok ? null : validation.message);
  }, [onValidationChange, validation]);

  const changeDraft = (next: PanelFrameDraft) => {
    setDraft(next);
    const parsed = parsePanelFrameProps({
      ...next,
      opacity: parseDraftNumber(next.opacity),
      glowStrength: parseDraftNumber(next.glowStrength),
      headerHeight: parseDraftNumber(next.headerHeight),
      cornerSize: parseDraftNumber(next.cornerSize),
    });
    if (parsed.ok) onNodeChange({ ...node, props: parsed.value });
  };

  if (!initial.ok) {
    return <aside className="component-inspector is-empty"><div className="inspector-invalid"><strong>科技面板配置无效</strong><p>{initial.message}</p></div></aside>;
  }

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">Panel frame</span>
        <h2>{componentLabels[node.type]}</h2>
        <p>组件 ID：{node.id.slice(0, 8)}</p>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>标题与结构</strong><span>{Math.round(node.width)} × {Math.round(node.height)}</span></div>
        <label><span>面板样式</span><select disabled={!editable} onChange={(event) => changeDraft({ ...draft, style: event.target.value as PanelFrameStyle })} value={draft.style}>{Object.entries(styleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="inspector-check-row"><input checked={draft.showHeader} disabled={!editable} onChange={(event) => changeDraft({ ...draft, showHeader: event.target.checked })} type="checkbox" /><span>显示标题栏</span></label>
        {draft.showHeader ? <>
          <label><span>标题</span><input disabled={!editable} maxLength={120} onChange={(event) => changeDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
          <label><span>英文副标题</span><input disabled={!editable} maxLength={160} onChange={(event) => changeDraft({ ...draft, subtitle: event.target.value })} value={draft.subtitle} /></label>
          <label><span>标题栏高度</span><input disabled={!editable} max={80} min={32} onChange={(event) => changeDraft({ ...draft, headerHeight: event.target.value })} step={1} type="number" value={draft.headerHeight} /></label>
        </> : null}
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>视觉参数</strong><span>局部覆盖</span></div>
        <div className="inspector-decoration-colors">
          <label><span>文字</span><input aria-label="文字颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, textColor: event.target.value })} type="color" value={draft.textColor} /></label>
          <label><span>强调</span><input aria-label="强调颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, accentColor: event.target.value })} type="color" value={draft.accentColor} /></label>
          <label><span>背景</span><input aria-label="背景颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, fillColor: event.target.value })} type="color" value={draft.fillColor} /></label>
          <label><span>边框</span><input aria-label="边框颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, borderColor: event.target.value })} type="color" value={draft.borderColor} /></label>
        </div>
        <div className="inspector-number-grid">
          <label><span>透明度</span><input disabled={!editable} max={1} min={0.05} onChange={(event) => changeDraft({ ...draft, opacity: event.target.value })} step={0.05} type="number" value={draft.opacity} /></label>
          <label><span>辉光强度</span><input disabled={!editable} max={1} min={0} onChange={(event) => changeDraft({ ...draft, glowStrength: event.target.value })} step={0.05} type="number" value={draft.glowStrength} /></label>
          <label><span>角标尺寸</span><input disabled={!editable} max={48} min={8} onChange={(event) => changeDraft({ ...draft, cornerSize: event.target.value })} step={1} type="number" value={draft.cornerSize} /></label>
        </div>
        {!validation.ok ? <p className="inspector-validation-error" role="alert">{validation.message}</p> : null}
      </section>

      <div className="inspector-note"><strong>作为背景容器使用</strong><p>科技面板保持轻量，只负责边框与标题。把图表、指标等组件叠放在上方即可组合出完整业务板块。</p></div>
    </aside>
  );
}
