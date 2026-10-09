import { useNotifications } from "../components/NotificationProvider";
import { createUuid } from "../uuid";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TWIN_DRIVE_LIMITS, twinDriveErrors, twinDrivePath, type TwinDriveConfig, type TwinDriveDocument, type TwinTarget, type TwinVector, type TwinMotionBinding, type TwinCollider, type TwinApiSourceTest } from "../../../../shared/twin-drive";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import type { TwinNodeCatalogEntry } from "../scene/twin-drive-runtime";
import { errorMessage, request, reportError } from "../api";
import { Select } from "../components/Select";
import { ThemeToggle } from "../theme/ThemeToggle";
import { parseTwinDriveConfig } from "./twin-config-json";
import { TwinSourceStep } from "./TwinSourceStep";
import { TwinBindingRemap } from "./TwinBindingRemap";
import { TwinPoseFields } from "./TwinPoseFields";
import "./twin-drive.css";

const id = (prefix: string) => `${prefix}-${createUuid().slice(0, 8)}`;
const emptyTarget = (): TwinTarget => ({ instanceId: "", modelAssetId: "", nodeName: "" });
const numeric = (value: string) => value.trim() === "" ? NaN : Number(value);
const NumberField = ({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) => <label><span>{label}</span><input type="number" step="any" min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} value={Number.isFinite(value) ? value : ""} onChange={(event) => onChange(numeric(event.target.value))} /></label>;
const TextField = ({ label, value, onChange, maxLength = 120, placeholder }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; placeholder?: string }) => <label><span>{label}</span><input value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
function VectorField({ label, value, onChange }: { label: string; value: TwinVector; onChange: (value: TwinVector) => void }) {
  return <fieldset className="twin-vector"><legend>{label}</legend>{value.map((axis, index) => <NumberField key={index} label={["X", "Y", "Z"][index]!} value={axis} onChange={(next) => { const result: TwinVector = [...value]; result[index] = next; onChange(result); }} />)}</fieldset>;
}

function TargetFields({ target, onChange, scene, catalog, motion = false }: { target: TwinTarget; onChange: (value: TwinTarget) => void; scene: StandaloneSceneDocument; catalog: TwinNodeCatalogEntry[]; motion?: boolean }) {
  const [search, setSearch] = useState("");
  const instance = scene.instances.find((item) => item.id === target.instanceId);
  const sameResource = instance?.modelAssetId === target.modelAssetId;
  const available = catalog.filter((node) => node.instanceId === target.instanceId && node.modelAssetId === instance?.modelAssetId);
  const nodes = available.filter((node) => node.nodeName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const options = nodes.slice(0, 200);
  const selected = sameResource ? available.find((node) => node.nodeName === target.nodeName) : undefined;
  const unavailable = (node: TwinNodeCatalogEntry | undefined) => !node?.unique || (motion && node.drivable !== true);
  const suffix = (node: TwinNodeCatalogEntry | undefined) => !node ? "（未找到）" : !node.unique ? "（重名，不可绑定）" : motion && node.drivable !== true ? "（模型根节点，不可驱动）" : "";
  return <div className="twin-fields">
    <label><span>选择模型</span><Select value={target.instanceId} onValueChange={(instanceId) => {
      if (instanceId === target.instanceId && sameResource) return;
      const next = scene.instances.find((item) => item.id === instanceId);
      onChange({ instanceId, modelAssetId: next?.modelAssetId ?? "", nodeName: "" }); setSearch("");
    }}><option value="">请选择模型</option>{target.instanceId && !instance ? <option value={target.instanceId}>原模型已移除</option> : null}{scene.instances.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</Select></label>
    <label><span>查找部件</span><input placeholder="输入部件名称" value={search} onChange={(event) => setSearch(event.target.value)} disabled={!instance} /></label>
    <label className="twin-wide"><span>选择模型部件</span><Select value={sameResource ? target.nodeName : ""} disabled={!instance} onValueChange={(nodeName) => onChange({ ...target, modelAssetId: instance!.modelAssetId, nodeName })}>
      <option value="">请选择部件</option>
      {sameResource && target.nodeName && !options.some((node) => node.nodeName === target.nodeName) ? <option value={target.nodeName} disabled={unavailable(selected)}>{target.nodeName}{suffix(selected)}</option> : null}
      {options.map((node, index) => <option key={`${node.nodeName}-${index}`} value={node.nodeName} disabled={unavailable(node)}>{node.nodeName}{suffix(node)}</option>)}
    </Select></label>
    {instance && !sameResource ? <p className="twin-error twin-wide">这个模型的文件已更换，请重新选择部件，或使用“更换模型”批量对应。</p> : null}
    <p className="twin-help twin-wide">{!instance ? "先选择模型，再选择要控制的部件。" : !available.length ? "模型部件尚未加载，请确认模型在场景中可正常显示。" : nodes.length > 200 ? `找到 ${nodes.length} 个部件，显示前 200 个，请继续筛选。` : `找到 ${nodes.length} 个部件。`}</p>
  </div>;
}

function JsonEditor({ value, onApply, onDraftChange }: { value: unknown; onApply: (value: unknown) => void; onDraftChange: (dirty: boolean) => void }) {
  const source = JSON.stringify(value, null, 2);
  const [text, setText] = useState(source);
  const [baseline, setBaseline] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== baseline;
  const conflict = dirty && source !== baseline;
  useEffect(() => { if (!dirty) { setText(source); setBaseline(source); } }, [source, dirty]);
  useEffect(() => { onDraftChange(dirty); }, [dirty, onDraftChange]);
  return <section className="twin-card twin-json"><h3>完整配置 JSON</h3><p className="twin-help">供高级配置与排查使用。应用到表单后，还需保存配置。</p>
    <textarea aria-label="完整配置 JSON" rows={16} spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} />
    {conflict ? <p className="twin-error" role="alert">表单已经变化。JSON 草稿仍保留，请复制需要保留的内容，再重新载入当前表单。</p> : null}
    <div className="twin-row"><button type="button" className="secondary-button compact-button" disabled={conflict || !dirty} onClick={() => {
      try { const next = JSON.parse(text); onApply(next); const formatted = JSON.stringify(next, null, 2); setText(formatted); setBaseline(formatted); setError(null); }
      catch (reason) { reportError(reason); setError("配置格式无效，请检查 JSON 后重试。"); }
    }}>应用 JSON 到草稿</button>{dirty ? <button type="button" className="secondary-button compact-button" onClick={() => { setText(source); setBaseline(source); setError(null); }}>放弃 JSON 修改并载入表单</button> : null}</div>
    {error ? <p className="twin-error" role="alert">{error}</p> : null}
  </section>;
}

function validateConfig(config: TwinDriveConfig, scene: StandaloneSceneDocument, catalog: TwinNodeCatalogEntry[]): string[] {
  try {
    const errors = twinDriveErrors(config);
    for (const item of [...config.bindings, ...config.colliders]) {
      const instance = scene.instances.find((candidate) => candidate.id === item.target.instanceId);
      const label = item.label || item.id;
      if (!instance) { errors.push(`${label}：请选择场景中存在的模型。`); continue; }
      if (instance.modelAssetId !== item.target.modelAssetId) { errors.push(`${label}：模型已更换，请重新对应部件。`); continue; }
      const matches = catalog.filter((node) => node.instanceId === instance.id && node.modelAssetId === instance.modelAssetId && node.nodeName === item.target.nodeName);
      if (!matches.length) errors.push(`${label}：部件未找到或模型尚未加载，请检查后再保存。`);
      else if (matches.length !== 1 || !matches[0]!.unique) errors.push(`${label}：部件名称重复，请在模型中设置唯一名称。`);
      else if ("kind" in item && matches[0]!.drivable !== true) errors.push(`${label}：模型根节点不能用于动作绑定，请选择模型内的部件。`);
    }
    return errors;
  } catch (reason) { return [`配置结构不完整：${errorMessage(reason)}`]; }
}

const primarySteps = [
  { id: "source", label: "连接接口", hint: "填写 REST 或 WebSocket 地址" },
  { id: "bindings", label: "绑定动作", hint: "数据字段对应模型部件" },
  { id: "test", label: "检查效果", hint: "查看实际数据与模型动作" },
] as const;
const secondarySteps = [
  { id: "reuse", label: "更换模型", hint: "保留数据与动作，重新对应部件" },
  { id: "collisions", label: "碰撞提示", hint: "配置需要检查的部件" }, { id: "advanced", label: "高级配置", hint: "配置说明与完整 JSON" },
] as const;
type EditorTab = typeof primarySteps[number]["id"] | typeof secondarySteps[number]["id"];
const axes: { value: string; label: string; vector: TwinVector }[] = [
  { value: "x", label: "X 轴", vector: [1, 0, 0] }, { value: "y", label: "Y 轴", vector: [0, 1, 0] }, { value: "z", label: "Z 轴", vector: [0, 0, 1] },
];

export function TwinDriveEditor({ document, scene, catalog, projectName, onSaved, onClose, onTestChange, connectionTest }: {
  document: TwinDriveDocument; scene: StandaloneSceneDocument; catalog: TwinNodeCatalogEntry[]; projectName?: string;
  onSaved: (document: TwinDriveDocument) => void; onClose: () => void; onTestChange: (active: boolean) => void; connectionTest: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const [baseRevision, setBaseRevision] = useState(document.revision);
  const [baseline, setBaseline] = useState(() => JSON.stringify(document.config));
  const [config, setConfig] = useState<TwinDriveConfig>(() => structuredClone(document.config));
  const [tab, setTab] = useState<EditorTab>("source");
  const [bindingId, setBindingId] = useState(config.bindings[0]?.id ?? "");
  const [colliderId, setColliderId] = useState(config.colliders[0]?.id ?? "");
  const [sourceFields, setSourceFields] = useState<TwinApiSourceTest["fields"]>([]);
  const connectionKey = JSON.stringify(config.connection);
  const selectableFields = sourceFields.filter(field => field.type === "number" || field.type === "boolean");
  const [saving, setSaving] = useState(false);
  const notify = useNotifications();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [jsonDirty, setJsonDirty] = useState(false);
  const [jsonGeneration, setJsonGeneration] = useState(0);
  const [pendingMotionKind, setPendingMotionKind] = useState<{ bindingId: string; kind: TwinMotionBinding["kind"] } | null>(null);
  const binding = config.bindings.find((item) => item.id === bindingId);
  const point = config.points.find((item) => item.id === binding?.pointId);
  const selectedSourceField = sourceFields.find(field => field.path === point?.sourcePath);
  const inspectedValue = selectedSourceField?.type === "number" ? Number(selectedSourceField.value) : selectedSourceField?.type === "boolean" ? selectedSourceField.value ? 1 : 0 : null;
  const inspectedOutsideRange = point && inspectedValue !== null && Number.isFinite(point.min) && Number.isFinite(point.max) && (inspectedValue < point.min || inspectedValue > point.max);
  const collider = config.colliders.find((item) => item.id === colliderId);
  const errors = validateConfig(config, scene, catalog);
  const conflict = baseRevision !== document.revision;
  const dirty = JSON.stringify(config) !== baseline || jsonDirty;
  const section = [...primarySteps, ...secondarySteps].find((step) => step.id === tab)!;
  const stepIndex = primarySteps.findIndex((step) => step.id === tab);
  const bindingInUse = binding && config.bindings.some((item) => item.parentBindingId === binding.id);
  const colliderInUse = collider && config.collisionRules.some((item) => item.first === collider.id || item.second === collider.id);
  const nativeConflict = config.source === "api" && config.enabled && scene.settings.playAnimations && config.bindings.some((item) => scene.instances.some((instance) => instance.id === item.target.instanceId && instance.animation?.enabled !== false));
  const patchPoint = (patch: Partial<NonNullable<typeof point>>) => setConfig({ ...config, points: config.points.map((item) => {
    if (item.id !== point?.id) return item;
    const next = { ...item, ...patch };
    if (Number.isFinite(next.min) && Number.isFinite(next.max) && next.min < next.max) next.initialValue = Math.max(next.min, Math.min(next.max, next.initialValue));
    return next;
  }) });
  const patchBinding = (patch: Partial<TwinMotionBinding>) => setConfig({ ...config, bindings: config.bindings.map((item) => item.id === bindingId ? { ...item, ...patch } : item) });
  const patchCollider = (patch: Partial<TwinCollider>) => setConfig({ ...config, colliders: config.colliders.map((item) => item.id === colliderId ? { ...item, ...patch } : item) });
  const changeTab = (next: EditorTab) => { setTab(next); onTestChange(next === "test"); };
  const changeMotionKind = (kind: TwinMotionBinding["kind"]) => {
    if (!binding || kind === binding.kind) return;
    const input = config.points.find((item) => item.id === binding.pointId);
    patchBinding({ kind, poses: kind === "pose" ? [{ value: input?.min ?? 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, { value: input?.max ?? 1, position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] : [] });
    setPendingMotionKind(null);
  };
  useEffect(() => {
    const previous = globalThis.document.activeElement;
    heading.current?.focus();
    return () => { onTestChange(false); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    navigation.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { setSourceFields([]); }, [connectionKey]);
  const save = async () => {
    if (saving || config.source !== "api" || errors.length || conflict || nativeConflict || jsonDirty || !document.editable) return;
    setSaving(true);
    try {
      const result = await request<TwinDriveDocument>(twinDrivePath(document.projectId), { method: "PUT", body: JSON.stringify({ expectedRevision: baseRevision, config }) });
      setConfig(structuredClone(result.config)); setBaseRevision(result.revision); setBaseline(JSON.stringify(result.config)); setConfirmLeave(false); onSaved(result);
      notify.success("接口与动作配置已保存。");
    } catch (reason) { reportError(reason, { operation: "save_twin_drive", projectId: document.projectId, revision: baseRevision }); notify.error(reason); }
    finally { setSaving(false); }
  };
  return <section className="twin-workspace" aria-label="数据与模型配置">
    <header className="twin-workspace-header">
      <button className="secondary-button compact-button" type="button" disabled={saving} onClick={() => { if (dirty) setConfirmLeave(true); else onClose(); }}>← 返回模型</button>
      <div className="twin-workspace-title"><span className="eyebrow">{projectName || "模型配置"}</span><h1 ref={heading} tabIndex={-1}>数据与模型配置</h1></div>
      <div className="twin-workspace-header-actions"><span className="twin-save-state" role="status">{saving ? "正在保存…" : !document.editable ? "只读配置" : dirty ? "有未保存的修改" : "已保存"}</span><ThemeToggle /></div>
    </header>
    <nav ref={navigation} className="twin-workspace-nav" aria-label="配置步骤">
      {primarySteps.map((step, index) => <button key={step.id} className={tab === step.id ? "is-active" : ""} type="button" aria-current={tab === step.id ? "step" : undefined} onClick={() => changeTab(step.id)}><span className="twin-step-number">{index + 1}</span><span><strong>{step.label}</strong><small>{step.hint}</small></span></button>)}
      <span className="twin-nav-label">更多配置</span>{secondarySteps.map((step) => <button key={step.id} className={`twin-nav-secondary${tab === step.id ? " is-active" : ""}`} type="button" aria-current={tab === step.id ? "page" : undefined} onClick={() => changeTab(step.id)}>{step.label}</button>)}
    </nav>
    <div ref={content} className="twin-workspace-content"><div className="twin-content-inner">
      <div className="twin-section-heading"><span>{stepIndex >= 0 ? `步骤 ${stepIndex + 1} / ${primarySteps.length}` : "更多配置"}</span><h2>{section.label}</h2><p>{section.hint}</p></div>
      {tab === "test" ? <section className="twin-connection-test"><p className={dirty || conflict ? "twin-error" : "twin-readonly"}>{dirty || conflict ? "当前有未保存的修改。这里只测试已保存的配置。" : "正在检查已保存的接口与动作。修改配置后请保存，再检查效果。"}</p>{connectionTest}</section> : null}
      <fieldset className="twin-editor-body" disabled={!document.editable || saving}>
        {tab === "source" ? <TwinSourceStep projectId={document.projectId} config={config} onChange={setConfig} onContinue={() => changeTab("bindings")} onInspect={result => setSourceFields(result?.fields ?? [])} /> : null}
        {tab === "bindings" && config.source === "api" ? <>
          <div className="twin-row"><label><span>选择动作</span><Select value={bindingId} onValueChange={setBindingId}><option value="">请选择动作</option>{config.bindings.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label><button className="secondary-button compact-button" type="button" disabled={config.points.length >= TWIN_DRIVE_LIMITS.points || config.bindings.length >= TWIN_DRIVE_LIMITS.bindings} onClick={() => {
            const nextPoint = id("point"); const nextId = id("motion");
            setConfig({ ...config, points: [...config.points, { id: nextPoint, label: "新动作数据", assetId: "", metricKey: nextPoint, sourcePath: "", unit: "m", min: 0, max: 10, initialValue: 0, maxSpeed: 1, staleAfterMs: 3000 }], bindings: [...config.bindings, { id: nextId, label: "新部件动作", pointId: nextPoint, target: emptyTarget(), parentBindingId: null, useNodeRestPose: true, kind: "translation", axis: [1, 0, 0], pivot: [0, 0, 0], valueScale: 1, valueOffset: 0, poses: [] }] }); setBindingId(nextId);
          }}>＋ 添加动作</button></div>
          {binding ? <section className="twin-card"><TextField label="动作名称" value={binding.label} placeholder="例如：小车沿轨道移动" onChange={(label) => patchBinding({ label })} />
            {point ? <div className="twin-action-data"><div className="twin-fields">
              {selectableFields.length ? <>
                <label className="twin-wide"><span>数据字段</span><Select value={point.sourcePath ?? ""} onValueChange={(sourcePath) => patchPoint({ sourcePath })}><option value="">请选择字段</option>{point.sourcePath && !selectableFields.some(field => field.path === point.sourcePath) ? <option value={point.sourcePath}>{point.sourcePath}（手动填写）</option> : null}{selectableFields.map(field => <option key={field.path} value={field.path}>{field.path} · {String(field.value)}</option>)}</Select></label>
                <details className="twin-advanced twin-wide"><summary>手动填写字段</summary><TextField label="手动数据字段" maxLength={256} value={point.sourcePath ?? ""} placeholder="例如：agv.positionM" onChange={(sourcePath) => patchPoint({ sourcePath })} /></details>
              </> : <><TextField label="数据字段" maxLength={256} value={point.sourcePath ?? ""} placeholder="例如：agv.positionM" onChange={(sourcePath) => patchPoint({ sourcePath })} /><p className="twin-help">尚未读取接口字段，可手动填写数值或布尔字段，或先在“连接接口”读取后选择。</p></>}
            </div>{selectedSourceField?.type === "boolean" ? <p className="twin-help">这个字段是开关值：false = 0，true = 1，建议数据范围使用 0 到 1。可用于显示／隐藏；移动和转动时，也按 0 与 1 计算。</p> : null}{inspectedOutsideRange ? <p className="twin-error" role="alert">已读取当前值 {inspectedValue} 超出数据范围 {point.min}～{point.max}。请在“数据范围与高级设置”调整范围；超出范围的数据会停止驱动动作。</p> : null}<details className="twin-advanced"><summary>数据范围与高级设置</summary><div className="twin-fields">
              <NumberField label="最小值" value={point.min} min={-1e6} max={1e6} onChange={(min) => patchPoint({ min })} /><NumberField label="最大值" value={point.max} min={-1e6} max={1e6} onChange={(max) => patchPoint({ max })} />
              <TextField label="数据单位" maxLength={32} value={point.unit} placeholder="例如：m、度" onChange={(unit) => patchPoint({ unit })} /><NumberField label="数据过期时间（毫秒）" value={point.staleAfterMs} min={500} max={60000} onChange={(staleAfterMs) => patchPoint({ staleAfterMs })} />
              <TextField label="数据名称" value={point.label} onChange={(label) => patchPoint({ label })} />
            </div><p className="twin-help">数据超出范围或长时间未更新时，动作会停下并提示。布尔字段按 false = 0、true = 1 处理。</p></details></div> : <p className="twin-error" role="alert">动作引用的数据已删除，请在高级配置中修正对应关系。</p>}
            <TargetFields key={`target:${binding.id}`} target={binding.target} onChange={(target) => patchBinding({ target })} scene={scene} catalog={catalog} motion />
            <div className="twin-fields"><label><span>部件如何变化</span><Select value={binding.kind} onValueChange={(value) => { const kind = value as TwinMotionBinding["kind"]; if (kind === binding.kind) return; if (binding.kind === "pose" && binding.poses.length) setPendingMotionKind({ bindingId: binding.id, kind }); else changeMotionKind(kind); }}><option value="translation">沿方向移动</option><option value="rotation">绕轴转动</option><option value="pose">在多个姿态间变化</option><option value="visibility">显示 / 隐藏</option></Select></label>
              {binding.kind === "translation" || binding.kind === "rotation" ? <label><span>{binding.kind === "translation" ? "移动方向" : "转动轴"}</span><Select value={axes.find((axis) => axis.vector.every((value, index) => value === binding.axis[index]))?.value ?? "custom"} onValueChange={(value) => { const selected = axes.find((axis) => axis.value === value); if (selected) patchBinding({ axis: [...selected.vector] }); }}><option value="custom" disabled>自定义方向（见高级设置）</option>{axes.map((axis) => <option key={axis.value} value={axis.value}>{axis.label}</option>)}</Select></label> : null}
            </div>
            <p className="twin-help">移动距离使用米，转动角度使用度。数据单位不同时，可在高级设置中调整变化比例与偏移。</p>
            {pendingMotionKind?.bindingId === binding.id ? <div className="twin-exit-confirm" role="alert"><span>切换运动方式将清除这个动作的关键姿态，是否继续？</span><button type="button" className="secondary-button compact-button" onClick={() => setPendingMotionKind(null)}>保留当前姿态</button><button type="button" className="secondary-button compact-button twin-danger" onClick={() => changeMotionKind(pendingMotionKind.kind)}>清除姿态并切换</button></div> : null}
            {binding.kind === "pose" ? <TwinPoseFields key={`pose:${binding.id}`} poses={binding.poses} onChange={(poses) => patchBinding({ poses })} /> : null}
            <details className="twin-advanced"><summary>比例、轴心与联动设置</summary><div className="twin-fields"><NumberField label="变化比例" value={binding.valueScale} onChange={(valueScale) => patchBinding({ valueScale })} /><NumberField label="起始偏移" value={binding.valueOffset} onChange={(valueOffset) => patchBinding({ valueOffset })} />
              <label><span>跟随另一个动作</span><Select value={binding.parentBindingId ?? ""} onValueChange={(value) => patchBinding({ parentBindingId: value || null })}><option value="">不跟随其他动作</option>{binding.parentBindingId && !config.bindings.some((item) => item.id === binding.parentBindingId && item.target.instanceId === binding.target.instanceId) ? <option value={binding.parentBindingId}>原上级动作不可用</option> : null}{config.bindings.filter((item) => item.id !== binding.id && item.target.instanceId === binding.target.instanceId).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>
            </div><label className="twin-check"><input type="checkbox" checked={binding.useNodeRestPose} onChange={(event) => patchBinding({ useNodeRestPose: event.target.checked })} />以模型原始姿态为起点</label>
              {binding.kind === "translation" || binding.kind === "rotation" ? <VectorField label="自定义方向（长度为 1）" value={binding.axis} onChange={(axis) => patchBinding({ axis })} /> : null}
              {binding.kind === "rotation" ? <VectorField label="转动轴心（模型坐标，米）" value={binding.pivot} onChange={(pivot) => patchBinding({ pivot })} /> : null}<p className="twin-help">移动距离或转角 = 数据值 × 变化比例 + 起始偏移。转角单位为度。</p>
            </details><button className="secondary-button compact-button twin-danger" type="button" disabled={Boolean(bindingInUse)} onClick={() => { const remaining = config.bindings.filter((item) => item.id !== binding.id); setConfig({ ...config, bindings: remaining, points: config.points.filter(item => item.id !== binding.pointId || remaining.some(other => other.pointId === item.id)) }); setBindingId(remaining[0]?.id ?? ""); }}>删除这个动作</button>{bindingInUse ? <p className="twin-help">其他动作正在跟随这个动作，请先修改它们的跟随关系。</p> : null}
          </section> : <p className="twin-empty">添加动作，选择接口字段与模型部件，即可让部件跟随数据变化。</p>}
        </> : null}
        {tab === "reuse" && config.source === "api" ? <TwinBindingRemap config={config} scene={scene} catalog={catalog} onChange={setConfig} /> : null}
        {tab === "collisions" && config.source === "api" ? <>
          <div className="twin-row"><label><span>选择碰撞部件</span><Select value={colliderId} onValueChange={setColliderId}><option value="">请选择碰撞部件</option>{config.colliders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label><button className="secondary-button compact-button" type="button" disabled={config.colliders.length >= TWIN_DRIVE_LIMITS.colliders} onClick={() => { const nextId = id("collider"); setConfig({ ...config, colliders: [...config.colliders, { id: nextId, label: "新碰撞部件", target: emptyTarget(), center: [0, 0, 0], size: [1, 1, 1] }] }); setColliderId(nextId); }}>＋ 添加碰撞部件</button></div>
          {collider ? <section className="twin-card"><TextField label="碰撞部件名称" value={collider.label} onChange={(label) => patchCollider({ label })} /><TargetFields key={collider.id} target={collider.target} onChange={(target) => patchCollider({ target })} scene={scene} catalog={catalog} /><VectorField label="检测盒中心" value={collider.center} onChange={(center) => patchCollider({ center })} /><VectorField label="检测盒尺寸（正数）" value={collider.size} onChange={(size) => patchCollider({ size })} /><button className="secondary-button compact-button twin-danger" type="button" disabled={Boolean(colliderInUse)} onClick={() => { setConfig({ ...config, colliders: config.colliders.filter((item) => item.id !== collider.id) }); setColliderId(""); }}>删除碰撞部件</button>{colliderInUse ? <p className="twin-help">这个部件仍被碰撞规则使用，请先移除对应规则。</p> : null}</section> : null}
          <h3>碰撞提示规则</h3><p className="twin-help">检查指定部件是否接触，显示进入和离开提示。仅用于模型演示，不控制真实设备。</p>
          {config.collisionRules.map((rule) => <section className="twin-card" key={rule.id}><div className="twin-fields"><TextField label="规则名称" value={rule.label} onChange={(label) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, label } : item) })} /><label><span>提示等级</span><Select value={rule.severity} onValueChange={(severity) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, severity: severity as "warning" | "error" } : item) })}><option value="warning">警告</option><option value="error">错误</option></Select></label>{(["first", "second"] as const).map((key, index) => <label key={key}><span>碰撞部件 {index + 1}</span><Select value={rule[key]} onValueChange={(value) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, [key]: value } : item) })}><option value="">请选择部件</option>{config.colliders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>)}</div><div className="twin-row"><label className="twin-check"><input type="checkbox" checked={rule.enabled} onChange={(event) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) })} />启用规则</label><button className="secondary-button compact-button twin-danger" type="button" onClick={() => setConfig({ ...config, collisionRules: config.collisionRules.filter((item) => item.id !== rule.id) })}>删除规则</button></div></section>)}
          <button className="secondary-button" type="button" disabled={config.colliders.length < 2 || config.collisionRules.length >= TWIN_DRIVE_LIMITS.collisionRules} onClick={() => setConfig({ ...config, collisionRules: [...config.collisionRules, { id: id("collision"), label: "新碰撞提示", first: config.colliders[0]!.id, second: config.colliders[1]!.id, severity: "warning", enabled: true }] })}>＋ 添加碰撞规则</button>
        </> : null}
        {config.source === "simulator" && tab !== "source" && tab !== "advanced" && tab !== "test" ? <p className="twin-readonly">旧版平台模拟配置已停用。请在“连接接口”选择“重新接入接口”。</p> : null}
        <div hidden={tab !== "advanced"} className="twin-advanced-page">
          <section className="twin-card"><label><span>配置说明</span><textarea rows={3} maxLength={4000} placeholder="记录这套配置的用途、模型或动作范围" value={config.description ?? ""} onChange={(event) => setConfig({ ...config, description: event.target.value })} /></label></section>
          <JsonEditor key={jsonGeneration} value={config} onApply={(next) => setConfig(parseTwinDriveConfig(next))} onDraftChange={setJsonDirty} />
        </div>
      </fieldset>
    </div></div>
    <footer className="twin-workspace-footer">
      <div className="twin-workspace-messages">
      {confirmLeave && dirty ? <div className="twin-exit-confirm" role="alert"><span>还有未保存的修改，离开后将丢失。</span><button className="secondary-button compact-button" type="button" onClick={() => setConfirmLeave(false)}>继续编辑</button><button className="secondary-button compact-button twin-danger" type="button" onClick={onClose}>放弃修改并返回</button></div> : null}
      {nativeConflict ? <p role="alert" className="twin-error">模型还在播放自带动画。请返回模型，关闭对应模型动画并保存场景，再启用数据驱动。</p> : null}
      {conflict ? <div role="alert" className="twin-error">配置已被其他操作更新，当前修改已保留。请先载入最新配置。<button className="secondary-button compact-button" type="button" disabled={saving} onClick={() => { setConfig(structuredClone(document.config)); setBaseRevision(document.revision); setBaseline(JSON.stringify(document.config)); setJsonDirty(false); setJsonGeneration((value) => value + 1);   }}>放弃草稿并载入最新配置</button></div> : null}
      {jsonDirty ? <p className="twin-error">还有未应用的 JSON 修改，请在高级配置中应用或放弃后保存。</p> : null}
      {errors.length ? <div className="twin-validation"><p>{errors.length} 项配置需要修正</p><ul>{errors.map((message, index) => <li key={index}>{message}</li>)}</ul></div> : null}
      </div>
      <div className="twin-row twin-workspace-actions"><span className="twin-footer-note">{!document.editable ? "当前账号只能查看配置" : "修改后保存，才会用于模型运行。"}</span><div className="twin-footer-actions">
        {stepIndex > 0 ? <button type="button" className="secondary-button compact-button" onClick={() => changeTab(primarySteps[stepIndex - 1]!.id)}>上一步</button> : null}
        {stepIndex < 0 ? <button type="button" className="secondary-button compact-button" onClick={() => changeTab("source")}>返回配置流程</button> : null}
        {stepIndex >= 0 && stepIndex < primarySteps.length - 1 ? <button type="button" className="secondary-button compact-button" onClick={() => changeTab(primarySteps[stepIndex + 1]!.id)}>下一步</button> : null}
        <button type="button" className="primary-button" disabled={!document.editable || config.source !== "api" || saving || errors.length > 0 || nativeConflict || conflict || jsonDirty} onClick={() => void save()}>{saving ? "保存中…" : "保存配置"}</button>
      </div></div>
    </footer>
  </section>;
}
