import { useEffect, useRef, useState, type ReactNode } from "react";
import { TWIN_DRIVE_LIMITS, twinDriveErrors, twinDrivePath, type TwinDriveConfig, type TwinDriveDocument, type TwinTarget, type TwinVector, type TwinMotionBinding, type TwinCollider } from "../../../../shared/twin-drive";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import type { TwinNodeCatalogEntry } from "../scene/twin-drive-runtime";
import { errorMessage, request } from "../api";
import { projectAssetsPath, type ProjectAsset, type ProjectAssetListResponse } from "../canvas/assets";
import { Select } from "../components/Select";
import { ThemeToggle } from "../theme/ThemeToggle";
import { parseTwinDriveConfig } from "./twin-config-json";
import { TwinSourceStep } from "./TwinSourceStep";
import { TwinBindingRemap } from "./TwinBindingRemap";
import { TwinPoseFields } from "./TwinPoseFields";
import { TwinProcedureFields } from "./TwinProcedureFields";
import "./twin-drive.css";

const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
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
      catch (reason) { setError(errorMessage(reason)); }
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
  { id: "source", label: "选择数据源", hint: "数据从哪里来" }, { id: "points", label: "选择数据", hint: "填写 Topic 与订阅数据" },
  { id: "bindings", label: "绑定模型部件", hint: "选择部件与运动方式" }, { id: "test", label: "接入测试", hint: "检查数据和模型动作" },
] as const;
const secondarySteps = [
  { id: "reuse", label: "更换模型", hint: "保留数据与动作，重新对应部件" }, { id: "procedures", label: "模拟流程", hint: "用模拟数据验证动作顺序" },
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
  const [pointId, setPointId] = useState(config.points[0]?.id ?? "");
  const [bindingId, setBindingId] = useState(config.bindings[0]?.id ?? "");
  const [colliderId, setColliderId] = useState(config.colliders[0]?.id ?? "");
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [assetRequest, setAssetRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [jsonDirty, setJsonDirty] = useState(false);
  const [jsonGeneration, setJsonGeneration] = useState(0);
  const [pendingMotionKind, setPendingMotionKind] = useState<{ bindingId: string; kind: TwinMotionBinding["kind"] } | null>(null);
  const point = config.points.find((item) => item.id === pointId);
  const binding = config.bindings.find((item) => item.id === bindingId);
  const collider = config.colliders.find((item) => item.id === colliderId);
  const errors = validateConfig(config, scene, catalog);
  const conflict = baseRevision !== document.revision;
  const dirty = JSON.stringify(config) !== baseline || jsonDirty;
  const section = [...primarySteps, ...secondarySteps].find((step) => step.id === tab)!;
  const stepIndex = primarySteps.findIndex((step) => step.id === tab);
  const pointInUse = point && (config.bindings.some((item) => item.pointId === point.id) || config.procedures.some((item) => item.steps.some((step) => step.targets.some((target) => target.pointId === point.id))));
  const bindingInUse = binding && config.bindings.some((item) => item.parentBindingId === binding.id);
  const colliderInUse = collider && config.collisionRules.some((item) => item.first === collider.id || item.second === collider.id);
  const nativeConflict = config.enabled && scene.settings.playAnimations && config.bindings.some((item) => scene.instances.some((instance) => instance.id === item.target.instanceId && instance.animation?.enabled !== false));
  const patchPoint = (patch: Partial<NonNullable<typeof point>>) => setConfig({ ...config, points: config.points.map((item) => item.id === pointId ? { ...item, ...patch } : item) });
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
  useEffect(() => {
    let active = true;
    setAssetsLoading(true); setAssetsError(null);
    void request<ProjectAssetListResponse>(projectAssetsPath(document.projectId)).then((result) => { if (active) setAssets(result.assets); })
      .catch((reason) => { if (active) setAssetsError(errorMessage(reason)); })
      .finally(() => { if (active) setAssetsLoading(false); });
    return () => { active = false; };
  }, [document.projectId, assetRequest]);
  const save = async () => {
    if (saving || errors.length || conflict || nativeConflict || jsonDirty || !document.editable) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await request<TwinDriveDocument>(twinDrivePath(document.projectId), { method: "PUT", body: JSON.stringify({ expectedRevision: baseRevision, config }) });
      setConfig(structuredClone(result.config)); setBaseRevision(result.revision); setBaseline(JSON.stringify(result.config)); setConfirmLeave(false); onSaved(result);
      setNotice(`已保存${result.config.simulation?.enabled ? "，自动模拟已启用。" : "。"}`);
    } catch (reason) { setError(errorMessage(reason)); }
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
      <div className="twin-section-heading"><span>{stepIndex >= 0 ? `步骤 ${stepIndex + 1} / 4` : "更多配置"}</span><h2>{section.label}</h2><p>{section.hint}</p></div>
      {tab === "test" ? <section className="twin-connection-test"><p className={dirty || conflict ? "twin-error" : "twin-readonly"}>{dirty || conflict ? "当前有未保存的修改。这里只测试已保存的配置。" : "正在检查已保存的配置。退出测试不会停止自动模拟。"}</p>{connectionTest}</section> : null}
      <fieldset className="twin-editor-body" disabled={!document.editable || saving}>
        {tab === "source" ? <TwinSourceStep config={config} onChange={setConfig} onContinue={() => changeTab("points")} /> : null}
        {tab === "points" ? <>
          <div className="twin-row"><label><span>选择已配置的数据</span><Select value={pointId} onValueChange={setPointId}><option value="">请选择数据</option>{config.points.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label><button className="secondary-button compact-button" type="button" disabled={config.points.length >= TWIN_DRIVE_LIMITS.points} onClick={() => { const nextId = id("point"); setConfig({ ...config, points: [...config.points, { id: nextId, label: "新数据", assetId: "", metricKey: nextId, unit: "m", min: 0, max: 10, initialValue: 0, maxSpeed: 1, staleAfterMs: 3000 }] }); setPointId(nextId); }}>＋ 添加数据</button></div>
          {config.points.length >= TWIN_DRIVE_LIMITS.points ? <p className="twin-help">最多配置 {TWIN_DRIVE_LIMITS.points} 项数据。</p> : null}
          {assetsError ? <div className="twin-error" role="alert">设备列表加载失败：{assetsError}<button type="button" className="secondary-button compact-button" onClick={() => setAssetRequest((value) => value + 1)}>重试加载设备</button></div> : null}
          {point ? <section className="twin-card"><div className="twin-fields">
            <TextField label="数据名称" value={point.label} placeholder="例如：升降台高度" onChange={(label) => patchPoint({ label })} />
            <label><span>所属设备</span><Select value={point.assetId} disabled={assetsLoading} onValueChange={(assetId) => patchPoint({ assetId })}><option value="">{assetsLoading ? "正在加载设备…" : "请选择设备"}</option>{point.assetId && !assets.some((asset) => asset.assetId === point.assetId) ? <option value={point.assetId}>{point.assetId}（未在设备列表中找到）</option> : null}{assets.map((asset) => <option value={asset.assetId} key={asset.id}>{asset.name} · {asset.assetId}</option>)}</Select></label>
            <TextField label="订阅 Topic" maxLength={200} placeholder="例如：line1/lift/height" value={point.topic ?? ""} onChange={(topic) => { if (topic === "") { const { topic: _removed, ...withoutTopic } = point; setConfig({ ...config, points: config.points.map((item) => item.id === point.id ? withoutTopic : item) }); } else patchPoint({ topic }); }} />
            <TextField label="数据单位" maxLength={32} value={point.unit} placeholder="例如：m、度" onChange={(unit) => patchPoint({ unit })} />
          </div><p className="twin-help">保存后会自动订阅填写的 Topic。每项数据使用独立 Topic，名称需与平台模拟源一致。</p>
          <details className="twin-advanced"><summary>数据范围与高级设置</summary><div className="twin-fields">
            <NumberField label="最小值" value={point.min} min={-1e6} max={1e6} onChange={(min) => patchPoint({ min })} /><NumberField label="最大值" value={point.max} min={-1e6} max={1e6} onChange={(max) => patchPoint({ max })} />
            <NumberField label="模拟初始值" value={point.initialValue} min={point.min} max={point.max} onChange={(initialValue) => patchPoint({ initialValue })} /><NumberField label="模拟速度（单位 / 秒）" value={point.maxSpeed} min={0} max={1e6} onChange={(maxSpeed) => patchPoint({ maxSpeed })} />
            <NumberField label="数据过期时间（毫秒）" value={point.staleAfterMs} min={500} max={60000} onChange={(staleAfterMs) => patchPoint({ staleAfterMs })} />
            <TextField label="指标编号" value={point.metricKey} maxLength={80} onChange={(metricKey) => patchPoint({ metricKey })} /><TextField label="手动填写设备编号" value={point.assetId} maxLength={80} onChange={(assetId) => patchPoint({ assetId })} />
          </div><p className="twin-help">设备不在列表中时，可填写约定的设备编号。编号使用字母、数字、点、下划线、冒号或连字符。</p></details>
          <button className="secondary-button compact-button twin-danger" type="button" disabled={Boolean(pointInUse)} onClick={() => { setConfig({ ...config, points: config.points.filter((item) => item.id !== point.id) }); setPointId(""); }}>删除这项数据</button>{pointInUse ? <p className="twin-help">这项数据仍被部件或模拟流程使用，请先解除对应关系。</p> : null}</section> : <p className="twin-empty">添加一项数据，例如高度或转角，然后将它绑定到模型部件。</p>}
        </> : null}
        {tab === "bindings" ? <>
          <div className="twin-row"><label><span>选择已绑定的部件</span><Select value={bindingId} onValueChange={setBindingId}><option value="">请选择绑定</option>{config.bindings.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label><button className="secondary-button compact-button" type="button" disabled={!config.points.length || config.bindings.length >= TWIN_DRIVE_LIMITS.bindings} onClick={() => { const nextId = id("motion"); setConfig({ ...config, bindings: [...config.bindings, { id: nextId, label: "新部件动作", pointId: config.points[0]!.id, target: emptyTarget(), parentBindingId: null, useNodeRestPose: true, kind: "translation", axis: [1, 0, 0], pivot: [0, 0, 0], valueScale: 1, valueOffset: 0, poses: [] }] }); setBindingId(nextId); }}>＋ 绑定部件</button></div>
          {binding ? <section className="twin-card"><div className="twin-fields"><TextField label="动作名称" value={binding.label} placeholder="例如：升降台升降" onChange={(label) => patchBinding({ label })} /><label><span>使用哪项数据</span><Select value={binding.pointId} onValueChange={(pointId) => patchBinding({ pointId })}><option value="">请选择数据</option>{binding.pointId && !config.points.some((item) => item.id === binding.pointId) ? <option value={binding.pointId}>原数据已删除</option> : null}{config.points.map((item) => <option key={item.id} value={item.id}>{item.label}{item.unit ? `（${item.unit}）` : ""}</option>)}</Select></label></div>
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
            </details><button className="secondary-button compact-button twin-danger" type="button" disabled={Boolean(bindingInUse)} onClick={() => { setConfig({ ...config, bindings: config.bindings.filter((item) => item.id !== binding.id) }); setBindingId(""); }}>删除这个绑定</button>{bindingInUse ? <p className="twin-help">其他动作正在跟随这个动作，请先修改它们的跟随关系。</p> : null}
          </section> : <p className="twin-empty">先添加数据，再选择要控制的模型部件。</p>}
        </> : null}
        {tab === "reuse" ? <TwinBindingRemap config={config} scene={scene} catalog={catalog} onChange={setConfig} /> : null}
        {tab === "procedures" ? <TwinProcedureFields config={config} onChange={setConfig} /> : null}
        {tab === "collisions" ? <>
          <div className="twin-row"><label><span>选择碰撞部件</span><Select value={colliderId} onValueChange={setColliderId}><option value="">请选择碰撞部件</option>{config.colliders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label><button className="secondary-button compact-button" type="button" disabled={config.colliders.length >= TWIN_DRIVE_LIMITS.colliders} onClick={() => { const nextId = id("collider"); setConfig({ ...config, colliders: [...config.colliders, { id: nextId, label: "新碰撞部件", target: emptyTarget(), center: [0, 0, 0], size: [1, 1, 1] }] }); setColliderId(nextId); }}>＋ 添加碰撞部件</button></div>
          {collider ? <section className="twin-card"><TextField label="碰撞部件名称" value={collider.label} onChange={(label) => patchCollider({ label })} /><TargetFields key={collider.id} target={collider.target} onChange={(target) => patchCollider({ target })} scene={scene} catalog={catalog} /><VectorField label="检测盒中心" value={collider.center} onChange={(center) => patchCollider({ center })} /><VectorField label="检测盒尺寸（正数）" value={collider.size} onChange={(size) => patchCollider({ size })} /><button className="secondary-button compact-button twin-danger" type="button" disabled={Boolean(colliderInUse)} onClick={() => { setConfig({ ...config, colliders: config.colliders.filter((item) => item.id !== collider.id) }); setColliderId(""); }}>删除碰撞部件</button>{colliderInUse ? <p className="twin-help">这个部件仍被碰撞规则使用，请先移除对应规则。</p> : null}</section> : null}
          <h3>碰撞提示规则</h3><p className="twin-help">检查指定部件是否接触，显示进入和离开提示。仅用于模型演示，不控制真实设备。</p>
          {config.collisionRules.map((rule) => <section className="twin-card" key={rule.id}><div className="twin-fields"><TextField label="规则名称" value={rule.label} onChange={(label) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, label } : item) })} /><label><span>提示等级</span><Select value={rule.severity} onValueChange={(severity) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, severity: severity as "warning" | "error" } : item) })}><option value="warning">警告</option><option value="error">错误</option></Select></label>{(["first", "second"] as const).map((key, index) => <label key={key}><span>碰撞部件 {index + 1}</span><Select value={rule[key]} onValueChange={(value) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, [key]: value } : item) })}><option value="">请选择部件</option>{config.colliders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>)}</div><div className="twin-row"><label className="twin-check"><input type="checkbox" checked={rule.enabled} onChange={(event) => setConfig({ ...config, collisionRules: config.collisionRules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) })} />启用规则</label><button className="secondary-button compact-button twin-danger" type="button" onClick={() => setConfig({ ...config, collisionRules: config.collisionRules.filter((item) => item.id !== rule.id) })}>删除规则</button></div></section>)}
          <button className="secondary-button" type="button" disabled={config.colliders.length < 2 || config.collisionRules.length >= TWIN_DRIVE_LIMITS.collisionRules} onClick={() => setConfig({ ...config, collisionRules: [...config.collisionRules, { id: id("collision"), label: "新碰撞提示", first: config.colliders[0]!.id, second: config.colliders[1]!.id, severity: "warning", enabled: true }] })}>＋ 添加碰撞规则</button>
        </> : null}
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
      {conflict ? <div role="alert" className="twin-error">配置已被其他操作更新，当前修改已保留。请先载入最新配置。<button className="secondary-button compact-button" type="button" disabled={saving} onClick={() => { setConfig(structuredClone(document.config)); setBaseRevision(document.revision); setBaseline(JSON.stringify(document.config)); setJsonDirty(false); setJsonGeneration((value) => value + 1); setError(null); setNotice(null); }}>放弃草稿并载入最新配置</button></div> : null}
      {jsonDirty ? <p className="twin-error">还有未应用的 JSON 修改，请在高级配置中应用或放弃后保存。</p> : null}
      {errors.length ? <details className="twin-validation"><summary>{errors.length} 项配置需要修正</summary><ul>{errors.map((message, index) => <li key={index}>{message}</li>)}</ul></details> : null}
      {error ? <p className="twin-error" role="alert">{error}</p> : null}{notice && !dirty ? <p className="twin-success" role="status">{notice}</p> : null}
      </div>
      <div className="twin-row twin-workspace-actions"><span className="twin-footer-note">{!document.editable ? "当前账号只能查看配置" : "修改后保存，才会用于模型运行。"}</span><div className="twin-footer-actions">
        {stepIndex > 0 ? <button type="button" className="secondary-button compact-button" onClick={() => changeTab(primarySteps[stepIndex - 1]!.id)}>上一步</button> : null}
        {stepIndex < 0 ? <button type="button" className="secondary-button compact-button" onClick={() => changeTab("source")}>返回配置流程</button> : null}
        {stepIndex >= 0 && stepIndex < primarySteps.length - 1 ? <button type="button" className="secondary-button compact-button" onClick={() => changeTab(primarySteps[stepIndex + 1]!.id)}>下一步</button> : null}
        <button type="button" className="primary-button" disabled={!document.editable || saving || errors.length > 0 || nativeConflict || conflict || jsonDirty} onClick={() => void save()}>{saving ? "保存中…" : "保存配置"}</button>
      </div></div>
    </footer>
  </section>;
}
