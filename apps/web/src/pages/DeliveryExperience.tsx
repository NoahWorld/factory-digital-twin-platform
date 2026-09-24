import { useEffect, useRef, useState } from "react";
import { CanvasTemplatePreview } from "../canvas/CanvasTemplatePreview";
import { LocalIcon } from "../canvas/LocalIcon";
import { getCanvasTemplate, type CanvasTemplateId } from "../canvas/templates";
import { PublicShowcaseModel, showcaseModels } from "./PublicShowcaseModel";
import "./DeliveryExperience.css";

function ExperienceIcon({ kind }: { kind: "next" | "previous" | "expand" | "close" | "play" | "pause" | "view" | "scroll" }) {
  const paths = {
    next: "M5 12h14m-5-5 5 5-5 5", previous: "M19 12H5m5-5-5 5 5 5",
    expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5", close: "m6 6 12 12M6 18 18 6",
    play: "m8 5 11 7-11 7Z", pause: "M8 5v14M16 5v14",
    view: "m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10v8m-9-13 9 5 9-5",
    scroll: "M12 4v16m-5-5 5 5 5-5",
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

const chapters = [
  { title: "从一台设备开始。", label: "模型登场", kicker: "01 / THE MODEL", icon: "boxes", description: "机械臂、加工设备、物流小车。先把工业现场里熟悉的设备，变成可以从不同角度查看的 3D 模型。", tags: ["真实几何", "材质与灯光", "原生动画"] },
  { title: "给模型一个业务身份。", label: "资产关联", kicker: "02 / THE CONNECTION", icon: "database", description: "设备名称、运行状态、关键指标，与模型一起呈现。让客户在看清结构的同时，也能读懂设备正在做什么。", tags: ["设备资产", "信息联动", "状态呈现"] },
  { title: "让现场进入业务大屏。", label: "业务呈现", kicker: "03 / THE BIG PICTURE", icon: "monitor", description: "从单台设备走向全局。把图表、指标和业务信息组织进同一个画面，让下一次方案沟通有据可看。", tags: ["行业模板", "图表与指标", "统一展示"] },
] as const;

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function DeliveryScrollStory() {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(() => !reduceMotion());
  const [front, setFront] = useState(false);
  const model = showcaseModels[selected];

  function readingLine() {
    if (window.matchMedia("(max-width: 800px)").matches && stage.current) {
      const bottom = parseFloat(getComputedStyle(stage.current).top) + stage.current.offsetHeight;
      return bottom + Math.max(30, (window.innerHeight - bottom) / 2);
    }
    return window.innerHeight * 0.52;
  }

  function goToChapter(index: number) {
    const copy = chapterRefs.current[index];
    if (!copy) return;
    const rect = copy.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top + rect.height / 2 - readingLine(), behavior: reduceMotion() ? "instant" : "smooth" });
  }

  useEffect(() => {
    const container = track.current;
    if (!container) return;
    let frame = 0;
    let observing = false;
    let disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const line = readingLine();
      const centers = chapterRefs.current.map(element => {
        if (!element) throw new Error("滚动演示章节尚未挂载");
        const rect = element.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      let nearest = 0;
      centers.forEach((center, index) => { if (Math.abs(center - line) < Math.abs(centers[nearest] - line)) nearest = index; });
      setActive(value => value === nearest ? value : nearest);
      const progress = clamp((line - centers[0]) / (centers[2] - centers[0]), 0, 1);
      container.style.setProperty("--story-progress", String(progress));
      container.style.setProperty("--story-drift", `${reduceMotion() ? 0 : (progress - 0.5) * 32}px`);
    };
    const requestMeasure = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !observing) {
        observing = true;
        window.addEventListener("scroll", requestMeasure, { passive: true });
        requestMeasure();
      } else if (!entry.isIntersecting && observing) {
        observing = false;
        window.removeEventListener("scroll", requestMeasure);
      }
    });
    observer.observe(container);
    const resize = new ResizeObserver(requestMeasure);
    resize.observe(container);
    window.addEventListener("resize", requestMeasure);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotion = () => { if (motion.matches) setPlaying(false); requestMeasure(); };
    motion.addEventListener("change", handleMotion);
    return () => {
      disposed = true;
      observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestMeasure);
      window.removeEventListener("resize", requestMeasure);
      motion.removeEventListener("change", handleMotion);
    };
  }, []);

  return <section className="delivery-scroll-story delivery-container" id="industrial-story" aria-labelledby="delivery-story-title">
    <div className="delivery-experience-heading">
      <div><p className="delivery-eyebrow">SCROLL TO BUILD THE PICTURE</p><h2 id="delivery-story-title">往下滚动，<br />看交付一步步成形。</h2></div>
      <div><p>从设备的细节，到业务的全貌。<br />滚动页面，或点击分镜，亲手走过这段过程。</p><span className="delivery-scroll-cue"><ExperienceIcon kind="scroll" />滚动探索 · 三段交付故事</span></div>
    </div>
    <div className="delivery-story-track" ref={track}>
      <div className="delivery-story-stage" ref={stage} data-story-step={active}>
        <div className="delivery-story-stage-top"><span>DELIVERY / IN THE MAKING</span><span className="delivery-sample-badge">公开演示 · 模拟数据</span></div>
        <div className="delivery-story-tabs" role="group" aria-label="切换交付分镜">{chapters.map((chapter, index) => <button type="button" key={chapter.label} aria-pressed={index === active} onClick={() => goToChapter(index)}><span>0{index + 1}</span>{chapter.label}</button>)}</div>
        <div className="delivery-story-visual">
          <div className="delivery-story-orbit" aria-hidden="true"><i /><i /><i /></div>
          <div className="delivery-story-model-wrap" hidden={active === 2}>
            <div className="delivery-story-model"><PublicShowcaseModel model={model} playing={playing && active !== 2} view={front ? "front" : "isometric-left"} /></div>
            <div className="delivery-story-model-label"><span>PUBLIC MODEL / 0{selected + 1}</span><strong>{model.shortName}</strong></div>
          </div>
          {active === 1 && <aside className="delivery-story-asset" aria-label="设备模拟信息">
            <div className="delivery-story-asset-head"><LocalIcon name={model.icon} size={19} /><span>设备数字身份</span><i /></div>
            <span className="delivery-story-asset-code">{model.code}</span><h3>{model.shortName}</h3>
            <p><i />{model.status}<span>模拟状态</span></p>
            <dl>{model.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}<small>{metric.unit}</small></dd></div>)}</dl>
            <svg viewBox="0 0 200 46" role="img" aria-label="模拟运行趋势"><polyline points={model.points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /></svg>
            <span className="delivery-story-asset-note">模型对象 ↔ 设备资产 ↔ 业务信息</span>
          </aside>}
          {active === 2 && <div className="delivery-story-dashboard"><div><LocalIcon name="monitor" size={17} /><span>从设备视角，走向生产全局</span></div><CanvasTemplatePreview templateId="production-operations" /><span>工业制造 · 业务看板示例 · 模拟数据</span></div>}
        </div>
        <div className="delivery-story-tools">
          {active < 2 ? <><span>{model.detailAnimation ? "切换设备，看看不同细节" : "小车驻停展示 · 切换视角查看"}</span><div><button type="button" aria-pressed={front} onClick={() => setFront(value => !value)}><ExperienceIcon kind="view" />{front ? "立体视角" : "正面视角"}</button>{model.detailAnimation && <button type="button" aria-pressed={!playing} onClick={() => setPlaying(value => !value)}><ExperienceIcon kind={playing ? "pause" : "play"} />{playing ? "暂停" : "播放"}</button>}</div></> : <><span>将模型、资产与指标组合成完整表达</span><button type="button" onClick={() => document.getElementById("industrial-gallery")?.scrollIntoView({ behavior: reduceMotion() ? "instant" : "smooth", block: "start" })}>浏览宣传画面<ExperienceIcon kind="next" /></button></>}
        </div>
        <div className="delivery-story-model-picker" role="group" aria-label="选择展台模型" hidden={active === 2}>{showcaseModels.map((item, index) => <button type="button" key={item.id} aria-pressed={index === selected} onClick={() => setSelected(index)}><img src={`${import.meta.env.BASE_URL}${item.asset.thumbnailPath.slice(1)}`} alt="" loading="lazy" /><span>{item.shortName}</span><span className="delivery-model-choice-dot" /></button>)}</div>
        {active === 2 && <div className="delivery-story-outcome"><span><LocalIcon name="circle-check" size={17} />清晰的业务布局</span><span><LocalIcon name="circle-check" size={17} />可继续编辑的模板</span><span><LocalIcon name="circle-check" size={17} />统一的展示画面</span></div>}
        <div className="delivery-story-progress" aria-hidden="true"><span /></div>
      </div>
      <div className="delivery-story-chapters">{chapters.map((chapter, index) => <article className={`delivery-story-chapter${index === active ? " is-active" : ""}`} key={chapter.label}>
        <div ref={element => { chapterRefs.current[index] = element; }}>
          <span className="delivery-story-kicker"><LocalIcon name={chapter.icon} size={20} />{chapter.kicker}</span>
          <h3>{chapter.title}</h3><p>{chapter.description}</p>
          <ul>{chapter.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
          <button type="button" className="delivery-story-chapter-action" onClick={() => index < 2 ? goToChapter(index + 1) : document.getElementById("industrial-gallery")?.scrollIntoView({ behavior: reduceMotion() ? "instant" : "smooth", block: "start" })}>{index < 2 ? `继续看：${chapters[index + 1].label}` : "寻找你的展示灵感"}<ExperienceIcon kind="next" /></button>
        </div>
      </article>)}</div>
    </div>
  </section>;
}

const galleryItems = [
  { id: "production-operations", icon: "factory", label: "工业制造", title: "把产线的每个环节，\n放进同一个视野。", copy: "产量、质量、设备状态与告警，在一张业务画面中汇合。让生产现场的重点更容易被看见。" },
  { id: "warehouse-logistics", icon: "truck", label: "仓储物流", title: "让流转中的物料，\n有清晰的业务脉络。", copy: "从库存库容到作业任务，从车辆月台到搬运设备，为物流调度组织一幅清楚的全景。" },
  { id: "energy-safety", icon: "zap", label: "能源管理", title: "看见能源去向，\n也看见运行重点。", copy: "将水电气、区域能耗与安全告警放在一起，为能源管理和现场沟通建立共同的视角。" },
  { id: "industrial-park-operations", icon: "boxes", label: "园区运营", title: "从一栋建筑，\n看到整座园区。", copy: "汇总设施、通行、能耗与事件，将分散的运营信息组合成一张适合汇报和展示的画面。" },
] as const satisfies ReadonlyArray<{ id: CanvasTemplateId; icon: string; label: string; title: string; copy: string }>;

export function DeliveryScreenGallery() {
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const item = galleryItems[selected];
  const template = getCanvasTemplate(item.id);
  const move = (offset: number) => setSelected(value => (value + offset + galleryItems.length) % galleryItems.length);

  useEffect(() => {
    if (!expanded || !dialog.current) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      expandButton.current?.focus({ preventScroll: true });
    };
  }, [expanded]);

  return <section className="delivery-gallery delivery-container" id="industrial-gallery" aria-labelledby="delivery-gallery-title">
    <div className="delivery-experience-heading"><div><p className="delivery-eyebrow">A NEW SCENE. A NEW POSSIBILITY.</p><h2 id="delivery-gallery-title">换个画面，<br />发现下一种交付可能。</h2></div><p>选择一个行业，看看不同的业务表达。<br />这些画面来自平台内可继续编辑的模板。</p></div>
    <div className="delivery-gallery-filters" role="group" aria-label="选择宣传画面">{galleryItems.map((entry, index) => <button type="button" key={entry.id} aria-pressed={index === selected} onClick={() => setSelected(index)}><LocalIcon name={entry.icon} size={20} /><span>{entry.label}</span><span>0{index + 1}</span></button>)}</div>
    <div className="delivery-gallery-showcase">
      <div className="delivery-gallery-copy" aria-live="polite" aria-atomic="true"><span className="delivery-gallery-index">0{selected + 1}<small>/ 04</small></span><span className="delivery-gallery-code">{template.code} / {item.label}</span><h3>{item.title}</h3><p>{item.copy}</p><div className="delivery-gallery-tags">{template.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div>
      <div className="delivery-gallery-screen"><div className="delivery-gallery-screen-top"><span><i /><i /><i /></span><strong>{template.name}</strong><button type="button" ref={expandButton} onClick={() => setExpanded(true)} aria-label={`放大查看${item.label}宣传画面`}><ExperienceIcon kind="expand" />放大查看</button></div><CanvasTemplatePreview templateId={item.id} /><div className="delivery-gallery-screen-bottom"><span>{template.showcase.deliveryForm}</span><span>1920 × 1080 / 示例画面</span></div></div>
    </div>
    <div className="delivery-gallery-bottom"><p>从模板出发，继续搭建你的项目。</p><div><button type="button" aria-label="上一张宣传画面" onClick={() => move(-1)}><ExperienceIcon kind="previous" /></button><button type="button" onClick={() => move(1)}>下一张画面<ExperienceIcon kind="next" /></button><a href="#/projects">进入平台<ExperienceIcon kind="next" /></a></div></div>
    {expanded && <dialog className="delivery-gallery-dialog" ref={dialog} aria-labelledby="gallery-dialog-title" onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}>
      <header><div><span className="delivery-eyebrow">{item.label}</span><h3 id="gallery-dialog-title">{template.name}</h3></div><button type="button" aria-label="关闭宣传画面" onClick={() => setExpanded(false)} autoFocus><ExperienceIcon kind="close" /></button></header>
      <CanvasTemplatePreview templateId={item.id} />
      <footer><span>0{selected + 1} / 04 · {template.showcase.dataLabel}</span><div><button type="button" onClick={() => move(-1)}><ExperienceIcon kind="previous" />上一张</button><button type="button" onClick={() => move(1)}>下一张<ExperienceIcon kind="next" /></button></div></footer>
    </dialog>}
  </section>;
}
