import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { standaloneScenePath, standaloneSceneRoutePath, STANDALONE_3D_LIMITS, type StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { errorMessage, reportError, request, UserFacingError } from "../api";
import { Model3DNode } from "../canvas/Model3DNode";
import { standaloneRendererNode } from "../canvas/standalone-renderer-node";
import { bindDemoDevices, demoValue, metalSaltDemo, type DemoDevice } from "./metal-salt-demo";
import "./metal-salt-dashboard.css";

const ignoreNodeSelection = () => undefined;
type LoadedScene = { scene: StandaloneSceneDocument; bindings: Map<string, string> };

function Trend({ device, tick, index }: { device: DemoDevice; tick: number; index: number }) {
  const metric = device.metrics[0];
  const values = Array.from({ length: 31 }, (_, i) => demoValue(metric, tick - 30 + i, index));
  const low = metric.base - metric.amplitude * 1.5;
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
  const [view, setView] = useState<"isometric" | "top">("isometric");
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

  const rendererNode = useMemo(() => loaded ? standaloneRendererNode({ ...loaded.scene, settings: {
    ...loaded.scene.settings, backgroundColor: "#071525", backgroundOpacity: 0, autoRotate: false,
    cameraView: view, modelScale: wideScreen ? 1.5 : 1.12,
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

  const devicePanel = (device: DemoDevice, index: number) => <button
    className={`salt-device${selectedKey === device.key ? " is-selected" : ""}`} key={device.key}
    ref={element => { if (element) deviceButtons.current.set(device.key, element); else deviceButtons.current.delete(device.key); }}
    aria-label={`查看${device.label}详情`} aria-pressed={selectedKey === device.key}
    onClick={() => setSelectedKey(device.key)} type="button">
    <span className="salt-device-heading"><strong>{device.label}</strong><span className="salt-running">运行中</span></span>
    <span className="salt-device-stage">{String(index + 1).padStart(2, "0")} / {device.stage}<span>查看详情 ↗</span></span>
    <span className="salt-metrics">{device.metrics.slice(0, 2).map((metric, i) => <span key={metric.label}>
      <span className="salt-metric-label">{metric.label}</span><span className="salt-metric-value">{demoValue(metric, tick, index + i).toFixed(metric.digits)}<small>{metric.unit}</small></span>
    </span>)}</span>
  </button>;

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
          maximumModelInstances={STANDALONE_3D_LIMITS.maximumInstances} selectionStyle="runtime"
          selectedModelInstanceId={selectedKey ? loaded.bindings.get(selectedKey) : null}
          onModelInstanceSelect={selectInstance} onSceneNodeSelect={ignoreNodeSelection} selectedSceneNodePath={null}
          decorations={loaded.scene.decorations} staticMap={loaded.scene.staticMap} fluids={loaded.scene.fluids} />
      </div>
      <section className="salt-overview" aria-label="产线概况">
        <div><strong>07<small>台</small></strong><span>工艺设备</span></div>
        <div><strong>04<small>段</small></strong><span>核心工序</span></div>
        <div><strong>06<small>段</small></strong><span>连接管道</span></div>
        <div className="salt-overview-status"><span className="salt-running">{paused ? "模拟已暂停" : "模拟运行中"}</span><span>反应 / 清洗 / 分离 / 分散</span></div>
      </section>
      <aside className="salt-column salt-left" aria-label="反应与清洗设备模拟数据"><h2>反应与清洗<span>PROCESS / 01—03</span></h2>{metalSaltDemo.devices.slice(0, 3).map(devicePanel)}
        <section className="salt-guide"><h3>产线工艺概览</h3><p>反应物料经两级清洗、固液分离后进入分散工序，呈直角布局。</p><div><span>反应</span><i>→</i><span>清洗</span><i>→</i><span>分离</span><i>→</i><span>分散</span></div></section>
      </aside>
      <aside className="salt-column salt-right" aria-label="分离与分散设备模拟数据"><h2>分离与分散<span>PROCESS / 04—07</span></h2>{metalSaltDemo.devices.slice(3).map((device, i) => devicePanel(device, i + 3))}</aside>
      <div className="salt-scene-controls" role="group" aria-label="场景展示控制">
        <button type="button" onClick={() => { setView("isometric"); setReset(value => value + 1); }}>全景复位</button>
        <button type="button" aria-pressed={view === "top"} onClick={() => setView(value => value === "top" ? "isometric" : "top")}>俯视布局</button>
        <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "继续模拟" : "暂停模拟"}</button>
        <span>拖拽旋转 · 滚轮缩放 · 点击设备查看详情</span>
      </div>
      {selected ? <section className="salt-detail" role="region" aria-label={`${selected.label}详情`}>
        <div className="salt-detail-head"><div><h2 tabIndex={-1} ref={detailTitle}>{selected.label}<span>设备详情</span></h2><p>{selected.stage} · 模拟运行</p></div><button type="button" aria-label="关闭设备详情" onClick={closeDetails}>关闭 ×</button></div>
        <p className="salt-detail-copy">{selected.description}</p>
        <div className="salt-detail-data"><dl>{selected.metrics.map((metric, i) => <div key={metric.label}><dt>{metric.label}</dt><dd>{demoValue(metric, tick, selectedIndex + i).toFixed(metric.digits)}<small>{metric.unit}</small></dd></div>)}</dl><Trend device={selected} index={selectedIndex} tick={tick} /></div>
        <p className="salt-detail-note">演示参数与趋势仅用于参观讲解，未连接现场设备，不作为生产控制依据。</p>
      </section> : null}
      <footer className="salt-footer"><span>工艺路径</span><nav aria-label="按工序查看设备">{metalSaltDemo.devices.map((device, i) => <button type="button" key={device.key} aria-pressed={selectedKey === device.key} onClick={() => setSelectedKey(device.key)}><small>{String(i + 1).padStart(2, "0")}</small>{device.label}</button>)}</nav><p>模拟演示 · 非现场实时数据</p></footer>
    </>}
    {controlError ? <p className="salt-control-error" role="alert">{controlError}<button onClick={() => setControlError(null)}>关闭</button></p> : null}
  </main>;
}
