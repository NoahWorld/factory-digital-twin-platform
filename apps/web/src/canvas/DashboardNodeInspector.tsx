import { useEffect, useMemo, useState } from "react";
import {
  componentLabels,
  isDashboardNodeType,
  parseDashboardProps,
  type CanvasNode,
  type DashboardNodeType,
} from "./types";

type DashboardNodeInspectorProps = {
  editable: boolean;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onValidationChange: (message: string | null) => void;
};

const cloneProps = (props: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(props)) as Record<string, unknown>;

const inputValue = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? value : "";

export function DashboardNodeInspector({
  editable,
  node,
  onNodeChange,
  onValidationChange,
}: DashboardNodeInspectorProps) {
  if (!isDashboardNodeType(node.type)) {
    throw new Error(`DashboardNodeInspector received unsupported node type: ${node.type}`);
  }
  const nodeType: DashboardNodeType = node.type;
  const [draft, setDraft] = useState<Record<string, unknown>>(() => cloneProps(node.props));
  const propsSignature = JSON.stringify(node.props);
  const validation = useMemo(
    () => parseDashboardProps(nodeType, draft),
    [draft, nodeType],
  );

  useEffect(() => {
    setDraft(cloneProps(node.props));
  }, [node.id, propsSignature]);

  useEffect(() => {
    onValidationChange(validation.ok ? null : validation.message);
    return () => onValidationChange(null);
  }, [onValidationChange, validation]);

  const changeDraft = (nextDraft: Record<string, unknown>) => {
    setDraft(nextDraft);
    const result = parseDashboardProps(nodeType, nextDraft);
    if (result.ok) onNodeChange({ ...node, props: result.value });
  };

  const setField = (field: string, value: unknown) => {
    changeDraft({ ...draft, [field]: value });
  };

  const updateItem = (index: number, field: string, value: unknown) => {
    const items = Array.isArray(draft.items)
      ? draft.items.map((item) => ({ ...(item as Record<string, unknown>) }))
      : [];
    items[index] = { ...items[index], [field]: value };
    changeDraft({ ...draft, items });
  };

  const removeItem = (index: number) => {
    const items = Array.isArray(draft.items)
      ? draft.items.filter((_, itemIndex) => itemIndex !== index)
      : [];
    changeDraft({ ...draft, items });
  };

  const addItem = () => {
    const items = Array.isArray(draft.items) ? [...draft.items] : [];
    if (nodeType === "progress-list" && items.length < 12) {
      changeDraft({
        ...draft,
        items: [...items, { label: `进度项 ${items.length + 1}`, value: 0, maximum: 100, unit: "%" }],
      });
    } else if (nodeType === "status-grid" && items.length < 24) {
      changeDraft({
        ...draft,
        items: [...items, { label: `状态项 ${items.length + 1}`, value: "待绑定", tone: "offline" }],
      });
    }
  };

  const items = Array.isArray(draft.items) ? draft.items as Array<Record<string, unknown>> : [];

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">Properties</span>
        <h2>{componentLabels[nodeType]}</h2>
        <p>{Math.round(node.width)} × {Math.round(node.height)}</p>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>内容配置</strong><span>公共组件</span></div>
        <label>
          <span>标题</span>
          <input disabled={!editable} maxLength={120} onChange={(event) => setField("title", event.target.value)} value={inputValue(draft.title)} />
        </label>

        {nodeType === "metric-card" ? (
          <>
            <div className="inspector-inline-fields">
              <label><span>指标值</span><input disabled={!editable} maxLength={40} onChange={(event) => setField("value", event.target.value)} value={inputValue(draft.value)} /></label>
              <label><span>单位</span><input disabled={!editable} maxLength={24} onChange={(event) => setField("unit", event.target.value)} value={inputValue(draft.unit)} /></label>
            </div>
            <label><span>副标题</span><input disabled={!editable} maxLength={120} onChange={(event) => setField("subtitle", event.target.value)} value={inputValue(draft.subtitle)} /></label>
            <label><span>图标文字</span><input disabled={!editable} maxLength={4} onChange={(event) => setField("icon", event.target.value)} value={inputValue(draft.icon)} /></label>
          </>
        ) : null}

        {nodeType === "radial-gauge" ? (
          <>
            <div className="inspector-inline-fields">
              <label><span>当前值</span><input disabled={!editable} min={0} onChange={(event) => setField("value", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(draft.value)} /></label>
              <label><span>最大值</span><input disabled={!editable} min={0.000001} onChange={(event) => setField("maximum", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(draft.maximum)} /></label>
            </div>
            <div className="inspector-inline-fields">
              <label><span>单位</span><input disabled={!editable} maxLength={24} onChange={(event) => setField("unit", event.target.value)} value={inputValue(draft.unit)} /></label>
              <label><span>副标题</span><input disabled={!editable} maxLength={120} onChange={(event) => setField("subtitle", event.target.value)} value={inputValue(draft.subtitle)} /></label>
            </div>
          </>
        ) : null}

        {nodeType === "status-grid" ? (
          <label>
            <span>列数</span>
            <input disabled={!editable} max={6} min={1} onChange={(event) => setField("columns", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(draft.columns)} />
          </label>
        ) : null}

        <label className="inspector-check-row">
          <input checked={draft.sample === true} disabled={!editable} onChange={(event) => setField("sample", event.target.checked)} type="checkbox" />
          <span>标记为示例数据</span>
        </label>
      </section>

      {(nodeType === "progress-list" || nodeType === "status-grid") ? (
        <section className="inspector-section inspector-data-section">
          <div className="inspector-section-title">
            <strong>{nodeType === "progress-list" ? "进度数据" : "状态数据"}</strong>
            <span>{items.length}/{nodeType === "progress-list" ? 12 : 24}</span>
          </div>
          <div className="dashboard-inspector-items">
            {items.map((item, index) => (
              <div className="dashboard-inspector-item" key={index}>
                <div>
                  <input aria-label={`第 ${index + 1} 项名称`} disabled={!editable} maxLength={80} onChange={(event) => updateItem(index, "label", event.target.value)} value={inputValue(item.label)} />
                  {nodeType === "progress-list" ? (
                    <>
                      <input aria-label={`第 ${index + 1} 项当前值`} disabled={!editable} min={0} onChange={(event) => updateItem(index, "value", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(item.value)} />
                      <input aria-label={`第 ${index + 1} 项最大值`} disabled={!editable} min={0.000001} onChange={(event) => updateItem(index, "maximum", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(item.maximum)} />
                      <input aria-label={`第 ${index + 1} 项单位`} disabled={!editable} maxLength={24} onChange={(event) => updateItem(index, "unit", event.target.value)} value={inputValue(item.unit)} />
                    </>
                  ) : (
                    <>
                      <input aria-label={`第 ${index + 1} 项状态值`} disabled={!editable} maxLength={80} onChange={(event) => updateItem(index, "value", event.target.value)} value={inputValue(item.value)} />
                      <select aria-label={`第 ${index + 1} 项状态等级`} disabled={!editable} onChange={(event) => updateItem(index, "tone", event.target.value)} value={inputValue(item.tone)}>
                        <option value="normal">正常</option>
                        <option value="warning">预警</option>
                        <option value="danger">故障</option>
                        <option value="offline">离线</option>
                      </select>
                    </>
                  )}
                </div>
                <button aria-label={`删除第 ${index + 1} 项`} className="inspector-remove-point" disabled={!editable || items.length <= 1} onClick={() => removeItem(index)} type="button">×</button>
              </div>
            ))}
          </div>
          <button className="secondary-button inspector-add-point" disabled={!editable || items.length >= (nodeType === "progress-list" ? 12 : 24)} onClick={addItem} type="button">＋ 添加一项</button>
        </section>
      ) : null}

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>外观配置</strong><span>主题样式</span></div>
        <div className="inspector-decoration-colors">
          <label><span>文字颜色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => setField("textColor", event.target.value)} type="color" value={String(draft.textColor)} /></label>
          <label><span>强调色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => setField("accentColor", event.target.value)} type="color" value={String(draft.accentColor)} /></label>
          <label><span>背景颜色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => setField("fillColor", event.target.value)} type="color" value={String(draft.fillColor)} /></label>
          <label><span>边框颜色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => setField("borderColor", event.target.value)} type="color" value={String(draft.borderColor)} /></label>
        </div>
        {!validation.ok ? <p className="inspector-validation-error" role="alert">{validation.message}</p> : null}
      </section>

      <div className="inspector-note">
        <strong>数据边界</strong>
        <p>模板只提供明确标识的示例值。接入实时数据后取消“示例数据”标记，并通过数据绑定 ID 关联标准指标。</p>
      </div>
    </aside>
  );
}
