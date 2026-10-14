import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiRequestError, errorMessage, reportError, UserFacingError } from "../api";
import { createUuid } from "../uuid";
import { formatFileSize } from "../canvas/model-assets";
import { SiteCaptureRequirements } from "./SiteCaptureRequirements";
import { validateSceneBackgroundName } from "./scene-background";
import { captureBase, captureMime, captureRequest, captureStage, captureStatus, checkedCapabilities, checkedJob, validateCaptureFiles, type CaptureCapabilities, type CaptureJob } from "./site-capture";
import "./site-capture.css";

const Viewer = lazy(() => import("./SiteCaptureViewer"));
type Props = { open: boolean; projectId: string; projectName: string; onBack: () => void; onClose: () => void };

class ViewerBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { reportError(error, { operation: "site-capture-viewer-render" }); }
  render() {
    return this.state.failed ? <div className="capture-viewer-loading" role="alert"><p>漫游查看器加载失败，请关闭后刷新页面重试。已生成的场景仍保存在项目中。</p><button type="button" onClick={this.props.onClose}>返回任务</button></div> : this.props.children;
  }
}

export function SiteCaptureWizard({ open, projectId, projectName, onBack, onClose }: Props) {
  const [jobs, setJobs] = useState<CaptureJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [caps, setCaps] = useState<CaptureCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollError, setPollError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [retries, setRetries] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; filename: string } | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [name, setName] = useState(`${projectName}写实漫游`);
  const [files, setFiles] = useState<File[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [viewer, setViewer] = useState<CaptureJob | null>(null);
  const requestId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const mutationRevision = useRef(0);
  const lifetime = useRef(new AbortController());
  const base = captureBase(projectId);
  const active = jobs.find(job => job.id === selected) ?? null;
  const validation = validateCaptureFiles(files, caps);
  const nameError = validateSceneBackgroundName(name);
  const unavailableApi = pollError instanceof ApiRequestError && pollError.context.status === 404 && pollError.context.path === "/api/v1/site-captures/capabilities";

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer = 0; let failures = 0;
    setLoading(true);
    const poll = async () => {
      const revision = mutationRevision.current;
      try {
        const capabilities = checkedCapabilities(await captureRequest<CaptureCapabilities>("/api/v1/site-captures/capabilities", { signal: controller.signal }));
        const response = await captureRequest<{ captures: CaptureJob[] }>(base, { signal: controller.signal });
        if (!Array.isArray(response?.captures)) throw new ApiRequestError("invalid_response", undefined, "Missing capture task list.");
        const captures = response.captures.map(checkedJob);
        if (controller.signal.aborted) return;
        setCaps(capabilities); if (!busyRef.current && revision === mutationRevision.current) setJobs(captures); setPollError(null); setRetries(0); failures = 0;
        timer = window.setTimeout(() => void poll(), 4000);
      } catch (reason) {
        if (controller.signal.aborted) return;
        failures += 1; setRetries(failures - 1); setPollError(reason);
        reportError(reason, { operation: "site-capture-poll", projectId });
        // Retain last confirmed tasks; a failed read is never an empty list.
        if (failures <= 5 && !(reason instanceof ApiRequestError && [401, 403, 404].includes(reason.context.status ?? 0))) {
          timer = window.setTimeout(() => void poll(), Math.min(30000, 2000 * 2 ** (failures - 1)));
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [base, open, refresh, projectId]);
  useEffect(() => {
    if (started === null) return;
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000)); tick();
    const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [started]);
  useEffect(() => {
    if (!open || viewer) return;
    const key = (event: KeyboardEvent) => { if (!event.defaultPrevented && event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [open, viewer, onClose]);

  const retain = (job: CaptureJob) => {
    checkedJob(job); setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]); setSelected(job.id); return job;
  };
  const execute = async (operation: string, work: () => Promise<void>) => {
    if (busyRef.current) return;
    mutationRevision.current++;
    busyRef.current = true; setBusy(true); setError(null); setStarted(Date.now());
    try { await work(); }
    catch (reason) {
      if (!lifetime.current.signal.aborted) { setError(reason); reportError(reason, { operation, projectId, correlationId: selected }); }
    } finally {
      mutationRevision.current++;
      busyRef.current = false;
      if (!lifetime.current.signal.aborted) { setBusy(false); setStarted(null); setProgress(null); setRefresh(value => value + 1); }
    }
  };
  const upload = (existing: CaptureJob | null) => execute("site-capture-upload", async () => {
    let job = existing;
    const signal = lifetime.current.signal;
    if (!job) {
      if (validation.errors.length || nameError || !acknowledged) throw new UserFacingError("请先检查素材并确认采集要求。");
      requestId.current ??= createUuid();
      const response = await captureRequest<{ capture: CaptureJob }>(base, { method: "POST", signal, body: JSON.stringify({ name: name.trim(), inputKind: validation.inputKind === "video" ? "video" : "images", files: files.map(file => ({ filename: file.name, byteSize: file.size, contentType: captureMime(file) })), clientRequestId: requestId.current }) });
      job = retain(response.capture);
    }
    // Re-read before resuming: a timed-out PUT may have completed server-side.
    job = retain((await captureRequest<{ capture: CaptureJob }>(`${base}/${job.id}`, { signal })).capture);
    if (job.status !== "uploading") throw new UserFacingError("该任务已离开素材准备阶段，请查看最新状态。");
    const pending = job.files.filter(slot => !slot.uploaded);
    const matches = pending.map(slot => {
      const file = files.find(item => item.name === slot.filename && item.size === slot.byteSize && captureMime(item) === slot.contentType);
      if (!file) throw new UserFacingError(`请重新选择原始文件“${slot.filename}”，文件名、类型和大小必须与任务一致。`);
      return { slot, file };
    });
    for (const { slot, file } of matches) {
      setProgress({ completed: job.files.filter(item => item.uploaded).length, total: job.files.length, filename: file.name });
      job = retain((await captureRequest<{ capture: CaptureJob }>(`${base}/${job.id}/sources/${slot.index}`, { method: "PUT", signal, headers: { "content-type": slot.contentType }, body: file }, 10 * 60 * 1000)).capture);
    }
    setFiles([]); requestId.current = null;
  });
  const action = (job: CaptureJob, verb: "start" | "cancel" | "retry" | "delete") => execute(`site-capture-${verb}`, async () => {
    const signal = lifetime.current.signal;
    if (verb === "delete") {
      await captureRequest(`${base}/${job.id}`, { method: "DELETE", signal });
      setJobs(previous => previous.filter(item => item.id !== job.id)); setSelected(null);
    } else retain((await captureRequest<{ capture: CaptureJob }>(`${base}/${job.id}/${verb}`, { method: "POST", signal })).capture);
  });
  if (!open) return null;
  const newJob = () => { setSelected(null); setFiles([]); setAcknowledged(false); setError(null); requestId.current = null; };
  return <div className="dialog-backdrop capture-backdrop" role="dialog" aria-modal="true" aria-labelledby="capture-title">
    <section className="capture-workspace">
      <header className="capture-header"><div><p className="eyebrow">SITE CAPTURE / 现场重建</p><h2 id="capture-title">写实漫游</h2><p>{projectName} · 上传采集素材，生成可自由浏览的现场场景。</p></div><button type="button" onClick={onClose} aria-label="关闭写实漫游">×</button></header>
      <div className="capture-body">
        <aside className="capture-sidebar"><button type="button" className="primary-button" onClick={newJob} disabled={busy}>＋ 新建写实漫游</button><h3>本项目的漫游任务</h3>
          {loading && !jobs.length ? <p role="status">🟡 正在读取任务…</p> : !jobs.length && !pollError ? <p>暂无任务。先查看采集要求，再上传现场素材。</p> : null}
          <div className="capture-task-list">{jobs.map(job => <button type="button" key={job.id} className={`capture-task ${selected === job.id ? "is-selected" : ""}`} onClick={() => { setSelected(job.id); setError(null); }} disabled={busy}><strong>{job.name}</strong><span className={`capture-state is-${job.status}`}>{captureStatus[job.status]}</span></button>)}</div>
        </aside>
        <main className="capture-main">
          {pollError ? <div className="capture-notice is-warning" role="status"><strong>{unavailableApi ? "当前后端尚未提供写实重建接口" : pollError instanceof ApiRequestError && pollError.code === "network_error" ? `🔴 网络异常／正在重连 · 重试 ${retries}/5` : "任务状态读取失败"}</strong><p>{unavailableApi ? "请先更新后端。采集要求可正常查看；更新后可上传素材和管理任务。" : errorMessage(pollError)}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>重新检查服务</button></div> : caps && !caps.available ? <div className="capture-notice" role="status"><strong>GPU 重建服务尚未就绪</strong><p>可以先上传和保存素材。接入可用的 NVIDIA GPU 工作节点后，再点击生成；已有结果仍可打开。</p><button type="button" onClick={() => setRefresh(value => value + 1)}>重新检查服务</button></div> : caps ? <p className="capture-ready">● GPU 重建服务已就绪</p> : null}
          {error ? <div className="capture-notice is-error" role="alert"><strong>{errorMessage(error)}</strong>{error instanceof ApiRequestError && error.requestId ? <small>请求编号：{error.requestId}</small> : null}</div> : null}
          {busy ? <div className="capture-notice" role="status" aria-live="polite"><strong>🔵 {progress ? `正在上传 ${progress.completed}/${progress.total} 个素材` : "正在处理任务"} · 已用时 {elapsed} 秒</strong>{progress ? <><p>{progress.filename}</p><progress value={progress.completed} max={progress.total} /></> : null}<p>可关闭面板后返回查看；素材上传期间请保留当前页面。</p></div> : null}
          {!active ? <>
            <SiteCaptureRequirements />
            <div className="capture-file-limits"><span>照片 <strong>{caps?.minImages ?? 8}–{caps?.maxImages ?? 120} 张</strong> · 单张 <strong>{formatFileSize(caps?.maxImageBytes ?? 8388608)}</strong></span><span>视频 <strong>{formatFileSize(caps?.maxVideoBytes ?? 104857600)}</strong> · 素材合计 <strong>{formatFileSize(caps?.maxTotalBytes ?? 524288000)}</strong></span></div>
            <form className="capture-form" onSubmit={event => { event.preventDefault(); void upload(null); }}>
              <label>漫游名称<input value={name} maxLength={80} disabled={busy || requestId.current !== null} onChange={event => setName(event.target.value)} /></label>
              <label>选择一组照片或一个连续视频<input type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.webm" multiple disabled={busy || requestId.current !== null} onChange={event => { setFiles(Array.from(event.target.files ?? [])); setError(null); }} /></label>
              {files.length ? <p>已选择 {files.length} 个文件 · {formatFileSize(validation.totalBytes)}</p> : null}
              {files.length && validation.errors.length ? <ul className="capture-validation">{validation.errors.map(message => <li key={message}>{message}</li>)}</ul> : null}
              {nameError ? <p className="capture-validation">{nameError}</p> : null}
              <label className="capture-check"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />我已阅读采集要求，理解重建需质量检查，无法保证所有区域都能还原。</label>
              <button type="submit" className="primary-button" disabled={busy || !caps || !!pollError || !acknowledged || !files.length || !!validation.errors.length || !!nameError}>上传并保存素材</button>
            </form>
          </> : <article className="capture-detail">
            <div className="capture-detail-heading"><div><p className="eyebrow">{active.inputKind === "video" ? "连续视频" : "多视角照片"}</p><h3>{active.name}</h3></div><span className={`capture-state is-${active.status}`}>{captureStatus[active.status]}</span></div>
            <p className="capture-task-id">任务编号：{active.id}</p>
            {active.status === "uploading" ? <><h4>素材准备</h4><p>已保存 {active.files.filter(file => file.uploaded).length}/{active.files.length} 个文件。保存后由你决定何时开始生成。</p>
              {active.files.some(file => !file.uploaded) ? <><label className="capture-resume">重新选择原始素材，继续上传未完成的文件<input aria-label="继续上传原始素材" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.webm" disabled={busy} onChange={event => setFiles(Array.from(event.target.files ?? []))} /></label><button type="button" disabled={busy || !files.length} onClick={() => void upload(active)}>继续上传</button></> : <button type="button" className="primary-button" disabled={busy || !caps?.available || !!pollError} onClick={() => void action(active, "start")}>开始生成漫游</button>}
            </> : null}
            {["queued", "running"].includes(active.status) ? <div className="capture-notice" role="status"><strong>🟡 {captureStage[active.stage] ?? "后台正在处理"}</strong>{active.total > 0 ? <p>{active.completed} / {active.total}</p> : <p>正在执行此阶段，请耐心等待。</p>}<p>重建可能需要数十分钟，取决于素材与 GPU。可关闭面板或离开页面，服务器会继续执行。</p></div> : null}
            {active.status === "failed" ? <div className="capture-notice is-error" role="alert"><strong>{errorMessage(new ApiRequestError(active.errorCode ? (active.errorCode.startsWith("site_capture_") ? active.errorCode : `site_capture_${active.errorCode}`) : "site_capture_worker_failed", undefined, "Site capture failed."))}</strong><p>任务编号和错误码可用于定位：{active.errorCode}</p></div> : null}
            {active.status === "succeeded" && active.result ? <><div className="capture-result"><span>场景已生成</span><strong>{active.result.gaussianCount.toLocaleString()} 个高斯点</strong><p>{formatFileSize(active.result.byteSize)} · 已定位 {active.result.quality.registeredImages}/{active.result.quality.inputImages} 张画面</p><button type="button" className="primary-button" onClick={() => setViewer(active)}>进入写实漫游</button></div><p>可自由移动查看；未拍摄区域可能缺失。此结果不含碰撞、工程构件或测量标定。</p>{active.result.warnings.length ? <p className="capture-notice">重建记录包含 {active.result.warnings.length} 项质量提示，请重点检查弱纹理、反光和遮挡区域。</p> : null}</> : null}
            <details className="capture-sources"><summary>查看 {active.files.length} 个源文件</summary><ul>{active.files.map(file => <li key={file.index}><span>{file.filename}</span><small>{formatFileSize(file.byteSize)} · {file.uploaded ? "已保存" : "待上传"}</small></li>)}</ul></details>
            <div className="capture-actions">{["uploading", "queued", "running"].includes(active.status) ? <button type="button" disabled={busy} onClick={() => void action(active, "cancel")}>取消任务</button> : null}{active.status === "failed" && active.files.every(file => file.uploaded) ? <button type="button" disabled={busy || !caps?.available || !!pollError} onClick={() => void action(active, "retry")}>重新生成</button> : null}{["uploading", "failed", "canceled", "succeeded"].includes(active.status) ? <button type="button" disabled={busy} onClick={() => { if (window.confirm(`删除“${active.name}”及其源文件和结果？此操作无法撤销。`)) void action(active, "delete"); }}>删除任务及文件</button> : null}</div>
          </article>}
        </main>
      </div>
      <footer className="capture-footer"><span>素材准备 → GPU 重建 → 浏览器漫游</span><div><button type="button" onClick={onBack}>返回功能中心</button><button type="button" onClick={onClose}>关闭面板</button></div></footer>
    </section>
    {viewer?.result ? <ViewerBoundary key={viewer.id} onClose={() => setViewer(null)}><Suspense fallback={<div className="capture-viewer-loading" role="status"><p>🟡 正在加载漫游查看器…</p><button type="button" onClick={() => setViewer(null)}>返回任务</button></div>}><Viewer title={viewer.name} contentUrl={`${base}/${viewer.id}/content`} result={viewer.result} onClose={() => setViewer(null)} /></Suspense></ViewerBoundary> : null}
  </div>;
}
