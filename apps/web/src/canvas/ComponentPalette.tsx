import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { componentLabels, type CanvasNodeType } from "./types";
import { LocalIcon } from "./LocalIcon";

type PaletteView = "grid" | "compact" | "list";
type PaletteGroup = {
  id: string;
  label: string;
  items: { type: CanvasNodeType; description: string; icon: ReactNode }[];
};

const groups: PaletteGroup[] = [
  { id: "model", label: "3D 场景", items: [
      { type: "scene-3d", description: "引用已搭建的独立场景", icon: "◫" },
      { type: "model-3d", description: "导入 GLB 或 GLTF", icon: "⬡" },
  ] },
  { id: "chart", label: "图表", items: [
      { type: "line-chart", description: "连续趋势数据", icon: "⌁" },
      { type: "bar-chart", description: "分类对比数据", icon: "▥" },
      { type: "area-chart", description: "趋势与累计变化", icon: "◒" },
      { type: "pie-chart", description: "分类占比构成", icon: "◔" },
      { type: "donut-chart", description: "占比与总量", icon: "◎" },
      { type: "radar-chart", description: "多维能力对比", icon: "◇" },
  ] },
  { id: "basic", label: "内容与交互", items: [
      { type: "plain-text", description: "静态与滚动文字", icon: "Aa" },
      { type: "text-link", description: "预览时打开网页", icon: "↗" },
      { type: "image", description: "绑定项目资源", icon: "▧" },
      { type: "carousel", description: "多图自动轮播", icon: "▤" },
      { type: "button", description: "预览时执行动作", icon: "▰" },
      { type: "fullscreen-toggle", description: "预览时进入或退出全屏", icon: "⛶" },
      { type: "switch", description: "开关状态切换", icon: "◉" },
      { type: "checkbox-group", description: "多项选择", icon: "☑" },
      { type: "radio-group", description: "单项选择", icon: "◉" },
      { type: "select", description: "选项选择", icon: "⌄" },
  ] },
  { id: "dashboard", label: "数据展示", items: [
      { type: "asset-detail", description: "展示当前选中设备的实时数据", icon: "⌖" },
      { type: "metric-card", description: "核心数字与摘要", icon: "#" },
      { type: "radial-gauge", description: "完成率与消耗率", icon: "◉" },
      { type: "progress-list", description: "多行进度与排行", icon: "≡" },
      { type: "status-grid", description: "设备、人员或告警", icon: "▦" },
  ] },
  { id: "business", label: "业务组件", items: [
      { type: "ranking-list", description: "业务排行与趋势", icon: "№" },
      { type: "alarm-list", description: "故障与失联事件", icon: "!" },
      { type: "data-table", description: "结构化业务明细", icon: "▦" },
      { type: "event-timeline", description: "流程与操作记录", icon: "◷" },
  ] },
  { id: "shape", label: "基础图形", items: [
      { type: "rectangle", description: "可配置填充和圆角", icon: (<i className="palette-shape-icon is-rectangle" />) },
      { type: "circle", description: "固定比例缩放", icon: (<i className="palette-shape-icon is-circle" />) },
  ] },
  { id: "decoration", label: "界面点缀", items: [
      { type: "card-title", description: "图标与可配置文字样式", icon: <LocalIcon name="wrench" /> },
      { type: "vector-icon", description: "36 个本地工业线性图标", icon: <LocalIcon name="factory" /> },
      { type: "screen-title", description: "主标题与英文副标题", icon: "T" },
      { type: "background-decoration", description: "网格与科技光环", icon: "◇" },
      { type: "radar-sweep", description: "旋转扫描与目标脉冲", icon: "◉" },
      { type: "data-stream", description: "多轨高速数据流光", icon: "≋" },
      { type: "circuit-pulse", description: "工业电路与节点传导", icon: "⌁" },
      { type: "energy-core", description: "旋转能量环与核心呼吸", icon: "◎" },
      { type: "industrial-flow", description: "机械导轨与推进箭头", icon: "»" },
      { type: "scan-grid", description: "透视网格与往复扫描", icon: "▦" },
      { type: "datetime", description: "实时日期与时钟", icon: "◷" },
      { type: "section-title", description: "看板区块标题", icon: "▰" },
      { type: "card-background", description: "轻量面板底框", icon: "▣" },
      { type: "panel-frame", description: "标题与科技边框", icon: "⌗" },
      { type: "icon-background", description: "固定比例图标底座", icon: "◆" },
  ] },
];

const views = [
  { id: "grid", label: "双列", title: "双列卡片" },
  { id: "compact", label: "紧凑", title: "三列紧凑" },
  { id: "list", label: "列表", title: "详细列表" },
] as const;

export function ComponentPalette({ editable, onDragStart }: {
  editable: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>, type: CanvasNodeType) => void;
}) {
  const [view, setView] = useState<PaletteView>("grid");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const search = query.trim().toLocaleLowerCase();
  const filteredGroups = groups
    .filter((group) => category === "all" || group.id === category)
    .map((group) => ({ ...group, items: group.items.filter((item) =>
      `${componentLabels[item.type]} ${item.description} ${item.type}`.toLocaleLowerCase().includes(search),
    ) }))
    .filter((group) => group.items.length > 0);
  const count = filteredGroups.reduce((total, group) => total + group.items.length, 0);
  const resetScroll = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };

  return (
    <aside className={`component-palette palette-view-${view}`} aria-label="组件库">
      <div className="palette-controls">
        <div className="component-palette-heading"><span className="eyebrow">Components</span><h2>组件库</h2><p>拖到画布中创建组件</p></div>
        <div className="palette-view-switch" role="group" aria-label="组件展示方式">
          {views.map((option) => <button key={option.id} type="button" title={option.title} aria-label={option.title} aria-pressed={view === option.id} onClick={() => { setView(option.id); resetScroll(); }}>{option.label}</button>)}
        </div>
        <input className="palette-search" type="search" aria-label="搜索组件" placeholder="搜索组件名称或用途" value={query} onChange={(event) => { setQuery(event.target.value); resetScroll(); }} />
        <div className="palette-categories" role="group" aria-label="组件分类">
          {[{ id: "all", label: "全部" }, ...groups].map((group) => <button key={group.id} type="button" aria-pressed={category === group.id} onClick={() => { setCategory(group.id); resetScroll(); }}>{group.label}</button>)}
        </div>
        <p className="palette-result-count" role="status">{count} 个组件</p>
      </div>
      <div className="palette-scroll" ref={scrollRef}>
        {filteredGroups.map((group) => <section key={group.id} aria-labelledby={`palette-${group.id}-title`} className={`palette-group is-${group.id}`}>
          <h3 className="palette-group-title" id={`palette-${group.id}-title`}><span>{group.label}</span><em>{group.items.length}</em></h3>
          <div className="palette-items">
            {group.items.map((item) => <button key={item.type} aria-label={`${componentLabels[item.type]}，${item.description}`} className={`palette-item palette-${item.type}`} disabled={!editable} draggable={editable} onDragStart={(event) => onDragStart(event, item.type)} title={`${componentLabels[item.type]} · ${item.description}`} type="button">
              <span className="palette-icon" aria-hidden="true">{item.icon}</span>
              <span><strong>{componentLabels[item.type]}</strong><small>{item.description}</small></span>
              <span className="palette-drag-mark" aria-hidden="true">⋮⋮</span>
            </button>)}
          </div>
        </section>)}
        {count === 0 ? <div className="palette-empty"><p>没有找到匹配的组件</p><button type="button" onClick={() => { setQuery(""); setCategory("all"); resetScroll(); }}>清除筛选</button></div> : null}
      </div>
    </aside>
  );
}
