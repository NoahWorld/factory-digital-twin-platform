import { ornamentDefaults, type CardTitleProps } from "../../../../shared/canvas-ornaments";
import type { IconId } from "../../../../shared/icon-catalog";
import type { CanvasNode, CanvasNodeType, DashboardBaseProps, PanelFrameProps } from "./types";

type Box = [x: number, y: number, width: number, height: number];
type Palette = { background: string; fill: string; border: string; accent: string; text: string };
const palettes = {
  production: { background: "#031718", fill: "#082b29", border: "#1b7466", accent: "#35edbf", text: "#e6fff8" },
  logistics: { background: "#090d24", fill: "#161b3a", border: "#505ba0", accent: "#9b8dff", text: "#f0f2ff" },
  energy: { background: "#100f0b", fill: "#211e12", border: "#80632b", accent: "#ffd15a", text: "#fff6df" },
  park: { background: "#03152b", fill: "#072844", border: "#146c9f", accent: "#33c9ff", text: "#e5f6ff" },
} satisfies Record<string, Palette>;

/** Artwork is one replaceable image node. Every label, KPI, chart and table remains authored data. */
function composer(p: Palette) {
  const nodes: CanvasNode[] = [];
  const base: DashboardBaseProps = { title: "", textColor: p.text, accentColor: p.accent, fillColor: p.fill, borderColor: p.border, sample: true };
  const add = (type: CanvasNodeType, [x, y, width, height]: Box, props: Record<string, unknown>, zIndex = 10) => {
    const node: CanvasNode = { id: crypto.randomUUID(), type, x, y, width, height, props, zIndex, resourceRefs: [], dataBindingRefs: [] };
    nodes.push(node);
    return node;
  };
  const label = (box: Box, text: string, fontSize = 18, options: Partial<CardTitleProps> = {}) => add("card-title", box, {
    ...ornamentDefaults["card-title"], icon: "none", text, fontSize, textColor: p.text, iconColor: p.accent,
    accentColor: p.accent, fillColor: p.fill, padding: 0, gap: 10, letterSpacing: 0.5, ...options,
  }, 24);
  const frame = (box: Box, title: string, subtitle = "") => add("panel-frame", box, {
    title, subtitle, showHeader: true, style: "corners", textColor: p.text, accentColor: p.accent,
    fillColor: p.background, borderColor: p.border, opacity: 1, glowStrength: 0.35, headerHeight: 54, cornerSize: 16,
  } satisfies PanelFrameProps, 4);
  const image = (box: Box, key: string) => {
    const node = add("image", box, { alt: `${key} 行业场景`, fit: "cover", backgroundColor: p.background, borderColor: p.border, borderRadius: 4 }, 6);
    node.resourceRefs = [`builtin:industry-${key}-v1`];
    return node;
  };
  const dashboard = (type: CanvasNodeType, box: Box, title: string, props: Record<string, unknown>) => add(type, box, { ...base, title, ...props });
  const chart = (type: "area-chart" | "line-chart" | "bar-chart" | "donut-chart", box: Box, title: string, categories: string[], values: number[], unit = "", color = p.accent) =>
    add(type, box, { title, categories, values, unit, color });
  const ranking = (box: Box, title: string, names: string[], values: number[], unit: string) => dashboard("ranking-list", box, title, {
    items: names.map((label, i) => ({ label, value: values[i], unit, trend: i % 3 === 1 ? "down" : "up" })),
  });
  const progress = (box: Box, title: string, names: string[], values: number[]) => dashboard("progress-list", box, title, {
    items: names.map((label, i) => ({ label, value: values[i], maximum: 100, unit: "%" })),
  });
  const gauge = (box: Box, title: string, value: number, subtitle: string) => dashboard("radial-gauge", box, title, { value, maximum: 100, unit: "%", subtitle });
  const table = (box: Box, title: string, columns: string[], rows: string[][], highlightColumn: number) => dashboard("data-table", box, title, { columns, rows, highlightColumn });
  const header = (title: string, subtitle: string, icon: IconId) => {
    add("rectangle", [0, 0, 1920, 1080], { fillColor: p.background, borderColor: p.background, borderWidth: 0, borderRadius: 0, opacity: 1 }, 0);
    add("vector-icon", [28, 30, 48, 48], { ...ornamentDefaults["vector-icon"], icon, iconSize: 46, iconColor: p.accent }, 24);
    label([94, 20, 1070, 48], title, 32, { fontWeight: 700 });
    label([96, 63, 870, 32], subtitle, 13, { textColor: p.accent, letterSpacing: 2.4, fontWeight: 400 });
    label([1130, 38, 370, 36], "运营总览  /  数据分析  /  设备状态", 15, { textColor: p.accent, align: "right" });
    add("datetime", [1540, 15, 358, 82], { text: "当前时间", subtitle: "", textColor: p.text, accentColor: p.accent, fillColor: p.background, borderColor: p.border, opacity: 1, align: "right", showDate: true, showSeconds: true }, 10);
  };
  const metrics = (items: [string, string, string, string, string][]) => {
    const width = (1884 - (items.length - 1) * 12) / items.length;
    items.forEach(([title, value, unit, subtitle, icon], i) => dashboard("metric-card", [18 + i * (width + 12), 108, width, 124], title, { value, unit, subtitle, icon }));
  };
  const callout = (x: number, y: number, title: string, detail: string, icon: IconId, width = 214) => {
    label([x, y, width, 38], title, 18, { icon, iconSize: 22, padding: 9, variant: "corner", backgroundOpacity: 0.94, fontWeight: 600 });
    label([x, y + 38, width, 32], detail, 14, { padding: 9, backgroundOpacity: 0.9, fontWeight: 400, textColor: p.accent });
  };
  return { nodes, add, label, frame, image, dashboard, chart, ranking, progress, gauge, table, header, metrics, callout };
}

const hours = ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22", "24"];

export function productionTemplate(): CanvasNode[] {
  const c = composer(palettes.production);
  c.header("智能制造数字化管控平台", "SMART MANUFACTURING · 生产全流程可视化", "factory");
  c.metrics([
    ["今日产量", "12,680", "件", "计划 12,000   ↑ +5.7%", "产"],
    ["产品良率", "99.1", "%", "较昨日   ↑ +0.3%", "质"],
    ["设备综合效率 OEE", "87.4", "%", "目标 85%   ↑ +2.1%", "效"],
    ["平均节拍", "42.6", "秒", "目标 45 秒   ↓ -6.8%", "速"],
    ["在制工单", "18", "个", "运行中 14  ·  等待 4", "单"],
    ["设备在线率", "96.2", "%", "在线 123 台   ↑ +1.5%", "机"],
  ]);
  c.chart("area-chart", [18, 246, 420, 286], "产量趋势 · 今日 / 件", hours, [4200, 5300, 6800, 9400, 10100, 11500, 12600, 11800, 10860, 11700, 13180, 12200, 12680], "件");
  c.ranking([18, 546, 420, 280], "产品产量 TOP 5", ["MFG-001 精密执行器", "MFG-002 驱动模块", "MFG-003 控制总成", "MFG-004 联轴组件", "MFG-005 传动单元"], [2860, 2480, 1980, 1260, 980], "件");
  c.frame([452, 246, 1016, 580], "从原料到成品 · 全流程可视化", "产线 A01  ·  生产 / 质量 / 设备协同");
  c.image([458, 301, 1004, 519], "production");
  c.callout(480, 320, "01 原料入库", "2,480 件 / 今日到料", "package", 208);
  c.callout(801, 324, "02 精密加工", "8 条产线 · 运行中", "cog", 216);
  c.callout(1200, 397, "03 自动装配", "节拍 42.6 s / 件", "settings", 240);
  c.callout(1030, 719, "04 成品包装", "已完成 12,480 件", "boxes", 216);
  c.callout(569, 671, "05 视觉检测", "一次合格率 99.1%", "shield-check", 218);
  c.gauge([1482, 246, 420, 280], "质量分析 · 一次合格率", 99.1, "合格 12,564 件 / 不良 116 件");
  c.ranking([1482, 540, 420, 286], "不良原因 TOP 5", ["外观缺陷", "尺寸偏差", "装配不良", "材料问题", "其他"], [42, 28, 18, 12, 16], "件");
  c.chart("donut-chart", [18, 840, 420, 222], "设备状态概览", ["运行", "待机", "故障", "维护"], [98, 14, 8, 8], "台");
  c.table([452, 840, 630, 222], "工单进度 · 进行中", ["工单编号", "产品", "计划量", "完成率", "状态"], [
    ["MO-0924-01", "MFG-001", "4,000", "80%", "生产中"], ["MO-0924-02", "MFG-003", "3,000", "62%", "生产中"],
    ["MO-0924-03", "MFG-002", "2,000", "100%", "已完成"], ["MO-0924-04", "MFG-005", "1,500", "45%", "生产中"],
  ], 3);
  c.dashboard("alarm-list", [1096, 840, 806, 222], "实时告警 · 设备与质量", { items: [
    { time: "09:45", source: "3# 热处理机", message: "温度高于设定阈值 8 ℃", tone: "danger" },
    { time: "09:32", source: "2# 机器人", message: "运行电流异常，请检查夹具", tone: "warning" },
    { time: "09:18", source: "A 线检测站", message: "产品尺寸偏差上升", tone: "warning" },
    { time: "08:56", source: "1# 空压机", message: "压力接近下限", tone: "normal" },
  ] });
  return c.nodes;
}

export function warehouseTemplate(): CanvasNode[] {
  const c = composer(palettes.logistics);
  c.header("智慧仓储物流运营中心", "WAREHOUSE & LOGISTICS CONTROL CENTER", "warehouse");
  c.metrics([
    ["库存总量", "128,640", "件", "SKU 3,826 种  ↑ +5.7%", "库"], ["库容利用率", "78.3", "%", "可用库位 35,920", "位"],
    ["今日入库", "6,420", "件", "较昨日  ↑ +12.6%", "入"], ["今日出库", "5,986", "件", "较昨日  ↑ +8.3%", "出"],
    ["待执行任务", "36", "单", "18 单拣选 · 6 单搬运", "单"], ["订单准时率", "96.2", "%", "已完成 1,195 单", "质"],
  ]);
  c.chart("bar-chart", [18, 246, 420, 280], "各库区库容利用率", ["A 区", "B 区", "C 区", "D 区", "E 区"], [92, 78, 68, 55, 43], "%");
  c.ranking([18, 540, 420, 286], "库区作业量 TOP 5", ["A 区 · 成品库", "B 区 · 原料库", "C 区 · 半成品库", "D 区 · 电商备货", "E 区 · 退货暂存"], [12480, 9620, 7860, 6380, 4210], "件");
  c.frame([452, 246, 1016, 580], "全链路可视 · 智能调度 · 高效流转", "入库路径 / 库内流转 / 出库路径");
  c.image([458, 301, 1004, 519], "logistics");
  c.callout(478, 529, "01 收货月台", "42 辆 / 今日到场", "truck", 211);
  c.callout(614, 326, "02 入库上架", "B 区 · 上架 98.6%", "warehouse", 220);
  c.callout(877, 367, "03 库位管理", "可用库位 35,920", "boxes", 221);
  c.callout(1203, 350, "04 拣选复核", "18 单 / 执行中", "search", 235);
  c.callout(850, 728, "05 自动搬运", "AGV 在线 26 / 28", "forklift", 226);
  c.callout(1212, 672, "06 发货月台", "45 辆 / 已发运", "truck", 228);
  c.dashboard("status-grid", [1482, 246, 420, 220], "车辆调度 · 月台状态", { columns: 3, items: [
    { label: "01 月台", value: "使用中", tone: "normal" }, { label: "02 月台", value: "使用中", tone: "normal" },
    { label: "03 月台", value: "空闲", tone: "normal" }, { label: "04 月台", value: "等待", tone: "warning" },
    { label: "05 月台", value: "空闲", tone: "normal" }, { label: "06 月台", value: "维护", tone: "danger" },
  ] });
  c.chart("line-chart", [1482, 480, 420, 346], "车辆到离趋势 · 今日", hours, [12, 15, 22, 31, 28, 20, 34, 38, 35, 32, 24, 18, 11], "辆", "#60caff");
  c.table([18, 840, 822, 222], "实时任务 / 波次", ["任务编号", "任务类型", "关联订单", "目标位置", "状态", "预计完成"], [
    ["T20260924001", "入库", "PO-24581", "A-01-12", "进行中", "10:20"], ["T20260924002", "拣选", "SO-78421", "C-03-05", "进行中", "10:35"],
    ["T20260924003", "搬运", "TASK-9021", "A > C", "等待中", "10:48"], ["T20260924004", "出库", "SO-78422", "月台 3#", "待开始", "11:10"],
  ], 4);
  c.progress([854, 840, 614, 222], "设备运行效率", ["AGV · 26 / 28 在线", "堆垛机 · 6 / 6 在线", "输送线 · 14 / 16 在线", "提升机 · 8 / 8 在线"], [92.8, 100, 87.5, 100]);
  c.gauge([1482, 840, 420, 222], "拣选作业效率", 97.6, "目标 95% · 平均等待 18 min");
  return c.nodes;
}

export function energyTemplate(): CanvasNode[] {
  const p = palettes.energy;
  const c = composer(p);
  c.header("能源管理智能监控平台", "SMART ENERGY MANAGEMENT · 让每一度能源都有迹可循", "zap");
  c.metrics([
    ["今日用电", "28,460", "kWh", "较昨日   ↓ -3.2%", "电"], ["今日用水", "1,286", "m³", "较昨日   ↑ +6.1%", "水"],
    ["天然气", "3,820", "Nm³", "较昨日   ↓ -1.6%", "气"], ["碳排放", "18.6", "tCO₂", "较昨日   ↓ -8.7%", "碳"],
    ["未处置告警", "7", "条", "高优先级 2 条", "!"],
  ]);
  c.chart("line-chart", [18, 246, 420, 280], "本周能耗趋势 · kWh", ["09/18", "09/19", "09/20", "09/21", "09/22", "09/23", "09/24"], [31620, 28560, 27900, 30120, 29360, 31080, 28460], "kWh");
  c.ranking([18, 540, 420, 286], "重点区域能耗排名", ["机加车间", "装配车间", "涂装车间", "动力站房", "办公区域"], [12480, 8320, 6780, 4620, 3210], "kWh");
  c.frame([452, 246, 1016, 580], "能源流向总览", "能源输入 → 转换分配 → 车间使用");
  c.image([459, 301, 1002, 519], "energy-flow");
  const flowNode = (x: number, y: number, title: string, value: string, icon: IconId, color: string, width = 210) => {
    c.label([x, y, width, 42], title, 18, { icon, iconColor: color, iconSize: 30, variant: "corner", padding: 10, backgroundOpacity: 0.96, accentColor: color });
    c.label([x, y + 42, width, 34], value, 20, { padding: 10, backgroundOpacity: 0.92, textColor: color, fontFamily: "mono" });
  };
  flowNode(482, 354, "市电输入", "32,000 kWh", "zap", "#ffda65");
  flowNode(482, 456, "市政供水", "2,400 m³", "droplets", "#66cfff");
  flowNode(482, 558, "天然气", "4,200 Nm³", "flame", "#ffb165");
  flowNode(482, 662, "压缩空气", "920 m³", "settings", "#63e6b3");
  flowNode(848, 385, "变电站", "28,800 kWh", "plug", "#ffda65", 186);
  flowNode(848, 482, "空压站", "860 m³", "gauge", "#66cfff", 186);
  flowNode(848, 582, "锅炉房", "3,980 Nm³", "flame", "#ffb165", 186);
  flowNode(848, 682, "水处理站", "2,280 m³", "droplets", "#63e6b3", 186);
  flowNode(1228, 342, "机加车间", "10,240 kWh", "factory", "#ffda65", 210);
  flowNode(1228, 439, "装配车间", "8,560 kWh", "cog", "#ffda65", 210);
  flowNode(1228, 533, "涂装车间", "6,320 kWh", "settings", "#ffb165", 210);
  flowNode(1228, 629, "成型车间", "4,280 kWh", "factory", "#66cfff", 210);
  flowNode(1228, 722, "公用辅助", "3,400 kWh", "warehouse", "#63e6b3", 210);
  c.gauge([1482, 246, 420, 280], "本月能源预算", 76, "实际 286,420 / 预算 380,000 kWh");
  c.chart("donut-chart", [1482, 540, 420, 286], "能源结构占比", ["电力", "天然气", "水", "压缩空气"], [685, 187, 84, 44], "标准煤指数");
  c.chart("bar-chart", [18, 840, 536, 222], "分项计量统计 · 本月", ["生产设备", "空调暖通", "照明", "工艺用能", "辅助设施", "其他"], [12480, 8420, 6360, 5280, 3740, 2000], "kWh");
  c.progress([568, 840, 500, 222], "节能目标达成", ["综合能耗强度", "碳排放强度", "用水单耗"], [76, 68, 82]);
  c.dashboard("alarm-list", [1082, 840, 820, 222], "安全告警处理", { items: [
    { time: "09:32", source: "空压站 2#", message: "供气压力低于设定值", tone: "danger" },
    { time: "08:56", source: "锅炉房", message: "烟气温度高于阈值", tone: "warning" },
    { time: "07:41", source: "废水处理站", message: "pH 值恢复正常，已闭环", tone: "normal" },
    { time: "06:18", source: "变电站", message: "A 相电流波动，已处理", tone: "normal" },
  ] });
  return c.nodes;
}

export function parkTemplate(existingNodes: CanvasNode[]): CanvasNode[] {
  const c = composer(palettes.park);
  c.header("云港智谷 · 园区运营指挥中心", "PARK OPERATION COMMAND CENTER", "factory");
  c.metrics([
    ["在线楼宇", "18", "栋", "总计 20 栋 · 运行正常", "楼"], ["今日入园", "3,286", "人次", "较昨日  ↑ +12%", "人"],
    ["停车占用", "72.6", "%", "已用 1,452 / 2,000", "车"], ["当日能耗", "86.4", "MWh", "较昨日   ↓ -6.8%", "能"],
    ["待处置事件", "9", "起", "总数 24 起 · 已闭环 15", "!"],
  ]);
  c.chart("donut-chart", [18, 246, 420, 280], "园区空间概况", ["生产厂房", "仓储物流", "研发办公", "公共配套", "其他"], [8, 4, 4, 3, 1], "栋");
  c.progress([18, 540, 420, 286], "园区使用率", ["整体使用率", "生产区", "办公区", "仓储区", "公共配套"], [78, 86, 74, 68, 52]);
  c.frame([452, 246, 1016, 580], "园区空间总览", "楼宇分布 / 功能分区 / 运行态势");
  const existingModel = existingNodes.find(node => node.type === "model-3d");
  if (existingModel) {
    const model = c.add("model-3d", [458, 301, 1004, 519], { ...existingModel.props }, 6);
    model.resourceRefs = [...existingModel.resourceRefs];
    model.dataBindingRefs = [...existingModel.dataBindingRefs];
  } else {
    c.image([458, 301, 1004, 519], "park");
    c.callout(777, 316, "B1 研发中心", "入驻率 92%", "factory", 216);
    c.callout(548, 460, "A1 智造厂房", "运行中 · 产线 12 条", "factory", 226);
    c.callout(989, 427, "A2 智造厂房", "运行中 · 产线 8 条", "factory", 228);
    c.callout(1218, 540, "C1 仓储中心", "库存利用率 68%", "warehouse", 228);
    c.callout(766, 659, "D1 综合服务中心", "今日访客 186 人", "users", 256);
    c.callout(545, 732, "P 园区停车场", "空余车位 548 个", "truck", 226);
  }
  c.dashboard("status-grid", [1482, 246, 420, 280], "重点区域状态", { columns: 2, items: [
    { label: "生产厂房区", value: "8 栋 · 正常", tone: "normal" }, { label: "仓储物流区", value: "4 栋 · 正常", tone: "normal" },
    { label: "办公研发区", value: "4 栋 · 正常", tone: "normal" }, { label: "动力中心", value: "1 座 · 正常", tone: "normal" },
    { label: "污水处理站", value: "巡检处理中", tone: "warning" }, { label: "门禁停车", value: "通行正常", tone: "normal" },
  ] });
  c.dashboard("event-timeline", [1482, 540, 420, 286], "园区事件闭环", { items: [
    { time: "09:32", title: "A 区消防通道异常占用", detail: "待处理 · 安保组", tone: "danger" },
    { time: "08:56", title: "B1 楼空调机组告警", detail: "处理中 · 设施组", tone: "warning" },
    { time: "07:41", title: "东门车辆拥堵", detail: "已处理 · 疏导完成", tone: "normal" },
    { time: "06:18", title: "C 区照明设备故障", detail: "已处理 · 已复检", tone: "normal" },
  ] });
  c.chart("area-chart", [18, 840, 634, 222], "今日园区人流趋势", hours, [128, 320, 450, 596, 740, 528, 412, 368, 342, 300, 284, 448, 236], "人次");
  c.gauge([666, 840, 360, 222], "停车使用情况", 72.6, "空余车位 548 / 2,000");
  c.ranking([1040, 840, 428, 222], "楼宇入驻率 TOP 4", ["B1 研发中心", "A1 智造厂房", "D1 办公楼", "A2 智造厂房"], [92, 88, 85, 78], "%");
  c.dashboard("status-grid", [1482, 840, 420, 222], "能耗与环境 · 今日", { columns: 3, items: [
    { label: "总能耗 MWh", value: "86.4", tone: "normal" }, { label: "用水量 t", value: "25.6", tone: "normal" }, { label: "碳排放 tCO₂", value: "18.6", tone: "normal" },
  ] });
  return c.nodes;
}
