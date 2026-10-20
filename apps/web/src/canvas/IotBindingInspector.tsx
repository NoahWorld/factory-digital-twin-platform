import { useEffect, useState } from "react";
import { Select } from "../components/Select";
import { buildIotPointManifest, isIotBindableNodeType, parseIotBinding, type IotValueType } from "../../../../shared/iot-embed";
import type { CanvasDocument, CanvasNode } from "./types";

export function IotBindingInspector({ node, document, editable, onNodeChange, onValidationChange }: {
  node: CanvasNode; document?: CanvasDocument | null; editable: boolean; onNodeChange: (node: CanvasNode) => void; onValidationChange: (error: string | null) => void;
}) {
  const [enabled, setEnabled] = useState(node.iotBinding !== undefined);
  const [key, setKey] = useState(node.iotBinding?.pointKey ?? "");
  const [valueType, setValueType] = useState<IotValueType>(node.iotBinding?.valueType ?? "number");
  const [stale, setStale] = useState(String(node.iotBinding?.staleAfterSeconds ?? 60));
  const signature = JSON.stringify(node.iotBinding);
  useEffect(() => {
    setEnabled(node.iotBinding !== undefined);
    setKey(node.iotBinding?.pointKey ?? "");
    setValueType(node.iotBinding?.valueType ?? "number");
    setStale(String(node.iotBinding?.staleAfterSeconds ?? 60));
  }, [node.id, signature]);
  const draft = { pointKey: key, valueType, staleAfterSeconds: stale.trim() ? Number(stale) : Number.NaN };
  const parsed = enabled ? parseIotBinding(draft, node.type) : null;
  const manifest = buildIotPointManifest((document?.nodes ?? [node]).map((item) => item.id === node.id ? { ...item, iotBinding: enabled ? draft : undefined } : item));
  const error = parsed && !parsed.ok ? parsed.message : !manifest.ok ? manifest.message : null;
  useEffect(() => { onValidationChange(error); return () => onValidationChange(null); }, [error, onValidationChange]);
  const change = (next: typeof draft) => {
    const result = parseIotBinding(next, node.type);
    if (result.ok) onNodeChange({ ...node, iotBinding: result.value });
  };
  if (!isIotBindableNodeType(node.type) && node.iotBinding === undefined) return null;
  return (
    <section className="inspector-section canvas-interaction-inspector iot-binding-inspector">
      <div className="inspector-section-title"><strong>外部 IoT 点位</strong><span>2D 预览</span></div>
      <label className="inspector-check-row"><input type="checkbox" checked={enabled} disabled={!editable} onChange={(event) => {
        const checked = event.target.checked;
        setEnabled(checked);
        if (checked) change(draft);
        else { const { iotBinding: _binding, ...rest } = node; onNodeChange(rest); }
      }} /><span>使用 IoT 实时数据</span></label>
      {enabled ? <>
        <label className="iot-binding-field"><span>画面点位名称</span><input value={key} maxLength={200} disabled={!editable} placeholder="例如 inletTemperature" onChange={(event) => { setKey(event.target.value); change({ ...draft, pointKey: event.target.value }); }} /></label>
        <p className="inspector-help">填写画面变量名，不需要设备 ID。IoT 平台负责把它映射到设备属性；多个组件可共用同一名称。</p>
        <label className="iot-binding-field"><span>数据类型</span><Select value={valueType} disabled={!editable || node.type === "radial-gauge"} onValueChange={(value) => { const type = value as IotValueType; setValueType(type); change({ ...draft, valueType: type }); }}><option value="number">数值</option><option value="string">文字</option><option value="boolean">布尔值</option></Select></label>
        <label className="iot-binding-field"><span>数据过期时间（秒）</span><input type="number" min={1} max={86400} step={1} value={stale} disabled={!editable} onChange={(event) => { setStale(event.target.value); change({ ...draft, staleAfterSeconds: event.target.value.trim() ? Number(event.target.value) : Number.NaN }); }} /></label>
        <p className="inspector-help">预览以真实数据替换组件值。未连接、数据异常或过期时显示状态，编辑画布中的静态值仅用于排版。</p>
        {manifest.ok ? <p className="inspector-help">当前画面共声明 {manifest.value.length} 个点位，嵌入连接时会自动提供完整清单。</p> : null}
      </> : null}
      {error ? <p className="inspector-validation-error" role="alert">{error}</p> : null}
    </section>
  );
}
