import { useRef, useState, type PointerEvent } from "react";
import "./SceneFoundationShowcase.css";

type SourceKind = "cad" | "bim";
type DrawingPart = "all" | "walls" | "equipment" | "slab" | "frame" | "glass";
type DrawingSelection = { selected: DrawingPart; onSelect: (part: DrawingPart) => void };

const drawingParts: Record<SourceKind, { id: DrawingPart; label: string; note: string }[]> = {
  cad: [
    { id: "all", label: "全部图层", note: "试着拖动右侧手柄，看平面轮廓一点点立起来。" },
    { id: "walls", label: "墙体", note: "同一条墙体轮廓，在图纸与模型中同步突出显示。" },
    { id: "equipment", label: "设备", note: "设备轮廓拉伸为简化体；真实设备细节仍需专用模型。" },
  ],
  bim: [
    { id: "all", label: "全部构件", note: "试着拆开楼层，看看建筑内部的构件关系。" },
    { id: "slab", label: "楼板", note: "暖色楼板标出每层空间，也能看清屋面所在的位置。" },
    { id: "frame", label: "结构", note: "青绿色梁柱组成建筑骨架，拆开后更容易看清。" },
    { id: "glass", label: "围护", note: "蓝色玻璃围护与屋顶采光窗，为建筑带来通透感。" },
  ],
};

const sourceDetails = {
  cad: {
    filename: "车间布局.dxf",
    label: "二维工程图",
    outputFilename: "车间布局.glb",
    inputCaption: "平面蓝图 · 图层与闭合轮廓",
    outputCaption: "轮廓拉伸示意 · 车间空间与设备简化体",
    title: "从平面布局，建立空间轮廓。",
    description: "按图层确认用途、单位、高度与标高，将符合要求的二维轮廓转成三维几何。",
    requirements: "DXF 需按用途分层，建模轮廓闭合且不自交，并明确实际单位和高度。DWG 请先导出 DXF。",
    parameters: ["图层用途", "实际单位", "高度 / 标高"],
  },
  bim: {
    filename: "双层厂房.ifc",
    label: "建筑构件模型",
    outputFilename: "双层厂房.glb",
    inputCaption: "构件分解示意 · 楼板、结构与围护",
    outputCaption: "建筑组合示意 · 保留构件几何与位置",
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

function PlanDrawing({ selected, onSelect }: DrawingSelection) {
  return <svg className="foundation-showcase-plan" viewBox="0 0 400 290" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="1">
      <path className="foundation-drawing-grid" d="M20 50H380M20 90H380M20 130H380M20 170H380M20 210H380M20 250H380M50 30V270M100 30V270M150 30V270M200 30V270M250 30V270M300 30V270M350 30V270" />
      <g className="foundation-drawing-part" data-part="walls" data-muted={selected !== "all" && selected !== "walls"} onClick={() => onSelect("walls")}>
        <path d="M70 60H330V230H70Z" strokeWidth="3" />
        <path d="M75 65H325V225H75Z" />
      </g>
      <path d="M70 43H330M70 36V50M330 36V50M348 60V230M341 60H355M341 230H355" opacity=".65" />
      <path d="M70 255H160M195 255H330M180 50V236" strokeDasharray="4 5" opacity=".35" />
      <path d="M70 80H330M70 190H330M105 60V230M290 60V230" strokeDasharray="9 3 2 3" opacity=".25" />
      <path d="M290 230H320" stroke="var(--foundation-drawing-paper)" strokeWidth="6" />
      <path d="M290 230V200Q320 200 320 230" strokeWidth="1.2" />
      {equipment.map((box, index) => <g key={index} className="foundation-drawing-part" data-part="equipment" data-muted={selected !== "all" && selected !== "equipment"} onClick={() => onSelect("equipment")}>
        <rect className="foundation-drawing-equipment" x={70 + box.x} y={60 + box.y} width={box.w} height={box.d} rx="1" />
        <path d={`M${70 + box.x + 5} ${60 + box.y + 5}h${box.w - 10}v${box.d - 10}h-${box.w - 10}Z`} opacity=".5" />
      </g>)}
      <path d="M42 60V230M37 60H48M37 145H48M37 230H48M105 245H290M105 239V251M290 239V251" opacity=".5" />
      {[105, 180, 290].map((x, index) => <g key={x}><circle cx={x} cy={273} r={8} /><text x={x} y={276} fill="currentColor" stroke="none" textAnchor="middle" fontSize="9">{index + 1}</text></g>)}
    </g>
    <g fill="currentColor" fontSize="9" textAnchor="middle" fontFamily="inherit" opacity=".8">
      <text x="200" y="36">平面尺寸 / 按实际单位</text><text x="360" y="148" transform="rotate(90 360 148)">建筑轮廓</text><text x="204" y="155">设备图层</text><text x="30" y="104">A</text><text x="30" y="193">B</text>
    </g>
  </svg>;
}

function point(x: number, y: number, height: number) { return `${205 + x * .9 - y * .9},${70 + x * .42 + y * .42 - height}`; }

function Volume({ x, y, w, d, h, z = 0, className = "", part, selected = "all", onSelect }: { x: number; y: number; w: number; d: number; h: number; z?: number; className?: string; part?: DrawingPart } & Partial<DrawingSelection>) {
  return <g className={`${className} ${part ? "foundation-drawing-part" : ""}`} strokeLinejoin="round" data-part={part} data-muted={selected !== "all" && selected !== part} onClick={part && onSelect ? () => onSelect(part) : undefined}>
    <polygon className="foundation-volume-left" points={[point(x, y + d, z), point(x + w, y + d, z), point(x + w, y + d, z + h), point(x, y + d, z + h)].join(" ")} />
    <polygon className="foundation-volume-right" points={[point(x + w, y, z), point(x + w, y + d, z), point(x + w, y + d, z + h), point(x + w, y, z + h)].join(" ")} />
    <polygon className="foundation-volume-top" points={[point(x, y, z + h), point(x + w, y, z + h), point(x + w, y + d, z + h), point(x, y + d, z + h)].join(" ")} />
  </g>;
}

// Only the visible handle captures touch; the rest of the illustration keeps native page scrolling.
// The native range below provides the same interaction for keyboard and assistive technology.
function DrawingHandle({ x, y, travel, value, onChange }: { x: number; y: number; travel: number; value: number; onChange: (value: number) => void }) {
  const drag = useRef<{ pointerId: number; startY: number; value: number; pixels: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function finish(event: PointerEvent<SVGGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <g className="foundation-drag-handle" data-dragging={dragging} transform={`translate(${x} ${y})`}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      const matrix = event.currentTarget.getScreenCTM();
      if (!matrix) throw new Error("Scene foundation demo: cannot determine drag handle screen scale");
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, startY: event.clientY, value, pixels: travel * Math.hypot(matrix.c, matrix.d) };
      setDragging(true);
      event.preventDefault();
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      onChange(Math.max(0, Math.min(100, Math.round(active.value + (active.startY - event.clientY) / active.pixels * 100))));
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
    <rect className="foundation-handle-hit" x="-44" y="-44" width="88" height="88" rx="24" />
    <circle className="foundation-handle-halo" r="25" />
    <circle className="foundation-handle-knob" r="18" />
    <path d="M0-9V9M-4-5L0-9L4-5M-4 5L0 9L4 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </g>;
}

function CadModelDrawing({ amount, onChange, ...selection }: DrawingSelection & { amount: number; onChange: (value: number) => void }) {
  const height = amount * .88;
  return <svg className="foundation-showcase-model" viewBox="0 0 520 290" aria-hidden="true" focusable="false">
    <ellipse cx="249" cy="221" rx="184" ry="44" className="foundation-model-shadow" />
    <g transform="translate(0 24)">
      <Volume x={-8} y={-8} w={276} d={186} h={amount * .09} className="foundation-volume-base" />
      <Volume x={0} y={0} w={260} d={5} h={height} className="foundation-volume-wall" part="walls" {...selection} />
      <Volume x={0} y={0} w={5} d={170} h={height} className="foundation-volume-wall" part="walls" {...selection} />
      <path d={`M${point(5, 90, 10)}L${point(254, 90, 10)}`} fill="none" stroke="var(--delivery-blue)" strokeDasharray="4 5" opacity=".35" />
      {equipment.map((box, index) => <Volume {...box} h={box.h * amount / 75} key={index} part="equipment" {...selection} />)}
    </g>
    <g className="foundation-handle-guide" fill="none" stroke="currentColor"><path d="M471 102V222" strokeDasharray="3 5" /><path d={`M439 ${203 - height}H470`} /></g>
    <DrawingHandle x={471} y={203 - height} travel={88} value={amount} onChange={onChange} />
    <text className="foundation-handle-label" x="471" y="250" textAnchor="middle">上下拖动</text>
  </svg>;
}

function BimDrawing({ spread, onChange, ...selection }: DrawingSelection & { spread: number; onChange?: (value: number) => void }) {
  const floorStep = 54 + spread * .24;
  const exploded = spread > 0;
  return <svg className="foundation-showcase-model foundation-bim-drawing" viewBox="0 0 520 330" aria-hidden="true" focusable="false">
    <ellipse cx="256" cy="283" rx="173" ry="32" className="foundation-model-shadow" />
    <g transform="translate(15 108)">
      {exploded ? <g fill="none" stroke="currentColor" strokeDasharray="3 5" opacity=".4">
        {[[0, 0], [180, 0], [0, 120], [180, 120]].map(([x, y]) => <path key={`${x}-${y}`} d={`M${point(x, y, 0)}L${point(x, y, floorStep * 2 + 14)}`} />)}
      </g> : null}
      {[0, floorStep].map((z, floor) => <g key={floor}>
        <Volume x={-4} y={-4} w={188} d={128} h={6} z={z} className="foundation-volume-slab" part="slab" {...selection} />
        <Volume x={0} y={0} w={180} d={3} h={46} z={z + 6} className="foundation-volume-glass" part="glass" {...selection} />
        <Volume x={0} y={0} w={3} d={120} h={46} z={z + 6} className="foundation-volume-glass" part="glass" {...selection} />
        {[22, 68, 114, 160].map(x => <Volume key={x} x={x} y={0} w={2} d={4} h={46} z={z + 6} className="foundation-volume-frame" part="frame" {...selection} />)}
        <Volume x={80} y={36} w={4} d={48} h={35} z={z + 6} className="foundation-volume-wall" {...selection} />
        <Volume x={12} y={62} w={68} d={4} h={35} z={z + 6} className="foundation-volume-wall" {...selection} />
        {Array.from({ length: 8 }, (_, step) => <Volume key={step} x={143} y={22 + step * 8} w={21} d={8} h={(step + 1) * 5} z={z + 6} className="foundation-volume-wall" {...selection} />)}
        {[0, 90, 175].flatMap(x => [0, 115].map(y => <Volume key={`${x}-${y}`} x={x} y={y} w={5} d={5} h={48} z={z + 6} className="foundation-volume-frame" part="frame" {...selection} />))}
        <Volume x={0} y={115} w={180} d={5} h={5} z={z + 49} className="foundation-volume-frame" part="frame" {...selection} />
        <Volume x={175} y={0} w={5} d={115} h={5} z={z + 49} className="foundation-volume-frame" part="frame" {...selection} />
      </g>)}
      <Volume x={-4} y={-4} w={188} d={128} h={6} z={floorStep * 2} className="foundation-volume-slab" part="slab" {...selection} />
      {[20, 75, 130].map(x => <Volume key={x} x={x} y={32} w={30} d={60} h={7} z={floorStep * 2 + 6} className="foundation-volume-glass" part="glass" {...selection} />)}
      {!onChange ? <g className="foundation-bim-callouts" fill="none" stroke="currentColor" strokeWidth=".8">
        {["首层构件", "二层构件", "屋面系统"].map((label, level) => {
          const anchor = point(180, 120, level * floorStep + 4);
          const height = 192 - level * floorStep;
          return <g key={label}><path d={`M${anchor}H416`} /><circle cx={259} cy={height} r={2} fill="currentColor" /><text x={423} y={height + 4} fill="currentColor" stroke="none" fontSize="11">{label}</text></g>;
        })}
      </g> : null}
    </g>
    {onChange ? <>
      <g className="foundation-handle-guide" fill="none" stroke="currentColor"><path d="M460 122V221" strokeDasharray="3 5" /><path d={`M387 ${192 - spread * .48}H460`} /></g>
      <DrawingHandle x={460} y={192 - spread * .48} travel={48} value={spread} onChange={onChange} />
      <text className="foundation-handle-label" x="460" y="250" textAnchor="middle">上下拖动</text>
    </> : null}
  </svg>;
}

export function SceneFoundationShowcase() {
  const [kind, setKind] = useState<SourceKind>("cad");
  const [cadAmount, setCadAmount] = useState(75);
  const [bimSpread, setBimSpread] = useState(0);
  const [selectedParts, setSelectedParts] = useState<Record<SourceKind, DrawingPart>>({ cad: "all", bim: "all" });
  const source = sourceDetails[kind];
  const selected = selectedParts[kind];
  const selection: DrawingSelection = {
    selected,
    onSelect: part => setSelectedParts(previous => ({ ...previous, [kind]: previous[kind] === part ? "all" : part })),
  };
  const amount = kind === "cad" ? cadAmount : bimSpread;
  const changeAmount = kind === "cad" ? setCadAmount : setBimSpread;
  const valueText = kind === "cad" ? `${(cadAmount * .04).toFixed(1)} 米示例墙高` : `${bimSpread}% 拆层幅度`;
  function resetDemo() {
    changeAmount(kind === "cad" ? 75 : 0);
    setSelectedParts(previous => ({ ...previous, [kind]: "all" }));
  }
  return <section className="foundation-showcase delivery-container" id="industrial-foundation" aria-labelledby="foundation-showcase-title">
    <div className="foundation-showcase-heading">
      <div><p className="delivery-eyebrow foundation-showcase-kicker"><strong><span>AI</span> 场景底座</strong><small>· 工程文件转模型</small></p><h2 id="foundation-showcase-title">让已有图纸，<br /><em>成为场景的起点。</em></h2></div>
      <div><p>从一份工程资料，到可以继续搭建的三维模型。<br />让已有设计成果，接上场景、设备与业务展示。</p><a className="delivery-button is-primary" href="#/resources?tool=scene-foundation">导入工程文件<span aria-hidden="true">↗</span></a></div>
    </div>
    <div className="foundation-showcase-board" data-source={kind}>
      <div className="foundation-showcase-toolbar"><div className="foundation-source-switch" role="group" aria-label="查看工程文件类型"><button type="button" aria-pressed={kind === "cad"} onClick={() => setKind("cad")}>二维 CAD<span>DXF</span></button><button type="button" aria-pressed={kind === "bim"} onClick={() => setKind("bim")}>BIM 模型<span>IFC</span></button></div><span className="foundation-showcase-caption">转换流程示意 · 非实际文件结果</span></div>
      <div className="foundation-play-heading">
        <div><span className="foundation-play-badge">动手试试 <span aria-hidden="true">↗</span></span><h3>{kind === "cad" ? "让平面的轮廓，在你手中立起来。" : "把建筑拆开，看见里面的设计。"}</h3></div>
        <button type="button" className="foundation-reset" onClick={resetDemo}><span aria-hidden="true">↺</span> 还原示例</button>
      </div>
      <div className="foundation-showcase-visuals">
        <div className="foundation-showcase-input"><div className="foundation-drawing-label"><span>01 / {source.label}</span><strong>{source.filename}</strong></div>{kind === "cad" ? <PlanDrawing {...selection} /> : <BimDrawing spread={100} {...selection} />}<span className="foundation-drawing-footnote">{source.inputCaption}</span></div>
        <div className="foundation-showcase-bridge" aria-hidden="true"><span>→</span></div>
        <div className="foundation-showcase-output"><div className="foundation-drawing-label"><span>02 / {kind === "cad" ? "拉伸轮廓，感受空间" : "拆层观察，探索构件"}</span><strong>{source.outputFilename}</strong></div>{kind === "cad" ? <CadModelDrawing amount={cadAmount} onChange={setCadAmount} {...selection} /> : <BimDrawing key="bim-output" spread={bimSpread} onChange={setBimSpread} {...selection} />}<span className="foundation-drawing-footnote">{kind === "cad" ? source.outputCaption : "拆层仅用于观察示意 · 转换保持原有位置"}</span></div>
      </div>
      <div className="foundation-play-controls">
        <div className="foundation-part-controls">
          <span className="foundation-control-label">{kind === "cad" ? "点选图层，看看它在哪里" : "点选构件，发现建筑的组成"}</span>
          <div className="foundation-part-buttons" role="group" aria-label={kind === "cad" ? "聚焦示例图层" : "聚焦示例构件"}>
            {drawingParts[kind].map(part => <button type="button" key={part.id} aria-pressed={selected === part.id} onClick={() => selection.onSelect(part.id)}><i className={`foundation-part-dot is-${part.id}`} aria-hidden="true" />{part.label}</button>)}
          </div>
          <p className="foundation-selection-note" aria-live="polite">{drawingParts[kind].find(part => part.id === selected)?.note}</p>
        </div>
        <div className="foundation-range-control">
          <div className="foundation-range-label"><label htmlFor="foundation-demo-amount">{kind === "cad" ? "拖一拖，改变拉伸高度" : "拖一拖，展开楼层"}</label><output htmlFor="foundation-demo-amount">{kind === "cad" ? <>{(cadAmount * .04).toFixed(1)} <small>m</small></> : <>{bimSpread}<small>%</small></>}</output></div>
          <input id="foundation-demo-amount" type="range" min="0" max="100" step="1" value={amount} aria-valuetext={valueText} aria-describedby="foundation-range-note" onChange={event => changeAmount(event.currentTarget.valueAsNumber)} />
          <div className="foundation-range-stops"><span>{kind === "cad" ? "平面轮廓" : "完整建筑"}</span><span>{kind === "cad" ? "立体空间" : "楼层展开"}</span></div>
          <p id="foundation-range-note">{kind === "cad" ? "数值为示例墙高；设备轮廓按示例比例同步拉伸。" : "只改变示意图的展示间距，不改变文件中的真实层高。"}</p>
        </div>
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
