import { useEffect } from "react";
import { componentLabels, parseAssetDetailProps, type AssetDetailProps, type CanvasNode } from "./types";

export function AssetDetailInspector({
  editable,
  node,
  onNodeChange,
  onValidationChange,
}: {
  editable: boolean;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onValidationChange: (message: string | null) => void;
}) {
  const parsed = parseAssetDetailProps(node.props);
  const validationMessage = parsed.ok ? null : parsed.message;

  useEffect(() => {
    onValidationChange(validationMessage);
    return () => onValidationChange(null);
  }, [onValidationChange, validationMessage]);

  if (!parsed.ok) {
    return <aside className="component-inspector is-empty"><div className="inspector-invalid"><strong>设备数据配置无效</strong><p>{parsed.message}</p></div></aside>;
  }

  const update = <K extends keyof AssetDetailProps>(key: K, value: AssetDetailProps[K]) => {
    onNodeChange({ ...node, props: { ...parsed.value, [key]: value } });
  };

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">RUNTIME ASSET DATA</span>
        <h2>{componentLabels[node.type]}</h2>
        <p>组件 ID：{node.id.slice(0, 8)}</p>
      </header>
      <section className="inspector-section">
        <div className="inspector-section-title"><strong>内容</strong><span>运行态</span></div>
        <label><span>标题</span><input disabled={!editable} maxLength={120} onChange={(event) => update("title", event.target.value)} value={parsed.value.title} /></label>
        <label><span>未选中提示</span><textarea disabled={!editable} maxLength={200} onChange={(event) => update("emptyText", event.target.value)} rows={3} value={parsed.value.emptyText} /></label>
        <label><span>最多显示指标</span><input disabled={!editable} max={12} min={1} onChange={(event) => update("maximumMetrics", Number(event.target.value))} type="number" value={parsed.value.maximumMetrics} /></label>
        <label className="inspector-check-row"><input checked={parsed.value.showMetadata} disabled={!editable} onChange={(event) => update("showMetadata", event.target.checked)} type="checkbox" /><span>显示资产 ID、类型和更新时间</span></label>
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title"><strong>外观</strong><span>面板配色</span></div>
        <div className="inspector-decoration-colors">
          {([
            ["textColor", "文字"],
            ["accentColor", "强调"],
            ["fillColor", "背景"],
            ["borderColor", "边框"],
          ] as const).map(([key, label]) => (
            <label key={key}><span>{label}</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => update(key, event.target.value)} type="color" value={parsed.value[key]} /></label>
          ))}
        </div>
      </section>
      <section className="inspector-section">
        <p className="inspector-help">该组件自动订阅同一看板中最近一次点击的 3D 设备，无需为每台设备复制面板。</p>
      </section>
    </aside>
  );
}
