import { SITE_CAPTURE_RELEASED, type SceneBackgroundMode } from "./scene-background";

// Static illustrations describe each workflow; they are not reconstruction previews.
function FoundationIllustration({ kind }: { kind: "image" | "capture" | "engineering" }) {
  return (
    <svg aria-hidden="true" className={`foundation-illustration is-${kind}`} viewBox="0 0 360 190" fill="none">
      <path className="foundation-grid" d="M0 154 180 64 360 154M0 178 180 88 360 178M48 190 180 124 312 190M-20 132 180 32 380 132M0 100 180 190 360 100M48 76 228 166M108 46 288 136M252 76 72 166M312 106 144 190" />
      {kind === "image" ? <>
        <path className="foundation-surface" d="m72 43 212-15v125L72 168Z" />
        <path className="foundation-line" d="m72 43 212-15v125L72 168Zm16 13 179-12v95L88 152Z" />
        <path className="foundation-fill" d="m102 128 0-37 29-21 25 16v37Zm66-4V77l30-24 23 20v47Zm65-5V88l22-16v46Z" />
        <path className="foundation-line" d="m102 128 0-37 29-21 25 16v37m12 1V77l30-24 23 20v47m12-1V88l22-16v46M114 99v21m14-22v21m14-23v22m38-29v23m15-24v23m14-24v23" />
        <path className="foundation-dashed" d="m31 147 32-3m233-4 32-2M46 129v32m269-40v32" />
        <circle className="foundation-fill" cx="308" cy="52" r="17" />
        <path className="foundation-line" d="m300 52 6 6 11-13" />
      </> : kind === "capture" ? <>
        {Array.from({ length: 13 }, (_, x) => Array.from({ length: 7 }, (_, y) => (
          <circle key={`${x}-${y}`} cx={96 + x * 13} cy={63 + y * 11 - Math.sin(x * .6) * 12} r={(x + y) % 3 === 0 ? 2 : 1.25} className="foundation-point" opacity={.35 + ((x + y) % 4) * .2} />
        )))}
        <path className="foundation-dashed" d="M69 120C15 175 279 207 304 120c15-54-126-92-209-63" />
        <path className="foundation-line" d="m92 125 0-52 69-33 94 48v50m-163-13 70 35 93-22M162 160V89l-70-16m70 16 93-1M131 144v-38l22 11v38m44-12v-33l32-10v37" />
        <g className="foundation-camera"><rect x="43" y="124" width="30" height="22" rx="5" /><path d="m73 130 10-4v19l-10-5" /><circle cx="58" cy="135" r="5" /></g>
        <g className="foundation-camera"><rect x="270" y="75" width="30" height="22" rx="5" /><path d="m270 80-10-4v19l10-5" /><circle cx="285" cy="86" r="5" /></g>
      </> : <>
        <path className="foundation-surface" d="m77 125 105-53 109 56-106 54Z" />
        <path className="foundation-line" d="m77 125 105-53 109 56-106 54Zm0-24 105-53 109 56-106 54Zm0-24 105-53 109 56-106 54ZM77 77v48m108-48v105m106-102v48M182 24v48" />
        <path className="foundation-fill" d="m103 86 26-13v44l-26 13Zm52-26 27-14v44l-27 14Zm45 42 27-13v43l-27 14Z" />
        <path className="foundation-line" d="m103 86 26-13v44l-26 13Zm52-26 27-14v44l-27 14Zm45 42 27-13v43l-27 14Z" />
        <path className="foundation-dashed" d="m62 142 108 55m132-61 24-12M62 68v60M46 68h24M46 128h24" />
        <circle className="foundation-fill" cx="305" cy="44" r="17" /><path className="foundation-line" d="m297 44 6 6 11-13" />
      </>}
    </svg>
  );
}

export function SceneFoundationHub({ onSelect, onEngineering, imageGeneration, capabilityFailed }: {
  onSelect: (mode: SceneBackgroundMode) => void;
  onEngineering: () => void;
  imageGeneration: boolean | null;
  capabilityFailed: boolean;
}) {
  return <div className="foundation-hub">
    <div className="foundation-intro">
      <div><span className="eyebrow">从现场到数字场景</span><h3>选择适合素材的创建方式</h3></div>
      <p>按手中的素材进入对应工作区，<br />从文件准备到结果入库，独立完成。</p>
    </div>
    <div className="foundation-modules">
      <article className="foundation-module is-image" aria-labelledby="foundation-image-title">
        <div className="foundation-module-top"><span>01 / IMAGE</span><span className={`foundation-status${imageGeneration === true ? "" : " is-pending"}`}>{imageGeneration === true ? "可生成模型" : imageGeneration === false ? "生成服务未接入" : capabilityFailed ? "服务检查失败" : "正在检查服务"}</span></div>
        <div className="foundation-art"><FoundationIllustration kind="image" /><span>单图 → 纹理平面</span></div>
        <div className="foundation-module-content">
          <h3 id="foundation-image-title">极速背景</h3>
          <p className="foundation-tagline">让一张现场照片，成为场景背景</p>
          <p className="foundation-description">保留原图清晰度，快速搭建固定视角的现场展示，让设备与看板拥有真实环境衬景。</p>
          <dl><div><dt>输入</dt><dd>PNG / JPEG / WebP 单张图片</dd></div><div><dt>目标产出</dt><dd>内嵌纹理的轻量 GLB</dd></div></dl>
          <p className="foundation-boundary">{imageGeneration === false ? "当前后端未提供生成服务。" : "适合固定视角展示，无立体深度。"}</p>
          <button type="button" onClick={() => onSelect("single-image")} aria-label="打开极速背景 · 单图生成 GLB">{imageGeneration === true ? "创建极速背景" : "查看功能说明"}<span aria-hidden="true">↗</span></button>
        </div>
      </article>
      {SITE_CAPTURE_RELEASED ? <article className="foundation-module is-capture" aria-labelledby="foundation-capture-title">
        <div className="foundation-module-top"><span>02 / CAPTURE</span><span className="foundation-status is-pending">GPU 后台重建</span></div>
        <div className="foundation-art"><FoundationIllustration kind="capture" /><span>多视角采集 · 能力示意</span></div>
        <div className="foundation-module-content">
          <h3 id="foundation-capture-title">写实漫游</h3>
          <p className="foundation-tagline">从多个现场视角，还原可漫游的空间</p>
          <p className="foundation-description">按要求上传连续视频或多视角照片，后台求解空间并生成写实场景，在浏览器中自由移动查看。</p>
          <dl><div><dt>输入</dt><dd>MP4 / WebM 或 8–120 张照片</dd></div><div><dt>产出</dt><dd>独立写实场景与漫游查看器</dd></div></dl>
          <p className="foundation-boundary is-pending">需要可用 GPU 工作节点；进入后检查服务。</p>
          <button type="button" onClick={() => onSelect("site-capture")} aria-label="打开写实漫游 · 采集重建与任务管理">进入写实漫游<span aria-hidden="true">↗</span></button>
        </div>
      </article> : null}
      <article className="foundation-module is-engineering" aria-labelledby="foundation-engineering-title">
        <div className="foundation-module-top"><span>{SITE_CAPTURE_RELEASED ? "03" : "02"} / ENGINEERING</span><span className="foundation-status">支持模型转换</span></div>
        <div className="foundation-art"><FoundationIllustration kind="engineering" /><span>工程几何 → 三维模型</span></div>
        <div className="foundation-module-content">
          <h3 id="foundation-engineering-title">工程底座</h3>
          <p className="foundation-tagline">从设计图纸，构建有尺寸的三维空间</p>
          <p className="foundation-description">保留 IFC 构件几何，或按 DXF 图层设置高度与用途，后台生成可预览、可加入场景的工程模型。</p>
          <dl><div><dt>输入</dt><dd>BIM · IFC / 二维 CAD · DXF</dd></div><div><dt>产出</dt><dd>标准 GLB 三维模型</dd></div></dl>
          <p className="foundation-boundary">创建前检查文件要求与转换服务。</p>
          <button type="button" onClick={onEngineering} aria-label="打开工程底座 · IFC / DXF 转 GLB">导入 BIM / CAD<span aria-hidden="true">↗</span></button>
        </div>
      </article>
    </div>
  </div>;
}
