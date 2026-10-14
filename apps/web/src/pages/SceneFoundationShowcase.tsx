import { useState } from "react";
import "./SceneFoundationShowcase.css";

type SourceKind = "cad" | "bim";

const sourceDetails = {
  cad: {
    filename: "车间布局.dxf",
    label: "二维工程图",
    title: "从平面布局，建立空间轮廓。",
    description: "按图层确认用途、单位、高度与标高，将符合要求的二维轮廓转成三维几何。",
    requirements: "DXF 需按用途分层，建模轮廓闭合且不自交，并明确实际单位和高度。DWG 请先导出 DXF。",
    parameters: ["图层用途", "实际单位", "高度 / 标高"],
  },
  bim: {
    filename: "车间建筑.ifc",
    label: "建筑构件模型",
    title: "让建筑模型，继续服务于展示。",
    description: "将 IFC 中的构件几何转为可展示的三维模型，沿用文件中的单位、位置与材质颜色。",
    requirements: "IFC 需包含构件几何及所需楼层、构件和开洞。RVT 等原生格式请先导出 IFC。",
    parameters: ["构件几何", "楼层范围", "文件单位"],
  },
} as const;

const equipment = [
  { x: 42, y: 35, w: 34, d: 32, h: 30 },
  { x: 102, y: 35, w: 34, d: 32, h: 30 },
  { x: 162, y: 35, w: 34, d: 32, h: 30 },
  { x: 42, y: 110, w: 154, d: 18, h: 18 },
];

function PlanDrawing({ kind }: { kind: SourceKind }) {
  return <svg className="foundation-showcase-plan" viewBox="0 0 400 290" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="1">
      <path className="foundation-drawing-grid" d="M20 50H380M20 90H380M20 130H380M20 170H380M20 210H380M20 250H380M50 30V270M100 30V270M150 30V270M200 30V270M250 30V270M300 30V270M350 30V270" />
      <path d="M70 60H330V230H70Z" strokeWidth="3" />
      <path d="M75 65H325V225H75Z" />
      <path d="M70 43H330M70 36V50M330 36V50M348 60V230M341 60H355M341 230H355" opacity=".65" />
      <path d="M70 255H160M195 255H330M180 50V236" strokeDasharray="4 5" opacity=".35" />
      <path d="M290 230H320" stroke="var(--foundation-drawing-paper)" strokeWidth="6" />
      <path d="M290 230V200Q320 200 320 230" strokeWidth="1.2" />
      {equipment.map((box, index) => <g key={index}>
        <rect className="foundation-drawing-equipment" x={70 + box.x} y={60 + box.y} width={box.w} height={box.d} rx="1" />
        <path d={`M${70 + box.x + 5} ${60 + box.y + 5}h${box.w - 10}v${box.d - 10}h-${box.w - 10}Z`} opacity=".5" />
      </g>)}
      {kind === "bim" ? <path d="M75 68H325M75 83H325M84 65V225M305 65V225" strokeWidth="2" opacity=".5" /> : null}
    </g>
    <g fill="currentColor" fontSize="9" textAnchor="middle" fontFamily="inherit" opacity=".8">
      <text x="200" y="36">空间轮廓</text><text x="360" y="148" transform="rotate(90 360 148)">明确单位</text><text x="204" y="155">设备图层</text><text x="176" y="259">轴线</text>
    </g>
  </svg>;
}

function point(x: number, y: number, height: number) { return `${205 + x * .9 - y * .9},${70 + x * .42 + y * .42 - height}`; }

function Volume({ x, y, w, d, h, className = "" }: { x: number; y: number; w: number; d: number; h: number; className?: string }) {
  return <g className={className} strokeLinejoin="round">
    <polygon className="foundation-volume-left" points={[point(x, y + d, 0), point(x + w, y + d, 0), point(x + w, y + d, h), point(x, y + d, h)].join(" ")} />
    <polygon className="foundation-volume-right" points={[point(x + w, y, 0), point(x + w, y + d, 0), point(x + w, y + d, h), point(x + w, y, h)].join(" ")} />
    <polygon className="foundation-volume-top" points={[point(x, y, h), point(x + w, y, h), point(x + w, y + d, h), point(x, y + d, h)].join(" ")} />
  </g>;
}

function ModelDrawing() {
  return <svg className="foundation-showcase-model" viewBox="0 0 520 290" aria-hidden="true" focusable="false">
    <ellipse cx="249" cy="221" rx="184" ry="44" className="foundation-model-shadow" />
    <g transform="translate(0 24)">
      <Volume x={-8} y={-8} w={276} d={186} h={9} className="foundation-volume-base" />
      <Volume x={0} y={0} w={260} d={5} h={66} className="foundation-volume-wall" />
      <Volume x={0} y={0} w={5} d={170} h={66} className="foundation-volume-wall" />
      <path d={`M${point(5, 90, 10)}L${point(254, 90, 10)}`} fill="none" stroke="var(--delivery-blue)" strokeDasharray="4 5" opacity=".35" />
      {equipment.map((box, index) => <Volume {...box} key={index} />)}
    </g>
    <g fill="none" stroke="currentColor" strokeWidth="1" opacity=".65">
      <path d="M386 78H455V57M126 222V257H68" /><circle cx="386" cy="78" r="3" fill="currentColor" /><circle cx="126" cy="222" r="3" fill="currentColor" />
    </g>
    <g fill="currentColor" fontFamily="inherit" fontSize="10"><text x="413" y="48">空间结构</text><text x="65" y="274">可复用的模型资源</text></g>
  </svg>;
}

export function SceneFoundationShowcase() {
  const [kind, setKind] = useState<SourceKind>("cad");
  const source = sourceDetails[kind];
  return <section className="foundation-showcase delivery-container" id="industrial-foundation" aria-labelledby="foundation-showcase-title">
    <div className="foundation-showcase-heading">
      <div><p className="delivery-eyebrow">AI 场景底座 · 工程文件转模型</p><h2 id="foundation-showcase-title">让已有图纸，<br /><em>成为场景的起点。</em></h2></div>
      <div><p>从一份工程资料，到可以继续搭建的三维模型。<br />让已有设计成果，接上场景、设备与业务展示。</p><a className="delivery-button is-primary" href="#/resources?tool=scene-foundation">导入工程文件<span aria-hidden="true">↗</span></a></div>
    </div>
    <div className="foundation-showcase-board">
      <div className="foundation-showcase-toolbar"><div className="foundation-source-switch" role="group" aria-label="查看工程文件类型"><button type="button" aria-pressed={kind === "cad"} onClick={() => setKind("cad")}>二维 CAD<span>DXF</span></button><button type="button" aria-pressed={kind === "bim"} onClick={() => setKind("bim")}>BIM 模型<span>IFC</span></button></div><span className="foundation-showcase-caption">转换流程示意 · 非实际文件结果</span></div>
      <div className="foundation-showcase-visuals">
        <div className="foundation-showcase-input"><div className="foundation-drawing-label"><span>01 / 输入工程资料</span><strong>{source.filename}</strong></div><PlanDrawing kind={kind} /><span className="foundation-drawing-footnote">{source.label} · 按要求准备</span></div>
        <div className="foundation-showcase-bridge" aria-hidden="true"><span>→</span></div>
        <div className="foundation-showcase-output"><div className="foundation-drawing-label"><span>02 / 生成三维模型</span><strong>车间模型.glb</strong></div><ModelDrawing /><span className="foundation-drawing-footnote">空间剖视示意 · 模型可进入场景</span></div>
      </div>
      <div className="foundation-showcase-detail" aria-live="polite" aria-atomic="true"><div><h3>{source.title}</h3><p>{source.description}</p></div><div className="foundation-parameter-chips" aria-label="需要确认的内容">{source.parameters.map((parameter) => <span key={parameter}>{parameter}</span>)}</div></div>
    </div>
    <ol className="foundation-showcase-steps" aria-label="工程文件进入场景的步骤">
      <li><span>01</span><div><h3>导入工程文件</h3><p>支持 IFC 与 DXF，上传前说明文件要求。</p></div></li>
      <li><span>02</span><div><h3>检查并确认参数</h3><p>先检查内容，再确认建模范围与参数。</p></div></li>
      <li><span>03</span><div><h3>后台生成 GLB</h3><p>处理状态随时可查，关闭面板仍继续转换。</p></div></li>
      <li><span>04</span><div><h3>加入你的场景</h3><p>转换完成后自动入库，继续组合与展示。</p></div></li>
    </ol>
    <div className="foundation-showcase-requirements"><strong>文件准备</strong><p>{source.requirements}<span>转换结果用于三维展示；二维设备轮廓生成简化体，GLB 不保留原软件的参数化编辑能力。</span></p></div>
  </section>;
}
