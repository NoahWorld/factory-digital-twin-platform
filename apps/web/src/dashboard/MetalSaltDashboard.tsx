import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { standaloneScenePath, standaloneSceneRoutePath, STANDALONE_3D_LIMITS, type StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { errorMessage, reportError, request, UserFacingError } from "../api";
import { Model3DNode } from "../canvas/Model3DNode";
import { standaloneRendererNode } from "../canvas/standalone-renderer-node";
import { bindDemoDevices, demoValue, metalSaltDemo, demoProduction, demoEnvironment, demoUtilities, deviceOperation, deviceMetricValue, type DemoDevice } from "./metal-salt-demo";
import "./metal-salt-dashboard.css";
import { chemicalWorkshopScene } from "./chemical-workshop-scene";

const ignoreNodeSelection = () => undefined;
type LoadedScene = { scene: StandaloneSceneDocument; bindings: Map<string, string> };

function Trend({ device, tick, index }: { device: DemoDevice; tick: number; index: number }) {
  const metric = device.metrics[0];
  const values = Array.from({ length: 31 }, (_, i) => deviceMetricValue(device, metric, tick - 30 + i, index));
  const low = device.key === "dispersion-b" ? 0 : metric.base - metric.amplitude * 1.5;
  const high = metric.base + metric.amplitude * 1.5;
  const points = values.map((value, i) => `${46 + i * 14.4},${104 - (value - low) / (high - low) * 76}`).join(" ");
  return <figure className="salt-trend">
    <figcaption>{metric.label}趋势 <span>最近 60 秒 · 模拟</span></figcaption>
    <svg viewBox="0 0 490 138" role="img" aria-label={`${device.label}${metric.label}模拟趋势，${low.toFixed(metric.digits)} 至 ${high.toFixed(metric.digits)} ${metric.unit}`}>
      {[28, 66, 104].map((y, i) => <g key={y}><line x1="46" y1={y} x2="478" y2={y} /><text x="0" y={y + 4}>{(high - i * (high - low) / 2).toFixed(metric.digits)}</text></g>)}
      <polyline points={points} />
      <text x="46" y="130">−60s</text><text x="246" y="130">−30s</text><text x="448" y="130">当前</text>
    </svg>
  </figure>;
}

export default function MetalSaltDashboard({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<LoadedScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<"front" | "top">("front");
  const [reset, setReset] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const [wideScreen, setWideScreen] = useState(() => window.matchMedia("(min-width: 1101px)").matches);
  const [controlError, setControlError] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const deviceButtons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null); setError(null); setSelectedKey(null);
    void request<{ scene: StandaloneSceneDocument }>(standaloneScenePath(projectId), { signal: controller.signal })
      .then(({ scene }) => {
        if (controller.signal.aborted) return;
        if (scene.projectId !== projectId) throw new UserFacingError("场景项目与看板地址不一致，请重新打开项目。");
        const bindings = bindDemoDevices(scene.instances);
        setLoaded({ scene, bindings });
      }).catch(reason => {
        if (controller.signal.aborted) return;
        reportError(reason, { operation: "dashboard.scene.load", projectId });
        setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [projectId, attempt]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (paused || !loaded) return;
    const timer = window.setInterval(() => { if (!document.hidden) setTick(value => value + 1); }, 2000);
    return () => clearInterval(timer);
  }, [paused, loaded]);
  useEffect(() => {
    const update = () => setFullScreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1101px)");
    const update = () => setWideScreen(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => { if (selectedKey) detailTitle.current?.focus({ preventScroll: true }); }, [selectedKey]);

  const rendererNode = useMemo(() => loaded ? standaloneRendererNode({ ...chemicalWorkshopScene(loaded.scene), settings: {
    ...loaded.scene.settings, backgroundColor: "#071525", backgroundOpacity: 0, autoRotate: false,
    cameraView: view, cameraFov: 42, modelScale: wideScreen ? 2.1 : 1.2, showGrid: false,
  } }) : null, [loaded, view, wideScreen]);
  const selectInstance = useCallback((_node: string, instanceId: string | null) => {
    if (!instanceId || !loaded) return;
    const match = [...loaded.bindings].find(([, id]) => id === instanceId);
    if (match) setSelectedKey(match[0]);
  }, [loaded]);
  const closeDetails = useCallback(() => {
    const key = selectedKeyRef.current;
    setSelectedKey(null);
    if (key) deviceButtons.current.get(key)?.focus({ preventScroll: true });
  }, []);
  const selected = metalSaltDemo.devices.find(device => device.key === selectedKey);
  const selectedIndex = metalSaltDemo.devices.findIndex(device => device.key === selectedKey);
  const fullscreen = async () => {
    setControlError(null);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else throw new UserFacingError("当前浏览器不支持全屏，请使用浏览器的全屏菜单。");
    } catch (reason) {
      reportError(reason, { operation: "dashboard.fullscreen", projectId });
      setControlError(reason instanceof UserFacingError ? reason.message : "浏览器未能进入或退出全屏。请切回此看板标签页后重试，或使用浏览器菜单中的全屏功能。");
    }
  };

  const devicePanel = (device: DemoDevice, index: number) => { const operation = deviceOperation(device, index); return <button
    className={`salt-device${selectedKey === device.key ? " is-selected" : ""}`} key={device.key}
    ref={element => { if (element) deviceButtons.current.set(device.key, element); else deviceButtons.current.delete(device.key); }}
    aria-label={`查看${device.label}详情`} aria-pressed={selectedKey === device.key}
    onClick={() => setSelectedKey(device.key)} type="button">
    <span className="salt-device-heading"><strong>{device.label}</strong><span className={operation.started ? "salt-running" : "salt-standby"}>{operation.state} · {operation.mode}</span></span>
    <span className="salt-device-stage">{String(index + 1).padStart(2, "0")} / {device.stage}<span>查看详情 ↗</span></span>
    <span className="salt-metrics">{device.metrics.map((metric, i) => <span key={metric.label}>
      <span className="salt-metric-label">{metric.label}</span><span className="salt-metric-value">{deviceMetricValue(device, metric, tick, index + i).toFixed(metric.digits)}<small>{metric.unit}</small></span>
    </span>)}</span>
    <span className="salt-device-status"><span>{operation.tag}</span><span>启停：{operation.started ? "启动" : "停止"}</span><span>联锁：{operation.interlock}</span></span>
  </button>; };

  return <main className="salt-dashboard" ref={root} onKeyDown={event => { if (event.key === "Escape" && selected) closeDetails(); }}>
    <header className="salt-header">
      <div className="salt-header-side"><a href={standaloneSceneRoutePath(projectId, "edit")}>返回场景</a><span className="salt-demo-badge">模拟数据</span></div>
      <div className="salt-title"><h1>{metalSaltDemo.title}</h1><p>贵金属 · 重金属分离产线</p></div>
      <div className="salt-header-side salt-header-end"><time dateTime={now.toISOString()}>{now.toLocaleDateString("zh-CN")}<b>{now.toLocaleTimeString("zh-CN", { hour12: false })}</b></time><button onClick={fullscreen} type="button">{fullScreen ? "退出全屏" : "全屏展示"}</button></div>
    </header>
    {error ? <section className="salt-state" role="alert"><h2>无法载入产线场景</h2><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>重新加载</button><small>重试次数：{attempt}</small></section> : !loaded || !rendererNode ? <section className="salt-state" role="status"><h2>正在载入车间场景</h2><p>读取 IoT 中保存的设备与车间布局…</p></section> : <>
      <div className="salt-scene" aria-label="可交互的三维生产车间">
        <Model3DNode key={`${projectId}:${reset}`} node={rendererNode} projectId={projectId}
          editable={false} interactive cameraControlsEnabled runtimeControlsEnabled={false}
          cameraFraming={view === "front" ? {direction: [0,.46,1], targetOffset: [0,-1.2,0]} : undefined}
          maximumModelInstances={STANDALONE_3D_LIMITS.maximumInstances} selectionStyle="runtime"
          selectedModelInstanceId={selectedKey ? loaded.bindings.get(selectedKey) : null}
          onModelInstanceSelect={selectInstance} onSceneNodeSelect={ignoreNodeSelection} selectedSceneNodePath={null}
          decorations={loaded.scene.decorations} staticMap={loaded.scene.staticMap} fluids={loaded.scene.fluids} />
      </div>
      <section className="salt-overview" aria-label="生产订单概况">
        <div><span>当前订单</span><strong className="salt-order-id">{demoProduction.order}</strong><span>{demoProduction.product} · {demoProduction.shift}</span></div>
        <div><span>本批产出 / 计划</span><strong>{demoProduction.completedKg}<small>/ {demoProduction.plannedKg} kg</small></strong><progress aria-label="订单完成率" value={demoProduction.completedKg} max={demoProduction.plannedKg}/></div>
        <div><span>完成率</span><strong>70<small>%</small></strong><span>计划 {demoProduction.startedAt}—{demoProduction.dueAt}</span></div>
        <div><span className="salt-running">{paused ? "模拟已暂停" : "6 台运行 · 1 台待机"}</span><span>批次 {demoProduction.batch}</span><span>活动告警 0 · 联锁就绪</span></div>
      </section>
      <aside className="salt-column salt-left" aria-label="反应与清洗设备模拟数据"><h2>反应与清洗<span>PROCESS / 01—03</span></h2>{metalSaltDemo.devices.slice(0, 3).map(devicePanel)}
        <section className="salt-process-panel"><h3>批次与质量</h3><dl><div><dt>生产批次</dt><dd>{demoProduction.batch}</dd></div><div><dt>抽检单号</dt><dd>{demoProduction.sample}</dd></div><div><dt>产品纯度</dt><dd>{demoProduction.purity}</dd></div><div><dt>金属回收率</dt><dd>{demoProduction.recovery}</dd></div><div><dt>质量判定</dt><dd>{demoProduction.inspection}</dd></div></dl></section>
      </aside>
      <aside className="salt-column salt-right" aria-label="分离与分散设备模拟数据"><h2>分离与分散<span>PROCESS / 04—07</span></h2>{metalSaltDemo.devices.slice(3).map((device, i) => devicePanel(device, i + 3))}</aside>
      <section className="salt-bottom-data" aria-label="环境与公用工程模拟数据">{[["车间环境",demoEnvironment],["公用工程",demoUtilities]].map(([title, metrics]) => <div className="salt-utility-group" key={String(title)}><h2>{String(title)}</h2><dl>{(metrics as typeof demoEnvironment).map((metric,i)=><div key={metric.label}><dt>{metric.label}</dt><dd>{demoValue(metric,tick,i).toFixed(metric.digits)}<small>{metric.unit}</small></dd></div>)}</dl></div>)}</section>
      <div className="salt-scene-controls" role="group" aria-label="场景展示控制">
        <button type="button" onClick={() => { setView("front"); setReset(value => value + 1); }}>产线正视</button>
        <button type="button" aria-pressed={view === "top"} onClick={() => setView(value => value === "top" ? "front" : "top")}>俯视布局</button>
        <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "继续模拟" : "暂停模拟"}</button>
        <span>拖拽旋转 · 滚轮缩放 · 点击设备查看详情</span>
      </div>
      {selected ? <section className="salt-detail" role="region" aria-label={`${selected.label}详情`}>
        <div className="salt-detail-head"><div><h2 tabIndex={-1} ref={detailTitle}>{selected.label}<span>设备详情</span></h2><p>{selected.stage} · {deviceOperation(selected,selectedIndex).state} · 自动模式</p></div><button type="button" aria-label="关闭设备详情" onClick={closeDetails}>关闭 ×</button></div>
        <dl className="salt-detail-context"><div><dt>订单号</dt><dd>{demoProduction.order}</dd></div><div><dt>批次号</dt><dd>{demoProduction.batch}</dd></div><div><dt>设备编号</dt><dd>{deviceOperation(selected,selectedIndex).tag}</dd></div><div><dt>累计运行</dt><dd>{deviceOperation(selected,selectedIndex).runHours} h</dd></div><div><dt>启停 / 联锁</dt><dd>{deviceOperation(selected,selectedIndex).started ? "启动" : "停止"} / 就绪</dd></div><div><dt>机旁湿度</dt><dd>{demoValue(deviceOperation(selected,selectedIndex).humidity,tick,selectedIndex)} %RH</dd></div><div><dt>驱动转速</dt><dd>{deviceMetricValue(selected,deviceOperation(selected,selectedIndex).rpm,tick,selectedIndex + Math.max(0, selected.metrics.findIndex(metric => metric.unit === "rpm")))} rpm</dd></div><div><dt>下次保养</dt><dd>{deviceOperation(selected,selectedIndex).maintenance}</dd></div></dl>
        <p className="salt-detail-copy">{selected.description}</p>
        <div className="salt-detail-data"><dl>{selected.metrics.map((metric, i) => <div key={metric.label}><dt>{metric.label}</dt><dd>{deviceMetricValue(selected, metric, tick, selectedIndex + i).toFixed(metric.digits)}<small>{metric.unit}</small></dd></div>)}</dl><Trend device={selected} index={selectedIndex} tick={tick} /></div>
        <p className="salt-detail-note">演示参数与趋势仅用于参观讲解，未连接现场设备，不作为生产控制依据。</p>
      </section> : null}
      <footer className="salt-footer"><span>工艺路径</span><nav aria-label="按工序查看设备">{metalSaltDemo.devices.map((device, i) => <button type="button" key={device.key} aria-pressed={selectedKey === device.key} onClick={() => setSelectedKey(device.key)}><small>{String(i + 1).padStart(2, "0")}</small>{device.label}</button>)}</nav><p>模拟演示 · 非现场实时数据</p></footer>
    </>}
    {controlError ? <p className="salt-control-error" role="alert">{controlError}<button onClick={() => setControlError(null)}>关闭</button></p> : null}
  </main>;
}
