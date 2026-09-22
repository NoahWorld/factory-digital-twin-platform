import { useCallback, useEffect, useMemo, useState } from "react";
import { FLUID_LIMITS, createFluidDefinition, parseFluids, type FluidDefinition, type FluidKind, type FluidPoint } from "../../../../shared/fluids";
import { Select } from "../components/Select";
import "./fluid-editor.css";

export const fluidKindLabels: Record<FluidKind, string> = { gas: "气体", liquid: "液体", molten: "熔融体" };
export type FluidDrawingPlane = "xz" | "xy" | "yz";
export type FluidPathSession = {
  fluid: FluidDefinition;
  isNew: boolean;
  plane: FluidDrawingPlane;
  offset: number;
  active: boolean;
  selectedPointIndex: number | null;
};
const EMPTY_FLUIDS: FluidDefinition[] = [];
const planeAxis = { xz: "Y", xy: "Z", yz: "X" } as const;

/** Editor drafts deliberately allow zero/one points and never enter the saved document. */
export function useFluidEditor({ fluids = EMPTY_FLUIDS, onChange, enabled }: {
  fluids?: FluidDefinition[];
  onChange: (fluids: FluidDefinition[]) => void;
  enabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<FluidPathSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
  const setFieldError = useCallback((field: string, message: string | null) => {
    setInvalidFields((current) => {
      if ((current[field] ?? null) === message) return current;
      const next = { ...current };
      if (message) next[field] = message; else delete next[field];
      return next;
    });
  }, []);
  const hasInvalidFields = Object.keys(invalidFields).length > 0;
  const selected = session?.fluid ?? fluids.find((fluid) => fluid.id === selectedId) ?? null;
  const validation = useMemo(() => {
    if (!session || session.fluid.points.length < FLUID_LIMITS.minimumPoints) return null;
    return parseFluids(session.isNew ? [...fluids, session.fluid] : fluids.map((fluid) => fluid.id === session.fluid.id ? session.fluid : fluid));
  }, [fluids, session]);
  const previewFluids = validation?.ok ? validation.value : fluids;
  const rendererEditor = useMemo(() => session ? {
    points: session.fluid.points, plane: session.plane, offset: session.offset,
    active: enabled && session.active, direction: session.fluid.direction, selectedPointIndex: session.selectedPointIndex,
  } : null, [enabled, session]);

  const reset = useCallback(() => { setSession(null); setSelectedId(null); setError(null); setInvalidFields({}); }, []);
  const select = useCallback((id: string | null) => {
    if (session && id !== session.fluid.id) {
      setError("请先应用或取消当前流体路径，再切换对象。");
      return false;
    }
    setSelectedId(id); setError(null);
    return true;
  }, [session]);
  const start = (kind: FluidKind = "liquid") => {
    if (!enabled) return false;
    if (session) { setError("请先应用或取消当前路径，再添加流体。"); return false; }
    if (fluids.length >= FLUID_LIMITS.maximumFluids) { setError(`场景最多支持 ${FLUID_LIMITS.maximumFluids} 条流体。`); return false; }
    const fluid = createFluidDefinition(`fluid-${crypto.randomUUID()}`, kind);
    fluid.label = `${fluidKindLabels[kind]} ${fluids.length + 1}`;
    setSession({ fluid, isNew: true, plane: "xz", offset: 0, active: true, selectedPointIndex: null });
    setSelectedId(fluid.id); setError(null);
    return true;
  };
  const commit = (next: FluidDefinition[]) => {
    const result = parseFluids(next);
    if (!result.ok) { setError(`流体配置无效：${result.message}`); return false; }
    onChange(result.value); setError(null);
    return true;
  };
  const update = (patch: Partial<FluidDefinition>) => {
    if (!enabled || !selected) return;
    if (session) { setSession({ ...session, fluid: { ...session.fluid, ...patch } }); setError(null); }
    else commit(fluids.map((fluid) => fluid.id === selected.id ? { ...fluid, ...patch } : fluid));
  };
  const updateSession = (patch: Partial<Omit<FluidPathSession, "fluid" | "isNew">>) => {
    if (!enabled) return;
    setSession((current) => current ? { ...current, ...patch } : current); setError(null);
  };
  const editPath = () => {
    if (!enabled || !selected || session) return;
    const fluid = structuredClone(selected);
    setSession({ fluid, isNew: false, plane: "xz", offset: fluid.points[0][1], active: true, selectedPointIndex: null });
    setError(null);
  };
  const onPoint = useCallback((point: FluidPoint) => {
    if (!enabled || !session?.active) return;
    if (!point.every((coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) <= FLUID_LIMITS.maximumCoordinate)) {
      setError(`路径坐标必须是 ±${FLUID_LIMITS.maximumCoordinate} 内的有限数值。`); return;
    }
    const points = [...session.fluid.points];
    if (session.selectedPointIndex !== null) points[session.selectedPointIndex] = point;
    else if (points.length < FLUID_LIMITS.maximumPoints) points.push(point);
    else { setError(`每条流体最多 ${FLUID_LIMITS.maximumPoints} 个路径点。请修改已有点或应用路径。`); return; }
    setError(null);
    setSession({ ...session, fluid: { ...session.fluid, points } });
  }, [enabled, session]);
  const apply = () => {
    if (!enabled || !session) return false;
    if (hasInvalidFields) { setError("请修正标红的流体参数后再应用。"); return false; }
    if (session.fluid.points.length < FLUID_LIMITS.minimumPoints) { setError("至少设置 2 个不同路径点后才能应用流体。"); return false; }
    if (!commit(session.isNew ? [...fluids, session.fluid] : fluids.map((fluid) => fluid.id === session.fluid.id ? session.fluid : fluid))) return false;
    setSelectedId(session.fluid.id); setSession(null);
    return true;
  };
  const cancel = () => {
    if (session?.isNew) setSelectedId(null);
    setSession(null); setError(null); setInvalidFields({});
  };
  const remove = () => {
    if (!enabled || !selected || session) return;
    if (commit(fluids.filter((fluid) => fluid.id !== selected.id))) setSelectedId(null);
  };
  const toggleVisible = (id: string) => {
    if (!enabled) return;
    if (session) { setError("请先应用或取消当前路径，再修改图层显隐。"); return; }
    commit(fluids.map((fluid) => fluid.id === id ? { ...fluid, visible: !fluid.visible } : fluid));
  };
  const setPoints = (points: FluidPoint[], selectedPointIndex: number | null = null) => {
    if (!enabled || !session) return;
    setSession({ ...session, fluid: { ...session.fluid, points }, selectedPointIndex }); setError(null);
  };
  return { fluids, selected, selectedId, session, error: error ?? (validation && !validation.ok ? `路径尚未生效：${validation.message}` : null),
    previewFluids, rendererEditor, enabled, hasInvalidFields, setFieldError, reset, select, start, update, updateSession, editPath, onPoint, apply, cancel, remove, toggleVisible, setPoints };
}

export type FluidEditorController = ReturnType<typeof useFluidEditor>;

export function FluidLayers({ editor, onSelect, onAdd }: {
  editor: FluidEditorController;
  onSelect: (id: string) => void;
  onAdd: (kind: FluidKind) => void;
}) {
  return <section className="fluid-layers" aria-label="流体图层">
    <div className="standalone-panel-heading standalone-layer-heading">
      <div><span>FLUID COMPONENTS</span><strong>流体 <small>{editor.fluids.length}/{FLUID_LIMITS.maximumFluids}</small></strong></div>
    </div>
    <div className="fluid-add-actions">{(["gas", "liquid", "molten"] as const).map((kind) => <button
      className="inspector-action-button" disabled={!editor.enabled || !!editor.session || editor.fluids.length >= FLUID_LIMITS.maximumFluids}
      key={kind} onClick={() => onAdd(kind)} type="button">＋ {fluidKindLabels[kind]}</button>)}</div>
    <p className="standalone-panel-copy">添加流体后，在画布中点击路径点。三种流体均支持沿路径扩散。</p>
    <div className="standalone-layer-tree">
      {editor.fluids.map((fluid) => <article key={fluid.id} data-fluid-id={fluid.id} className={`${editor.selectedId === fluid.id ? "is-selected" : ""}${fluid.visible ? "" : " is-hidden"}`}>
        <span className="standalone-layer-branch" aria-hidden="true">└</span>
        <button className="standalone-layer-main" onClick={() => onSelect(fluid.id)} type="button">
          <span className="fluid-layer-swatch" style={{ backgroundColor: fluid.color }} aria-hidden="true" />
          <span><strong>{fluid.label}</strong><small>{fluidKindLabels[fluid.kind]} · {fluid.mode === "diffuse" ? "扩散流" : "连续流"} · {fluid.points.length} 点</small></span>
        </button>
        <button aria-label={`${fluid.visible ? "隐藏" : "显示"}${fluid.label}`} aria-pressed={fluid.visible} className="standalone-layer-visibility"
          disabled={!editor.enabled || !!editor.session} onClick={() => editor.toggleVisible(fluid.id)} type="button">{fluid.visible ? "◉" : "○"}</button>
      </article>)}
      {editor.session?.isNew ? <article className="is-selected fluid-layer-draft" data-fluid-id={editor.session.fluid.id}>
        <span className="standalone-layer-branch" aria-hidden="true">└</span>
        <button className="standalone-layer-main" onClick={() => onSelect(editor.session!.fluid.id)} type="button">
          <span className="fluid-layer-swatch" style={{ backgroundColor: editor.session.fluid.color }} aria-hidden="true" />
          <span><strong>{editor.session.fluid.label}</strong><small>绘制中 · {editor.session.fluid.points.length} 点 · 尚未应用</small></span>
        </button>
      </article> : null}
    </div>
  </section>;
}

/** Buffered numeric inputs permit intermediate typing without injecting NaN into scene state. */
function FluidNumberField({ label, value, min, max, step = 0.1, disabled, onChange, onValidity }: {
  label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void;
  onValidity: (field: string, error: string | null) => void;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(String(value)); setError(null); onValidity(label, null); }, [value, label, onValidity]);
  useEffect(() => () => onValidity(label, null), [label, onValidity]);
  function validate(text: string) {
    const next = Number(text);
    const message = !text.trim() || !Number.isFinite(next) || next < min || next > max ? `${label}须在 ${min}～${max} 之间。` : null;
    setError(message); onValidity(label, message);
    return message === null;
  }
  function apply() {
    if (validate(text)) onChange(Number(text));
  }
  return <label className="fluid-number-field"><span>{label}</span><input aria-label={label} aria-invalid={!!error} disabled={disabled}
    type="number" required value={text} min={min} max={max} step={step} onChange={(event) => { setText(event.target.value); validate(event.target.value); }} onBlur={apply}
    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    {error ? <small className="fluid-field-error" role="alert">{error}</small> : null}</label>;
}

export function FluidEditor({ editor, sceneAnimationsEnabled, sceneAnimationSpeed }: { editor: FluidEditorController; sceneAnimationsEnabled?: boolean; sceneAnimationSpeed?: number }) {
  const fluid = editor.selected;
  const session = editor.session;
  if (!fluid) return <div className="fluid-editor"><p className="standalone-property-note">在图层中添加气体、液体或熔融体，并绘制流向路径。</p>{editor.error ? <p className="fluid-error" role="alert">{editor.error}</p> : null}</div>;
  const disabled = !editor.enabled;
  const selectedPoint = session?.selectedPointIndex !== null && session?.selectedPointIndex !== undefined ? session.fluid.points[session.selectedPointIndex] : null;
  const directionLabel = fluid.direction === "forward" ? "首点 → 末点" : "末点 → 首点";
  return <div className="fluid-editor" onKeyDown={(event) => event.stopPropagation()}>
    <div className="standalone-inspector-title">
      <div><span>FLUID COMPONENT</span><strong>{fluid.label}</strong><small>{session ? "路径草稿 · 应用后再保存场景" : "公共流体组件 · 场景坐标"}</small></div>
      {!session ? <button className="inspector-action-button is-danger" disabled={disabled} onClick={editor.remove} type="button">移除</button> : null}
    </div>
    {editor.error ? <p className="fluid-error" role="alert">{editor.error}</p> : null}
    <section className="standalone-property-group">
      <header><span aria-hidden="true">01</span><div><h3>流体与外观</h3><small>可复用于任意模型与路径</small></div></header>
      <label><span>流体名称</span><input aria-label="流体名称" disabled={disabled} maxLength={FLUID_LIMITS.maximumLabelLength} value={fluid.label} onChange={(event) => editor.update({ label: event.target.value })} /></label>
      <label><span>流体类型</span><Select aria-label="流体类型" disabled={disabled} value={fluid.kind} onValueChange={(kind) => editor.update({ kind: kind as FluidKind })}>
        <option value="gas">气体</option><option value="liquid">液体</option><option value="molten">熔融体</option>
      </Select></label>
      <label><span>流体颜色</span><span className="standalone-color-input"><input aria-label="流体颜色" disabled={disabled} type="color" value={fluid.color} onChange={(event) => editor.update({ color: event.target.value })} /><code>{fluid.color.toUpperCase()}</code></span></label>
      <label><span>表现形态</span><Select aria-label="表现形态" disabled={disabled} value={fluid.mode} onValueChange={(mode) => editor.update({ mode: mode as FluidDefinition["mode"] })}>
        <option value="stream">连续流 · 沿路径流动</option><option value="diffuse">扩散流 · 沿流向扩散</option>
      </Select></label>
      <p className="standalone-property-note">气体、液体和熔融体都可选择扩散流；扩散从流向起点逐渐展开，反向会同步反转扩散方向。</p>
      <div className="fluid-fields-grid">
        <FluidNumberField onValidity={editor.setFieldError} label="流体半径" value={fluid.radius} min={FLUID_LIMITS.minimumRadius} max={FLUID_LIMITS.maximumRadius} step={0.05} disabled={disabled} onChange={(radius) => editor.update({ radius })} />
        <FluidNumberField onValidity={editor.setFieldError} label="扩散幅度（半径倍数）" value={fluid.spread} min={FLUID_LIMITS.minimumSpread} max={FLUID_LIMITS.maximumSpread} disabled={disabled || fluid.mode !== "diffuse"} onChange={(spread) => editor.update({ spread })} />
      </div>
      <label><span>不透明度 <output>{Math.round(fluid.opacity * 100)}%</output></span><input aria-label="流体不透明度" disabled={disabled} type="range" min={FLUID_LIMITS.minimumOpacity} max={FLUID_LIMITS.maximumOpacity} step={0.01} value={fluid.opacity} onChange={(event) => editor.update({ opacity: Number(event.target.value) })} /></label>
      <label className="standalone-checkbox"><input disabled={disabled} type="checkbox" checked={fluid.visible} onChange={(event) => editor.update({ visible: event.target.checked })} /> 显示流体</label>
    </section>
    <section className="standalone-property-group">
      <header><span aria-hidden="true">02</span><div><h3>流向与动态</h3><small>{directionLabel}</small></div></header>
      <label><span>流动方向</span><Select aria-label="流动方向" disabled={disabled} value={fluid.direction} onValueChange={(direction) => editor.update({ direction: direction as FluidDefinition["direction"] })}>
        <option value="forward">正向：首点 → 末点</option><option value="reverse">反向：末点 → 首点</option>
      </Select></label>
      <FluidNumberField onValidity={editor.setFieldError} label="视觉流速" value={fluid.speed} min={FLUID_LIMITS.minimumSpeed} max={FLUID_LIMITS.maximumSpeed} disabled={disabled} onChange={(speed) => editor.update({ speed })} />
      <label className="standalone-checkbox"><input disabled={disabled} type="checkbox" checked={fluid.playing} onChange={(event) => editor.update({ playing: event.target.checked })} /> 播放流动效果</label>
      {sceneAnimationsEnabled !== undefined ? <p className="standalone-property-note">{sceneAnimationsEnabled
        ? `流体受场景全局动画控制${sceneAnimationSpeed === undefined ? "" : `；当前全局速度 ${sceneAnimationSpeed}×`}，与这里的视觉流速共同生效。`
        : "场景全局动画当前已关闭，流体保持暂停。可在“场景属性 → 动态”开启全局动画。"}</p> : null}
    </section>
    <section className="standalone-property-group">
      <header><span aria-hidden="true">03</span><div><h3>流向路径</h3><small>{fluid.points.length}/{FLUID_LIMITS.maximumPoints} 个三维路径点</small></div></header>
      {!session ? <><p className="standalone-property-note">路径按点序连接，流动方向可反转。编辑路径时可用鼠标定位或输入 XYZ。</p><button className="inspector-action-button" disabled={disabled} onClick={editor.editPath} type="button">编辑路径</button></> : <>
        <label><span>鼠标绘制平面</span><Select aria-label="鼠标绘制平面" disabled={disabled} value={session.plane} onValueChange={(plane) => editor.updateSession({ plane: plane as FluidDrawingPlane })}>
          <option value="xz">XZ 水平面（固定 Y）</option><option value="xy">XY 竖直面（固定 Z）</option><option value="yz">YZ 竖直面（固定 X）</option>
        </Select></label>
        <FluidNumberField onValidity={editor.setFieldError} label={`平面位置 ${planeAxis[session.plane]}`} value={session.offset} min={-FLUID_LIMITS.maximumCoordinate} max={FLUID_LIMITS.maximumCoordinate} disabled={disabled} onChange={(offset) => editor.updateSession({ offset })} />
        <p className="standalone-property-note">左键单击{selectedPoint ? `移动第 ${session.selectedPointIndex! + 1} 点` : "添加路径点"}；拖动旋转、滚轮缩放。切换平面只影响下一次拾取，可组合绘制三维路径。</p>
        <div className="fluid-path-actions">
          <button className="inspector-action-button" aria-pressed={session.active} disabled={disabled} onClick={() => editor.updateSession({ active: !session.active })} type="button">{session.active ? "暂停鼠标拾取" : "开启鼠标拾取"}</button>
          <button className="inspector-action-button" disabled={disabled || !session.fluid.points.length} onClick={() => editor.setPoints(session.fluid.points.slice(0, -1))} type="button">撤销上一点</button>
          <button className="inspector-action-button is-danger" disabled={disabled || !session.fluid.points.length} onClick={() => editor.setPoints([])} type="button">清空路径</button>
        </div>
        <ol className="fluid-point-list" aria-label="流体路径点">{session.fluid.points.map((point, index) => <li key={index}>
          <button className={session.selectedPointIndex === index ? "is-selected" : ""} aria-pressed={session.selectedPointIndex === index} disabled={disabled}
            onClick={() => editor.updateSession({ selectedPointIndex: index, active: true })} type="button">
            <strong>{index + 1}{index === 0 ? " · 首点" : index === fluid.points.length - 1 ? " · 末点" : ""}</strong><span>{point.map((value) => Number(value.toFixed(2))).join(", ")}</span>
          </button>
        </li>)}</ol>
        {selectedPoint ? <div className="fluid-point-editor">
          <strong>第 {session.selectedPointIndex! + 1} 点坐标</strong>
          <div className="fluid-coordinate-fields">{(["X", "Y", "Z"] as const).map((axis, axisIndex) => <FluidNumberField onValidity={editor.setFieldError}
            key={`${session.selectedPointIndex}-${axis}`} label={axis} value={selectedPoint[axisIndex]} min={-FLUID_LIMITS.maximumCoordinate} max={FLUID_LIMITS.maximumCoordinate} disabled={disabled}
            onChange={(value) => editor.setPoints(session.fluid.points.map((point, index) => index === session.selectedPointIndex ? point.map((coordinate, coordinateIndex) => coordinateIndex === axisIndex ? value : coordinate) as FluidPoint : point), session.selectedPointIndex)} />)}</div>
          <div className="fluid-path-actions"><button className="inspector-action-button" onClick={() => editor.updateSession({ selectedPointIndex: null, active: true })} disabled={disabled} type="button">继续添加点</button>
            <button className="inspector-action-button is-danger" disabled={disabled} onClick={() => editor.setPoints(session.fluid.points.filter((_, index) => index !== session.selectedPointIndex))} type="button">删除此点</button></div>
        </div> : null}
        <div className="fluid-apply-actions"><button className="primary-button compact-button" disabled={disabled || editor.hasInvalidFields || fluid.points.length < FLUID_LIMITS.minimumPoints} onClick={editor.apply} type="button">应用流体</button><button className="secondary-button compact-button" onClick={editor.cancel} type="button">取消路径修改</button></div>
        <p className="standalone-property-note">{fluid.points.length < 2 ? "至少设置 2 个不同的路径点。" : "画布显示有效路径的临时预览。"}应用后点击“保存场景”保存配置。</p>
      </>}
    </section>
  </div>;
}
