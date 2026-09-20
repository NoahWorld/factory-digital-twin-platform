import { useEffect, useMemo, useRef, useState } from "react";
import { BatchModel3DNode } from "../canvas/BatchModel3DNode";
import { LocalIcon } from "../canvas/LocalIcon";
import type { ModelCameraView } from "../canvas/types";
import { PRODUCT_NAME } from "../product-config";
import { ThemeToggle } from "../theme/ThemeToggle";
import { demoDevices, getDemoSelection, industrialDemoNode } from "./industrial-demo-scene";
import "./IndustrialLandingPage.css";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-6-6 6 6-6 6"} /></svg>;
}

function Brand() {
  return <span className="delivery-brand"><span className="delivery-brand-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m16 3 12 7v13l-12 7-12-7V10L16 3Z" stroke="currentColor" strokeWidth="2" /><path d="m4 10 12 7 12-7M16 17v13M10 6.5l12 7V20" stroke="currentColor" strokeWidth="2" /></svg></span><span>{PRODUCT_NAME}<small>3D 数字孪生交付平台</small></span></span>;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
}

// The demo links selections to explicitly simulated values, never to customer assets.
function FactoryDemo() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [modelScale, setModelScale] = useState(industrialDemoNode.props.modelScale);
  const [selectedId, setSelectedId] = useState<string | null>("robot-0");
  const [view, setView] = useState<ModelCameraView>("isometric-left");
  const [animate, setAnimate] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const container = sceneRef.current;
    if (!container) return;
    // Keep the complete workshop in frame as the layout narrows, preserving the user's orbit.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setModelScale(1.9 * Math.min(1, width / height / 1.8));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setAnimate(!preference.matches);
    preference.addEventListener("change", handleChange);
    return () => preference.removeEventListener("change", handleChange);
  }, []);
  const node = useMemo(() => ({ ...industrialDemoNode, props: { ...industrialDemoNode.props, cameraView: view, playAnimations: animate, modelScale } }), [view, animate, modelScale]);
  const { instance, device } = getDemoSelection(selectedId);
  return (
    <section className="delivery-demo" id="industrial-demo" aria-label="可交互的智能制造车间演示">
      <div className="delivery-demo-topbar">
        <div className="delivery-demo-title"><span className="delivery-demo-dot" /><strong>智能制造车间</strong><span className="delivery-example-label">交付场景示例</span></div>
        <span className="delivery-demo-guide">拖动旋转 · 滚轮缩放 · 点击设备</span>
      </div>
      <div className="delivery-demo-body">
        <div className="delivery-scene-area">
          <div className="delivery-scene-caption"><span>EXPLORE YOUR DIGITAL FACTORY</span><strong>让每一台设备，都有数字身份。</strong></div>
          <div className="delivery-scene" ref={sceneRef} aria-label="3D 车间，可拖动查看；也可用下方设备按钮选择设备">
            <BatchModel3DNode node={node} projectId="public-landing-demo" editable={false} interactive cameraControlsEnabled runtimeControlsEnabled={false} selectedModelInstanceId={device ? selectedId : null} selectedSceneNodePath={null} onModelInstanceSelect={(_, id) => setSelectedId(id)} onSceneNodeSelect={() => { /* This demo selects whole equipment, not mesh nodes. */ }} />
          </div>
          <div className="delivery-scene-controls" aria-label="场景视角和动画">
            <div className="delivery-view-switch"><button type="button" aria-pressed={view === "isometric-left"} onClick={() => setView("isometric-left")}>立体视角</button><button type="button" aria-pressed={view === "top"} onClick={() => setView("top")}>俯视布局</button></div>
            <button type="button" className="delivery-motion-button" aria-pressed={!animate} onClick={() => setAnimate((value) => !value)}>{animate ? "Ⅱ 暂停动画" : "▷ 播放动画"}</button>
          </div>
        </div>
        <aside className="delivery-device-panel" aria-live="polite" aria-atomic="true">
          <div className="delivery-panel-label"><span>设备信息</span><span className="delivery-sample-badge">模拟数据</span></div>
          <div className="delivery-device-icon"><LocalIcon name={device?.icon ?? "boxes"} size={30} /></div>
          <span className="delivery-device-category">{device?.category ?? "车间场景 / 模型对象"}</span>
          <h2>{instance?.label ?? "探索你的数字工厂"}</h2>
          {device ? <>
            <div className="delivery-device-status"><i />{device.status}<span>演示状态</span></div>
            <div className="delivery-device-metrics">{device.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}<small>{metric.unit}</small></strong></div>)}</div>
            <div className="delivery-trend"><span>运行趋势<small>示意曲线</small></span><svg viewBox="0 0 200 46" role="img" aria-label="模拟运行趋势曲线"><polyline points={device.points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /></svg></div>
            <p className="delivery-device-note">{device.note}</p>
          </> : <p className="delivery-device-empty">{instance ? "这是车间中的场景对象。选择机械臂、加工设备或 AGV，体验模型与设备信息的联动。" : "点击场景中的设备，或使用下方按钮，查看对应的设备信息。"}</p>}
          <div className="delivery-binding"><span>3D 模型</span><span aria-hidden="true">↔</span><span>设备资产</span><span aria-hidden="true">↔</span><span>业务数据</span></div>
        </aside>
      </div>
      <div className="delivery-demo-footer"><span><b>试着点一点</b>，从场景找到设备</span><div className="delivery-device-buttons" aria-label="选择演示设备">{demoDevices.map((item) => <button type="button" key={item.id} aria-pressed={device?.kind === item.kind} onClick={() => setSelectedId(item.id)}><LocalIcon name={item.icon} size={17} />{item.shortName}<Arrow /></button>)}</div></div>
    </section>
  );
}

const advantages = [
  { icon: "boxes", number: "01", title: "模型进来，场景搭起来", text: "导入模型，拖入设备，调整位置、材质与视角。把分散的 3D 素材，组织成客户看得懂的工业现场。", items: ["内置工业模型，可反复复用", "多模型组合与场景编辑", "灯光、材质与镜头配置"], className: "is-blue" },
  { icon: "database", number: "02", title: "点中设备，信息跟着来", text: "把模型对象关联到设备资产，再接入业务数据。客户看到的不只是一个模型，还有设备背后的运行信息。", items: ["模型与资产一一关联", "点击设备，联动详情", "REST 数据接入与字段映射"], className: "is-teal" },
  { icon: "monitor", number: "03", title: "场景和看板，一起呈现", text: "既能展示完整 3D 场景，也能把场景嵌入业务大屏。将图表、指标和设备信息组合成统一的展示界面。", items: ["独立 3D 场景展示", "2D + 3D 组合式大屏", "配置保存与项目预览"], className: "is-violet" },
] as const;

const steps = [
  ["准备模型", "导入 GLB / glTF，或选用内置工业模型。", "01"],
  ["搭建场景", "摆放设备，配置材质、灯光和展示视角。", "02"],
  ["关联业务", "绑定设备资产，配置数据和看板组件。", "03"],
  ["预览验证", "检查交互和数据呈现，完善客户展示。", "04"],
];

export default function IndustrialLandingPage() {
  return (
    <div className="delivery-landing">
      <a className="delivery-skip" href="#industrial-main" onClick={(event) => { event.preventDefault(); document.getElementById("industrial-main")?.focus(); }}>跳到主要内容</a>
      <header className="delivery-header"><div className="delivery-header-inner"><a href="#/" aria-label={`${PRODUCT_NAME} 首页`}><Brand /></a><nav aria-label="主导航"><button type="button" onClick={() => scrollToSection("industrial-demo")}>场景体验</button><button type="button" onClick={() => scrollToSection("industrial-value")}>平台优势</button><button type="button" onClick={() => scrollToSection("industrial-workflow")}>交付流程</button></nav><div className="delivery-header-actions"><ThemeToggle /><a className="delivery-nav-cta" href="#/projects">进入平台<Arrow diagonal /></a></div></div></header>
      <main id="industrial-main" tabIndex={-1}>
        <section className="delivery-hero delivery-container">
          <div className="delivery-hero-copy"><div><p className="delivery-eyebrow"><span />面向工业场景的 3D 交付平台</p><h1>把工业现场，<em>交付到客户眼前。</em></h1></div><div className="delivery-hero-intro"><p>从 3D 场景搭建、设备数据关联，到可交互看板。<br className="delivery-wide-break" />让模型有业务，让展示有说服力。</p><div className="delivery-actions"><a href="#/projects" className="delivery-button is-primary">开始搭建项目<Arrow /></a><button type="button" className="delivery-button is-secondary" onClick={() => scrollToSection("industrial-demo")}>体验 3D 场景<span aria-hidden="true">↓</span></button></div><div className="delivery-hero-tags"><span>场景可编辑</span><span>设备可关联</span><span>看板可组合</span></div></div></div>
          <FactoryDemo />
          <div className="delivery-capability-strip"><span>从模型到客户展示</span><strong>3D 场景搭建</strong><i>＋</i><strong>设备资产关联</strong><i>＋</i><strong>业务数据呈现</strong><i>＝</i><strong className="delivery-strip-result">有业务价值的 3D 交付</strong></div>
        </section>
        <section className="delivery-value delivery-container" id="industrial-value"><div className="delivery-section-heading"><div><p className="delivery-eyebrow">BUILT FOR DELIVERY</p><h2>好看的 3D，更要解决交付里的实际问题。</h2></div><p>把模型、资产、数据和界面放进同一个项目。<br />减少反复拼接，让每一步成果都能继续复用。</p></div><div className="delivery-advantage-grid">{advantages.map((item) => <article className={`delivery-advantage ${item.className}`} key={item.number}><div className="delivery-advantage-top"><span><LocalIcon name={item.icon} size={28} /></span><b>{item.number}</b></div><h3>{item.title}</h3><p>{item.text}</p><ul>{item.items.map((text) => <li key={text}><LocalIcon name="circle-check" size={17} />{text}</li>)}</ul></article>)}</div></section>
        <section className="delivery-formats delivery-container"><div className="delivery-format-intro"><p className="delivery-eyebrow">ONE PLATFORM. TWO WAYS TO SHOW.</p><h2>客户需要什么，就用什么方式呈现。</h2><p>同一套场景能力，适配不同的展示目标。</p><a href="#/projects">创建你的项目<Arrow /></a></div><article className="delivery-format"><span className="delivery-format-mark">3D</span><span className="delivery-format-tag">空间与设备</span><h3>沉浸式 3D 场景</h3><p>自由查看车间布局、设备结构和空间关系，适合方案沟通与现场展示。</p><div><span>工业制造</span><span>园区设施</span><span>仓储物流</span></div></article><article className="delivery-format is-dashboard"><span className="delivery-format-mark">2D <small>+</small> 3D</span><span className="delivery-format-tag">数据与业务</span><h3>数字孪生业务大屏</h3><p>在场景旁组合图表、指标和资产详情，适合运行监控与业务汇报。</p><div><span>设备运行</span><span>生产概览</span><span>资产管理</span></div></article></section>
        <section className="delivery-workflow" id="industrial-workflow"><div className="delivery-container"><div className="delivery-section-heading"><div><p className="delivery-eyebrow">A CLEAR PATH TO YOUR PROJECT</p><h2>从一个模型，到一份完整展示。</h2></div><p>让交付过程有章可循，让项目成果持续积累。</p></div><ol className="delivery-steps">{steps.map(([title, text, index]) => <li key={index}><div><span>{index}</span><Arrow /></div><h3>{title}</h3><p>{text}</p></li>)}</ol></div></section>
        <section className="delivery-final-cta delivery-container"><div><p className="delivery-eyebrow">YOUR NEXT PROJECT STARTS HERE</p><h2>让客户看懂现场，也看见你的交付能力。</h2><p>从一个场景开始，把下一次展示做得更直观。</p></div><a className="delivery-button is-primary" href="#/projects">进入平台，开始搭建<Arrow diagonal /></a><div className="delivery-cta-orbits" aria-hidden="true"><span /><span /><span /></div></section>
      </main>
      <footer className="delivery-footer delivery-container"><Brand /><p>模型 · 场景 · 数据 · 展示</p><span>页面场景为虚构演示，指标为模拟数据。</span></footer>
    </div>
  );
}
