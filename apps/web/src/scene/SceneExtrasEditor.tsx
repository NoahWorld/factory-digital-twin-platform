import { createUuid } from "../uuid";
import { useEffect, useMemo, useState } from "react";
import { Select } from "../components/Select";
import { errorMessage, request } from "../api";
import { assetDataBindingsPath, type AssetDataBindingListResponse } from "../canvas/asset-data-bindings";
import type { ProjectAsset } from "../canvas/assets";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { createSceneDecoration, SCENE_DECORATION_LIMITS, type DecorationKind, type SceneDecoration } from "../../../../shared/scene-decorations";
import { ROOM_ALARM_LIMITS, type RoomAlarmRule } from "../../../../shared/room-alarms";
import { importGeoJson, STATIC_MAP_EXAMPLE, STATIC_MAP_LIMITS, type StaticMapDefinition } from "../../../../shared/static-map";
import type { TwinNodeCatalogEntry } from "./twin-drive-runtime";
import type { RoomAlarmStatus } from "./room-alarm-runtime";
import "./scene-extras.css";

type Source = { projectId: string; label: string; assets: ProjectAsset[]; loading: boolean; error: string | null };
type SceneExtrasSelection = { id: string; kind: "decoration" | "map" };
export type SceneExtrasEditorProps = {
  disabled: boolean; scene: StandaloneSceneDocument; decorations: SceneDecoration[]; roomAlarms: RoomAlarmRule[];
  staticMap: StaticMapDefinition | null; catalog: TwinNodeCatalogEntry[]; sources: Source[]; alarmStatuses?: RoomAlarmStatus[];
  onDecorationsChange: (items: SceneDecoration[]) => void; onRoomAlarmsChange: (items: RoomAlarmRule[]) => void;
  onStaticMapChange: (map: StaticMapDefinition | null) => void; onPendingChange?: (pending: boolean) => void;
  focusRequest?: SceneExtrasSelection & { requestId: number };
  onSelectionChange?: (selection: SceneExtrasSelection | null) => void;
  selection?: SceneExtrasSelection | null;
};
type Vec3 = [number, number, number];
type Tab = "environment" | "military" | "alarms" | "map";
const tabs: { id: Tab; label: string }[] = [{ id: "environment", label: "环境" }, { id: "military", label: "军事" }, { id: "alarms", label: "房间报警" }, { id: "map", label: "地图" }];
const labels: Record<DecorationKind, string> = { tree: "乔木", shrub: "灌木", river: "河流", "military-truck": "运输车", "military-tent": "帐篷", "military-radar": "雷达", "military-armored": "装甲车" };
const militaryKinds: DecorationKind[] = ["military-truck", "military-tent", "military-radar", "military-armored"];
const alarmLabels: Record<RoomAlarmStatus["state"], string> = { normal: "正常", alarm: "报警", waiting: "等待数据", stale: "数据陈旧", offline: "失联", error: "错误" };
function Numeric({ name, value, min, max, disabled, onChange, onInvalid, integer = false, exclusiveMin = false }: { name: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void; onInvalid: (name: string, bad: boolean) => void; integer?: boolean; exclusiveMin?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); onInvalid(name, false); }, [value, name]);
  useEffect(() => () => onInvalid(name, false), [name]);
  const valid = text.trim() !== "" && Number.isFinite(Number(text)) && (exclusiveMin ? Number(text) > min : Number(text) >= min) && Number(text) <= max && (!integer || Number.isInteger(Number(text)));
  return <label>
<span>{name}</span>
<input type="number" min={min} max={max} step="any" inputMode="decimal" disabled={disabled} value={text} aria-invalid={!valid} onChange={(event) => { const next = event.target.value; setText(next); const number = Number(next); const good = next.trim() !== "" && Number.isFinite(number) && (exclusiveMin ? number > min : number >= min) && number <= max && (!integer || Number.isInteger(number)); onInvalid(name, !good); if (good) onChange(number); }} />
</label>;
}
function Vector({ name, value, min, max, disabled, onChange, onInvalid, exclusiveMin = false }: { name: string; value: Vec3; min: number; max: number; disabled: boolean; onChange: (value: Vec3) => void; onInvalid: (name: string, bad: boolean) => void; exclusiveMin?: boolean }) {
  return <div className="scene-extras-vector">
<strong>{name}</strong>
<div>{(["X", "Y", "Z"] as const).map((axis, index) => <Numeric key={axis} exclusiveMin={exclusiveMin} name={name + " " + axis} value={value[index]} min={min} max={max} disabled={disabled} onInvalid={onInvalid} onChange={(next) => onChange(value.map((v, i) => i === index ? next : v) as Vec3)} />)}</div>
</div>;
}
function Color({ name, value, disabled, onChange }: { name: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label>
<span>{name}</span>
<input type="color" aria-label={name} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
</label>;
}

export function SceneExtrasEditor({ disabled, scene, decorations, roomAlarms, staticMap, catalog, sources, alarmStatuses, onDecorationsChange, onRoomAlarmsChange, onStaticMapChange, onPendingChange, focusRequest, onSelectionChange, selection }: SceneExtrasEditorProps) {
  const [tab, setTab] = useState<Tab>("environment");
  const [decorationId, setDecorationId] = useState<string | null>(null);
  useEffect(() => { if (selection !== undefined) setDecorationId(selection?.kind === "decoration" ? selection.id : null); }, [selection?.id, selection?.kind]);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const [geoText, setGeoText] = useState("");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoOptions, setGeoOptions] = useState({ label: "厂区地图", coordinateSystem: "local" as "local" | "wgs84", width: 100, defaultHeight: 4, color: "#778b7a", outlineColor: "#b8d7bd" });
  const [metricKeys, setMetricKeys] = useState<string[]>([]);
  const [metricError, setMetricError] = useState<string | null>(null);
  const [metricLoading, setMetricLoading] = useState(false);
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.kind === "map") {
      if (staticMap?.id !== focusRequest.id) return;
      setTab("map");
      setDecorationId(null);
    } else {
      const target = decorations.find((item) => item.id === focusRequest.id);
      if (!target) return;
      setTab(target.kind.startsWith("military-") ? "military" : "environment");
      setDecorationId(target.id);
    }
  }, [focusRequest?.requestId, focusRequest?.id, focusRequest?.kind]);
  const decoration = decorations.find((item) => item.id === decorationId);
  const rule = roomAlarms.find((item) => item.id === ruleId);
  const source = sources.find((item) => item.projectId === rule?.source.projectId);
  const asset = source?.assets.find((item) => item.assetId === rule?.source.assetId);
  const bindingPath = rule && asset ? assetDataBindingsPath(rule.source.projectId, asset.id) : null;
  const pending = geoText.trim() !== "" || Object.values(bad).some(Boolean);
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => {
    setMetricKeys([]); setMetricError(null);
    if (!bindingPath) { setMetricLoading(false); return; }
    let active = true; setMetricLoading(true);
    void request<AssetDataBindingListResponse>(bindingPath).then((result) => { if (active) setMetricKeys([...new Set(result.dataBindings.map((item) => item.metricKey))]); }).catch((error: unknown) => { if (active) setMetricError(errorMessage(error)); }).finally(() => { if (active) setMetricLoading(false); });
    return () => { active = false; };
  }, [bindingPath]);
  const setInvalid = (name: string, invalid: boolean) => setBad((old) => old[name] === invalid ? old : { ...old, [name]: invalid });
  const changeDecoration = (patch: Partial<SceneDecoration>) => { if (decoration && !disabled) onDecorationsChange(decorations.map((item) => item.id === decoration.id ? { ...item, ...patch } : item)); };
  const changeRule = (patch: Partial<RoomAlarmRule>) => { if (rule && !disabled) onRoomAlarmsChange(roomAlarms.map((item) => item.id === rule.id ? { ...item, ...patch } : item)); };
  const selectDecoration = (id: string) => { setDecorationId(id); onSelectionChange?.({ id, kind: "decoration" }); };
  const selectMap = (id: string) => { setDecorationId(null); setTab("map"); onSelectionChange?.({ id, kind: "map" }); };
  const addDecoration = (kind: DecorationKind) => { if (disabled || decorations.length >= SCENE_DECORATION_LIMITS.maximumDecorations) return; const item = createSceneDecoration(createUuid(), kind); onDecorationsChange([...decorations, item]); selectDecoration(item.id); };
  const changeTab = (next: Tab) => {
    setTab(next);
    const selected = decorations.find((item) => item.id === decorationId);
    if (next === "map" && staticMap) selectMap(staticMap.id);
    else if (next === "alarms" || !selected || selected.kind.startsWith("military-") !== (next === "military")) {
      setDecorationId(null);
      onSelectionChange?.(null);
    }
  };
  const instance = scene.instances.find((item) => item.id === rule?.target.instanceId);
  const nodes = useMemo(() => catalog.filter((item) => item.instanceId === rule?.target.instanceId && item.modelAssetId === rule?.target.modelAssetId && item.unique && item.drivable && item.nodeName.toLowerCase().includes(nodeSearch.toLowerCase())), [catalog, rule?.target.instanceId, rule?.target.modelAssetId, nodeSearch]);
  const status = alarmStatuses?.find((item) => item.id === ruleId);
  const changeMap = (patch: Partial<StaticMapDefinition>) => { if (staticMap && !disabled) onStaticMapChange({ ...staticMap, ...patch }); };
  const renderDecorations = (military: boolean) => <>
    <p className="scene-extras-note">选择对象，调整外观与位置后点击上方“保存场景”。</p>
    <fieldset disabled={disabled}>
<legend>添加对象</legend>
<div className="scene-extras-actions">{(military ? militaryKinds : ["tree", "shrub", "river"] as DecorationKind[]).map((kind) => <button key={kind} type="button" disabled={decorations.length >= SCENE_DECORATION_LIMITS.maximumDecorations} onClick={() => addDecoration(kind)}>+ {labels[kind]}</button>)}</div>
</fieldset>
    <div className="scene-extras-list" role="group" aria-label={military ? "军事对象" : "环境对象"}>{decorations.filter((item) => item.kind.startsWith("military-") === military).map((item) => <button key={item.id} type="button" aria-pressed={decorationId === item.id} onClick={() => selectDecoration(item.id)}>
<span>{item.label}</span>
<small>{labels[item.kind]} · {item.visible ? "显示" : "隐藏"}</small>
</button>)}</div>
    {decoration && decoration.kind.startsWith("military-") === military ? <fieldset disabled={disabled} key={decoration.id}>
<legend>编辑 {labels[decoration.kind]}</legend>
      <label>
<span>名称</span>
<input value={decoration.label} maxLength={80} onChange={(event) => changeDecoration({ label: event.target.value })} />
</label>
      <label className="scene-extras-check">
<input type="checkbox" checked={decoration.visible} onChange={(event) => changeDecoration({ visible: event.target.checked })} />显示</label>
      <details>
<summary>外观与位置</summary>
<div className="scene-extras-fields">
<Color name="主色" value={decoration.color} disabled={disabled} onChange={(color) => changeDecoration({ color })} />
<Color name="辅色" value={decoration.accentColor} disabled={disabled} onChange={(accentColor) => changeDecoration({ accentColor })} />
{(decoration.kind === "tree" || decoration.kind === "shrub") ? <Numeric name="随机种子" value={decoration.seed} min={0} max={0xffffffff} integer disabled={disabled} onInvalid={setInvalid} onChange={(seed) => changeDecoration({ seed })} /> : null}{(["position", "rotation", "scale"] as const).map((key) => <Vector key={key} name={{ position: "位置", rotation: "旋转", scale: "缩放" }[key]} value={decoration.transform[key]} min={key === "scale" ? 0.001 : key === "rotation" ? -3600 : -10000} max={key === "scale" ? 100 : key === "rotation" ? 3600 : 10000} disabled={disabled} onInvalid={setInvalid} onChange={(value) => changeDecoration({ transform: { ...decoration.transform, [key]: value } })} />)}</div>
</details>
      {decoration.kind === "river" && decoration.river ? <details>
<summary>河面路径与流动</summary>
<div className="scene-extras-fields">
<Numeric name="河面宽度" value={decoration.river.width} min={0.1} max={100} disabled={disabled} onInvalid={setInvalid} onChange={(width) => changeDecoration({ river: { ...decoration.river!, width } })} />
<Numeric name="流速" value={decoration.river.speed} min={0} max={10} disabled={disabled} onInvalid={setInvalid} onChange={(speed) => changeDecoration({ river: { ...decoration.river!, speed } })} />
<Numeric name="透明度" value={decoration.river.opacity} min={0.05} max={1} disabled={disabled} onInvalid={setInvalid} onChange={(opacity) => changeDecoration({ river: { ...decoration.river!, opacity } })} />
<label className="scene-extras-check">
<input type="checkbox" checked={decoration.river.playing} onChange={(event) => changeDecoration({ river: { ...decoration.river!, playing: event.target.checked } })} />播放</label>
        {decoration.river.points.map((point, index) => <div className="scene-extras-point" key={index}>
<Vector name={"路径点 " + (index + 1)} value={point} min={-10000} max={10000} disabled={disabled} onInvalid={setInvalid} onChange={(value) => changeDecoration({ river: { ...decoration.river!, points: decoration.river!.points.map((item, i) => i === index ? value : item) } })} />
<button type="button" className="is-danger" disabled={decoration.river!.points.length <= 2} onClick={() => changeDecoration({ river: { ...decoration.river!, points: decoration.river!.points.filter((_, i) => i !== index) } })}>删除此点</button>
</div>)}
        <button type="button" disabled={decoration.river.points.length >= SCENE_DECORATION_LIMITS.maximumRiverPoints} onClick={() => { const points = decoration.river!.points; const last = points[points.length - 1]; changeDecoration({ river: { ...decoration.river!, points: [...points, [last[0] + 2, last[1], last[2]]] } }); }}>添加路径点</button>
</div>
</details> : null}
      <div className="scene-extras-actions">
<button type="button" disabled={decorations.length >= SCENE_DECORATION_LIMITS.maximumDecorations} onClick={() => { const copy: SceneDecoration = { ...decoration, id: createUuid(), label: (decoration.label + " 副本").slice(0, 80), transform: { position: [...decoration.transform.position], rotation: [...decoration.transform.rotation], scale: [...decoration.transform.scale] }, ...(decoration.river ? { river: { ...decoration.river, points: decoration.river.points.map((point) => [...point] as Vec3) } } : {}) }; onDecorationsChange([...decorations, copy]); selectDecoration(copy.id); }}>复制</button>
<button type="button" className="is-danger" onClick={() => { onDecorationsChange(decorations.filter((item) => item.id !== decoration.id)); setDecorationId(null); onSelectionChange?.(null); }}>删除</button>
</div>
    </fieldset> : null}
  </>;
  return <section className="scene-extras" aria-label="场景扩展属性">
<div className="scene-extras-tabs" role="tablist" aria-label="扩展类别">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} aria-controls={"scene-extras-" + item.id} onClick={() => changeTab(item.id)}>{item.label}</button>)}</div>
<div id={"scene-extras-" + tab} role="tabpanel" tabIndex={0}>
    {tab === "environment" ? renderDecorations(false) : null}{tab === "military" ? renderDecorations(true) : null}
    {tab === "alarms" ? <>
<p className="scene-extras-note">数据来自已授权项目；状态只依据运行观察。修改后点击“保存场景”。</p>
<fieldset disabled={disabled}>
<legend>报警规则</legend>
<button type="button" disabled={roomAlarms.length >= ROOM_ALARM_LIMITS.maximumRules} onClick={() => { const firstInstance = scene.instances[0]; const firstSource = sources[0]; const next: RoomAlarmRule = { id: createUuid(), label: "新报警", enabled: false, source: { projectId: firstSource?.projectId ?? "", assetId: firstSource?.assets[0]?.assetId ?? "", metricKey: "" }, target: { instanceId: firstInstance?.id ?? "", modelAssetId: firstInstance?.modelAssetId ?? "", nodeName: "" }, condition: { operator: "gt", value: 0 }, color: "#ff4d4f" }; onRoomAlarmsChange([...roomAlarms, next]); setRuleId(next.id); }}>+ 添加规则</button>
</fieldset>
<div className="scene-extras-list" role="group" aria-label="报警规则">{roomAlarms.map((item) => <button key={item.id} type="button" aria-pressed={ruleId === item.id} onClick={() => setRuleId(item.id)}>
<span>{item.label}</span>
<small>{alarmLabels[alarmStatuses?.find((entry) => entry.id === item.id)?.state ?? "waiting"]}</small>
</button>)}</div>
      {rule ? <fieldset disabled={disabled} key={rule.id}>
<legend>编辑报警</legend>{status ? <p className={"scene-extras-status is-" + status.state} role={status.state === "error" || status.state === "offline" ? "alert" : "status"}>{alarmLabels[status.state]}：{status.message}</p> : <p className="scene-extras-note">等待运行状态；没有数据时不推断为正常。</p>}<label>
<span>名称</span>
<input value={rule.label} maxLength={80} onChange={(event) => changeRule({ label: event.target.value })} />
</label>
<label className="scene-extras-check">
<input type="checkbox" checked={rule.enabled} onChange={(event) => changeRule({ enabled: event.target.checked })} />启用</label>
<Color name="报警颜色" value={rule.color} disabled={disabled} onChange={(color) => changeRule({ color })} />
        <details open>
<summary>数据条件</summary>
<div className="scene-extras-fields">
<label>
<span>数据项目</span>
<Select value={rule.source.projectId} disabled={disabled} onValueChange={(projectId) => changeRule({ source: { projectId, assetId: "", metricKey: "" } })}>
<option value="">选择项目</option>{sources.map((item) => <option key={item.projectId} value={item.projectId}>{item.label}</option>)}</Select>
</label>{source?.loading ? <p className="scene-extras-note">正在读取资产…</p> : null}{source?.error ? <p className="scene-extras-error" role="alert">{source.error}</p> : null}<label>
<span>业务资产</span>
<Select value={rule.source.assetId} disabled={disabled || !source || source.loading} onValueChange={(assetId) => changeRule({ source: { ...rule.source, assetId, metricKey: "" } })}>
<option value="">选择资产</option>{source?.assets.map((item) => <option key={item.id} value={item.assetId}>{item.name} · {item.assetId}</option>)}</Select>
</label>
<label>
<span>指标键 metricKey</span>
<input value={rule.source.metricKey} list={"metrics-" + rule.id} onChange={(event) => changeRule({ source: { ...rule.source, metricKey: event.target.value } })} />
<datalist id={"metrics-" + rule.id}>{metricKeys.map((item) => <option key={item} value={item} />)}</datalist>
</label>{metricLoading ? <small>正在读取此资产指标…</small> : null}{metricError ? <p className="scene-extras-error" role="alert">指标读取失败：{metricError}</p> : null}<label>
<span>运算符</span>
<Select value={rule.condition.operator} disabled={disabled} onValueChange={(operator) => changeRule({ condition: { operator: operator as RoomAlarmRule["condition"]["operator"], value: operator === "eq" || typeof rule.condition.value === "number" ? rule.condition.value : 0 } })}>
<option value="eq">等于</option>
<option value="gt">大于</option>
<option value="gte">大于等于</option>
<option value="lt">小于</option>
<option value="lte">小于等于</option>
</Select>
</label>
<label>
<span>条件值类型</span>
<Select value={typeof rule.condition.value} disabled={disabled || rule.condition.operator !== "eq"} onValueChange={(type) => changeRule({ condition: { ...rule.condition, value: type === "boolean" ? false : type === "string" ? "" : 0 } })}>
<option value="number">数值</option>
<option value="boolean">布尔</option>
<option value="string">文本</option>
</Select>
</label>{typeof rule.condition.value === "number" ? <Numeric name="条件数值" value={rule.condition.value} min={-ROOM_ALARM_LIMITS.maximumNumericValue} max={ROOM_ALARM_LIMITS.maximumNumericValue} disabled={disabled} onInvalid={setInvalid} onChange={(value) => changeRule({ condition: { ...rule.condition, value } })} /> : typeof rule.condition.value === "boolean" ? <label>
<span>布尔条件</span>
<Select value={String(rule.condition.value)} disabled={disabled} onValueChange={(value) => changeRule({ condition: { ...rule.condition, value: value === "true" } })}>
<option value="true">真</option>
<option value="false">假</option>
</Select>
</label> : <label>
<span>文本条件</span>
<input value={rule.condition.value} maxLength={120} onChange={(event) => changeRule({ condition: { ...rule.condition, value: event.target.value } })} />
</label>}</div>
</details>
        <details>
<summary>模型房间</summary>
<div className="scene-extras-fields">
<label>
<span>场景实例</span>
<Select value={rule.target.instanceId} disabled={disabled} onValueChange={(instanceId) => { const next = scene.instances.find((item) => item.id === instanceId); changeRule({ target: { instanceId, modelAssetId: next?.modelAssetId ?? "", nodeName: "" } }); setNodeSearch(""); }}>
<option value="">选择实例</option>{scene.instances.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
</label>{instance ? <small>模型资源：{instance.modelAssetId}</small> : null}<label>
<span>搜索唯一节点</span>
<input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} />
</label>
<label>
<span>房间节点</span>
<Select value={rule.target.nodeName} disabled={disabled || !instance} onValueChange={(nodeName) => changeRule({ target: { ...rule.target, nodeName } })}>
<option value="">选择节点</option>{nodes.map((item) => <option key={item.nodeName} value={item.nodeName}>{item.nodeName}</option>)}{rule.target.nodeName && !nodes.some((item) => item.nodeName === rule.target.nodeName) ? <option value={rule.target.nodeName} disabled>{rule.target.nodeName}（不可选）</option> : null}</Select>
</label>
<small>仅列出当前模型中名称唯一的子节点；房间需要能够单独选择。</small>
</div>
</details>
<button type="button" className="is-danger" onClick={() => { onRoomAlarmsChange(roomAlarms.filter((item) => item.id !== rule.id)); setRuleId(null); }}>删除规则</button>
</fieldset> : null}</> : null}
    {tab === "map" ? <>
<p className="scene-extras-note">从本地文件读取 GeoJSON，生成预览后点击“保存场景”保存地图配置。</p>
<fieldset disabled={disabled}>
<legend>导入地图</legend>
<label>
<span>名称</span>
<input value={geoOptions.label} maxLength={80} onChange={(event) => setGeoOptions({ ...geoOptions, label: event.target.value })} />
</label>
<label>
<span>坐标系</span>
<Select value={geoOptions.coordinateSystem} disabled={disabled} onValueChange={(coordinateSystem) => setGeoOptions({ ...geoOptions, coordinateSystem: coordinateSystem as "local" | "wgs84" })}>
<option value="local">本地平面</option>
<option value="wgs84">WGS84 经纬度</option>
</Select>
</label>
<Numeric name="导入宽度" value={geoOptions.width} min={STATIC_MAP_LIMITS.minimumWidth} max={STATIC_MAP_LIMITS.maximumWidth} disabled={disabled} onInvalid={setInvalid} onChange={(width) => setGeoOptions((old) => ({ ...old, width }))} />
<Numeric name="默认高度" value={geoOptions.defaultHeight} min={0} max={STATIC_MAP_LIMITS.maximumHeight} disabled={disabled} onInvalid={setInvalid} onChange={(defaultHeight) => setGeoOptions((old) => ({ ...old, defaultHeight }))} />
<Color name="填充色" value={geoOptions.color} disabled={disabled} onChange={(color) => setGeoOptions({ ...geoOptions, color })} />
<Color name="轮廓色" value={geoOptions.outlineColor} disabled={disabled} onChange={(outlineColor) => setGeoOptions({ ...geoOptions, outlineColor })} />
<label>
<span>GeoJSON 文件（最大 512 KiB）</span>
<input type="file" accept=".json,.geojson,application/json,application/geo+json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (file.size > STATIC_MAP_LIMITS.maximumJsonBytes) { setGeoError("文件超过 512 KiB。"); return; } void file.text().then((value) => { setGeoText(value); setGeoError(null); }).catch((error: unknown) => setGeoError("读取失败：" + errorMessage(error))); }} />
</label>
<label>
<span>GeoJSON 内容</span>
<textarea rows={6} value={geoText} onChange={(event) => { setGeoText(event.target.value); setGeoError(null); }} placeholder="粘贴 FeatureCollection 或载入样例" />
</label>{geoError ? <p className="scene-extras-error" role="alert">{geoError}</p> : null}<div className="scene-extras-actions">
<button type="button" onClick={() => { setGeoText(JSON.stringify(STATIC_MAP_EXAMPLE, null, 2)); setGeoError(null); }}>载入样例</button>
<button type="button" disabled={!geoText.trim() || Object.values(bad).some(Boolean)} onClick={() => { const result = importGeoJson(geoText, { id: staticMap?.id ?? createUuid(), ...geoOptions }); if (!result.ok) { setGeoError(result.message); return; } onStaticMapChange(result.value); if (result.value) selectMap(result.value.id); setGeoText(""); setGeoError(null); }}>生成地图</button>
<button type="button" onClick={() => { setGeoText(""); setGeoError(null); }}>放弃输入</button>
</div>
</fieldset>
      {staticMap ? <fieldset disabled={disabled}>
<legend>当前地图 · {staticMap.features.length} 个要素</legend>
<label>
<span>名称</span>
<input value={staticMap.label} maxLength={80} onChange={(event) => changeMap({ label: event.target.value })} />
</label>
<label className="scene-extras-check">
<input type="checkbox" checked={staticMap.visible} onChange={(event) => changeMap({ visible: event.target.checked })} />显示地图</label>
<details>
<summary>位置与显示</summary>
<div className="scene-extras-fields">
<Numeric name="地图宽度" value={staticMap.width} min={STATIC_MAP_LIMITS.minimumWidth} max={STATIC_MAP_LIMITS.maximumWidth} disabled={disabled} onInvalid={setInvalid} onChange={(width) => changeMap({ width })} />
<Color name="轮廓色" value={staticMap.outlineColor} disabled={disabled} onChange={(outlineColor) => changeMap({ outlineColor })} />{(["position", "rotation", "scale"] as const).map((key) => <Vector key={key} name={{ position: "位置", rotation: "旋转", scale: "缩放" }[key]} value={staticMap.transform[key]} exclusiveMin={key === "scale"} min={key === "scale" ? 0.001 : key === "rotation" ? -3600 : -10000} max={key === "scale" ? 100 : key === "rotation" ? 3600 : 10000} disabled={disabled} onInvalid={setInvalid} onChange={(value) => changeMap({ transform: { ...staticMap.transform, [key]: value } })} />)}</div>
</details>
<details>
<summary>地图要素</summary>
<div className="scene-extras-features">{staticMap.features.map((feature) => <details key={feature.id}>
<summary>{feature.label}</summary>
<label>
<span>名称</span>
<input value={feature.label} maxLength={80} onChange={(event) => changeMap({ features: staticMap.features.map((item) => item.id === feature.id ? { ...item, label: event.target.value } : item) })} />
</label>
<Numeric name={feature.id + " 高度"} value={feature.height} min={0} max={STATIC_MAP_LIMITS.maximumHeight} disabled={disabled} onInvalid={setInvalid} onChange={(height) => changeMap({ features: staticMap.features.map((item) => item.id === feature.id ? { ...item, height } : item) })} />
<Color name="填充色" value={feature.color} disabled={disabled} onChange={(color) => changeMap({ features: staticMap.features.map((item) => item.id === feature.id ? { ...item, color } : item) })} />
</details>)}</div>
</details>
<button type="button" className="is-danger" onClick={() => { onStaticMapChange(null); onSelectionChange?.(null); }}>删除地图</button>
</fieldset> : <p className="scene-extras-note">当前没有地图。</p>}</> : null}
  </div>{pending ? <p className="scene-extras-error" role="status">有未应用地图输入或未完成的数值；请修正或放弃后保存。</p> : null}</section>;
}
