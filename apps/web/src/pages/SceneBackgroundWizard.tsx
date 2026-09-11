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
  onCreate: (input: {
    files: readonly File[];
    knownScaleMeters: number | null;
    mode: SceneBackgroundMode;
    movement: SceneBackgroundMovement;
    name: string;
    quality: SceneBackgroundQuality;
  }) => Promise<void>;
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
    description: "上传一张现场图片，生成适合固定视角展示的高清纹理平面背景。",
    output: "当前可用 · 高清纹理背景 GLB",
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

export function SceneBackgroundWizard({ onClose, onCreate, projectName }: SceneBackgroundWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [mode, setMode] = useState<SceneBackgroundMode>("single-image");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sceneName, setSceneName] = useState(`${projectName}场景底座`);
  const [quality, setQuality] = useState<SceneBackgroundQuality>("balanced");
  const [movement, setMovement] = useState<SceneBackgroundMovement>("fixed");
  const [knownScale, setKnownScale] = useState("");
  const [checked, setChecked] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
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
      if (event.key === "Escape" && !importing) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [importing, onClose]);

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
    setImportError(null);
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
    setImportError(null);
    setChecked(true);
  };

  const createBackground = async () => {
    if (validation.errors.length > 0 || !configurationValid || files.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      await onCreate({
        files,
        knownScaleMeters: knownScale.trim() === "" ? null : Number(knownScale),
        mode,
        movement,
        name: sceneName.trim(),
        quality,
      });
      onClose();
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "场景底座创建失败，请查看服务端日志。");
    } finally {
      setImporting(false);
    }
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
            <p>极速背景会保留原图清晰度并生成可预览、可加入 3D 场景的轻量 GLB；写实漫游暂只接收采集素材。</p>
          </div>
          <button aria-label="关闭场景底座向导" className="dialog-close" disabled={importing} onClick={onClose} type="button">×</button>
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
                  <p>文件扩展名、数量和大小符合当前资源边界；提交后服务端仍会校验文件签名和图片尺寸。</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="scene-background-config-step">
              <div className="scene-background-section-heading">
                <div><span>STEP 03</span><h3>检查输出配置</h3></div>
                <p>{mode === "single-image" ? "提交后会保存原图，并同步生成高清纹理背景 GLB。" : "提交后会保存采集素材；写实漫游的 GPU 重建服务尚未接入。"}</p>
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
                    <small>当前版本始终保留原图清晰度；此选项会随模型记录，供后续纹理压缩与多级细节生成使用。</small>
                  </fieldset>

                  <fieldset>
                    <legend>镜头活动范围</legend>
                    <div className="scene-background-movement">
                      {movementOptions.map((option) => {
                        const unsupported = mode === "single-image" && option.id !== "fixed";
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
                    <span>背景宽度（米）<em>可选</em></span>
                    <input inputMode="decimal" min="0" onChange={(event) => { setKnownScale(event.target.value); setChecked(false); }} placeholder="留空则使用 10 米" step="0.01" type="number" value={knownScale} />
                    {scaleError ? <small className="field-error">{scaleError}</small> : <small>用于确定生成模型的实际宽度；高度会按原图比例计算。</small>}
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
                    <li className="is-ready"><i>✓</i><span><strong>原始素材入库</strong>使用项目资源接口</span></li>
                    <li className={mode === "single-image" ? "is-ready" : undefined}><i>{mode === "single-image" ? "✓" : "3"}</i><span><strong>服务端生成</strong>{mode === "single-image" ? "纹理平面 GLB 已支持" : "等待 GPU 重建服务"}</span></li>
                    <li className={mode === "single-image" ? "is-ready" : undefined}><i>{mode === "single-image" ? "✓" : "4"}</i><span><strong>发布到场景</strong>{mode === "single-image" ? "作为 3D 模型资源入库" : "等待生成结果"}</span></li>
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
                    <p>{mode === "single-image" ? "点击下方“生成背景模型”会保存原图，并创建一个内嵌原图纹理的轻量 GLB。" : "点击下方按钮会保存采集素材；当前不会伪造写实漫游结果。"}</p>
                  </div>
                </div>
              ) : null}
              {importError ? (
                <div className="scene-background-validation is-error" role="alert">
                  <strong>场景底座创建失败</strong>
                  <p>{importError}</p>
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
            {step === 1 ? <button className="secondary-button" disabled={importing} onClick={onClose} type="button">取消</button> : null}
            {step > 1 ? <button className="secondary-button" disabled={importing} onClick={() => { setStep((step - 1) as WizardStep); setChecked(false); setImportError(null); }} type="button">上一步</button> : null}
            {step === 1 ? <button className="primary-button" onClick={() => setStep(2)} type="button">添加素材</button> : null}
            {step === 2 ? (
              <button className="primary-button" disabled={validation.errors.length > 0} onClick={() => setStep(3)} type="button">检查配置</button>
            ) : null}
            {step === 3 && !checked ? (
              <button className="primary-button" disabled={validation.errors.length > 0 || !configurationValid} onClick={completePreflight} type="button">完成素材预检</button>
            ) : null}
            {step === 3 && checked ? (
              <button className="primary-button" disabled={importing} onClick={() => void createBackground()} type="button">
                {importing ? (mode === "single-image" ? "正在生成…" : "正在导入…") : mode === "single-image" ? "生成背景模型" : `导入 ${files.length} 个素材到资源库`}
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}
