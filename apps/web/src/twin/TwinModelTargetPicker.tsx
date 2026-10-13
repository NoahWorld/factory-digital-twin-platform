import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TwinTarget } from "../../../../shared/twin-drive";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import type { TwinNodeCatalogEntry } from "../scene/twin-drive-runtime";
import { createUuid } from "../uuid";
import { Select } from "../components/Select";
import { twinTargetLabel, twinTargetSearch } from "./twin-target-label";

export type TwinTargetPickerView = {
  target: TwinTarget;
  viewport: { left: number; top: number; width: number; height: number };
  onPick: (targets: TwinTarget[]) => void;
  focusRequest: { instanceId: string; requestId: string } | null;
};
export type TwinTargetPickerChange = (view: TwinTargetPickerView | null) => void;

type PickerProps = {
  target: TwinTarget; scene: StandaloneSceneDocument; catalog: TwinNodeCatalogEntry[];
  motion?: boolean; lockInstance?: boolean; onChange: (target: TwinTarget) => void;
  onTargetPickerChange?: TwinTargetPickerChange;
};

export function TwinModelTargetPicker(props: PickerProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button type="button" className="secondary-button compact-button" disabled={!props.onTargetPickerChange || !props.scene.instances.length} onClick={() => setOpen(true)}>在模型中选择</button>
    {open && props.onTargetPickerChange ? <TargetPickerDialog {...props} onTargetPickerChange={props.onTargetPickerChange} onClose={close} /> : null}
  </>;
}

function TargetPickerDialog({ target, scene, catalog, motion = false, lockInstance = false, onChange, onTargetPickerChange, onClose }: PickerProps & { onTargetPickerChange: TwinTargetPickerChange; onClose: () => void }) {
  const [chosen, setChosen] = useState(target);
  const [hits, setHits] = useState<TwinTarget[]>([]);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState(() => {
    if (!target.instanceId) return "";
    const original = scene.instances.find((item) => item.id === target.instanceId);
    if (!original) return "原模型已移除，请选择场景中的模型，或直接点击右侧实物。";
    return original.visible ? "" : "该模型已隐藏，请返回模型显示它后再选择部件，或选择其他可见模型。";
  });
  const [focusRequest, setFocusRequest] = useState(() => scene.instances.some((item) => item.id === target.instanceId && item.visible) ? { instanceId: target.instanceId, requestId: createUuid() } : null);
  const [viewport, setViewport] = useState<TwinTargetPickerView["viewport"] | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const instance = scene.instances.find((item) => item.id === chosen.instanceId);
  const nodes = catalog.filter((node) => node.instanceId === instance?.id && node.modelAssetId === instance?.modelAssetId);
  const selected = chosen.modelAssetId === instance?.modelAssetId ? nodes.find((node) => node.nodeName === chosen.nodeName) : undefined;
  const allowed = (node: TwinNodeCatalogEntry | undefined) => Boolean(instance?.visible && node?.unique && (!motion || node.drivable));
  const candidates = hits.map((hit) => nodes.find((node) => node.nodeName === hit.nodeName && node.instanceId === hit.instanceId && node.modelAssetId === hit.modelAssetId)).filter((node): node is TwinNodeCatalogEntry => Boolean(node));
  const matching = nodes.filter((node) => twinTargetSearch(node, search, nodes));
  const onPick = useCallback((targets: TwinTarget[]) => {
    const valid = targets.filter((hit) => {
      if (lockInstance && hit.instanceId !== target.instanceId) return false;
      return catalog.some((node) => node.instanceId === hit.instanceId && node.modelAssetId === hit.modelAssetId && node.nodeName === hit.nodeName && node.unique && (!motion || node.drivable));
    });
    setHits(valid); setSearch("");
    if (!valid.length) {
      setChosen((current) => ({ ...current, nodeName: "" }));
      setNotice(lockInstance && targets.some((hit) => hit.instanceId !== target.instanceId) ? "请点击当前所选模型的部件。" : "此位置没有可绑定的部件，请点击其他部位或按名称选择。");
      return;
    }
    setChosen(valid[0]!); setNotice("");
  }, [catalog, lockInstance, motion, target.instanceId]);

  useLayoutEffect(() => {
    const element = slot.current!;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      setViewport((current) => current && Object.keys(next).every((key) => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useLayoutEffect(() => {
    if (viewport) onTargetPickerChange({ target: selected && allowed(selected) ? chosen : { ...chosen, nodeName: "" }, viewport, onPick, focusRequest: focusRequest && scene.instances.some((item) => item.id === focusRequest.instanceId && item.visible) ? focusRequest : null });
  }, [chosen, selected, instance, scene.instances, motion, viewport, onPick, focusRequest, onTargetPickerChange]);
  useEffect(() => () => onTargetPickerChange(null), [onTargetPickerChange]);
  useEffect(() => {
    const previous = document.activeElement;
    heading.current?.focus();
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      const active = document.activeElement;
      if (active && !dialog.current!.contains(active) && !active.closest("[popover]")) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyDown);
    return () => { document.removeEventListener("keydown", keyDown); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [onClose]);
  const choose = (node: TwinNodeCatalogEntry) => {
    setChosen({ instanceId: node.instanceId, modelAssetId: node.modelAssetId, nodeName: node.nodeName }); setNotice("");
  };
  const partButton = (node: TwinNodeCatalogEntry, index: number) => <button type="button" key={`${node.nodeName}-${index}`} className={`twin-picker-part${selected === node ? " is-selected" : ""}`} aria-pressed={selected === node} disabled={!allowed(node)} onClick={() => choose(node)}>
    <span>{twinTargetLabel(node, nodes)}</span>
    <small>{!node.unique ? "名称重复，不能绑定" : motion && !node.drivable ? "模型根节点，不能绑定动作" : node.parentNodeName ? `所属：${twinTargetLabel(nodes.find((item) => item.nodeName === node.parentNodeName) ?? { nodeName: node.parentNodeName }, nodes)}` : ""}</small>
  </button>;
  return createPortal(<div className="twin-picker-backdrop">
    <div className="twin-target-picker" role="dialog" aria-modal="true" aria-labelledby="twin-target-picker-title" ref={dialog}>
      <header><div><h2 id="twin-target-picker-title" ref={heading} tabIndex={-1}>选择模型部件</h2><p>点击右侧实物，确认高亮范围后选择。拖动可调整视角。</p></div><button type="button" className="secondary-button compact-button" onClick={onClose}>取消</button></header>
      <aside>
        <label><span>模型</span><Select value={chosen.instanceId} disabled={lockInstance} onValueChange={(instanceId) => {
          const next = scene.instances.find((item) => item.id === instanceId);
          if (!next) throw new Error(`所选模型不在当前场景中：${instanceId}`);
          setChosen({ instanceId, modelAssetId: next.modelAssetId, nodeName: "" }); setHits([]); setSearch(""); setNotice(next.visible ? "" : "该模型已隐藏，请返回模型显示它后再选择部件。");
          setFocusRequest(next.visible ? { instanceId, requestId: createUuid() } : null);
        }}><option value="" disabled>请选择模型</option>{chosen.instanceId && !instance ? <option value={chosen.instanceId} disabled>原模型已移除</option> : null}{scene.instances.map((item) => <option key={item.id} value={item.id} disabled={!item.visible}>{item.label}{item.visible ? "" : "（已隐藏）"}</option>)}</Select></label>
        {candidates.length ? <section className="twin-picker-candidates"><h3>点选位置的部件</h3><p className="twin-help">可选单个部件，或包含它的整组部件。</p>{candidates.map(partButton)}</section> : null}
        <label><span>按名称查找</span><input value={search} placeholder="输入部件名称" onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="twin-picker-parts">{matching.slice(0, 200).map(partButton)}</div>
        {!instance ? <p className="twin-help">请选择模型，或直接点击右侧实物。</p> : !nodes.length ? <p className="twin-error" role="alert">模型部件尚未加载，请确认该模型能正常显示。</p> : matching.length > 200 ? <p className="twin-help">显示前 200 个部件，请按名称筛选或点击实物。</p> : null}
      </aside>
      <div className="twin-picker-viewport" ref={slot} aria-label="模型实物视图" />
      <footer><div aria-live="polite">{notice ? <p className="twin-error">{notice}</p> : <><strong>{selected ? `${instance?.label} · ${twinTargetLabel(selected, nodes)}` : "尚未选择部件"}</strong><p className="twin-help">确认仅更新配置草稿，保存配置后生效。</p></>}</div><button type="button" className="primary-button" disabled={!allowed(selected)} onClick={() => { onChange(chosen); onClose(); }}>使用这个部件</button></footer>
    </div>
  </div>, document.body);
}
