import { useEffect, useMemo, useRef, useState } from "react";
import { createCanvasNode, type Model3DProps } from "../canvas/types";
import type { SceneInput, SceneRuntime, SceneStatus } from "../scene/scene-runtime";
import type { AnimationProgress } from "../scene/native-playback";
import asset from "./precision-demo-asset.json";
import "./PrecisionMotionDemo.css";

const phases = [
  { title: "靠近 · 夹紧", description: "夹爪开合与工件贴合", start: 0, end: 3.6 },
  { title: "抬升 · 转运", description: "工件随夹爪连贯运动", start: 3.6, end: 6.3 },
  { title: "对位 · 放置", description: "沿轨迹缓缓落入托盘", start: 6.3, end: 7.9 },
  { title: "松爪 · 退回", description: "释放工件后抬起夹爪", start: 7.9, end: 9 },
];
const baseProps = createCanvasNode("model-3d", 0, 0, 0).props as Model3DProps;
const baseInput: SceneInput = {
  instances: [{ id: "precision-cell", assetId: asset.assetId, label: "机械臂精密取放演示", visible: true,
    transform: { position: [0, 0, 0], rotation: [0, -90, 0], scale: [1, 1, 1] } }],
  settings: { ...baseProps, backgroundColor: "#14202c", backgroundOpacity: 0,
    environmentLightColor: "#e4edff", environmentLightIntensity: 1.1,
    keyLightColor: "#fff2df", keyLightIntensity: 3.2,
    presentation: { ...baseProps.presentation, lighting: "studio" },
    cameraView: "isometric-left", cameraFov: 32, modelScale: 1.7,
    showGrid: false, autoRotate: false, playAnimations: true, showControlPanel: false },
  appearanceOverrides: {}, selectedPath: null, selectedInstanceId: null,
  selectionStyle: "none", controlsEnabled: true, instanceTransformMode: null,
};

function TransportIcon({ kind }: { kind: "play" | "pause" | "replay" | "view" }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{
    kind === "play" ? <path d="m8 5 11 7-11 7Z" /> : kind === "pause" ? <path d="M8 5v14M16 5v14" /> : kind === "replay" ? <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /> : <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>
  }</svg>;
}

export function PrecisionMotionDemo() {
  const section = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime | null>(null);
  const [nearby, setNearby] = useState(false);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<SceneStatus>({ status: "loading" });
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [closeup, setCloseup] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [progress, setProgress] = useState<AnimationProgress>({ time: 0, duration: asset.duration, finished: false });
  const input = useMemo<SceneInput>(() => ({ ...baseInput, settings: { ...baseInput.settings,
    playAnimations: playing, modelScale: closeup ? 2.1 : compact ? 1.3 : 1.7 } }), [playing, closeup, compact]);
  const latestInput = useRef(input);
  latestInput.current = input;
  const ready = status.status === "ready";
  const activePhase = Math.max(0, phases.findIndex(phase => progress.time < phase.end));

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: "180px" });
    if (section.current) observer.observe(section.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const width = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(width.matches);
    width.addEventListener("change", update);
    return () => width.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!nearby || !surface.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    setStatus({ status: "loading" });
    setProgress({ time: 0, duration: asset.duration, finished: false });
    void import("../scene/scene-runtime").then(({ createSceneRuntime }) => {
      if (disposed || !surface.current) return;
      const created = createSceneRuntime({ container: surface.current, projectId: "public-motion-demo",
        canvasNodeId: "public-motion-demo", initial: latestInput.current,
        // Fail closed: public presentation cannot fall through to a customer resource API.
        resolveModelUrl: (id) => {
          if (id !== asset.assetId) throw new Error(`宣传案例不允许访问此模型：${id}`);
          return `${import.meta.env.BASE_URL}${asset.contentPath.slice(1)}`;
        },
        nativePlayback: { mode: "repeat", onProgress: (value) => {
          if (disposed) return;
          setProgress(previous => previous.time === value.time && previous.duration === value.duration && previous.finished === value.finished ? previous : value);
        } },
        onStatus: (value) => { if (!disposed) setStatus(value); },
        onSnapshot: () => { /* Read-only presentation: no business binding. */ },
      });
      runtime.current = created;
      // This fixed public composition reframes when its panel changes size.
      // Editor/runtime cameras elsewhere retain their existing resize behaviour.
      resizeObserver = new ResizeObserver(() => created.resetCamera());
      resizeObserver.observe(surface.current);
      return created.update(latestInput.current);
    }).catch((reason: unknown) => {
      if (disposed) return;
      console.error("public.motion-demo.failed", { assetId: asset.assetId, reason });
      setStatus({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { disposed = true; resizeObserver?.disconnect(); runtime.current?.dispose(); runtime.current = null; };
  }, [nearby, retry]);
  useEffect(() => { if (runtime.current) void runtime.current.update(input); }, [input]);

  function seek(time: number) {
    if (!runtime.current || !ready) return;
    setPlaying(false);
    runtime.current.seekAnimation(time);
  }
  function replay() {
    if (!runtime.current || !ready) return;
    runtime.current.seekAnimation(0);
    setPlaying(true);
  }

  return <section className="precision-demo delivery-container" id="industrial-motion" ref={section} aria-labelledby="precision-heading">
    <div className="precision-heading">
      <div><p className="delivery-eyebrow">BUSINESS IN MOTION</p><h2 id="precision-heading">不止会动，<br />连取放细节都看得见。</h2></div>
      <p>从夹起一枚 U 盘，到稳稳放进托盘。<br />把夹爪开合、工件随动与动作衔接，<br className="precision-desktop-break" />做成细致、丝滑的 3D 业务过程。</p>
    </div>
    <div className="precision-showcase">
      <div className="precision-stage" data-motion-status={status.status} data-motion-time={progress.time.toFixed(2)} data-motion-playing={playing}>
        <div className="precision-stage-heading"><span className="precision-scene-number">02 / MOTION STUDY</span><div><strong>机械臂 · 精密取放</strong><span>局部工艺演示</span></div></div>
        <div className="precision-canvas" ref={surface} role="img" aria-label="金属质感机械臂从料架夹取 U 盘并放入托盘，可拖动旋转、滚轮缩放" />
        {status.status !== "ready" && <div className={`precision-load ${status.status === "error" ? "is-error" : ""}`} role={status.status === "error" ? "alert" : "status"}>
          <strong>{status.status === "error" ? "3D 案例加载失败" : "正在准备精密取放场景"}</strong>
          <p>{status.status === "error" ? status.message : nearby ? "正在加载模型与原生动画，首次载入请稍候。" : "靠近此区域后加载交互场景。"}</p>
          {status.status === "error" && <button type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button>}
        </div>}
        <div className="precision-stage-bottom"><span><i />{!ready ? "场景准备中" : playing ? `${phases[activePhase].title} · 循环演示` : "动画已暂停"}</span><span>拖动旋转 · 滚轮缩放</span></div>
      </div>
      <aside className="precision-story">
        <span className="precision-story-kicker">细节，让动作更有说服力</span>
        <h3>每一步，<br />都有业务含义。</h3>
        <ol className="precision-phases">{phases.map((phase, index) => <li key={phase.title} className={ready && activePhase === index ? "is-active" : ""}>
          <button type="button" disabled={!ready} onClick={() => seek(phase.start)} aria-label={`查看${phase.title}动作`} aria-current={ready && activePhase === index ? "step" : undefined}>
            <span className="precision-step-number">0{index + 1}</span><span><strong>{phase.title}</strong><small>{phase.description}</small></span>
          </button>
        </li>)}</ol>
        <div className="precision-materials"><span>钛银机身</span><span>石墨夹爪</span><span>香槟金工件</span></div>
        <p className="precision-story-note">真实几何 × 金属材质 × 连贯动作<br />让结构、质感与业务过程一起呈现。</p>
      </aside>
      <div className="precision-transport">
        <div className="precision-transport-buttons"><button className="precision-play" type="button" disabled={!ready} onClick={() => setPlaying(value => !value)}><TransportIcon kind={playing ? "pause" : "play"} />{playing ? "暂停" : "播放"}</button><button type="button" disabled={!ready} onClick={replay}><TransportIcon kind="replay" />重播</button></div>
        <div className="precision-view-controls"><button type="button" disabled={!ready} aria-pressed={closeup} onClick={() => setCloseup(value => !value)}>{closeup ? "完整视角" : "放大细节"}</button><button type="button" disabled={!ready} onClick={() => { setCloseup(false); runtime.current?.resetCamera(); }}><TransportIcon kind="view" />复位视角</button></div>
      </div>
    </div>
    <div className="precision-footnote"><p>这是可交互的 3D 动作片段，不是录屏视频。</p><span>模型原生动画演示 · 非现场实时控制</span></div>
  </section>;
}
