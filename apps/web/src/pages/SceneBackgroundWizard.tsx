import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { formatFileSize } from "../canvas/model-assets";
import {
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
  projectName: string;
};

type WizardStep = 1 | 2 | 3;

const modeOptions: Array<{
  id: SceneBackgroundMode;
  code: string;
  description: string;
  output: string;
  title: string;
}> = [
  {
    id: "single-image",
    code: "01",
    title: "极速背景",
    description: "上传一张现场图片，生成适合固定视角或小范围移动的 2.5D 背景。",
    output: "预计输出 · 分层深度背景",
  },
  {
    id: "site-capture",
    code: "02",
    title: "写实漫游",
    description: "上传一段环拍视频或一组多视角照片，为 Gaussian Splatting 重建准备素材。",
    output: "预计输出 · 可漫游视觉场景",
  },
];

const qualityOptions: Array<{
  description: string;
  id: SceneBackgroundQuality;
  label: string;
}> = [
  { id: "lightweight", label: "轻量优先", description: "移动端或复杂大屏优先" },
  { id: "balanced", label: "均衡", description: "画质与加载速度兼顾" },
  { id: "detail", label: "细节优先", description: "桌面端近距离查看" },
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
  { step: 1, label: "选择方案" },
  { step: 2, label: "添加素材" },
  { step: 3, label: "检查配置" },
];

const fileExtension = (filename: string): string =>
  filename.split(".").at(-1)?.toLowerCase() ?? "";

const isPreviewImage = (file: File): boolean =>
  ["jpg", "jpeg", "png", "webp"].includes(fileExtension(file.name));

const isPreviewVideo = (file: File): boolean =>
  ["mp4", "webm"].includes(fileExtension(file.name));

export function SceneBackgroundWizard({ onClose, projectName }: SceneBackgroundWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [mode, setMode] = useState<SceneBackgroundMode>("single-image");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sceneName, setSceneName] = useState(`${projectName}场景底座`);
  const [quality, setQuality] = useState<SceneBackgroundQuality>("balanced");
  const [movement, setMovement] = useState<SceneBackgroundMovement>("fixed");
  const [knownScale, setKnownScale] = useState("");
  const [checked, setChecked] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const validation = useMemo(
    () => validateSceneBackgroundFiles(mode, files),
    [files, mode],
  );
  const nameError = validateSceneBackgroundName(sceneName);
  const scaleError = validateKnownScale(knownScale);
  const configurationValid = !nameError && !scaleError;
  const selectedMode = modeOptions.find((option) => option.id === mode) ?? modeOptions[0];
  const firstFile = files[0] ?? null;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!firstFile || (!isPreviewImage(firstFile) && !isPreviewVideo(firstFile))) {
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
    if (nextMode === mode) return;
    setMode(nextMode);
    setMovement(nextMode === "single-image" ? "fixed" : "limited");
    replaceFiles([]);
  };

  const receiveFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const nextFiles = Array.from(fileList);
    replaceFiles(mode === "single-image" ? nextFiles.slice(0, 1) : nextFiles);
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

  const inputDescription = mode === "single-image"
    ? "选择一张清晰的正面或斜向现场照片。建议宽度不低于 1920 px。"
    : "选择一个 MP4/WebM 环拍视频，或一次选择 8–120 张有重叠视角的照片。";

  return (
    <div
      aria-labelledby="scene-background-wizard-title"
      aria-modal="true"
      className="dialog-backdrop scene-background-backdrop"
      role="dialog"
    >
      <section className="scene-background-wizard">
        <header className="scene-background-header">
          <div>
            <div className="scene-background-title-line">
              <p className="eyebrow">AI Scene Foundation</p>
              <span>组件预览</span>
            </div>
            <h2 id="scene-background-wizard-title">创建场景底座</h2>
            <p>为“{projectName}”准备客户现场素材。当前组件完成本地预检，不会上传文件或伪造生成任务。</p>
          </div>
          <button aria-label="关闭场景底座向导" className="dialog-close" onClick={onClose} type="button">×</button>
        </header>

        <nav aria-label="场景底座创建步骤" className="scene-background-steps">
          {wizardSteps.map(({ label, step: stepNumber }) => (
            <span
              aria-current={step === stepNumber ? "step" : undefined}
              className={`${step === stepNumber ? "is-active" : ""}${step > stepNumber ? " is-complete" : ""}`}
              key={stepNumber}
            >
              <i>{step > stepNumber ? "✓" : stepNumber}</i>
              {label}
            </span>
          ))}
        </nav>

        <div className="scene-background-body">
          {step === 1 ? (
            <div className="scene-background-mode-step">
              <div className="scene-background-section-heading">
                <div><span>STEP 01</span><h3>客户希望怎样查看现场？</h3></div>
                <p>选择展示目标后，平台才能使用正确的素材检查与重建路径。</p>
              </div>
              <div className="scene-background-mode-grid">
                {modeOptions.map((option) => (
                  <button
                    aria-pressed={mode === option.id}
                    className={`scene-background-mode-card${mode === option.id ? " is-active" : ""}`}
                    key={option.id}
                    onClick={() => selectMode(option.id)}
                    type="button"
                  >
                    <span className="scene-background-mode-code">{option.code}</span>
                    <span className="scene-background-mode-check" aria-hidden="true">{mode === option.id ? "✓" : ""}</span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                    <em>{option.output}</em>
                  </button>
                ))}
                <div aria-disabled="true" className="scene-background-mode-card is-disabled">
                  <span className="scene-background-mode-code">03</span>
                  <span className="scene-background-mode-badge">后续</span>
                  <strong>工程底座</strong>
                  <small>使用 BIM、CAD 或点云建立准确尺寸和空间关系，适合测距、碰撞与工程分析。</small>
                  <em>计划输出 · 轻量化工程 Mesh</em>
                </div>
              </div>
              <aside className="scene-background-principle">
                <span aria-hidden="true">◎</span>
                <div><strong>视觉背景与工程模型分开</strong><p>图片生成的结果只承担视觉展示，不会被标记为可测量、可碰撞或可用于物理计算的真实模型。</p></div>
              </aside>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="scene-background-material-step">
              <div className="scene-background-section-heading">
                <div><span>STEP 02</span><h3>添加{selectedMode.title}素材</h3></div>
                <p>{inputDescription}</p>
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
                    accept={modeFileAccept(mode)}
                    multiple={mode === "site-capture"}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      receiveFiles(event.target.files);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                  {previewUrl && firstFile ? (
                    <div className="scene-background-file-preview">
                      {isPreviewImage(firstFile) ? (
                        <img alt={`${firstFile.name} 本地预览`} src={previewUrl} />
                      ) : (
                        <video aria-label={`${firstFile.name} 本地预览`} muted playsInline preload="metadata" src={previewUrl} />
                      )}
                      {files.length > 1 ? <span>+{files.length - 1}</span> : null}
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
                        <span>{isPreviewVideo(file) ? "VID" : "IMG"}</span>
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
                  <p>文件扩展名、数量和大小符合当前资源边界；服务端接入后仍须校验文件签名与画面质量。</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="scene-background-config-step">
              <div className="scene-background-section-heading">
                <div><span>STEP 03</span><h3>检查输出配置</h3></div>
                <p>这些设置会成为生成任务输入；当前阶段仅在浏览器中预检，不会保存。</p>
              </div>
              <div className="scene-background-config-grid">
                <section className="scene-background-form">
                  <label>
                    <span>场景名称</span>
                    <input maxLength={80} onChange={(event) => { setSceneName(event.target.value); setChecked(false); }} value={sceneName} />
                    {nameError ? <small className="field-error">{nameError}</small> : null}
                  </label>

                  <fieldset>
                    <legend>输出偏好</legend>
                    <div className="scene-background-segmented">
                      {qualityOptions.map((option) => (
                        <label className={quality === option.id ? "is-active" : ""} key={option.id}>
                          <input checked={quality === option.id} name="background-quality" onChange={() => { setQuality(option.id); setChecked(false); }} type="radio" />
                          <strong>{option.label}</strong><small>{option.description}</small>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>镜头活动范围</legend>
                    <div className="scene-background-movement">
                      {movementOptions.map((option) => {
                        const unsupported = mode === "single-image" && option.id === "free";
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
                    {mode === "single-image" ? <small>单张图片缺少被遮挡区域，不能选择自由漫游。</small> : null}
                  </fieldset>

                  <label>
                    <span>现场已知尺寸（米）<em>可选</em></span>
                    <input inputMode="decimal" min="0" onChange={(event) => { setKnownScale(event.target.value); setChecked(false); }} placeholder="例如：厂房门宽 4.2" step="0.01" type="number" value={knownScale} />
                    {scaleError ? <small className="field-error">{scaleError}</small> : <small>后续在预览中选择对应两点，建立真实尺度参考。</small>}
                  </label>
                </section>

                <aside className="scene-background-task-summary">
                  <p className="eyebrow">Preflight summary</p>
                  <h3>{sceneName.trim() || "未命名场景"}</h3>
                  <dl>
                    <div><dt>生成路线</dt><dd>{selectedMode.title}</dd></div>
                    <div><dt>输入素材</dt><dd>{files.length} 个 · {formatFileSize(validation.totalBytes)}</dd></div>
                    <div><dt>画质策略</dt><dd>{qualityOptions.find((option) => option.id === quality)?.label}</dd></div>
                    <div><dt>镜头范围</dt><dd>{movementOptions.find((option) => option.id === movement)?.label}</dd></div>
                  </dl>
                  <ol>
                    <li className="is-ready"><i>✓</i><span><strong>素材预检</strong>前端组件已支持</span></li>
                    <li><i>2</i><span><strong>服务端重建</strong>等待 GPU 任务服务</span></li>
                    <li><i>3</i><span><strong>预览校准</strong>等待生成结果</span></li>
                    <li><i>4</i><span><strong>发布到场景</strong>等待资源契约</span></li>
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
                    <strong>组件预检已完成</strong>
                    <p>配置和文件选择已通过浏览器端检查。生成服务尚未接入，因此文件没有上传、任务没有创建。</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="scene-background-footer">
          <div>
            <span>当前项目</span>
            <strong>{projectName}</strong>
          </div>
          <div>
            {step === 1 ? <button className="secondary-button" onClick={onClose} type="button">取消</button> : null}
            {step > 1 ? <button className="secondary-button" onClick={() => { setStep((step - 1) as WizardStep); setChecked(false); }} type="button">上一步</button> : null}
            {step === 1 ? <button className="primary-button" onClick={() => setStep(2)} type="button">添加素材</button> : null}
            {step === 2 ? (
              <button className="primary-button" disabled={validation.errors.length > 0} onClick={() => setStep(3)} type="button">检查配置</button>
            ) : null}
            {step === 3 && !checked ? (
              <button className="primary-button" disabled={validation.errors.length > 0 || !configurationValid} onClick={completePreflight} type="button">完成素材预检</button>
            ) : null}
            {step === 3 && checked ? <button className="primary-button" onClick={onClose} type="button">完成</button> : null}
          </div>
        </footer>
      </section>
    </div>
  );
}
