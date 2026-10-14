import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { formatFileSize } from "../canvas/model-assets";
import { useNotifications } from "../components/NotificationProvider";
import { ApiRequestError, errorMessage, reportError, request } from "../api";
import { SceneFoundationHub } from "./SceneFoundationHub";
import {
  SCENE_BACKGROUND_LIMITS,
  SITE_CAPTURE_RELEASED,
  modeFileAccept,
  validateKnownScale,
  validateSceneBackgroundFiles,
  validateSceneBackgroundName,
  type SceneBackgroundMode,
  type SceneBackgroundMovement,
  type SceneBackgroundQuality,
} from "./scene-background";

type SceneBackgroundWizardProps = {
  onClose: () => void;
  onEngineering: () => void;
  onCapture: () => void;
  onCreate: (input: {
    files: readonly File[];
    knownScaleMeters: number | null;
    mode: SceneBackgroundMode;
    movement: SceneBackgroundMovement;
    name: string;
    quality: SceneBackgroundQuality;
    onProgress?: (progress: { completed: number; total: number; filename: string }) => void;
  }) => Promise<void>;
  projectName: string;
};

type WizardStep = 1 | 2 | 3;

const qualityOptions: Array<{
  description: string;
  id: SceneBackgroundQuality;
  label: string;
}> = [
  { id: "lightweight", label: "轻量优先", description: "记录移动端优化目标" },
  { id: "balanced", label: "均衡", description: "记录默认优化目标" },
  { id: "detail", label: "细节优先", description: "记录桌面端优化目标" },
];

const movementOptions: Array<{
  id: SceneBackgroundMovement;
  label: string;
}> = [
  { id: "fixed", label: "固定视角" },
  { id: "limited", label: "小范围移动" },
  { id: "free", label: "自由漫游" },
];

const wizardSteps: Array<{ label: string; step: WizardStep }> = [
  { step: 2, label: "添加素材" },
  { step: 3, label: "检查配置" },
];

const fileExtension = (filename: string): string =>
  filename.split(".").at(-1)?.toLowerCase() ?? "";

const isPreviewImage = (file: File): boolean =>
  ["jpg", "jpeg", "png", "webp"].includes(fileExtension(file.name));

export function SceneBackgroundWizard({ onClose, onCreate, onEngineering, onCapture, projectName }: SceneBackgroundWizardProps) {
  const notify = useNotifications();
  const [step, setStep] = useState<WizardStep>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sceneName, setSceneName] = useState(`${projectName}场景底座`);
  const [quality, setQuality] = useState<SceneBackgroundQuality>("balanced");
  const [movement, setMovement] = useState<SceneBackgroundMovement>("fixed");
  const [knownScale, setKnownScale] = useState("");
  const [checked, setChecked] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageGeneration, setImageGeneration] = useState<boolean | null>(null);
  const [capabilityError, setCapabilityError] = useState<unknown>(null);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [progress, setProgress] = useState<{ completed: number; total: number; filename: string } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const validation = useMemo(
    () => validateSceneBackgroundFiles("single-image", files),
    [files],
  );
  const nameError = validateSceneBackgroundName(sceneName);
  const scaleError = validateKnownScale(knownScale);
  const configurationValid = !nameError && !scaleError && imageGeneration === true;
  const firstFile = files[0] ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setImageGeneration(null);
    setCapabilityError(null);
    let disposed = false;
    void request<{ sceneBackgroundGeneration: boolean }>("/api/v1/capabilities", { signal: controller.signal })
      .then((value) => {
        if (typeof value?.sceneBackgroundGeneration !== "boolean") throw new ApiRequestError("invalid_response", undefined, "Missing sceneBackgroundGeneration capability.");
        if (!disposed) setImageGeneration(value.sceneBackgroundGeneration);
      }).catch((reason: unknown) => {
        if (disposed) return;
        const failure = controller.signal.aborted ? new ApiRequestError("network_error", undefined, "Scene foundation capability request timed out.") : reason;
        setCapabilityError(failure);
        reportError(failure, { operation: "scene-foundation-capabilities" });
      }).finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [capabilityRetry]);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === "Escape" && !importing) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [importing, onClose]);

  useEffect(() => {
    if (!firstFile || !isPreviewImage(firstFile)) {
      setPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(firstFile);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [firstFile]);

  const replaceFiles = (nextFiles: File[]) => {
    setFiles(nextFiles);
    setChecked(false);
  };

  const selectMode = (nextMode: SceneBackgroundMode) => {
    if (nextMode === "site-capture") {
      if (!SITE_CAPTURE_RELEASED) throw new Error("写实漫游尚未开放。");
      onCapture(); return;
    }
    setStep(2);
  };

  const receiveFiles = (fileList: FileList | null) => {
    if (!fileList || imageGeneration !== true) return;
    const nextFiles = Array.from(fileList);
    replaceFiles(nextFiles.slice(0, 1));
  };

  const dropFiles = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    receiveFiles(event.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    replaceFiles(files.filter((_, fileIndex) => fileIndex !== index));
  };

  const completePreflight = () => {
    if (validation.errors.length > 0 || !configurationValid) return;
    setChecked(true);
  };

  const createBackground = async () => {
    if (validation.errors.length > 0 || !configurationValid || files.length === 0) return;
    setImporting(true);
    setElapsed(0);
    setStartedAt(Date.now());
    setProgress({ completed: 0, total: files.length, filename: files[0].name });
    try {
      await onCreate({
        files,
        knownScaleMeters: knownScale.trim() === "" ? null : Number(knownScale),
        mode: "single-image",
        movement,
        name: sceneName.trim(),
        quality,
        onProgress: setProgress,
      });
      onClose();
    } catch (reason) {
      notify.error(reason);
    } finally {
      setImporting(false);
      setStartedAt(null);
    }
  };

  return (
    <div
      aria-labelledby="scene-background-wizard-title"
      aria-modal="true"
      className="dialog-backdrop scene-background-backdrop"
      role="dialog"
    >
      <section className={`scene-background-wizard${step === 1 ? " is-hub" : ""}`}>
        <header className="scene-background-header">
          <div>
            <div className="scene-background-title-line">
              <p className="eyebrow">AI Scene Foundation</p>
              {step > 1 ? <span>单图背景</span> : null}
            </div>
            <h2 id="scene-background-wizard-title">{step === 1 ? "AI 场景底座" : "极速背景"}</h2>
            <p>{step === 1 ? (SITE_CAPTURE_RELEASED ? "极速背景 · 写实漫游 · 工程底座" : "极速背景 · 工程底座") : "将现场照片制作成固定视角的纹理背景模型。"}</p>
          </div>
          <button aria-label="关闭场景底座向导" className="dialog-close" disabled={importing} onClick={onClose} type="button">×</button>
        </header>

        {step > 1 ? <nav aria-label="场景底座创建步骤" className="scene-background-steps">
          {wizardSteps.map(({ label, step: stepNumber }) => (
            <span
              aria-current={step === stepNumber ? "step" : undefined}
              className={`${step === stepNumber ? "is-active" : ""}${step > stepNumber ? " is-complete" : ""}`}
              key={stepNumber}
            >
              <i>{step > stepNumber ? "✓" : stepNumber - 1}</i>
              {label}
            </span>
          ))}
        </nav> : null}

        <div className="scene-background-body">
          {capabilityError ? <div className="scene-background-service-notice" role="alert">
            <strong>{capabilityError instanceof ApiRequestError && capabilityError.code === "network_error" ? "🔴 网络异常" : "背景生成服务检查失败"}</strong>
            <p>{errorMessage(capabilityError)} 重试次数：{capabilityRetry}。{SITE_CAPTURE_RELEASED ? "写实漫游和工程底座会独立检查各自的服务状态。" : "工程底座会独立检查转换服务状态。"}</p>
            <button type="button" className="secondary-button" onClick={() => setCapabilityRetry((value) => value + 1)}>重新检查背景服务</button>
          </div> : null}
          {step === 1 ? <SceneFoundationHub imageGeneration={imageGeneration} capabilityFailed={!!capabilityError} onSelect={selectMode} onEngineering={onEngineering} /> : null}
          {step > 1 && imageGeneration !== true ? <div className="scene-background-service-notice" role="status">
            <strong>{imageGeneration === false ? "当前服务尚未开放单图背景生成" : capabilityError ? "尚未确认生成服务状态" : "正在检查背景生成服务…"}</strong>
            <p>服务就绪后才能上传并生成 GLB。你仍可查看文件要求。</p>
          </div> : null}

          {step === 2 ? (
            <div className="scene-background-material-step">
              <div className="scene-background-section-heading">
                <div><span>STEP 01</span><h3>添加极速背景素材</h3></div>
                <p>选择一张清晰的正面或斜向现场照片。建议宽度不低于 1920 px。</p>
              </div>
              <div className="scene-background-input-limits">
                单张图片 ≤ <strong>{formatFileSize(SCENE_BACKGROUND_LIMITS.imageBytes)}</strong>。
              </div>
              <div className="scene-background-material-grid">
                <label
                  className={`scene-background-dropzone${dragging ? " is-dragging" : ""}${files.length > 0 ? " has-files" : ""}`}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={dropFiles}
                >
                  <input
                    accept={modeFileAccept("single-image")}
                    disabled={imageGeneration !== true}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      receiveFiles(event.target.files);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                  {previewUrl && firstFile ? (
                    <div className="scene-background-file-preview">
                      <img alt={`${firstFile.name} 本地预览`} src={previewUrl} />
                    </div>
                  ) : <span className="scene-background-upload-mark" aria-hidden="true">＋</span>}
                  <strong>{files.length > 0 ? "重新选择素材" : "拖放文件到这里"}</strong>
                  <small>{files.length > 0 ? "点击或拖放会替换当前选择" : "也可以点击浏览本地文件"}</small>
                </label>

                <aside className="scene-background-capture-guide">
                  <p className="eyebrow">Capture checklist</p>
                  <h3>拍摄建议</h3>
                  <ul>
                    <li><i>1</i><span><strong>连续覆盖</strong>相邻画面保留明显重叠区域</span></li>
                    <li><i>2</i><span><strong>移动平稳</strong>不要快速转身或频繁变焦</span></li>
                    <li><i>3</i><span><strong>减少干扰</strong>避开移动人员、车辆和强反光</span></li>
                    <li><i>4</i><span><strong>保留尺度</strong>记录一段已知长度用于校准</span></li>
                  </ul>
                </aside>
              </div>

              {files.length > 0 ? (
                <section className="scene-background-file-list">
                  <header><strong>已选择 {files.length} 个文件</strong><span>合计 {formatFileSize(validation.totalBytes)}</span></header>
                  <div>
                    {files.slice(0, 8).map((file, index) => (
                      <article key={`${file.name}:${file.lastModified}:${index}`}>
                        <span>IMG</span>
                        <div><strong title={file.name}>{file.name}</strong><small>{formatFileSize(file.size)}</small></div>
                        <button aria-label={`移除 ${file.name}`} onClick={() => removeFile(index)} type="button">×</button>
                      </article>
                    ))}
                    {files.length > 8 ? <p>其余 {files.length - 8} 个文件已纳入检查。</p> : null}
                  </div>
                </section>
              ) : null}

              {files.length > 0 && validation.errors.length > 0 ? (
                <div className="scene-background-validation is-error" role="alert">
                  <strong>素材未通过检查</strong>
                  {validation.errors.map((message) => <p key={message}>{message}</p>)}
                </div>
              ) : null}
              {files.length > 0 && validation.errors.length === 0 ? (
                <div className="scene-background-validation is-success" role="status">
                  <strong>基础检查通过</strong>
                  <p>文件扩展名、数量和大小符合当前资源边界；提交后服务端仍会校验文件类型、签名和大小。</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="scene-background-config-step" inert={importing}>
              <div className="scene-background-section-heading">
                <div><span>STEP 02</span><h3>检查输出配置</h3></div>
                <p>提交后会保存原图，并同步生成高清纹理背景 GLB。</p>
              </div>
              <div className="scene-background-config-grid">
                <section className="scene-background-form">
                  <label>
                    <span>场景名称</span>
                    <input maxLength={80} onChange={(event) => { setSceneName(event.target.value); setChecked(false); }} value={sceneName} />
                    {nameError ? <small className="field-error">{nameError}</small> : null}
                  </label>

                  <fieldset>
                    <legend>后续优化偏好</legend>
                    <div className="scene-background-segmented">
                      {qualityOptions.map((option) => (
                        <label className={quality === option.id ? "is-active" : ""} key={option.id}>
                          <input checked={quality === option.id} name="background-quality" onChange={() => { setQuality(option.id); setChecked(false); }} type="radio" />
                          <strong>{option.label}</strong><small>{option.description}</small>
                        </label>
                      ))}
                    </div>
                    <small>目前始终保留原图清晰度；此选项会随模型记录，供后续纹理压缩与多级细节生成使用。</small>
                  </fieldset>

                  <fieldset>
                    <legend>镜头活动范围</legend>
                    <div className="scene-background-movement">
                      {movementOptions.map((option) => {
                        const unsupported = option.id !== "fixed";
                        return (
                          <label className={movement === option.id ? "is-active" : ""} key={option.id}>
                            <input
                              checked={movement === option.id}
                              disabled={unsupported}
                              name="background-movement"
                              onChange={() => { setMovement(option.id); setChecked(false); }}
                              type="radio"
                            />
                            {option.label}
                          </label>
                        );
                      })}
                    </div>
                    <small>单张图片缺少被遮挡区域，不能选择自由漫游。</small>
                  </fieldset>

                  <label>
                    <span>背景宽度（米）<em>可选</em></span>
                    <input inputMode="decimal" min="0" onChange={(event) => { setKnownScale(event.target.value); setChecked(false); }} placeholder="留空则使用 10 米" step="0.01" type="number" value={knownScale} />
                    {scaleError ? <small className="field-error">{scaleError}</small> : <small>用于确定生成模型的实际宽度；高度会按原图比例计算。</small>}
                  </label>
                </section>

                <aside className="scene-background-task-summary">
                  <p className="eyebrow">Preflight summary</p>
                  <h3>{sceneName.trim() || "未命名场景"}</h3>
                  <dl>
                    <div><dt>当前功能</dt><dd>极速背景</dd></div>
                    <div><dt>输入素材</dt><dd>{files.length} 个 · {formatFileSize(validation.totalBytes)}</dd></div>
                    <div><dt>画质策略</dt><dd>{qualityOptions.find((option) => option.id === quality)?.label}</dd></div>
                    <div><dt>镜头范围</dt><dd>{movementOptions.find((option) => option.id === movement)?.label}</dd></div>
                  </dl>
                  <ol>
                    <li className={checked ? "is-ready" : undefined}><i>{checked ? "✓" : "1"}</i><span><strong>素材预检</strong>文件格式、数量与大小</span></li>
                    <li><i>2</i><span><strong>原始素材入库</strong>确认后按原文件保存</span></li>
                    <li><i>3</i><span><strong>服务端生成</strong>上传后生成纹理平面 GLB</span></li>
                    <li><i>4</i><span><strong>发布到场景</strong>生成后作为模型资源入库</span></li>
                  </ol>
                </aside>
              </div>

              {validation.warnings.length > 0 ? (
                <div className="scene-background-validation is-warning">
                  <strong>质量提示</strong>
                  {validation.warnings.map((message) => <p key={message}>{message}</p>)}
                </div>
              ) : null}

              {checked ? (
                <div className="scene-background-preflight-complete" role="status">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>素材预检已完成</strong>
                    <p>点击下方“生成背景模型”会保存原图，并创建一个内嵌原图纹理的轻量 GLB。</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {importing ? <div className="scene-background-import-progress" role="status" aria-live="polite">
          <strong>正在保存原图并生成背景模型</strong>
          <span>已等待 {elapsed} 秒 · 请保持此窗口开启</span>
          <p>{progress?.filename}</p>
          <progress aria-label="素材导入进度" />
        </div> : null}
        <footer className="scene-background-footer">
          <div>
            <span>当前项目</span>
            <strong>{projectName}</strong>
          </div>
          <div>
            {step === 1 ? <button className="secondary-button" disabled={importing} onClick={onClose} type="button">关闭功能中心</button> : null}
            {step > 1 ? <button className="secondary-button" disabled={importing} onClick={() => { setStep((step - 1) as WizardStep); setChecked(false); }} type="button">{step === 2 ? "返回功能中心" : "上一步"}</button> : null}
            {step === 2 ? (
              <button className="primary-button" disabled={validation.errors.length > 0 || imageGeneration !== true} onClick={() => setStep(3)} type="button">检查配置</button>
            ) : null}
            {step === 3 && !checked ? (
              <button className="primary-button" disabled={validation.errors.length > 0 || !configurationValid} onClick={completePreflight} type="button">完成素材预检</button>
            ) : null}
            {step === 3 && checked ? (
              <button className="primary-button" disabled={importing} onClick={() => void createBackground()} type="button">
                {importing ? "正在生成…" : "生成背景模型"}
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}
