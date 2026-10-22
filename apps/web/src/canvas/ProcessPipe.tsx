import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { parsePipeProps, pipeEndpoint, pipeRoute, validatePipeReferences, type PipeEndpoint, type PipePoint, type PipeProps } from "../../../../shared/process-control";
import { Select } from "../components/Select";
import { componentLabels, type CanvasDocument, type CanvasNode } from "./types";
import "./process-control.css";

const ports = { left: "左", right: "右", top: "上", bottom: "下" } as const;
const title = (node: CanvasNode) => String(node.props.label ?? node.props.title ?? node.props.text ?? componentLabels[node.type]).slice(0, 40);
export function PipeInspector({ node, document, editable, onChange, onValidationChange }: { node: CanvasNode; document: CanvasDocument; editable: boolean; onChange: (node: CanvasNode) => void; onValidationChange: (message: string | null) => void }) {
  const [draft, setDraft] = useState(node.props as PipeProps);
  const signature = JSON.stringify(node.props);
  useEffect(() => { setDraft(node.props as PipeProps); }, [signature]);
  const draftValidation = parsePipeProps(draft);
  const error = draftValidation.ok ? null : draftValidation.message;
  useEffect(() => { onValidationChange(error); return () => onValidationChange(null); }, [error, onValidationChange]);
  const parsed = parsePipeProps(node.props);
  if (!parsed.ok) return <aside className="component-inspector"><p role="alert">{parsed.message}</p></aside>;
  const props = draft;
  const update = (patch: Partial<PipeProps>) => { const next = { ...props, ...patch }; setDraft(next); if (parsePipeProps(next).ok) onChange({ ...node, props: next }); };
  return <aside className="component-inspector process-inspector"><section className="inspector-section">
    <div className="inspector-section-title"><strong>工艺管路</strong></div>
    {error ? <p className="inspector-validation-error" role="alert">{error}</p> : null}
    <label className="iot-binding-field"><span>名称</span><input value={props.label} disabled={!editable} maxLength={80} onChange={e => update({ label: e.target.value })} /></label>
    {(["source", "target"] as const).map(key => <div key={key} className="process-rule">
      <strong>{key === "source" ? "起点" : "终点"}</strong>
      <label className="iot-binding-field"><span>连接组件</span><Select disabled={!editable} value={props[key].nodeId ?? ""} onValueChange={id => update({ [key]: { ...props[key], ...pipeEndpoint(props[key], document.nodes), nodeId: id || null } })}>
        <option value="">自由端点</option>{document.nodes.filter(n => n.type !== "process-pipe").map(n => <option key={n.id} value={n.id}>{title(n)} · {n.id.slice(0, 6)}</option>)}
      </Select></label>
      {props[key].nodeId ? <label className="iot-binding-field"><span>连接位置</span><Select value={props[key].port} disabled={!editable} onValueChange={port => update({ [key]: { ...props[key], port } })}>{Object.entries(ports).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Select></label> : <div className="process-field-pair">{(["x", "y"] as const).map(axis => <label className="iot-binding-field" key={axis}><span>{axis.toUpperCase()}</span><input type="number" min={0} max={axis === "x" ? document.width : document.height} value={props[key][axis]} disabled={!editable} onChange={e => { if (e.target.value !== "") update({ [key]: { ...props[key], [axis]: Number(e.target.value) } }); }} /></label>)}</div>}
    </div>)}
    <label className="iot-binding-field"><span>直角走向</span><Select disabled={!editable} value={props.routing} onValueChange={routing => update({ routing: routing as PipeProps["routing"] })}><option value="horizontal">先横后竖</option><option value="vertical">先竖后横</option></Select></label>
    <p className="inspector-help">拖动端点靠近组件边缘可吸附；双击管路添加途经点，拖动圆点调整路径。多个管路可连接同一组件形成支路。</p>
    {props.waypoints.map((p, i) => <div className="process-point-row" key={i}>{(["x", "y"] as const).map(axis => <input key={axis} aria-label={`途经点 ${i + 1} ${axis}`} type="number" min={0} max={16384} value={p[axis]} disabled={!editable} onChange={e => { if (e.target.value !== "") update({ waypoints: props.waypoints.map((v, j) => j === i ? { ...v, [axis]: Number(e.target.value) } : v) }); }} />)}<button type="button" className="secondary-button compact-button" disabled={!editable} aria-label={`删除途经点 ${i + 1}`} onClick={() => update({ waypoints: props.waypoints.filter((_, j) => j !== i) })}>×</button></div>)}
    <button type="button" className="secondary-button compact-button" disabled={!editable || props.waypoints.length >= 32} onClick={() => { const a = pipeEndpoint(props.source, document.nodes), b = pipeEndpoint(props.target, document.nodes); update({ waypoints: [...props.waypoints, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }] }); }}>添加途经点</button>
    <div className="process-field-pair"><label className="iot-binding-field"><span>颜色</span><input type="color" disabled={!editable} value={props.color} onChange={e => update({ color: e.target.value })} /></label><label className="iot-binding-field"><span>管径（像素）</span><input type="number" min={2} max={40} disabled={!editable} value={props.width} onChange={e => { if (e.target.value !== "") update({ width: Number(e.target.value) }); }} /></label></div>
    <label className="inspector-check-row"><input type="checkbox" checked={props.flowing} disabled={!editable} onChange={e => update({ flowing: e.target.checked })} />静态配置：播放流动</label>
    <div className="process-field-pair"><label className="iot-binding-field"><span>流向</span><Select disabled={!editable} value={props.direction} onValueChange={v => update({ direction: v as PipeProps["direction"] })}><option value="forward">起点 → 终点</option><option value="reverse">终点 → 起点</option></Select></label><label className="iot-binding-field"><span>视觉速度</span><input type="number" min={0} max={30} step={0.1} disabled={!editable} value={props.speed} onChange={e => { if (e.target.value !== "") update({ speed: Number(e.target.value) }); }} /></label></div>
    {node.stateBinding ? <p className="inspector-help">预览时由下方状态规则决定外观和流动。</p> : null}
  </section></aside>;
}

type Handle = "source" | "target" | number;
export function ProcessPipe({ node, document, editable, selected, onSelect, onChange, error, stateLabel }: { node: CanvasNode; document: CanvasDocument; editable: boolean; selected: boolean; onSelect: () => void; onChange: (node: CanvasNode) => void; error?: string | null; stateLabel?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ handle: Handle; pointerId: number; props: PipeProps } | null>(null);
  const [draft, setDraft] = useState<PipeProps | null>(null);
  const validation = parsePipeProps(node.props);
  const references = validatePipeReferences(document.nodes);
  if (!validation.ok || !references.ok) return <div className="process-runtime-error" role="alert">{!validation.ok ? validation.message : !references.ok ? references.message : ""}</div>;
  const props = draft ?? validation.value;
  const route = pipeRoute(props, document.nodes);
  const directed = props.direction === "reverse" ? [...route].reverse() : route;
  const d = directed.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const segment = route.slice(1).map((point, i) => ({ start: route[i], end: point, length: Math.hypot(point.x - route[i].x, point.y - route[i].y) })).sort((a, b) => b.length - a.length)[0];
  const horizontal = !segment || segment.start.y === segment.end.y;
  const middle = segment ? { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 } : route[0];
  const labelWidth = Math.min(document.width, horizontal ? Math.max(36, Math.min(200, (segment?.length ?? 200) - 12)) : 200);
  const labelX = Math.max(0, Math.min(document.width - labelWidth, horizontal ? middle.x - labelWidth / 2 : middle.x + props.width / 2 + 8));
  const labelY = Math.max(0, Math.min(document.height - 24, horizontal ? middle.y - props.width / 2 - 28 : middle.y - 12));
  const position = (event: { clientX: number; clientY: number }): PipePoint => { const rect = svg.current!.getBoundingClientRect(); return { x: Math.round(Math.max(0, Math.min(document.width, (event.clientX - rect.left) * document.width / rect.width))), y: Math.round(Math.max(0, Math.min(document.height, (event.clientY - rect.top) * document.height / rect.height))) }; };
  const moved = (base: PipeProps, handle: Handle, p: PipePoint, snap = true) => {
    if (typeof handle === "number") return { ...base, waypoints: base.waypoints.map((v, i) => i === handle ? p : v) };
    let end: PipeEndpoint = { ...base[handle], ...p, nodeId: null }, distance = 24;
    for (const n of document.nodes) if (snap && n.type !== "process-pipe") for (const port of Object.keys(ports) as PipeEndpoint["port"][]) {
      const candidate = { ...p, nodeId: n.id, port }, anchor = pipeEndpoint(candidate, document.nodes), delta = Math.hypot(p.x - anchor.x, p.y - anchor.y);
      if (delta < distance) { end = { ...candidate, ...anchor }; distance = delta; }
    }
    return { ...base, [handle]: end };
  };
  const move = (e: PointerEvent<SVGSVGElement>) => { if (drag.current?.pointerId !== e.pointerId) return; const next = moved(drag.current.props, drag.current.handle, position(e)); drag.current.props = next; setDraft(next); };
  const handles: { handle: Handle; point: PipePoint; label: string }[] = [{ handle: "source", point: pipeEndpoint(props.source, document.nodes), label: "起点" }, ...props.waypoints.map((point, i) => ({ handle: i, point, label: `途经点 ${i + 1}` })), { handle: "target", point: pipeEndpoint(props.target, document.nodes), label: "终点" }];
  return <svg ref={svg} width={document.width} height={document.height} viewBox={`0 0 ${document.width} ${document.height}`} className="process-pipe-layer" role={editable ? "group" : "img"} aria-label={`管路 ${props.label}${error ? `，${error}` : stateLabel ? `，${stateLabel}` : ""}`} style={{ zIndex: node.zIndex + 2 }} data-pipe-id={node.id} onPointerMove={move} onPointerUp={e => { if (drag.current?.pointerId !== e.pointerId) return; const next = moved(drag.current.props, drag.current.handle, position(e)); drag.current = null; setDraft(null); onChange({ ...node, props: { ...next } }); }} onPointerCancel={() => { drag.current = null; setDraft(null); }}>
    <defs><marker id={`pipe-arrow-${node.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 1 L9 5 L0 9 Z" fill={props.color} /></marker></defs>
    {selected && editable ? <path d={d} fill="none" stroke="var(--ui-accent)" strokeWidth={props.width + 6} opacity={0.5} /> : null}
    <path d={d} fill="none" stroke={error ? "#94a3b8" : props.color} strokeWidth={props.width} strokeLinejoin="round" strokeLinecap="round" markerEnd={`url(#pipe-arrow-${node.id})`} />
    {props.flowing && props.speed > 0 && !error ? <path d={d} fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={Math.max(1, props.width * 0.28)} strokeDasharray="10 22" className="process-pipe-flow" style={{ animationDuration: `${1 / props.speed}s` } as CSSProperties} /> : null}
    <foreignObject x={labelX} y={labelY} width={labelWidth} height={24}>
      <div className="process-pipe-label" style={{ color: error ? "#f87171" : document.theme.textColor }} title={`${props.label}${error ? `：${error}` : stateLabel ? ` · ${stateLabel}` : ""}`}><span>{props.label}</span>{error || stateLabel ? <strong>{error ? "异常" : stateLabel}</strong> : null}</div>
    </foreignObject>
    {editable ? <path className="process-pipe-hit" d={d} fill="none" stroke="transparent" strokeWidth={Math.max(20, props.width + 10)} role="button" tabIndex={0} aria-label={`选择管路 ${props.label}`} onClick={e => { e.stopPropagation(); onSelect(); }} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }} onDoubleClick={e => { e.stopPropagation(); if (props.waypoints.length < 32) onChange({ ...node, props: { ...props, waypoints: [...props.waypoints, position(e)] } }); }} /> : null}
    {editable && selected ? handles.map(h => <circle key={h.handle} className="process-pipe-handle" cx={h.point.x} cy={h.point.y} r={7} role="button" tabIndex={0} aria-label={`拖动管路${h.label}`} onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { handle: h.handle, pointerId: e.pointerId, props }; }} onKeyDown={e => { const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key]; if (!delta) return; e.preventDefault(); e.stopPropagation(); const p = { x: Math.max(0, Math.min(document.width, h.point.x + delta[0])), y: Math.max(0, Math.min(document.height, h.point.y + delta[1])) }; onChange({ ...node, props: { ...moved(props, h.handle, p, false) } }); }} />) : null}
  </svg>;
}
