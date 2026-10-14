import { useEffect, useRef, useState } from "react";
import { Color, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { ApiRequestError, errorPresentation, reportError, UserFacingError } from "../api";
import { formatFileSize } from "../canvas/model-assets";
import { decodeCapturePly, fetchCapturePly, validateCaptureResult, type SiteCaptureViewerResult } from "./site-capture-ply";
import "./site-capture-viewer.css";

export type { SiteCaptureViewerResult } from "./site-capture-ply";
type Movement = "forward" | "back" | "left" | "right" | "up" | "down";
type ViewerState = { phase: "loading" | "decoding" | "rendering" | "ready" | "error"; loaded: number; decoded: number; message?: string; network?: boolean };
const keyMovement: Record<string, Movement> = { KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", KeyE: "up", KeyQ: "down" };

export function SiteCaptureViewer({ contentUrl, result, title, onClose }: {
  contentUrl: string;
  result: SiteCaptureViewerResult;
  title: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const movementRef = useRef(new Set<Movement>());
  const speedRef = useRef(1);
  const [speed, setSpeed] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ViewerState>({ phase: "loading", loaded: 0, decoded: 0 });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const abort = new AbortController();
    let closed = false, failed = false, frame = 0, released = false;
    let renderer: WebGLRenderer | null = null, spark: SparkRenderer | null = null, splats: SplatMesh | null = null;
    let frameWork: Promise<void> | null = null;
    const unlisten: (() => void)[] = [];
    setState({ phase: "loading", loaded: 0, decoded: 0 });
    const listen = <T extends EventTarget>(target: T, name: string, callback: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(name, callback, options);
      unlisten.push(() => target.removeEventListener(name, callback, options));
    };
    const release = () => {
      if (released) return;
      released = true;
      splats?.dispose();
      spark?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
    const fail = (reason: unknown) => {
      if (closed || failed) return;
      failed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      movementRef.current.clear();
      resetRef.current = null;
      reportError(reason, { operation: "site-capture-viewer", failureCount: retry });
      const network = reason instanceof ApiRequestError && reason.code === "network_error";
      setState((current) => ({ ...current, phase: "error", message: errorPresentation(reason).message, network }));
      if (!frameWork) release();
    };
    const run = async () => {
      const extent = validateCaptureResult(result);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2", { antialias: false, alpha: false });
      if (!context) throw new UserFacingError("浏览器无法启动 WebGL 2。请开启硬件加速，或换用支持 WebGL 2 的设备。");
      renderer = new WebGLRenderer({ canvas, context, antialias: false, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor(new Color("#101822"));
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", "写实漫游视窗，拖动环视，WASD 或方向键移动，Q E 升降");
      host.append(canvas);
      listen(canvas, "webglcontextlost", (event) => {
        event.preventDefault();
        fail(new UserFacingError("图形上下文已丢失，漫游已暂停。请重新加载；持续失败时请减小重建区域或更换设备。"));
      });
      const scene = new Scene();
      const camera = new PerspectiveCamera(60, 1, Math.max(extent / 100_000, 0.00001), extent * 100);
      const up = new Vector3().fromArray(result.initialCamera.up).normalize();
      const reset = () => {
        camera.position.fromArray(result.initialCamera.position);
        camera.up.copy(up);
        camera.lookAt(new Vector3().fromArray(result.initialCamera.target));
        movementRef.current.clear();
      };
      reset();
      const resize = () => {
        if (!renderer || closed) return;
        const { width, height } = host.getBoundingClientRect();
        renderer.setSize(Math.max(1, width), Math.max(1, height), false);
        camera.aspect = Math.max(1, width) / Math.max(1, height);
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host); unlisten.push(() => observer.disconnect()); resize();
      const bytes = await fetchCapturePly(contentUrl, result.byteSize, abort.signal,
        (loaded) => { if (!closed) setState((current) => ({ ...current, loaded })); });
      if (closed || failed) return;
      setState((current) => ({ ...current, phase: "decoding" }));
      const decoded = await decodeCapturePly(bytes, result, abort.signal,
        (count) => { if (!closed) setState((current) => ({ ...current, decoded: count })); });
      if (closed || failed) { decoded.dispose(); return; }
      splats = new SplatMesh({ extSplats: decoded, editable: false, raycastable: false, enableLod: false });
      await splats.initialized;
      if (closed || failed) return;
      spark = new SparkRenderer({ renderer, autoUpdate: false, enableDriveLod: false, enableLod: false, accumExtSplats: true, minSortIntervalMs: 0 });
      scene.add(spark, splats);
      setState((current) => ({ ...current, phase: "rendering" }));

      // Keep all input local to this dialog. Pointer capture also handles touch drag.
      let pointer: { id: number; x: number; y: number } | null = null;
      const endPointer = () => { pointer = null; };
      listen(canvas, "pointerdown", (raw) => {
        const event = raw as PointerEvent;
        if (event.button !== 0 || pointer) return;
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      listen(canvas, "pointermove", (raw) => {
        const event = raw as PointerEvent;
        if (!pointer || event.pointerId !== pointer.id) return;
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
        pointer.x = event.clientX; pointer.y = event.clientY;
        camera.quaternion.premultiply(new Quaternion().setFromAxisAngle(up, -dx * 0.003));
        const forward = camera.getWorldDirection(new Vector3());
        const pitch = Math.asin(Math.max(-1, Math.min(1, forward.dot(up))));
        const nextPitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch - dy * 0.003));
        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        camera.quaternion.premultiply(new Quaternion().setFromAxisAngle(right, nextPitch - pitch));
      });
      listen(canvas, "pointerup", endPointer); listen(canvas, "pointercancel", endPointer); listen(canvas, "lostpointercapture", endPointer);
      const clearMovement = () => { movementRef.current.clear(); endPointer(); };
      listen(window, "blur", clearMovement);
      listen(document, "visibilitychange", clearMovement);
      listen(dialogRef.current!, "focusout", () => { movementRef.current.clear(); });
      listen(dialogRef.current!, "keydown", (raw) => {
        const event = raw as KeyboardEvent;
        if (event.target !== canvas || event.altKey || event.ctrlKey || event.metaKey) return;
        const move = keyMovement[event.code];
        if (move) { event.preventDefault(); movementRef.current.add(move); }
      });
      listen(window, "keyup", (raw) => { const move = keyMovement[(raw as KeyboardEvent).code]; if (move) movementRef.current.delete(move); });
      resetRef.current = reset;
      let lastTime = performance.now(), ready = false;
      const draw = async (time: number) => {
        if (closed || failed || !renderer || !spark) return;
        const delta = Math.min((time - lastTime) / 1000, 0.05); lastTime = time;
        const move = movementRef.current;
        const forward = camera.getWorldDirection(new Vector3());
        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const displacement = new Vector3()
          .addScaledVector(forward, Number(move.has("forward")) - Number(move.has("back")))
          .addScaledVector(right, Number(move.has("right")) - Number(move.has("left")))
          .addScaledVector(up, Number(move.has("up")) - Number(move.has("down")));
        if (displacement.lengthSq() > 0) camera.position.addScaledVector(displacement.normalize(), extent * 0.08 * speedRef.current * delta);
        camera.updateMatrixWorld();
        await spark.update({ scene, camera });
        if (closed || failed) return;
        renderer.render(scene, camera);
        if (!ready) { ready = true; setState((current) => ({ ...current, phase: "ready" })); }
        frame = requestAnimationFrame(schedule);
      };
      const schedule = (time: number) => {
        frameWork = draw(time).catch(fail).finally(() => { frameWork = null; if (closed || failed) release(); });
      };
      schedule(performance.now());
    };
    void run().catch(fail).finally(() => { if ((closed || failed) && !frameWork) release(); });
    return () => {
      closed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      movementRef.current.clear(); resetRef.current = null;
      for (const remove of unlisten) remove();
      // Spark's in-flight GPU readback must finish before its textures/worker are released.
      if (!frameWork) release();
    };
  }, [contentUrl, result, retry]);

  const ready = state.phase === "ready";
  const directions: { move: Movement; label: string; glyph: string }[] = [
    { move: "forward", label: "前进", glyph: "↑" }, { move: "left", label: "左移", glyph: "←" },
    { move: "back", label: "后退", glyph: "↓" }, { move: "right", label: "右移", glyph: "→" },
    { move: "up", label: "上升", glyph: "＋" }, { move: "down", label: "下降", glyph: "−" },
  ];
  return <dialog className="site-capture-viewer" ref={dialogRef} aria-labelledby="site-capture-viewer-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><div><p>写实漫游</p><h2 id="site-capture-viewer-title">{title}</h2></div><button type="button" aria-label="关闭写实漫游" onClick={onClose}>×</button></header>
    <div className="site-capture-viewer-stage" ref={stageRef}>
      {!ready && <div className={`site-capture-viewer-status${state.phase === "error" ? " is-error" : ""}`} role={state.phase === "error" ? "alert" : "status"}>
        {state.phase === "error" ? <><strong>{state.network ? `🔴 网络异常 · 重试次数 ${retry}` : "漫游暂时无法显示"}</strong><p>{state.message}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>重新加载漫游</button></>
          : <><strong>🟡 {state.phase === "loading" ? "正在读取漫游文件" : state.phase === "decoding" ? "正在解析高斯场景" : "正在准备首帧"}</strong><p>{state.phase === "loading" ? `已读取 ${formatFileSize(state.loaded)} / ${formatFileSize(result.byteSize)}` : state.phase === "decoding" ? `已解析 ${state.decoded.toLocaleString()} / ${result.gaussianCount.toLocaleString()} 个高斯` : "正在初始化图形资源与深度排序，可随时关闭。"}</p></>}
      </div>}
      {ready && <div className="site-capture-viewer-navigation" aria-label="漫游方向控制">{directions.map(({ move, label, glyph }) => <button key={move} data-movement={move} aria-label={label} type="button"
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); movementRef.current.add(move); }}
        onPointerUp={() => movementRef.current.delete(move)} onPointerCancel={() => movementRef.current.delete(move)} onLostPointerCapture={() => movementRef.current.delete(move)}
        onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); movementRef.current.add(move); } }}
        onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") movementRef.current.delete(move); }} onBlur={() => movementRef.current.delete(move)}>{glyph}<small>{label}</small></button>)}</div>}
    </div>
    <footer>
      <div className="site-capture-viewer-instructions"><strong>{ready ? "拖动环视 · WASD / 方向键移动 · Q E 升降" : "加载期间仍可关闭面板"}</strong><span>视觉漫游，无碰撞和测量能力；移动速度按场景比例计算。</span></div>
      <label>速度 <input aria-label="漫游速度" type="range" min="0.25" max="3" step="0.25" value={speed} onChange={(event) => { const value = Number(event.target.value); setSpeed(value); speedRef.current = value; }} /><output>{speed}×</output></label>
      <button type="button" disabled={!ready} onClick={() => resetRef.current?.()}>回到初始视角</button>
    </footer>
  </dialog>;
}

export default SiteCaptureViewer;
