import { useEffect, useMemo, useState } from "react";
import { Model3DInspector } from "./Model3DInspector";
import type { ModelSceneSnapshot } from "./model-scene";
import {
  componentLabels,
  isDecorationNodeType,
  isModel3DNodeType,
  isShapeNodeType,
  parseChartProps,
  parseDecorationProps,
  parseShapeProps,
  type CanvasNode,
  type ChartProps,
  type DecorationNodeType,
  type DecorationProps,
  type ShapeProps,
} from "./types";

type ComponentInspectorProps = {
  editable: boolean;
  modelScene?: ModelSceneSnapshot | null;
  node: CanvasNode | null;
  onModelSceneNodeSelect?: (path: string | null) => void;
  onNodeChange: (node: CanvasNode) => void;
  onValidationChange: (message: string | null) => void;
};

type ChartDraft = {
  title: string;
  unit: string;
  color: string;
  categories: string[];
  values: string[];
};

type DraftResult =
  | { ok: true; props: ChartProps }
  | { ok: false; message: string };

type ShapeDraft = {
  fillColor: string;
  borderColor: string;
  borderWidth: string;
  borderRadius: string;
  opacity: string;
};

type ShapeDraftResult =
  | { ok: true; props: ShapeProps }
  | { ok: false; message: string };

type DecorationDraft = Omit<DecorationProps, "opacity"> & {
  opacity: string;
};

type DecorationDraftResult =
  | { ok: true; props: DecorationProps }
  | { ok: false; message: string };

const MAX_POINTS = 32;

const toDraft = (props: ChartProps): ChartDraft => ({
  title: props.title,
  unit: props.unit,
  color: props.color,
  categories: [...props.categories],
  values: props.values.map(String),
});

const validateDraft = (draft: ChartDraft): DraftResult => {
  const title = draft.title.trim();
  if (!title) return { ok: false, message: "图表标题不能为空。" };
  if (title.length > 120) return { ok: false, message: "图表标题不能超过 120 个字符。" };
  if (draft.unit.length > 24) return { ok: false, message: "单位不能超过 24 个字符。" };
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.color)) return { ok: false, message: "请选择有效的六位十六进制颜色。" };
  if (draft.categories.length < 2 || draft.categories.length > MAX_POINTS) {
    return { ok: false, message: `数据项必须为 2–${MAX_POINTS} 条。` };
  }

  const categories = draft.categories.map((category) => category.trim());
  if (categories.some((category) => !category)) return { ok: false, message: "分类名称不能为空。" };
  if (categories.some((category) => category.length > 80)) return { ok: false, message: "分类名称不能超过 80 个字符。" };

  const values = draft.values.map((value) => value.trim() === "" ? Number.NaN : Number(value));
  if (values.some((value) => !Number.isFinite(value))) return { ok: false, message: "每条数据都必须填写有效数值。" };
  if (values.some((value) => value < -1_000_000_000 || value > 1_000_000_000)) {
    return { ok: false, message: "数值必须在 -10 亿到 10 亿之间。" };
  }

  return {
    ok: true,
    props: { title, unit: draft.unit, color: draft.color, categories, values },
  };
};

function ValidChartInspector({ editable, node, props, onNodeChange, onValidationChange }: ComponentInspectorProps & { node: CanvasNode; props: ChartProps }) {
  const [draft, setDraft] = useState<ChartDraft>(() => toDraft(props));
  const propsSignature = JSON.stringify([props.title, props.unit, props.color, props.categories, props.values]);

  useEffect(() => {
    setDraft(toDraft(props));
  }, [node.id, propsSignature]);

  const validation = useMemo(() => validateDraft(draft), [draft]);

  useEffect(() => {
    onValidationChange(validation.ok ? null : validation.message);
  }, [onValidationChange, validation]);

  const changeDraft = (nextDraft: ChartDraft) => {
    setDraft(nextDraft);
    const result = validateDraft(nextDraft);
    if (result.ok) onNodeChange({ ...node, props: result.props });
  };

  const updatePoint = (index: number, field: "category" | "value", value: string) => {
    const nextDraft = { ...draft, categories: [...draft.categories], values: [...draft.values] };
    if (field === "category") nextDraft.categories[index] = value;
    else nextDraft.values[index] = value;
    changeDraft(nextDraft);
  };

  const addPoint = () => {
    if (draft.categories.length >= MAX_POINTS) return;
    changeDraft({
      ...draft,
      categories: [...draft.categories, `分类 ${draft.categories.length + 1}`],
      values: [...draft.values, "0"],
    });
  };

  const removePoint = (index: number) => {
    if (draft.categories.length <= 2) return;
    changeDraft({
      ...draft,
      categories: draft.categories.filter((_, itemIndex) => itemIndex !== index),
      values: draft.values.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">Properties</span>
        <h2>{componentLabels[node.type]}</h2>
        <p>组件 ID：{node.id.slice(0, 8)}</p>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>基础配置</strong><span>{Math.round(node.width)} × {Math.round(node.height)}</span></div>
        <label><span>图表标题</span><input disabled={!editable} maxLength={120} onChange={(event) => changeDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
        <div className="inspector-inline-fields">
          <label><span>单位</span><input disabled={!editable} maxLength={24} onChange={(event) => changeDraft({ ...draft, unit: event.target.value })} value={draft.unit} /></label>
          <label><span>主题颜色</span><input aria-label="主题颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, color: event.target.value })} type="color" value={draft.color} /></label>
        </div>
      </section>

      <section className="inspector-section inspector-data-section">
        <div className="inspector-section-title"><strong>静态数据</strong><span>{draft.categories.length}/{MAX_POINTS}</span></div>
        <div className="inspector-data-head"><span>分类</span><span>数值</span><span /></div>
        <div className="inspector-data-list">
          {draft.categories.map((category, index) => (
            <div className="inspector-data-row" key={index}>
              <input aria-label={`第 ${index + 1} 条分类`} disabled={!editable} maxLength={80} onChange={(event) => updatePoint(index, "category", event.target.value)} value={category} />
              <input aria-label={`第 ${index + 1} 条数值`} disabled={!editable} inputMode="decimal" onChange={(event) => updatePoint(index, "value", event.target.value)} type="number" value={draft.values[index]} />
              <button aria-label={`删除第 ${index + 1} 条数据`} className="inspector-remove-point" disabled={!editable || draft.categories.length <= 2} onClick={() => removePoint(index)} type="button">×</button>
            </div>
          ))}
        </div>
        <button className="secondary-button inspector-add-point" disabled={!editable || draft.categories.length >= MAX_POINTS} onClick={addPoint} type="button">＋ 添加数据</button>
        {!validation.ok ? <p className="inspector-validation-error" role="alert">{validation.message}</p> : null}
      </section>

      <div className="inspector-note"><strong>实时数据绑定</strong><p>当前先配置组件静态数据。REST 轮询和 WebSocket 将通过数据绑定 ID 接入，不会把持续变化的数据写进画布配置。</p></div>
    </aside>
  );
}

const toShapeDraft = (props: ShapeProps): ShapeDraft => ({
  fillColor: props.fillColor,
  borderColor: props.borderColor,
  borderWidth: String(props.borderWidth),
  borderRadius: String(props.borderRadius),
  opacity: String(props.opacity),
});

const parseDraftNumber = (value: string) => value.trim() === "" ? Number.NaN : Number(value);

const validateShapeDraft = (draft: ShapeDraft): ShapeDraftResult => {
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.fillColor) || !/^#[0-9a-fA-F]{6}$/.test(draft.borderColor)) {
    return { ok: false, message: "填充色和边框色必须是有效的六位十六进制颜色。" };
  }
  const borderWidth = parseDraftNumber(draft.borderWidth);
  const borderRadius = parseDraftNumber(draft.borderRadius);
  const opacity = parseDraftNumber(draft.opacity);
  if (!Number.isFinite(borderWidth) || borderWidth < 0 || borderWidth > 20) {
    return { ok: false, message: "边框宽度必须在 0–20 之间。" };
  }
  if (!Number.isFinite(borderRadius) || borderRadius < 0 || borderRadius > 200) {
    return { ok: false, message: "圆角必须在 0–200 之间。" };
  }
  if (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 1) {
    return { ok: false, message: "透明度必须在 0.05–1 之间。" };
  }
  return {
    ok: true,
    props: { fillColor: draft.fillColor, borderColor: draft.borderColor, borderWidth, borderRadius, opacity },
  };
};

function ValidShapeInspector({ editable, node, props, onNodeChange, onValidationChange }: ComponentInspectorProps & { node: CanvasNode; props: ShapeProps }) {
  const [draft, setDraft] = useState<ShapeDraft>(() => toShapeDraft(props));
  const propsSignature = JSON.stringify(props);

  useEffect(() => {
    setDraft(toShapeDraft(props));
  }, [node.id, propsSignature]);

  const validation = useMemo(() => validateShapeDraft(draft), [draft]);

  useEffect(() => {
    onValidationChange(validation.ok ? null : validation.message);
  }, [onValidationChange, validation]);

  const changeDraft = (nextDraft: ShapeDraft) => {
    setDraft(nextDraft);
    const result = validateShapeDraft(nextDraft);
    if (result.ok) onNodeChange({ ...node, props: result.props });
  };

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">Properties</span>
        <h2>{componentLabels[node.type]}</h2>
        <p>组件 ID：{node.id.slice(0, 8)}</p>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>外观配置</strong><span>{Math.round(node.width)} × {Math.round(node.height)}</span></div>
        <div className="inspector-shape-colors">
          <label><span>填充颜色</span><input aria-label="填充颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, fillColor: event.target.value })} type="color" value={draft.fillColor} /></label>
          <label><span>边框颜色</span><input aria-label="边框颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, borderColor: event.target.value })} type="color" value={draft.borderColor} /></label>
        </div>
        <div className="inspector-number-grid">
          <label><span>边框宽度</span><input disabled={!editable} max={20} min={0} onChange={(event) => changeDraft({ ...draft, borderWidth: event.target.value })} step={1} type="number" value={draft.borderWidth} /></label>
          {node.type === "rectangle" ? <label><span>圆角</span><input disabled={!editable} max={200} min={0} onChange={(event) => changeDraft({ ...draft, borderRadius: event.target.value })} step={1} type="number" value={draft.borderRadius} /></label> : null}
          <label><span>透明度</span><input disabled={!editable} max={1} min={0.05} onChange={(event) => changeDraft({ ...draft, opacity: event.target.value })} step={0.05} type="number" value={draft.opacity} /></label>
        </div>
        {!validation.ok ? <p className="inspector-validation-error" role="alert">{validation.message}</p> : null}
      </section>

      <div className="inspector-note"><strong>{node.type === "circle" ? "等比缩放" : "图形组件"}</strong><p>{node.type === "circle" ? "圆形缩放时固定 1:1 宽高比，不会被拉伸成椭圆。" : "矩形可自由调整宽高；圆角、边框和透明度只保存在轻量节点配置中。"}</p></div>
    </aside>
  );
}

const toDecorationDraft = (props: DecorationProps): DecorationDraft => ({
  ...props,
  opacity: String(props.opacity),
});

const validateDecorationDraft = (
  type: DecorationNodeType,
  draft: DecorationDraft,
): DecorationDraftResult => {
  const opacity = parseDraftNumber(draft.opacity);
  const parsed = parseDecorationProps(type, { ...draft, opacity });
  return parsed.ok
    ? { ok: true, props: parsed.value }
    : { ok: false, message: `${parsed.message}。` };
};

function ValidDecorationInspector({
  editable,
  node,
  props,
  onNodeChange,
  onValidationChange,
}: ComponentInspectorProps & { node: CanvasNode; props: DecorationProps }) {
  if (!isDecorationNodeType(node.type)) {
    throw new Error(`ValidDecorationInspector received unsupported node type: ${node.type}`);
  }

  const [draft, setDraft] = useState<DecorationDraft>(() => toDecorationDraft(props));
  const propsSignature = JSON.stringify(props);
  const nodeType = node.type;

  useEffect(() => {
    setDraft(toDecorationDraft(props));
  }, [node.id, propsSignature]);

  const validation = useMemo(
    () => validateDecorationDraft(nodeType, draft),
    [draft, nodeType],
  );

  useEffect(() => {
    onValidationChange(validation.ok ? null : validation.message);
  }, [onValidationChange, validation]);

  const changeDraft = (nextDraft: DecorationDraft) => {
    setDraft(nextDraft);
    const result = validateDecorationDraft(nodeType, nextDraft);
    if (result.ok) onNodeChange({ ...node, props: result.props });
  };

  const showsText =
    nodeType === "screen-title" ||
    nodeType === "datetime" ||
    nodeType === "section-title" ||
    nodeType === "icon-background";
  const showsAlign =
    nodeType === "screen-title" ||
    nodeType === "datetime" ||
    nodeType === "section-title";

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">Properties</span>
        <h2>{componentLabels[nodeType]}</h2>
        <p>组件 ID：{node.id.slice(0, 8)}</p>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title">
          <strong>内容与布局</strong>
          <span>{Math.round(node.width)} × {Math.round(node.height)}</span>
        </div>
        {showsText ? (
          <label>
            <span>{nodeType === "icon-background" ? "图标文字" : nodeType === "datetime" ? "提示文字" : "标题文字"}</span>
            <input
              disabled={!editable}
              maxLength={nodeType === "icon-background" ? 4 : 120}
              onChange={(event) => changeDraft({ ...draft, text: event.target.value })}
              value={draft.text}
            />
          </label>
        ) : null}
        {nodeType === "screen-title" ? (
          <label>
            <span>英文副标题</span>
            <input
              disabled={!editable}
              maxLength={160}
              onChange={(event) => changeDraft({ ...draft, subtitle: event.target.value })}
              value={draft.subtitle}
            />
          </label>
        ) : null}
        {showsAlign ? (
          <label>
            <span>内容对齐</span>
            <select
              disabled={!editable}
              onChange={(event) => changeDraft({
                ...draft,
                align: event.target.value as DecorationProps["align"],
              })}
              value={draft.align}
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
              <option value="right">右对齐</option>
            </select>
          </label>
        ) : null}
        {nodeType === "datetime" ? (
          <div className="inspector-checkbox-grid">
            <label>
              <input
                checked={draft.showDate}
                disabled={!editable}
                onChange={(event) => changeDraft({ ...draft, showDate: event.target.checked })}
                type="checkbox"
              />
              <span>显示日期</span>
            </label>
            <label>
              <input
                checked={draft.showSeconds}
                disabled={!editable}
                onChange={(event) => changeDraft({ ...draft, showSeconds: event.target.checked })}
                type="checkbox"
              />
              <span>显示秒数</span>
            </label>
          </div>
        ) : null}
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>外观配置</strong><span>轻量样式</span></div>
        <div className="inspector-decoration-colors">
          {showsText ? (
            <label><span>文字颜色</span><input aria-label="文字颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, textColor: event.target.value })} type="color" value={draft.textColor} /></label>
          ) : null}
          <label><span>点缀颜色</span><input aria-label="点缀颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, accentColor: event.target.value })} type="color" value={draft.accentColor} /></label>
          <label><span>背景颜色</span><input aria-label="背景颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, fillColor: event.target.value })} type="color" value={draft.fillColor} /></label>
          <label><span>边框颜色</span><input aria-label="边框颜色" className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ ...draft, borderColor: event.target.value })} type="color" value={draft.borderColor} /></label>
        </div>
        <label>
          <span>整体透明度</span>
          <input disabled={!editable} max={1} min={0.05} onChange={(event) => changeDraft({ ...draft, opacity: event.target.value })} step={0.05} type="number" value={draft.opacity} />
        </label>
        {!validation.ok ? <p className="inspector-validation-error" role="alert">{validation.message}</p> : null}
      </section>

      <div className="inspector-note">
        <strong>{nodeType === "datetime" ? "共享时钟" : "自适应点缀"}</strong>
        <p>{nodeType === "datetime" ? "同一画布上的时间组件共享一个计时器，避免组件增多时重复刷新。" : "文字按组件容器重新排版，缩放时不会用 transform 拉伸字体。"}</p>
      </div>
    </aside>
  );
}

export function ComponentInspector({
  editable,
  node,
  onNodeChange,
  onValidationChange,
  modelScene,
  onModelSceneNodeSelect,
  projectId,
  selectedModelSceneNodePath,
}: ComponentInspectorProps & {
  projectId: string;
  selectedModelSceneNodePath?: string | null;
}) {
  useEffect(() => {
    if (!node) onValidationChange(null);
  }, [node, onValidationChange]);

  if (!node) {
    return <aside className="component-inspector is-empty"><div><span>⌖</span><strong>选择一个组件</strong><p>选中画布中的组件后，可在这里修改数据或外观。</p></div></aside>;
  }

  if (isShapeNodeType(node.type)) {
    const parsed = parseShapeProps(node.props);
    if (!parsed.ok) {
      return <InvalidComponentInspector message={parsed.message} onValidationChange={onValidationChange} />;
    }
    return <ValidShapeInspector editable={editable} node={node} onNodeChange={onNodeChange} onValidationChange={onValidationChange} props={parsed.value} />;
  }

  if (isDecorationNodeType(node.type)) {
    const parsed = parseDecorationProps(node.type, node.props);
    if (!parsed.ok) {
      return <InvalidComponentInspector message={parsed.message} onValidationChange={onValidationChange} />;
    }
    return <ValidDecorationInspector editable={editable} node={node} onNodeChange={onNodeChange} onValidationChange={onValidationChange} props={parsed.value} />;
  }

  if (isModel3DNodeType(node.type)) {
    return (
      <Model3DInspector
        editable={editable}
        modelScene={modelScene ?? null}
        node={node}
        onNodeChange={onNodeChange}
        onSceneNodeSelect={onModelSceneNodeSelect ?? (() => undefined)}
        onValidationChange={onValidationChange}
        projectId={projectId}
        selectedSceneNodePath={selectedModelSceneNodePath ?? null}
      />
    );
  }

  const parsed = parseChartProps(node.props);
  if (!parsed.ok) {
    return <InvalidComponentInspector message={parsed.message} onValidationChange={onValidationChange} />;
  }

  return <ValidChartInspector editable={editable} node={node} onNodeChange={onNodeChange} onValidationChange={onValidationChange} props={parsed.value} />;
}

function InvalidComponentInspector({ message, onValidationChange }: { message: string; onValidationChange: (message: string | null) => void }) {
  useEffect(() => {
    onValidationChange(message);
  }, [message, onValidationChange]);

  return <aside className="component-inspector is-empty"><div className="inspector-invalid"><strong>组件配置无法编辑</strong><p>{message}</p></div></aside>;
}
