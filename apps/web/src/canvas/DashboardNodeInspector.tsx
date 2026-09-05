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

const itemLimits: Partial<Record<DashboardNodeType, number>> = {
  "progress-list": 12,
  "status-grid": 24,
  "ranking-list": 12,
  "alarm-list": 20,
  "event-timeline": 20,
};

const itemSectionLabels: Partial<Record<DashboardNodeType, string>> = {
  "progress-list": "进度数据",
  "status-grid": "状态数据",
  "ranking-list": "排名数据",
  "alarm-list": "告警记录",
  "event-timeline": "事件记录",
};

const ToneSelect = ({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string | number;
}) => (
  <select aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
    <option value="normal">正常</option>
    <option value="warning">预警</option>
    <option value="danger">严重</option>
    <option value="offline">失联</option>
  </select>
);

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
  const validation = useMemo(() => parseDashboardProps(nodeType, draft), [draft, nodeType]);

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

  const setField = (field: string, value: unknown) => changeDraft({ ...draft, [field]: value });

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
    const limit = itemLimits[nodeType];
    if (!limit || items.length >= limit) return;

    const newItem = nodeType === "progress-list"
      ? { label: `进度项 ${items.length + 1}`, value: 0, maximum: 100, unit: "%" }
      : nodeType === "status-grid"
        ? { label: `设备 ${items.length + 1}`, value: "待绑定", tone: "offline" }
        : nodeType === "ranking-list"
          ? { label: `排名项 ${items.length + 1}`, value: 0, unit: "件", trend: "flat" }
          : nodeType === "alarm-list"
            ? { time: "00:00:00", source: `设备 ${items.length + 1}`, message: "待填写告警内容", tone: "warning" }
            : { time: "00:00", title: `事件 ${items.length + 1}`, detail: "待填写事件详情", tone: "normal" };
    changeDraft({ ...draft, items: [...items, newItem] });
  };

  const columns = Array.isArray(draft.columns) ? draft.columns as unknown[] : [];
  const rows = Array.isArray(draft.rows) ? draft.rows as unknown[][] : [];
  const updateColumn = (index: number, value: string) => {
    const nextColumns = [...columns];
    nextColumns[index] = value;
    changeDraft({ ...draft, columns: nextColumns });
  };
  const addColumn = () => {
    if (columns.length >= 8) return;
    changeDraft({
      ...draft,
      columns: [...columns, `列 ${columns.length + 1}`],
      rows: rows.map((row) => [...row, "—"]),
    });
  };
  const removeColumn = (index: number) => {
    if (columns.length <= 2) return;
    const highlightColumn = typeof draft.highlightColumn === "number" ? draft.highlightColumn : -1;
    changeDraft({
      ...draft,
      columns: columns.filter((_, columnIndex) => columnIndex !== index),
      rows: rows.map((row) => row.filter((_, columnIndex) => columnIndex !== index)),
      highlightColumn: highlightColumn === index ? -1 : highlightColumn > index ? highlightColumn - 1 : highlightColumn,
    });
  };
  const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
    const nextRows = rows.map((row) => [...row]);
    nextRows[rowIndex][columnIndex] = value;
    changeDraft({ ...draft, rows: nextRows });
  };
  const addRow = () => {
    if (rows.length >= 20) return;
    changeDraft({ ...draft, rows: [...rows, columns.map(() => "—")] });
  };
  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    changeDraft({ ...draft, rows: rows.filter((_, rowIndex) => rowIndex !== index) });
  };

  const items = Array.isArray(draft.items) ? draft.items as Array<Record<string, unknown>> : [];
  const itemLimit = itemLimits[nodeType] ?? 0;

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">Properties</span>
        <h2>{componentLabels[nodeType]}</h2>
        <p>{Math.round(node.width)} × {Math.round(node.height)}</p>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>内容配置</strong><span>公共组件</span></div>
        <label><span>标题</span><input disabled={!editable} maxLength={120} onChange={(event) => setField("title", event.target.value)} value={inputValue(draft.title)} /></label>

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
          <label><span>列数</span><input disabled={!editable} max={6} min={1} onChange={(event) => setField("columns", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(draft.columns)} /></label>
        ) : null}

        <label className="inspector-check-row">
          <input checked={draft.sample === true} disabled={!editable} onChange={(event) => setField("sample", event.target.checked)} type="checkbox" />
          <span>标记为示例数据</span>
        </label>
      </section>

      {itemLimit > 0 ? (
        <section className="inspector-section inspector-data-section">
          <div className="inspector-section-title"><strong>{itemSectionLabels[nodeType]}</strong><span>{items.length}/{itemLimit}</span></div>
          <div className="dashboard-inspector-items">
            {items.map((item, index) => (
              <div className={`dashboard-inspector-item is-${nodeType}`} key={index}>
                <div>
                  {nodeType === "progress-list" ? (
                    <>
                      <input aria-label={`第 ${index + 1} 项名称`} disabled={!editable} maxLength={80} onChange={(event) => updateItem(index, "label", event.target.value)} value={inputValue(item.label)} />
                      <input aria-label={`第 ${index + 1} 项当前值`} disabled={!editable} min={0} onChange={(event) => updateItem(index, "value", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(item.value)} />
                      <input aria-label={`第 ${index + 1} 项最大值`} disabled={!editable} min={0.000001} onChange={(event) => updateItem(index, "maximum", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(item.maximum)} />
                      <input aria-label={`第 ${index + 1} 项单位`} disabled={!editable} maxLength={24} onChange={(event) => updateItem(index, "unit", event.target.value)} value={inputValue(item.unit)} />
                    </>
                  ) : nodeType === "status-grid" ? (
                    <>
                      <input aria-label={`第 ${index + 1} 项名称`} disabled={!editable} maxLength={80} onChange={(event) => updateItem(index, "label", event.target.value)} value={inputValue(item.label)} />
                      <input aria-label={`第 ${index + 1} 项状态值`} disabled={!editable} maxLength={80} onChange={(event) => updateItem(index, "value", event.target.value)} value={inputValue(item.value)} />
                      <ToneSelect disabled={!editable} label={`第 ${index + 1} 项状态等级`} onChange={(value) => updateItem(index, "tone", value)} value={inputValue(item.tone)} />
                    </>
                  ) : nodeType === "ranking-list" ? (
                    <>
                      <input aria-label={`第 ${index + 1} 项名称`} disabled={!editable} maxLength={80} onChange={(event) => updateItem(index, "label", event.target.value)} value={inputValue(item.label)} />
                      <input aria-label={`第 ${index + 1} 项数值`} disabled={!editable} min={0} onChange={(event) => updateItem(index, "value", event.target.value === "" ? "" : Number(event.target.value))} type="number" value={inputValue(item.value)} />
                      <input aria-label={`第 ${index + 1} 项单位`} disabled={!editable} maxLength={24} onChange={(event) => updateItem(index, "unit", event.target.value)} value={inputValue(item.unit)} />
                      <select aria-label={`第 ${index + 1} 项趋势`} disabled={!editable} onChange={(event) => updateItem(index, "trend", event.target.value)} value={inputValue(item.trend)}><option value="up">上升</option><option value="flat">持平</option><option value="down">下降</option></select>
                    </>
                  ) : nodeType === "alarm-list" ? (
                    <>
                      <input aria-label={`第 ${index + 1} 条时间`} disabled={!editable} maxLength={32} onChange={(event) => updateItem(index, "time", event.target.value)} value={inputValue(item.time)} />
                      <input aria-label={`第 ${index + 1} 条来源`} disabled={!editable} maxLength={80} onChange={(event) => updateItem(index, "source", event.target.value)} value={inputValue(item.source)} />
                      <input aria-label={`第 ${index + 1} 条内容`} disabled={!editable} maxLength={240} onChange={(event) => updateItem(index, "message", event.target.value)} value={inputValue(item.message)} />
                      <ToneSelect disabled={!editable} label={`第 ${index + 1} 条等级`} onChange={(value) => updateItem(index, "tone", value)} value={inputValue(item.tone)} />
                    </>
                  ) : (
                    <>
                      <input aria-label={`第 ${index + 1} 条时间`} disabled={!editable} maxLength={32} onChange={(event) => updateItem(index, "time", event.target.value)} value={inputValue(item.time)} />
                      <input aria-label={`第 ${index + 1} 条标题`} disabled={!editable} maxLength={120} onChange={(event) => updateItem(index, "title", event.target.value)} value={inputValue(item.title)} />
                      <input aria-label={`第 ${index + 1} 条详情`} disabled={!editable} maxLength={240} onChange={(event) => updateItem(index, "detail", event.target.value)} value={inputValue(item.detail)} />
                      <ToneSelect disabled={!editable} label={`第 ${index + 1} 条等级`} onChange={(value) => updateItem(index, "tone", value)} value={inputValue(item.tone)} />
                    </>
                  )}
                </div>
                <button aria-label={`删除第 ${index + 1} 项`} className="inspector-remove-point" disabled={!editable || items.length <= 1} onClick={() => removeItem(index)} type="button">×</button>
              </div>
            ))}
          </div>
          <button className="secondary-button inspector-add-point" disabled={!editable || items.length >= itemLimit} onClick={addItem} type="button">＋ 添加一项</button>
        </section>
      ) : null}

      {nodeType === "data-table" ? (
        <section className="inspector-section inspector-data-section">
          <div className="inspector-section-title"><strong>表格列</strong><span>{columns.length}/8</span></div>
          <div className="dashboard-table-column-editor">
            {columns.map((column, index) => (
              <div key={index}>
                <input aria-label={`第 ${index + 1} 列名称`} disabled={!editable} maxLength={80} onChange={(event) => updateColumn(index, event.target.value)} value={inputValue(column)} />
                <button aria-label={`删除第 ${index + 1} 列`} className="inspector-remove-point" disabled={!editable || columns.length <= 2} onClick={() => removeColumn(index)} type="button">×</button>
              </div>
            ))}
          </div>
          <button className="secondary-button inspector-add-point" disabled={!editable || columns.length >= 8} onClick={addColumn} type="button">＋ 添加一列</button>
          <label><span>强调列</span><select disabled={!editable} onChange={(event) => setField("highlightColumn", Number(event.target.value))} value={inputValue(draft.highlightColumn)}><option value={-1}>不强调</option>{columns.map((column, index) => <option key={index} value={index}>{inputValue(column)}</option>)}</select></label>

          <div className="inspector-section-title dashboard-table-rows-title"><strong>表格行</strong><span>{rows.length}/20</span></div>
          <div className="dashboard-table-row-editor">
            {rows.map((row, rowIndex) => (
              <div key={rowIndex}>
                <span>{String(rowIndex + 1).padStart(2, "0")}</span>
                <div>{columns.map((_, columnIndex) => <input aria-label={`第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`} disabled={!editable} key={columnIndex} maxLength={120} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} value={inputValue(row[columnIndex])} />)}</div>
                <button aria-label={`删除第 ${rowIndex + 1} 行`} className="inspector-remove-point" disabled={!editable || rows.length <= 1} onClick={() => removeRow(rowIndex)} type="button">×</button>
              </div>
            ))}
          </div>
          <button className="secondary-button inspector-add-point" disabled={!editable || rows.length >= 20} onClick={addRow} type="button">＋ 添加一行</button>
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

      <div className="inspector-note"><strong>数据边界</strong><p>模板只提供明确标识的示例值。接入实时数据后取消“示例数据”标记，并通过数据绑定 ID 关联标准指标。</p></div>
    </aside>
  );
}
