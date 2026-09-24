import type {
  AlarmListItem,
  CanvasNode,
  CanvasNodeType,
  CanvasTheme,
  ChartNodeType,
  ChartProps,
  DashboardBaseProps,
  DecorationProps,
  ProgressListItem,
  RankingListItem,
  ShapeProps,
  StatusGridItem,
  TimelineItem,
} from "./types";
import { templateScene } from "./template-scenes";
import { productionTemplate, energyTemplate, parkTemplate, warehouseTemplate } from "./industry-templates";

export type CanvasTemplateId =
  | "equipment-maintenance"
  | "equipment-support"
  | "production-operations"
  | "energy-safety"
  | "industrial-park-operations"
  | "warehouse-logistics"
  | "water-treatment-operations"
  | "data-center-infrastructure";

export type CanvasTemplateShowcase = {
  title: string;
  organization: string;
  location: string;
  site: string;
  deliveryForm: string;
  dataLabel: "模拟数据";
};

export type CanvasTemplate = {
  id: CanvasTemplateId;
  code: string;
  name: string;
  description: string;
  category: string;
  theme: "light" | "dark" | "green" | "amber" | "violet" | "blue" | "rose";
  canvasTheme: CanvasTheme;
  componentSummary: string;
  tags: readonly string[];
  showcase: CanvasTemplateShowcase;
};

const canvasTemplateShowcases: Record<CanvasTemplateId, CanvasTemplateShowcase> = {
  "equipment-maintenance": {
    title: "北辰装备 · 西安装备检修保障看板",
    organization: "北辰装备（虚构）",
    location: "陕西 · 西安",
    site: "综合维修保障中心",
    deliveryForm: "2D 检修驾驶舱 · 流程与质量闭环",
    dataLabel: "模拟数据",
  },
  "equipment-support": {
    title: "启岳装备 · 洛阳综合保障态势看板",
    organization: "启岳装备（虚构）",
    location: "河南 · 洛阳",
    site: "车辆与装备保障场",
    deliveryForm: "车辆分区示意 · 装备与钥匙监控",
    dataLabel: "模拟数据",
  },
  "production-operations": {
    title: "智能制造数字化管控平台",
    organization: "江城智装（虚构）",
    location: "湖北 · 武汉",
    site: "智能装备总装一号车间",
    deliveryForm: "2D 生产驾驶舱 · 设备状态联动",
    dataLabel: "模拟数据",
  },
  "energy-safety": {
    title: "能源管理智能监控平台",
    organization: "皖江新材（虚构）",
    location: "安徽 · 合肥",
    site: "新材料生产基地",
    deliveryForm: "能源驾驶舱 · 安全告警联动",
    dataLabel: "模拟数据",
  },
  "industrial-park-operations": {
    title: "云港智谷 · 园区运营指挥中心",
    organization: "云港智谷（虚构）",
    location: "江苏 · 苏州",
    site: "智能制造产业园",
    deliveryForm: "园区空间总览 · 楼宇与设施监控",
    dataLabel: "模拟数据",
  },
  "warehouse-logistics": {
    title: "智慧仓储物流运营中心",
    organization: "东海链仓（虚构）",
    location: "浙江 · 宁波",
    site: "区域智能仓配中心",
    deliveryForm: "仓储驾驶舱 · 月台与设备调度",
    dataLabel: "模拟数据",
  },
  "water-treatment-operations": {
    title: "清澜环境 · 宜昌水处理运行看板",
    organization: "清澜环境（虚构）",
    location: "湖北 · 宜昌",
    site: "工业污水处理中心",
    deliveryForm: "工艺驾驶舱 · 水质与设备监测",
    dataLabel: "模拟数据",
  },
  "data-center-infrastructure": {
    title: "星港算力 · 成都数据中心运维看板",
    organization: "星港算力（虚构）",
    location: "四川 · 成都",
    site: "高新算力基础设施中心",
    deliveryForm: "基础设施驾驶舱 · 容量与告警监控",
    dataLabel: "模拟数据",
  },
};

const showcaseTitle = (templateId: CanvasTemplateId) =>
  canvasTemplateShowcases[templateId].title;

const showcaseSubtitle = (templateId: CanvasTemplateId, detail: string) => {
  const showcase = canvasTemplateShowcases[templateId];
  return `${showcase.site} · ${detail} · ${showcase.dataLabel}`;
};

type Box = { x: number; y: number; width: number; height: number };

const makeNode = (
  type: CanvasNodeType,
  box: Box,
  props: Record<string, unknown>,
  zIndex = 10,
): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  ...box,
  zIndex,
  props,
  resourceRefs: [],
  dataBindingRefs: [],
});

const darkBase: DashboardBaseProps = {
  title: "",
  textColor: "#e9f8ff",
  accentColor: "#52d7ff",
  fillColor: "#0a2235",
  borderColor: "#276f8d",
  sample: true,
};

const lightBase: DashboardBaseProps = {
  title: "",
  textColor: "#253b4b",
  accentColor: "#16839a",
  fillColor: "#edf8fa",
  borderColor: "#8cbec9",
  sample: true,
};

const waterBase: DashboardBaseProps = {
  title: "",
  textColor: "#eaf8ff",
  accentColor: "#4fb7ff",
  fillColor: "#0b263b",
  borderColor: "#2e6e9b",
  sample: true,
};

const dataCenterBase: DashboardBaseProps = {
  title: "",
  textColor: "#fff0f4",
  accentColor: "#f08ba6",
  fillColor: "#2d1b29",
  borderColor: "#8a5064",
  sample: true,
};

const background = (fillColor: string) =>
  makeNode("rectangle", { x: 0, y: 0, width: 1920, height: 1080 }, {
    fillColor,
    borderColor: fillColor,
    borderWidth: 0,
    borderRadius: 0,
    opacity: 1,
  } satisfies ShapeProps, 0);

const title = (
  text: string,
  subtitle: string,
  colors: { text: string; accent: string; fill: string; border: string },
) => makeNode("screen-title", { x: 470, y: 18, width: 980, height: 94 }, {
  text,
  subtitle,
  textColor: colors.text,
  accentColor: colors.accent,
  fillColor: colors.fill,
  borderColor: colors.border,
  opacity: 0.96,
  align: "center",
  showDate: true,
  showSeconds: true,
} satisfies DecorationProps, 5);

const datetime = (
  colors: { text: string; accent: string; fill: string; border: string },
) => makeNode("datetime", { x: 1570, y: 20, width: 320, height: 88 }, {
  text: "当前时间",
  subtitle: "",
  textColor: colors.text,
  accentColor: colors.accent,
  fillColor: colors.fill,
  borderColor: colors.border,
  opacity: 0.92,
  align: "right",
  showDate: true,
  showSeconds: true,
} satisfies DecorationProps, 5);

const metric = (
  box: Box,
  base: DashboardBaseProps,
  metricTitle: string,
  value: string,
  unit: string,
  subtitle: string,
  icon: string,
) => makeNode("metric-card", box, {
  ...base,
  title: metricTitle,
  value,
  unit,
  subtitle,
  icon,
}, 10);

const gauge = (
  box: Box,
  base: DashboardBaseProps,
  gaugeTitle: string,
  value: number,
  maximum: number,
  unit: string,
  subtitle: string,
) => makeNode("radial-gauge", box, {
  ...base,
  title: gaugeTitle,
  value,
  maximum,
  unit,
  subtitle,
}, 10);

const progress = (
  box: Box,
  base: DashboardBaseProps,
  progressTitle: string,
  items: ProgressListItem[],
) => makeNode("progress-list", box, {
  ...base,
  title: progressTitle,
  items,
}, 10);

const status = (
  box: Box,
  base: DashboardBaseProps,
  statusTitle: string,
  columns: number,
  items: StatusGridItem[],
) => makeNode("status-grid", box, {
  ...base,
  title: statusTitle,
  columns,
  items,
}, 10);

const chart = (
  type: ChartNodeType,
  box: Box,
  chartTitle: string,
  categories: string[],
  values: number[],
  unit: string,
  color: string,
) => makeNode(type, box, {
  title: chartTitle,
  categories,
  values,
  unit,
  color,
} satisfies ChartProps, 10);

const ranking = (
  box: Box,
  base: DashboardBaseProps,
  rankingTitle: string,
  items: RankingListItem[],
) => makeNode("ranking-list", box, {
  ...base,
  title: rankingTitle,
  items,
}, 10);

const alarms = (
  box: Box,
  base: DashboardBaseProps,
  alarmTitle: string,
  items: AlarmListItem[],
) => makeNode("alarm-list", box, {
  ...base,
  title: alarmTitle,
  items,
}, 10);

const dataTable = (
  box: Box,
  base: DashboardBaseProps,
  tableTitle: string,
  columns: string[],
  rows: string[][],
  highlightColumn: number,
) => makeNode("data-table", box, {
  ...base,
  title: tableTitle,
  columns,
  rows,
  highlightColumn,
}, 10);

const timeline = (
  box: Box,
  base: DashboardBaseProps,
  timelineTitle: string,
  items: TimelineItem[],
) => makeNode("event-timeline", box, {
  ...base,
  title: timelineTitle,
  items,
}, 10);

const model = (box: Box, existingModel: CanvasNode): CanvasNode => ({
  ...makeNode("model-3d", box, { ...existingModel.props }, 10),
  resourceRefs: [...existingModel.resourceRefs],
  dataBindingRefs: [...existingModel.dataBindingRefs],
});

const maintenanceTemplate = (): CanvasNode[] => {
  const colors = { text: "#173849", accent: "#16839a", fill: "#dff0f3", border: "#78aeb9" };
  const metricBoxes = Array.from({ length: 6 }, (_, index) => ({
    x: 30 + index * 315,
    y: 130,
    width: 300,
    height: 140,
  }));
  return [
    background("#dceef1"),
    title(
      showcaseTitle("equipment-maintenance"),
      showcaseSubtitle("equipment-maintenance", "维修保障 · 送修交接 · 质量反馈"),
      colors,
    ),
    datetime(colors),
    metric(metricBoxes[0], lightBase, "保障申请", "128", "项", "本月累计", "申"),
    metric(metricBoxes[1], lightBase, "处理中申请", "23", "项", "待审批、交接与反馈", "办"),
    metric(metricBoxes[2], lightBase, "申请闭环率", "82.0", "%", "闭环 105 项", "率"),
    metric(metricBoxes[3], lightBase, "年度修理执行", "76", "项", "大中小修合计", "修"),
    metric(metricBoxes[4], lightBase, "执行完成率", "91.5", "%", "目标 90%", "✓"),
    metric(metricBoxes[5], lightBase, "年度故障次数", "14", "次", "3 份待复盘", "!"),
    progress(
      { x: 30, y: 300, width: 430, height: 390 },
      lightBase,
      "保障申请流程",
      [
        { label: "申请准备", value: 18, maximum: 20, unit: "项" },
        { label: "分级审批", value: 12, maximum: 20, unit: "项" },
        { label: "送修交接", value: 16, maximum: 20, unit: "项" },
        { label: "质量反馈", value: 11, maximum: 20, unit: "项" },
        { label: "流程闭环", value: 15, maximum: 20, unit: "项" },
      ],
    ),
    gauge({ x: 480, y: 300, width: 330, height: 390 }, lightBase, "修理完成率", 76, 100, "%", "年度目标 85%"),
    status(
      { x: 830, y: 300, width: 600, height: 390 },
      lightBase,
      "修理执行核心态势",
      2,
      [
        { label: "待执行", value: "7 项", tone: "warning" },
        { label: "执行中", value: "12 项", tone: "normal" },
        { label: "已完成", value: "76 项", tone: "normal" },
        { label: "已取消", value: "2 项", tone: "offline" },
      ],
    ),
    chart("bar-chart", { x: 1450, y: 300, width: 440, height: 390 }, "故障与器材排行", ["动力液压", "电池", "滤芯", "特种油液", "轮胎"], [14, 11, 8, 6, 4], "次", "#16839a"),
    status(
      { x: 30, y: 720, width: 430, height: 330 },
      lightBase,
      "分级修理与质量",
      2,
      [
        { label: "大修", value: "18 项", tone: "normal" },
        { label: "中修", value: "27 项", tone: "normal" },
        { label: "小修", value: "31 项", tone: "normal" },
        { label: "待反馈", value: "4 项", tone: "warning" },
      ],
    ),
    chart("line-chart", { x: 480, y: 720, width: 620, height: 330 }, "近期修理执行", ["1月", "2月", "3月", "4月", "5月", "6月", "7月"], [42, 51, 49, 63, 72, 70, 76], "项", "#16839a"),
    timeline(
      { x: 1120, y: 720, width: 770, height: 330 },
      lightBase,
      "今日检修节点",
      [
        { time: "08:15", title: "EQ-017 入场交接", detail: "动力系统故障，已完成初检", tone: "normal" },
        { time: "10:40", title: "EQ-042 等待备件", detail: "液压密封组件预计 14:00 到场", tone: "warning" },
        { time: "13:20", title: "EQ-009 质量复核", detail: "路试数据已提交", tone: "normal" },
        { time: "15:05", title: "EQ-031 通信中断", detail: "工位采集终端连续 90 秒无数据", tone: "offline" },
      ],
    ),
  ];
};

const supportTemplate = (existingNodes: CanvasNode[]): CanvasNode[] => {
  const colors = { text: "#e8fbff", accent: "#45d8ff", fill: "#071a2a", border: "#287c9e" };
  const existingModel = existingNodes.find((node) => node.type === "model-3d");
  return [
    background("#04111d"),
    title(
      showcaseTitle("equipment-support"),
      showcaseSubtitle("equipment-support", "车辆、车位、钥匙柜与装备状态综合监控"),
      colors,
    ),
    datetime(colors),
    metric({ x: 30, y: 130, width: 330, height: 140 }, darkBase, "在位车辆", "34", "辆", "在位率 85%", "车"),
    metric({ x: 380, y: 130, width: 330, height: 140 }, darkBase, "离位钥匙", "6", "把", "较昨日 +2", "钥"),
    metric({ x: 730, y: 130, width: 330, height: 140 }, darkBase, "年度消耗率", "63.4", "%", "接近二级警戒", "耗"),
    metric({ x: 1080, y: 130, width: 330, height: 140 }, darkBase, "当日动用", "12", "车次", "训练动装 8", "动"),
    metric({ x: 1430, y: 130, width: 460, height: 140 }, darkBase, "装备完好率", "96.8", "%", "在修装备 3 台", "✓"),
    progress(
      { x: 30, y: 300, width: 430, height: 340 },
      darkBase,
      "车辆在离位监控",
      [
        { label: "在位车辆", value: 34, maximum: 40, unit: "辆" },
        { label: "离位车辆", value: 6, maximum: 40, unit: "辆" },
        { label: "已绑定车位", value: 38, maximum: 40, unit: "个" },
      ],
    ),
    alarms(
      { x: 30, y: 670, width: 430, height: 380 },
      darkBase,
      "进出场异常记录",
      [
        { time: "15:32", source: "南侧装备门", message: "临时车辆等待人工核验", tone: "warning" },
        { time: "14:18", source: "三号钥匙柜", message: "07 号钥匙超时未归还", tone: "danger" },
        { time: "11:46", source: "西侧人行门", message: "访客证件校验通过", tone: "normal" },
        { time: "09:03", source: "车位采集器 P18", message: "采集器离线，保留最后状态", tone: "offline" },
      ],
    ),
    ...(existingModel
      ? [model({ x: 490, y: 300, width: 900, height: 520 }, existingModel)]
      : templateScene("support", { x: 490, y: 300, width: 900, height: 520 }, darkBase)),
    status(
      { x: 490, y: 850, width: 900, height: 200 },
      darkBase,
      "三号钥匙柜",
      6,
      Array.from({ length: 12 }, (_, index) => ({
        label: `${String(index + 1).padStart(2, "0")} 号`,
        value: [1, 6, 9].includes(index) ? "不在位" : "在位",
        tone: [1, 6, 9].includes(index) ? "danger" as const : "normal" as const,
      })),
    ),
    gauge({ x: 1420, y: 300, width: 470, height: 340 }, darkBase, "摩托小时年度指标", 63.4, 100, "%", "二级警戒线 70%"),
    chart("line-chart", { x: 1420, y: 670, width: 470, height: 380 }, "当日动用情况", ["07-27", "07-28", "07-29", "07-30", "07-31", "08-01", "08-02"], [5, 8, 7, 11, 9, 12, 10], "车次", "#45d8ff"),
  ];
};

const waterTemplate = (): CanvasNode[] => {
  const colors = { text: "#eaf8ff", accent: "#4fb7ff", fill: "#081f33", border: "#2e6e9b" };
  return [
    background("#061625"),
    title(
      showcaseTitle("water-treatment-operations"),
      showcaseSubtitle("water-treatment-operations", "进出水、水质、工艺单元、设备与能耗统一监测"),
      colors,
    ),
    datetime(colors),
    ...templateScene("water", { x: 480, y: 300, width: 950, height: 470 }, waterBase),
    metric({ x: 30, y: 130, width: 348, height: 140 }, waterBase, "今日处理量", "48,620", "m³", "设计负荷 81.0%", "量"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, waterBase, "出水 COD", "23.6", "mg/L", "限值 ≤ 50", "质"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, waterBase, "出水氨氮", "1.42", "mg/L", "限值 ≤ 5", "氮"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, waterBase, "吨水电耗", "0.286", "kWh", "较昨日 -1.8%", "电"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, waterBase, "设备在线率", "96.4", "%", "离线设备 3 台", "机"),
    status(
      { x: 30, y: 800, width: 590, height: 250 },
      waterBase,
      "工艺单元运行状态",
      2,
      [
        { label: "粗格栅", value: "运行", tone: "normal" },
        { label: "提升泵房", value: "运行", tone: "normal" },
        { label: "生化池", value: "运行", tone: "normal" },
        { label: "二沉池", value: "高液位", tone: "warning" },
        { label: "消毒单元", value: "运行", tone: "normal" },
        { label: "污泥脱水", value: "检修", tone: "offline" },
      ],
    ),
    chart(
      "area-chart",
      { x: 30, y: 300, width: 430, height: 220 },
      "24 小时出水流量",
      ["00", "04", "08", "12", "16", "20", "24"],
      [1820, 1740, 2050, 2260, 2180, 1940, 1860],
      "m³/h",
      "#4fb7ff",
    ),
    gauge({ x: 1450, y: 300, width: 440, height: 220 }, waterBase, "水质达标率", 99.2, 100, "%", "本月有效样本 2,864 组"),
    chart(
      "bar-chart",
      { x: 30, y: 550, width: 430, height: 220 },
      "工艺单元能耗",
      ["提升泵", "曝气", "回流泵", "脱水", "消毒"],
      [28, 46, 19, 14, 8],
      "MWh",
      "#348ed8",
    ),
    chart(
      "radar-chart",
      { x: 1450, y: 550, width: 440, height: 220 },
      "关键水质指标",
      ["COD", "氨氮", "总磷", "悬浮物", "pH 稳定度"],
      [86, 92, 89, 84, 96],
      "%",
      "#4fb7ff",
    ),
    alarms(
      { x: 1280, y: 800, width: 610, height: 250 },
      waterBase,
      "设备与水质告警",
      [
        { time: "15:28", source: "二沉池 LT-07", message: "液位接近高位阈值", tone: "warning" },
        { time: "14:56", source: "2# 鼓风机", message: "轴承振动连续升高", tone: "danger" },
        { time: "13:42", source: "液位计 L-07", message: "设备通信中断", tone: "offline" },
        { time: "12:18", source: "出水 COD", message: "在线仪表自动校准完成", tone: "normal" },
      ],
    ),
    dataTable({ x: 640, y: 800, width: 620, height: 250 }, waterBase, "出水化验记录 · 演示控制值", ["指标", "实测值", "控制值", "单位"], [
      ["COD", "23.6", "≤ 50", "mg/L"],
      ["氨氮", "1.42", "≤ 5", "mg/L"],
      ["总磷", "0.28", "≤ 0.5", "mg/L"],
      ["悬浮物", "6.8", "≤ 10", "mg/L"],
    ], 1),
  ];
};

const dataCenterTemplate = (): CanvasNode[] => {
  const colors = { text: "#fff0f4", accent: "#f08ba6", fill: "#251824", border: "#8a5064" };
  return [
    background("#160e18"),
    title(
      showcaseTitle("data-center-infrastructure"),
      showcaseSubtitle("data-center-infrastructure", "供配电、制冷、环境、容量与告警统一监控"),
      colors,
    ),
    datetime(colors),
    ...templateScene("datacenter", { x: 480, y: 300, width: 950, height: 470 }, dataCenterBase),
    metric({ x: 30, y: 130, width: 348, height: 140 }, dataCenterBase, "IT 实时负载", "2.86", "MW", "容量占用 71.5%", "IT"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, dataCenterBase, "实时 PUE", "1.32", "", "目标 ≤ 1.40", "能"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, dataCenterBase, "机柜使用率", "76.8", "%", "空闲机柜 116 个", "柜"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, dataCenterBase, "UPS 负载率", "58.4", "%", "后备时间 42 分钟", "UPS"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, dataCenterBase, "活动告警", "12", "条", "严重告警 2 条", "!"),
    chart(
      "area-chart",
      { x: 30, y: 300, width: 430, height: 220 },
      "24 小时 IT 负载趋势",
      ["00", "04", "08", "12", "16", "20", "24"],
      [2.22, 2.08, 2.46, 2.72, 2.86, 2.64, 2.38],
      "MW",
      "#f08ba6",
    ),
    chart(
      "bar-chart",
      { x: 30, y: 550, width: 430, height: 220 },
      "机房容量使用率",
      ["A1", "A2", "B1", "B2", "C1", "C2"],
      [82, 76, 69, 88, 64, 72],
      "%",
      "#c96989",
    ),
    gauge({ x: 1450, y: 300, width: 440, height: 220 }, dataCenterBase, "制冷容量利用率", 68.2, 100, "%", "剩余容量 1.26 MW"),
    status(
      { x: 30, y: 800, width: 590, height: 250 },
      dataCenterBase,
      "基础设施运行状态",
      3,
      [
        { label: "市电 A 路", value: "正常", tone: "normal" },
        { label: "市电 B 路", value: "正常", tone: "normal" },
        { label: "UPS 系统", value: "正常", tone: "normal" },
        { label: "柴发系统", value: "待机", tone: "normal" },
        { label: "冷机 3#", value: "预警", tone: "warning" },
        { label: "列头柜 P07", value: "失联", tone: "offline" },
      ],
    ),
    progress(
      { x: 1450, y: 550, width: 440, height: 220 },
      dataCenterBase,
      "环境与容量指标",
      [
        { label: "冷通道温度", value: 23.6, maximum: 35, unit: "℃" },
        { label: "机房湿度", value: 46, maximum: 100, unit: "%" },
        { label: "机柜容量", value: 77, maximum: 100, unit: "%" },
        { label: "网络端口", value: 68, maximum: 100, unit: "%" },
      ],
    ),
    alarms(
      { x: 1280, y: 800, width: 610, height: 250 },
      dataCenterBase,
      "基础设施活动告警",
      [
        { time: "15:36", source: "冷机 CH-03", message: "冷冻水供水温度高于设定值", tone: "warning" },
        { time: "15:02", source: "列头柜 P07", message: "采集网关连续 120 秒无心跳", tone: "offline" },
        { time: "14:28", source: "A2-17 机柜", message: "冷通道温度达到 29.4℃", tone: "danger" },
        { time: "13:45", source: "UPS-2B", message: "旁路切换自检完成", tone: "normal" },
      ],
    ),
    dataTable({ x: 640, y: 800, width: 620, height: 250 }, dataCenterBase, "供配电与制冷巡检", ["设备", "负载 / 温度", "冗余", "状态"], [
      ["UPS-1A", "56.2%", "N+1", "正常"],
      ["UPS-2B", "60.6%", "N+1", "自检完成"],
      ["冷机 CH-01", "7.2 ℃", "2+1", "正常"],
      ["冷机 CH-03", "9.8 ℃", "2+1", "供水偏高"],
    ], 1),
  ];
};

export const canvasTemplates: CanvasTemplate[] = [
  {
    id: "equipment-maintenance",
    code: "MRO-01",
    name: "装备修理统计态势",
    description: "浅色维修保障主题，包含申请流程、修理闭环、故障排行与人员质量概览。",
    category: "维修保障",
    theme: "light",
    canvasTheme: {
      mode: "light",
      presetId: "light-industrial",
      backgroundPattern: "grid",
      fontFamily: "system",
      glowIntensity: 0.18,
      panelRadius: 10,
      backgroundColor: "#dceef1",
      surfaceColor: "#edf8fa",
      textColor: "#253b4b",
      accentColor: "#16839a",
      borderColor: "#8cbec9",
    },
    componentSummary: "6 指标卡 · 环形进度 · 进度排行 · 状态矩阵 · 图表",
    tags: ["维修申请", "修理闭环", "质量反馈"],
    showcase: canvasTemplateShowcases["equipment-maintenance"],
  },
  {
    id: "equipment-support",
    code: "SUP-02",
    name: "装备场综合保障",
    description: "深色科技主题，组合车辆、钥匙、人员、动用趋势与场区车辆分布。",
    category: "装备保障",
    theme: "dark",
    canvasTheme: {
      mode: "dark",
      presetId: "deep-blue",
      backgroundPattern: "circuit",
      fontFamily: "industrial",
      glowIntensity: 0.65,
      panelRadius: 6,
      backgroundColor: "#04111d",
      surfaceColor: "#0a2235",
      textColor: "#e9f8ff",
      accentColor: "#52d7ff",
      borderColor: "#276f8d",
    },
    componentSummary: "5 指标卡 · 场区分布 · 状态矩阵 · 环形进度 · 趋势图",
    tags: ["车辆在位", "钥匙管理", "场区分布"],
    showcase: canvasTemplateShowcases["equipment-support"],
  },
  {
    id: "production-operations",
    code: "MFG-01",
    name: "智慧产线运营总览",
    description: "面向生产运营的产量、节拍、质量、OEE 与设备状态综合大屏。",
    category: "工业制造",
    theme: "green",
    canvasTheme: {
      mode: "custom",
      presetId: "energy-green",
      backgroundPattern: "dots",
      fontFamily: "data",
      glowIntensity: 0.58,
      panelRadius: 8,
      backgroundColor: "#031718",
      surfaceColor: "#082b29",
      textColor: "#e9fff6",
      accentColor: "#35edbf",
      borderColor: "#1b7466",
    },
    componentSummary: "6 指标卡 · 产线全景 · 质量排行 · 工单进度 · 实时告警",
    tags: ["产线总览", "设备联动", "OEE"],
    showcase: canvasTemplateShowcases["production-operations"],
  },
  {
    id: "energy-safety",
    code: "ENG-02",
    name: "能源与安全监控",
    description: "聚合水电气、碳排预算、安全告警和重点区域运行状态。",
    category: "能源电力",
    theme: "amber",
    canvasTheme: {
      mode: "custom",
      presetId: "command-gold",
      backgroundPattern: "circuit",
      fontFamily: "data",
      glowIntensity: 0.5,
      panelRadius: 0,
      backgroundColor: "#100f0b",
      surfaceColor: "#211e12",
      textColor: "#fff8e8",
      accentColor: "#ffd15a",
      borderColor: "#80632b",
    },
    componentSummary: "5 指标卡 · 能源流向 · 分项计量 · 预算进度 · 安全告警",
    tags: ["能耗分析", "安全告警", "区域状态"],
    showcase: canvasTemplateShowcases["energy-safety"],
  },
  {
    id: "industrial-park-operations",
    code: "PARK-03",
    name: "工业园区综合态势",
    description: "围绕楼宇、人员、车辆、能耗和事件组织园区运行态势，并展示楼宇与设施分布。",
    category: "园区运营",
    theme: "dark",
    canvasTheme: {
      mode: "custom",
      presetId: "custom",
      backgroundPattern: "circuit",
      fontFamily: "industrial",
      glowIntensity: 0.6,
      panelRadius: 6,
      backgroundColor: "#03152b",
      surfaceColor: "#072844",
      textColor: "#e8f8ff",
      accentColor: "#33c9ff",
      borderColor: "#146c9f",
    },
    componentSummary: "5 指标卡 · 园区鸟瞰 · 楼宇标注 · 人流趋势 · 事件闭环",
    tags: ["空间态势", "停车门禁", "事件闭环"],
    showcase: canvasTemplateShowcases["industrial-park-operations"],
  },
  {
    id: "warehouse-logistics",
    code: "LOG-04",
    name: "仓储物流运营调度",
    description: "面向仓库调度岗位，统一展示库存、库容、吞吐、作业任务、月台和搬运设备。",
    category: "仓储物流",
    theme: "violet",
    canvasTheme: {
      mode: "custom",
      presetId: "custom",
      backgroundPattern: "grid",
      fontFamily: "data",
      glowIntensity: 0.45,
      panelRadius: 8,
      backgroundColor: "#090d24",
      surfaceColor: "#161b3a",
      textColor: "#f2efff",
      accentColor: "#9b8dff",
      borderColor: "#505ba0",
    },
    componentSummary: "6 指标卡 · 仓储全景 · 月台调度 · 波次任务 · 设备效率",
    tags: ["库存库容", "车辆月台", "任务跟踪"],
    showcase: canvasTemplateShowcases["warehouse-logistics"],
  },
  {
    id: "water-treatment-operations",
    code: "WTR-05",
    name: "水处理设施运行监控",
    description: "覆盖进出水、水质、工艺单元、关键设备和单位能耗，突出超限与失联状态。",
    category: "水务环保",
    theme: "blue",
    canvasTheme: {
      mode: "custom",
      presetId: "custom",
      backgroundPattern: "circuit",
      fontFamily: "industrial",
      glowIntensity: 0.55,
      panelRadius: 6,
      backgroundColor: "#061625",
      surfaceColor: "#0b263b",
      textColor: "#eaf8ff",
      accentColor: "#4fb7ff",
      borderColor: "#2e6e9b",
    },
    componentSummary: "5 指标卡 · 流量面积图 · 水质雷达 · 工艺能耗 · 实时告警",
    tags: ["工艺流程", "水质监测", "设备失联"],
    showcase: canvasTemplateShowcases["water-treatment-operations"],
  },
  {
    id: "data-center-infrastructure",
    code: "IDC-06",
    name: "数据中心基础设施态势",
    description: "统一查看供配电、制冷、环境、机柜容量、PUE 和基础设施活动告警。",
    category: "数据中心",
    theme: "rose",
    canvasTheme: {
      mode: "custom",
      presetId: "custom",
      backgroundPattern: "grid",
      fontFamily: "data",
      glowIntensity: 0.45,
      panelRadius: 8,
      backgroundColor: "#160e18",
      surfaceColor: "#2d1b29",
      textColor: "#fff0f4",
      accentColor: "#f08ba6",
      borderColor: "#8a5064",
    },
    componentSummary: "5 指标卡 · 机房分区 · IT 负载趋势 · 容量对比 · 巡检与告警",
    tags: ["供配电", "机柜容量", "环境告警"],
    showcase: canvasTemplateShowcases["data-center-infrastructure"],
  },
];

const canvasTemplateIds = new Set<CanvasTemplateId>(
  canvasTemplates.map((template) => template.id),
);

export const isCanvasTemplateId = (value: string): value is CanvasTemplateId =>
  canvasTemplateIds.has(value as CanvasTemplateId);

export const getCanvasTemplate = (templateId: CanvasTemplateId): CanvasTemplate => {
  const template = canvasTemplates.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error(`Unsupported canvas template: ${templateId}`);
  return template;
};

export const instantiateCanvasTemplate = (
  templateId: CanvasTemplateId,
  existingNodes: CanvasNode[],
): CanvasNode[] => {
  if (templateId === "equipment-maintenance") return maintenanceTemplate();
  if (templateId === "equipment-support") return supportTemplate(existingNodes);
  if (templateId === "production-operations") return productionTemplate();
  if (templateId === "energy-safety") return energyTemplate();
  if (templateId === "industrial-park-operations") return parkTemplate(existingNodes);
  if (templateId === "warehouse-logistics") return warehouseTemplate();
  if (templateId === "water-treatment-operations") return waterTemplate();
  if (templateId === "data-center-infrastructure") return dataCenterTemplate();
  const exhaustiveCheck: never = templateId;
  throw new Error(`Unsupported canvas template: ${exhaustiveCheck}`);
};
