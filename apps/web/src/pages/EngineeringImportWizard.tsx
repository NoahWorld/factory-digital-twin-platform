import { useEffect, useRef, useState } from "react";
import { ApiRequestError, UserFacingError, errorPresentation, reportError, request } from "../api";
import { formatFileSize, modelAssetsPath, type ModelAsset, type ModelAssetListResponse } from "../canvas/model-assets";
import { Select } from "../components/Select";
import {
  engineeringConfigurationError, engineeringErrorLabels, engineeringFileError, engineeringImportsPath,
  engineeringIssues, engineeringStageLabels, engineeringStatusLabels, engineeringUnitLabels, engineeringWarningLabels,
  type EngineeringCapabilities, type EngineeringJob, type EngineeringLayerDraft, type EngineeringRole,
} from "./engineering-import";
import "./engineering-import.css";

type Props = {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onCompleted: () => void;
  onPreview: (asset: ModelAsset) => void;
};
const activeStatuses = new Set<EngineeringJob["status"]>(["queued", "inspecting", "converting"]);
const elapsed = (start: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};
async function timedRequest<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try { return await request<T>(path, { ...init, signal: controller.signal }); }
  catch (reason) {
    if (timedOut) throw new ApiRequestError("network_error", undefined, "Engineering request timed out.", { method: init.method ?? "GET", path });
    throw reason;
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}
const nameError = (name: string): string | null => name.trim().length === 0 || name.trim().length > 100 ? "名称须为 1–100 个字符。" : null;
const unavailableReasons: Record<string, string> = {
  engineering_not_configured: "当前后端已支持工程转换，但尚未配置转换组件。请联系管理员启用；已有任务记录仍可查看。",
  engineering_dependencies_missing: "工程转换组件不完整，请联系管理员检查离线安装包；已有任务记录仍可查看。",
  engineering_probe_failed: "工程转换组件检查失败，请联系管理员检查服务；已有任务记录仍可查看。",
};
function EngineeringNotice({ title, description, retryLabel, onRetry, warning = false }: { title: string; description: string; retryLabel?: string; onRetry?: () => void; warning?: boolean }) {
  return <div className={`engineering-import-notice${warning ? " is-warning" : ""}`} role="alert"><div><strong>{title}</strong><p>{description}</p></div>{onRetry ? <button type="button" className="secondary-button" onClick={onRetry}>{retryLabel}</button> : null}</div>;
}

export function EngineeringImportWizard({ open, projectId, projectName, onClose, onCompleted, onPreview }: Props) {
  const [capabilities, setCapabilities] = useState<EngineeringCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<unknown>(null);
  const [jobs, setJobs] = useState<EngineeringJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(`${projectName}工程模型`);
  const [requirementsAccepted, setRequirementsAccepted] = useState(false);
  const [uploadStarted, setUploadStarted] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [units, setUnits] = useState("");
  const [layers, setLayers] = useState<EngineeringLayerDraft[]>([]);
  const [center, setCenter] = useState(true);
  const [configurationAccepted, setConfigurationAccepted] = useState(false);
  const configuredJob = useRef<string | null>(null);
  const knownCompletions = useRef(new Set<string>());
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const job = jobs.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        const response = await timedRequest<{ imports: EngineeringJob[] }>(engineeringImportsPath(projectId), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!Array.isArray(response.imports)) throw new ApiRequestError("invalid_response", undefined, "Engineering import list is invalid.");
        setJobs(response.imports);
        for (const item of response.imports) {
          if (item.status === "completed" && !knownCompletions.current.has(item.id)) {
            knownCompletions.current.add(item.id);
            onCompletedRef.current();
          }
        }
        failures = 0;
        setRetryCount(0);
        setLoadError(null);
        timer = setTimeout(() => void poll(), 3000);
      } catch (reason) {
        if (controller.signal.aborted) return;
        failures += 1;
        setRetryCount(failures - 1);
        setLoadError(reason);
        reportError(reason, { operation: "engineering-import-poll", projectId, failureCount: failures });
        const retryable = reason instanceof ApiRequestError && (reason.code === "network_error" || (reason.context.status ?? 0) >= 500);
        if (retryable && failures <= 5) timer = setTimeout(() => void poll(), Math.min(30000, 2000 * 2 ** (failures - 1)));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    // Capability success confirms that this backend implements the task API.
    // available=false only disables conversion; existing task records remain readable.
    setCapabilities(null);
    setCapabilityError(null);
    setLoadError(null);
    setRetryCount(0);
    setLoading(false);
    void (async () => {
      try {
        const response = await timedRequest<EngineeringCapabilities>("/api/v1/engineering-imports/capabilities", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (typeof response?.available !== "boolean") throw new ApiRequestError("invalid_response", undefined, "Engineering capabilities are invalid.");
        setCapabilities(response);
        setLoading(true);
        void poll();
      } catch (reason) {
        if (controller.signal.aborted) return;
        setCapabilityError(reason);
        reportError(reason, { operation: "engineering-import-capabilities", projectId });
      }
    })();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [open, projectId, refresh]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const handleEscape = (event: KeyboardEvent) => { if (!event.defaultPrevented && event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEscape);
    return () => { clearInterval(timer); window.removeEventListener("keydown", handleEscape); };
  }, [open, onClose]);

  useEffect(() => {
    if (!job?.inspection || configuredJob.current === job.id) return;
    configuredJob.current = job.id;
    setName(job.name);
    setUnits(job.options?.units ?? "");
    setCenter(job.options?.center ?? true);
    setLayers(job.inspection.layers.map((layer) => {
      const saved = job.options?.layers.find((item) => item.name === layer.name);
      return { name: layer.name, role: saved?.role ?? "", height: saved ? String(saved.height) : "", base: saved ? String(saved.base) : "0" };
    }));
    setConfigurationAccepted(false);
  }, [job]);

  const selectJob = (id: string | null) => {
    setSelectedId(id);
    setActionError(null);
    configuredJob.current = null;
    if (id === null) { setName(`${projectName}工程模型`); setRequirementsAccepted(false); }
  };
  const upload = async () => {
    if (!file || !capabilities?.available || !requirementsAccepted || uploadStarted !== null) return;
    const error = engineeringFileError(file, capabilities.maxSourceBytes) ?? nameError(name);
    if (error) { setActionError(new UserFacingError(error)); return; }
    const form = new FormData();
    form.append("file", file);
    form.append("name", name.trim());
    setActionError(null);
    setUploadStarted(Date.now());
    try {
      const response = await timedRequest<{ import: EngineeringJob }>(engineeringImportsPath(projectId), { method: "POST", body: form }, 10 * 60 * 1000);
      setJobs((previous) => [response.import, ...previous.filter((item) => item.id !== response.import.id)]);
      selectJob(response.import.id);
      setFile(null);
      setRefresh((value) => value + 1);
    } catch (reason) {
      reportError(reason, { operation: "engineering-import-upload", projectId });
      setActionError(reason);
      // A lost response may still have created the durable task. Refresh, never auto-repeat the POST.
      setRefresh((value) => value + 1);
    } finally {
      setUploadStarted(null);
    }
  };
  const convert = async () => {
    if (!job?.inspection || submitting || !configurationAccepted || !capabilities?.available) return;
    const error = nameError(name) ?? engineeringConfigurationError(job.format, units, layers);
    if (error) { setActionError(new UserFacingError(error)); return; }
    setSubmitting(true);
    setActionError(null);
    try {
      const response = await timedRequest<{ import: EngineeringJob }>(`${engineeringImportsPath(projectId)}/${encodeURIComponent(job.id)}/convert`, {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: 1, name: name.trim(), center,
          ...(job.format === "dxf" ? { units, layers: layers.map((layer) => ({ name: layer.name, role: layer.role, height: layer.role === "ignore" ? 0 : Number(layer.height), base: layer.role === "ignore" ? 0 : Number(layer.base) })) } : { layers: [] }),
        }),
      });
      setJobs((previous) => previous.map((item) => item.id === response.import.id ? response.import : item));
      setRefresh((value) => value + 1);
    } catch (reason) {
      reportError(reason, { operation: "engineering-import-convert", projectId, correlationId: job.id });
      setActionError(reason);
      setRefresh((value) => value + 1);
    } finally { setSubmitting(false); }
  };
  const preview = async () => {
    if (!job?.resourceId || previewing) return;
    setPreviewing(true);
    setActionError(null);
    try {
      const response = await timedRequest<ModelAssetListResponse>(modelAssetsPath(projectId));
      const asset = response.modelAssets.find((item) => item.id === job.resourceId);
      if (!asset) throw new UserFacingError("生成模型已不存在，请刷新资源列表并检查是否被删除。");
      onPreview(asset);
    } catch (reason) { reportError(reason, { operation: "engineering-import-preview", projectId }); setActionError(reason); }
    finally { setPreviewing(false); }
  };
  const updateLayer = (index: number, patch: Partial<EngineeringLayerDraft>) => {
    setLayers((previous) => previous.map((layer, current) => index === current ? { ...layer, ...patch } : layer));
    setConfigurationAccepted(false);
  };

  if (!open) return null;
  const configurationError = job ? nameError(name) ?? engineeringConfigurationError(job.format, units, layers) : null;
  const fileError = file && capabilities ? engineeringFileError(file, capabilities.maxSourceBytes) : null;
  const configuring = job?.inspection && (job.status === "needs_configuration" || job.status === "failed");
  const issues = engineeringIssues(job?.error?.details);
  const networkError = loadError instanceof ApiRequestError && loadError.code === "network_error";
  const actionNetworkError = actionError instanceof ApiRequestError && actionError.code === "network_error";
  const capabilityNetworkError = capabilityError instanceof ApiRequestError && capabilityError.code === "network_error";
  const capabilityMissing = capabilityError instanceof ApiRequestError && capabilityError.context.status === 404;

  return <div className="dialog-backdrop scene-background-backdrop" role="dialog" aria-modal="true" aria-labelledby="engineering-import-title">
    <section className="scene-background-wizard engineering-import-wizard">
      <header className="scene-background-header">
        <div><h2 id="engineering-import-title">工程底座 · BIM / CAD 转 GLB</h2><p>{projectName} · 文件检查和转换在服务器后台执行。任务可关闭后重新查看，转换完成后模型自动入库。</p></div>
        <button className="dialog-close" aria-label="关闭工程底座" onClick={onClose} type="button">×</button>
      </header>
      <div className="engineering-import-layout">
        <aside className="engineering-import-tasks" aria-label="工程导入任务">
          <button className="primary-button" onClick={() => selectJob(null)} disabled={uploadStarted !== null} type="button">＋ 导入 BIM / CAD</button>
          <h3>本项目的转换任务</h3>
          {loading ? <p role="status">正在读取任务…</p> : null}
          {!capabilities && jobs.length === 0 ? <p>服务检查通过后显示任务。</p> : null}
          {capabilities && !loading && !loadError && jobs.length === 0 ? <p>暂无任务。先阅读文件要求，再上传源文件。</p> : null}
          {jobs.map((item) => <button key={item.id} className={`engineering-import-task${selectedId === item.id ? " is-active" : ""}`} onClick={() => selectJob(item.id)} type="button">
            <strong>{item.name}</strong><span>{item.format.toUpperCase()} · {engineeringStatusLabels[item.status]}</span>
          </button>)}
          {loadError ? <div className="engineering-import-task-error"><EngineeringNotice title={networkError ? retryCount >= 5 ? "🔴 网络异常 · 自动重试已暂停" : "🔴 网络异常／正在重连" : "任务状态读取失败"} description={errorPresentation(loadError).message} retryLabel="重新读取任务" onRetry={() => setRefresh((value) => value + 1)} /><p>重试次数：{retryCount}{retryCount >= 5 ? " · 自动重试已暂停" : ""}</p></div> : null}
        </aside>
        <main className="engineering-import-main">
          {capabilityError ? <EngineeringNotice title={capabilityMissing ? "工程转换接口尚未启用" : capabilityNetworkError ? "🔴 网络异常 · 重试次数：0（服务检查需手动重试）" : "转换服务检查失败"} description={capabilityMissing ? "当前后端未提供工程转换接口，请更新后端服务后重新检查。" : errorPresentation(capabilityError).message} warning={capabilityMissing} retryLabel="重新检查转换服务" onRetry={() => setRefresh((value) => value + 1)} /> : null}
          {capabilities && !capabilities.available ? <EngineeringNotice title="工程转换暂不可用" description={unavailableReasons[capabilities.reason ?? ""] ?? "工程转换服务尚未就绪，请联系管理员检查转换组件；已有任务记录仍可查看。"} warning retryLabel="重新检查转换服务" onRetry={() => setRefresh((value) => value + 1)} /> : null}
          {!capabilities && !capabilityError ? <p role="status">正在检查转换服务…</p> : null}
          {actionError ? <EngineeringNotice title={actionNetworkError ? "🔴 网络异常 · 重试次数：0" : "操作未完成"} description={actionNetworkError ? "请先核对任务状态，再手动重试，避免重复提交。" : errorPresentation(actionError).message} /> : null}
          {!job ? <>
            <section className="engineering-import-requirements" aria-label="创建前文件要求">
              <h3>创建前请准备好这些内容</h3>
              <div className="engineering-import-format-grid">
                <article><h4>BIM · IFC</h4><p>上传包含构件几何的 IFC 文件。RVT、NWD 等请先在原软件<strong className="engineering-import-key">导出 IFC</strong>，并包含所需楼层、构件和开洞。</p><p>转换使用文件中的单位、位置和材质颜色；GLB 用于可视化，不包含原软件的参数化编辑、施工图和完整业务属性。</p></article>
                <article><h4>二维 CAD · DXF</h4><p>DWG 请先<strong className="engineering-import-key">导出 DXF</strong>。模型空间按<strong className="engineering-import-key">实际尺寸 1:1</strong> 绘制，明确单位；地坪、墙体、柱子和设备按用途分层。文字、尺寸标注等辅助图层需要明确选择忽略。</p><p>墙体应为包含实际墙厚的<strong className="engineering-import-key">闭合占地轮廓</strong>。支持闭合多段线（含弧段）、圆、闭合椭圆、闭合样条、填充边界及块；不自动将零散线段拼成墙体。</p></article>
              </div>
              <ul><li>二维轮廓位于 XY 平面且闭合、不自交；上传后为每个建模图层填写高度 / 厚度和基准标高（米）。不同高度请拆分图层。</li><li>设备轮廓生成明确标记的简化体。三维面 / 网格保留原几何，图层高度仅用于二维轮廓拉伸；外部参照请先绑定，代理图元请转换为普通图元。</li><li>源文件上限 <strong className="engineering-import-limit">{capabilities ? formatFileSize(capabilities.maxSourceBytes) : "100 MiB"}</strong>，生成 GLB 上限 <strong className="engineering-import-limit">{capabilities ? formatFileSize(capabilities.maxOutputBytes) : "25 MiB"}</strong>。大型 BIM 建议按楼层或区域分文件导出。</li><li>复杂模型可能需要<strong className="engineering-import-key">数分钟</strong>。处理过程显示真实阶段，遇到不支持的建模内容会报告任务和图元信息。</li></ul>
              <a className="secondary-button" href="/samples/engineering-layout.dxf" download>下载 CAD 规范示例</a>
            </section>
            <div className="engineering-import-form">
              <label>模型名称<input value={name} maxLength={100} disabled={uploadStarted !== null} onChange={(event) => setName(event.target.value)} /></label>
              <label>选择 IFC 或 DXF<input type="file" accept=".ifc,.dxf" disabled={uploadStarted !== null} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setActionError(null); }} /></label>
              {file ? <p>{file.name} · {formatFileSize(file.size)}</p> : null}
              {fileError ? <p className="form-error">{fileError}</p> : null}
              <label className="engineering-import-check"><input type="checkbox" checked={requirementsAccepted} disabled={uploadStarted !== null} onChange={(event) => setRequirementsAccepted(event.target.checked)} /><span>我已了解上述要求。上传后先检查文件，确认参数后再生成模型。</span></label>
              {uploadStarted !== null ? <div className="engineering-import-progress" role="status"><strong>正在上传源文件 · 已用时 {elapsed(uploadStarted, now)}</strong><progress aria-label="源文件上传中" /><p>请保留当前页面；关闭此面板不会中断上传。最长等待 10 分钟，上传完成后任务保存在服务器。</p></div> : null}
              <button className="primary-button" type="button" disabled={!capabilities?.available || !file || !!fileError || !!nameError(name) || !requirementsAccepted || uploadStarted !== null} onClick={() => void upload()}>{uploadStarted !== null ? "正在上传…" : "上传并检查文件"}</button>
              {actionError ? <p>若上传时连接中断，请先检查左侧任务列表，避免重复上传。</p> : null}
            </div>
          </> : <>
            <div className="engineering-import-job-heading"><div><h3>{job.name}</h3><p>{job.fileName} · {job.format.toUpperCase()}</p></div><span className={`engineering-import-status is-${job.status}`}>{engineeringStatusLabels[job.status]}</span></div>
            <p className="engineering-import-job-id">任务编号：{job.id}</p>
            {activeStatuses.has(job.status) ? <div className="engineering-import-progress" role="status"><strong>{engineeringStageLabels[job.stage] ?? engineeringStatusLabels[job.status]}</strong><progress aria-label={engineeringStatusLabels[job.status]} /><p>任务已创建 {elapsed(Date.parse(job.createdAt), now)} · 状态最后更新 {new Date(job.updatedAt).toLocaleTimeString("zh-CN")}</p><p>正在服务器后台处理，复杂模型可能需要数分钟。可以关闭面板；重新进入“工程底座”即可查看结果。</p></div> : null}
            {job.error ? <div className="engineering-import-error" role="alert"><strong>{engineeringErrorLabels[job.error.code] ?? "任务处理失败，请保留任务编号并联系管理员检查日志。"}</strong>{issues.length > 0 ? <ul>{issues.map((issue, index) => <li key={index}>{issue.layer ? `图层：${issue.layer}；` : ""}{issue.handle ? `图元：${issue.handle}；` : ""}{issue.entityType ? `类型：${issue.entityType}；` : ""}{engineeringErrorLabels[issue.code] ?? "此图元不符合转换要求，请检查源文件。"}</li>)}</ul> : null}{configuring ? <p>可以调整下面的图层与参数后重新生成；几何错误需要修改源文件并重新导入。</p> : <p>请修正源文件后重新导入。任务记录保留用于定位问题。</p>}</div> : null}
            {job.inspection ? <section className="engineering-import-inspection"><h4>文件检查结果</h4><p>识别 {job.inspection.objectCount} 个对象 · {job.inspection.layers.length} 个图层{job.inspection.units ? ` · 文件单位：${engineeringUnitLabels[job.inspection.units as keyof typeof engineeringUnitLabels] ?? "不在可选范围内，请核对源文件"}` : " · 文件未声明可识别的单位"}</p>{job.inspection.warnings.length > 0 ? <ul>{job.inspection.warnings.map((warning, index) => <li key={index}>{engineeringWarningLabels[warning] ?? "文件包含需要复核的内容，请结合源文件检查生成结果。"}</li>)}</ul> : null}</section> : null}
            {configuring ? <section className="engineering-import-form">
              <h3>确认生成配置</h3>
              <label>模型名称<input value={name} maxLength={100} disabled={submitting} onChange={(event) => { setName(event.target.value); setConfigurationAccepted(false); }} /></label>
              {job.format === "dxf" ? <>
                <label>图纸坐标单位<Select aria-label="图纸坐标单位" value={units} disabled={submitting} onValueChange={(value) => { setUnits(value); setConfigurationAccepted(false); }}><option value="">请选择单位</option>{Object.entries(engineeringUnitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
                <p>逐层选择用途。所有高度 / 厚度、基准标高均以米填写；忽略层不会生成模型。设备会生成简化体；已有三维面 / 网格保持原形状，高度设置仅用于二维轮廓拉伸。</p>
                <div className="engineering-import-table-scroll"><table className="engineering-import-layer-table"><thead><tr><th>图层 / 图元</th><th>用途</th><th>高度 / 厚度（米）</th><th>基准标高（米）</th></tr></thead><tbody>{layers.map((layer, index) => <tr key={layer.name}><td><strong>{layer.name}</strong><small>{job.inspection?.layers[index]?.entityCount} 个 · {job.inspection?.layers[index]?.types.join(", ")}</small></td><td><Select aria-label={`${layer.name} 用途`} value={layer.role} disabled={submitting} onValueChange={(value) => updateLayer(index, { role: value as EngineeringRole })}><option value="">请选择</option><option value="floor">地坪</option><option value="wall">墙体</option><option value="column">柱子</option><option value="equipment">设备简化体</option><option value="ignore">忽略此层</option></Select></td><td><input aria-label={`${layer.name} 高度或厚度（米）`} type="number" min="0" max="1000" step="any" value={layer.height} disabled={submitting || layer.role === "ignore"} onChange={(event) => updateLayer(index, { height: event.target.value })} placeholder="请填写" /></td><td><input aria-label={`${layer.name} 基准标高（米）`} type="number" min="-10000" max="10000" step="any" value={layer.base} disabled={submitting || layer.role === "ignore"} onChange={(event) => updateLayer(index, { base: event.target.value })} /></td></tr>)}</tbody></table></div>
              </> : <p>使用 IFC 的原始单位和构件几何生成模型。请确认源文件包含所需构件；转换保留构件节点与材质颜色，开洞按源文件处理。</p>}
              <label className="engineering-import-check"><input type="checkbox" checked={center} disabled={submitting} onChange={(event) => { setCenter(event.target.checked); setConfigurationAccepted(false); }} /><span>将模型整体移到原点附近，保留构件相对位置（建议开启，适合场景放置）</span></label>
              {configurationError ? <p className="engineering-import-hint">{configurationError}</p> : null}
              <label className="engineering-import-check"><input type="checkbox" checked={configurationAccepted} disabled={submitting || !!configurationError} onChange={(event) => setConfigurationAccepted(event.target.checked)} /><span>已确认单位、图层和生成参数，并了解上述转换范围。</span></label>
              <button className="primary-button" disabled={submitting || !!configurationError || !configurationAccepted || !capabilities?.available} onClick={() => void convert()} type="button">{submitting ? "正在提交…" : "开始生成 GLB"}</button>
            </section> : null}
            {job.status === "completed" ? <div className="engineering-import-success"><strong>GLB 已加入本项目资源库</strong>{job.result ? <><p>实际生成 {job.result.objectCount.toLocaleString("zh-CN")} 个对象 · {job.result.triangleCount.toLocaleString("zh-CN")} 个三角面</p>{job.result.warnings.length > 0 ? <><h4>生成范围说明</h4><ul>{job.result.warnings.map((warning, index) => <li key={index}>{engineeringWarningLabels[warning] ?? "转换结果包含需要复核的内容，请结合源文件检查生成范围。"}</li>)}</ul></> : null}</> : <p>生成统计暂不可用，请保留任务编号并联系管理员检查记录。</p>}<p>可以预览生成结果，并在 3D 编辑器的模型库中使用。请对照源文件核对完整性和尺寸。</p><button className="primary-button" type="button" disabled={!job.resourceId || previewing} onClick={() => void preview()}>{previewing ? "正在读取模型…" : "预览生成的模型"}</button></div> : null}
          </>}
        </main>
      </div>
      <footer className="scene-background-footer"><div><span>工程文件转换</span><strong>后台任务 · 可返回查看</strong></div><div><button className="secondary-button" type="button" onClick={onClose}>关闭面板</button></div></footer>
    </section>
  </div>;
}
