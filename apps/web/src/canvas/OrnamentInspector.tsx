import { useEffect, useMemo, useState } from "react";
import { isOrnamentNodeType, parseOrnamentProps, titleFonts, titleVariants } from "../../../../shared/canvas-ornaments";
import { componentLabels, type CanvasNode } from "./types";
import { IconPicker } from "./IconPicker";

export function OrnamentInspector({ editable, node, onNodeChange, onValidationChange }: {
  editable: boolean; node: CanvasNode; onNodeChange: (node: CanvasNode) => void; onValidationChange: (message: string | null) => void;
}) {
  if (!isOrnamentNodeType(node.type)) throw new Error(`Unsupported ornament inspector: ${node.type}`);
  const type = node.type;
  const [draft, setDraft] = useState<Record<string, unknown>>(node.props);
  const signature = JSON.stringify(node.props);
  useEffect(() => { setDraft(node.props); }, [node.id, signature]);
  const validation = useMemo(() => parseOrnamentProps(type, draft), [type, draft]);
  useEffect(() => { onValidationChange(validation.ok ? null : validation.message); }, [validation, onValidationChange]);
  const change = (key: string, value: unknown) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    const parsed = parseOrnamentProps(type, next);
    if (parsed.ok) onNodeChange({ ...node, props: parsed.value });
  };
  const numberField = (key: string, label: string, min: number, max: number, step = 1) => <label key={key}><span>{label}</span><input type="number" disabled={!editable} min={min} max={max} step={step} value={String(draft[key] ?? "")} onChange={(event) => change(key, event.target.value === "" ? "" : Number(event.target.value))} /></label>;
  const colorField = (key: string, label: string) => <label key={key}><span>{label}</span><input className="inspector-color-input" type="color" disabled={!editable} aria-label={label} value={String(draft[key])} onChange={(event) => change(key, event.target.value)} /></label>;
  const checkField = (key: string, label: string) => <label className="inspector-check-row"><input type="checkbox" disabled={!editable} checked={draft[key] === true} onChange={(event) => change(key, event.target.checked)} /><span>{label}</span></label>;
  return <aside className="component-inspector">
    <header className="inspector-heading"><span className="eyebrow">Typography & icons</span><h2>{componentLabels[type]}</h2><p>{Math.round(node.width)} × {Math.round(node.height)}</p></header>
    {type === "card-title" ? <>
      <section className="inspector-section">
        <div className="inspector-section-title"><strong>标题与样式</strong></div>
        <label><span>标题内容</span><input disabled={!editable} maxLength={120} value={String(draft.text)} onChange={(event) => change("text", event.target.value)} /></label>
        <div className="title-variant-picker" role="group" aria-label="标题样式">{Object.entries(titleVariants).map(([variant, label]) => <button type="button" key={variant} data-variant={variant} disabled={!editable} aria-pressed={draft.variant === variant} onClick={() => change("variant", variant)}><i aria-hidden="true" /><span>{label}</span></button>)}</div>
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title"><strong>文字排版</strong></div>
        <label><span>字体</span><select disabled={!editable} value={String(draft.fontFamily)} onChange={(event) => change("fontFamily", event.target.value)}>{Object.entries(titleFonts).map(([key, font]) => <option key={key} value={key}>{font.label}</option>)}</select></label>
        <div className="inspector-number-grid">{numberField("fontSize", "文字大小 (px)", 10, 96)}{numberField("letterSpacing", "字间距 (px)", 0, 12, 0.5)}</div>
        <label><span>字重</span><select disabled={!editable} value={String(draft.fontWeight)} onChange={(event) => change("fontWeight", Number(event.target.value))}>{[[300, "纤细"], [400, "常规"], [500, "中等"], [600, "半粗"], [700, "粗体"], [800, "特粗"], [900, "黑体"]].map(([value, label]) => <option key={value} value={value}>{label} · {value}</option>)}</select></label>
        <label><span>对齐方式</span><select disabled={!editable} value={String(draft.align)} onChange={(event) => change("align", event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
        <div className="inspector-number-grid">{checkField("italic", "斜体")}{checkField("underline", "文字下划线")}</div>
        {colorField("textColor", "标题文字颜色")}
      </section>
    </> : null}
    <section className="inspector-section">
      <div className="inspector-section-title"><strong>{type === "card-title" ? "前置图标" : "选择图标"}</strong><span>36 个 · 本地资源</span></div>
      <IconPicker value={String(draft.icon)} disabled={!editable} allowNone={type === "card-title"} onChange={(id) => change("icon", id)} />
      {draft.icon !== "none" ? <>
        <div className="inspector-number-grid">{numberField("iconSize", "图标大小 (px)", 8, 256)}{numberField("strokeWidth", "线条粗细", 0.5, 4, 0.1)}{numberField("rotation", "旋转角度 (°)", -180, 180)}</div>
        {colorField("iconColor", "图标颜色")}
      </> : null}
    </section>
    <section className="inspector-section">
      <div className="inspector-section-title"><strong>布局与装饰</strong></div>
      {type === "card-title" ? <>
        <div className="inspector-number-grid">{numberField("gap", "图文间距 (px)", 0, 64)}{numberField("padding", "水平内边距 (px)", 0, 48)}</div>
        <div className="inspector-decoration-colors">{colorField("accentColor", "装饰颜色")}{colorField("fillColor", "背景颜色")}</div>
        {numberField("backgroundOpacity", "背景不透明度", 0, 1, 0.05)}
      </> : null}
      {numberField("opacity", "整体不透明度", 0, 1, 0.05)}
    </section>
    {!validation.ok ? <p className="inspector-validation-error" role="alert">{validation.message}</p> : null}
  </aside>;
}
