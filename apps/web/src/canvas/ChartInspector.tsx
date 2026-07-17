import { useEffect, useMemo, useState } from "react";
import { componentLabels, parseChartProps, type CanvasNode, type ChartProps } from "./types";

type ChartInspectorProps = {
  editable: boolean;
  node: CanvasNode | null;
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

function ValidChartInspector({ editable, node, props, onNodeChange, onValidationChange }: ChartInspectorProps & { node: CanvasNode; props: ChartProps }) {
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

export function ChartInspector({ editable, node, onNodeChange, onValidationChange }: ChartInspectorProps) {
  useEffect(() => {
    if (!node) onValidationChange(null);
  }, [node, onValidationChange]);

  if (!node) {
    return <aside className="component-inspector is-empty"><div><span>⌖</span><strong>选择一个组件</strong><p>选中画布中的图表后，可在这里修改标题、颜色和数据。</p></div></aside>;
  }

  const parsed = parseChartProps(node.props);
  if (!parsed.ok) {
    return <InvalidChartInspector message={parsed.message} onValidationChange={onValidationChange} />;
  }

  return <ValidChartInspector editable={editable} node={node} onNodeChange={onNodeChange} onValidationChange={onValidationChange} props={parsed.value} />;
}

function InvalidChartInspector({ message, onValidationChange }: { message: string; onValidationChange: (message: string | null) => void }) {
  useEffect(() => {
    onValidationChange(message);
  }, [message, onValidationChange]);

  return <aside className="component-inspector is-empty"><div className="inspector-invalid"><strong>组件配置无法编辑</strong><p>{message}</p></div></aside>;
}
