import type {
  AlarmListItem,
  CanvasNode,
  CanvasNodeType,
  CanvasTheme,
  ChartNodeType,
  ChartProps,
  DashboardBaseProps,
  DecorationProps,
  Model3DProps,
  ProgressListItem,
  RankingListItem,
  ShapeProps,
  StatusGridItem,
  TimelineItem,
} from "./types";

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
  badge: "虚构演示";
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
    badge: "虚构演示",
    dataLabel: "模拟数据",
  },
  "equipment-support": {
    title: "启岳装备 · 洛阳综合保障态势看板",
    organization: "启岳装备（虚构）",
    location: "河南 · 洛阳",
    site: "车辆与装备保障场",
    deliveryForm: "2D 指标区 · 3D 场区主视图",
    badge: "虚构演示",
    dataLabel: "模拟数据",
  },
  "production-operations": {
    title: "江城智装 · 武汉智能装备态势看板",
    organization: "江城智装（虚构）",
    location: "湖北 · 武汉",
    site: "智能装备总装一号车间",
    deliveryForm: "2D 生产驾驶舱 · 设备状态联动",
    badge: "虚构演示",
    dataLabel: "模拟数据",
  },
  "energy-safety": {
    title: "皖江新材 · 合肥工厂能源安全看板",
    organization: "皖江新材（虚构）",
    location: "安徽 · 合肥",
    site: "新材料生产基地",
    deliveryForm: "能源驾驶舱 · 安全告警联动",
    badge: "虚构演示",
    dataLabel: "模拟数据",
  },
  "industrial-park-operations": {
    title: "云港智谷 · 苏州园区综合运营看板",
    organization: "云港智谷（虚构）",
    location: "江苏 · 苏州",
    site: "智能制造产业园",
    deliveryForm: "2D 运营指标 · 3D 园区主视图",
    badge: "虚构演示",
    dataLabel: "模拟数据",
  },
  "warehouse-logistics": {
    title: "东海链仓 · 宁波智慧物流调度看板",
    organization: "东海链仓（虚构）",
    location: "浙江 · 宁波",
    site: "区域智能仓配中心",
    deliveryForm: "仓储驾驶舱 · 月台与设备调度",
    badge: "虚构演示",
    dataLabel: "模拟数据",
  },
  "water-treatment-operations": {
    title: "清澜环境 · 宜昌水处理运行看板",
    organization: "清澜环境（虚构）",
    location: "湖北 · 宜昌",
    site: "工业污水处理中心",
    deliveryForm: "工艺驾驶舱 · 水质与设备监测",
    badge: "虚构演示",
    dataLabel: "模拟数据",
  },
  "data-center-infrastructure": {
    title: "星港算力 · 成都数据中心运维看板",
    organization: "星港算力（虚构）",
    location: "四川 · 成都",
    site: "高新算力基础设施中心",
    deliveryForm: "基础设施驾驶舱 · 容量与告警监控",
    badge: "虚构演示",
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

const greenBase: DashboardBaseProps = {
  title: "",
  textColor: "#e9fff6",
  accentColor: "#48e0a4",
  fillColor: "#0c2927",
  borderColor: "#2d826d",
  sample: true,
};

const amberBase: DashboardBaseProps = {
  title: "",
  textColor: "#fff8e8",
  accentColor: "#ffbf54",
  fillColor: "#292417",
  borderColor: "#8b6c32",
  sample: true,
};

const parkBase: DashboardBaseProps = {
  title: "",
  textColor: "#e8f8ff",
  accentColor: "#5cc9ff",
  fillColor: "#0b2637",
  borderColor: "#2f7797",
  sample: true,
};

const logisticsBase: DashboardBaseProps = {
  title: "",
  textColor: "#f2efff",
  accentColor: "#a99df5",
  fillColor: "#211e3a",
  borderColor: "#625a9d",
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
  text: "数据同步中",
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

const model = (box: Box, existingModel: CanvasNode | undefined) => {
  const defaultProps: Model3DProps = {
    backgroundColor: "#061725",
    backgroundOpacity: 1,
    environmentLightColor: "#d7f5ff",
    environmentLightIntensity: 2.1,
    keyLightColor: "#ffffff",
    keyLightIntensity: 2.4,
    cameraFov: 42,
    cameraView: "isometric",
    autoRotate: true,
    rotationSpeed: 0.28,
    showGrid: true,
    appearanceOverrides: {},
    transformOverrides: {},
  };
  const node = makeNode(
    "model-3d",
    box,
    existingModel?.props ?? defaultProps,
    10,
  );
  return {
    ...node,
    resourceRefs: existingModel?.resourceRefs ?? [],
    dataBindingRefs: existingModel?.dataBindingRefs ?? [],
  };
};

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
    model({ x: 490, y: 300, width: 900, height: 520 }, existingModel),
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

const productionTemplate = (): CanvasNode[] => {
  const colors = { text: "#eafff7", accent: "#48e0a4", fill: "#0b2525", border: "#2d806c" };
  return [
    background("#071a1d"),
    title(
      showcaseTitle("production-operations"),
      showcaseSubtitle("production-operations", "产量、节拍、质量、设备与人员协同监测"),
      colors,
    ),
    datetime(colors),
    metric({ x: 30, y: 130, width: 348, height: 140 }, greenBase, "今日产量", "12,680", "件", "计划达成 96.2%", "产"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, greenBase, "平均节拍", "42.6", "秒", "目标 ≤ 45 秒", "速"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, greenBase, "一次合格率", "99.1", "%", "较昨日 +0.3%", "质"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, greenBase, "设备 OEE", "87.4", "%", "目标 85%", "效"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, greenBase, "在岗人员", "126", "人", "缺岗 2 人", "人"),
    chart("area-chart", { x: 30, y: 300, width: 850, height: 360 }, "24 小时产量趋势", ["00", "04", "08", "12", "16", "20", "24"], [420, 510, 680, 820, 760, 690, 590], "件", "#48e0a4"),
    chart("bar-chart", { x: 900, y: 300, width: 600, height: 360 }, "各产线完成率", ["一线", "二线", "三线", "四线", "五线"], [96, 92, 88, 101, 94], "%", "#67e6b4"),
    gauge({ x: 1520, y: 300, width: 370, height: 360 }, greenBase, "订单达成率", 96.2, 100, "%", "计划 13,180 件"),
    progress(
      { x: 30, y: 690, width: 580, height: 360 },
      greenBase,
      "工序节拍",
      [
        { label: "上料", value: 39, maximum: 50, unit: "秒" },
        { label: "装配", value: 43, maximum: 50, unit: "秒" },
        { label: "检测", value: 46, maximum: 50, unit: "秒" },
        { label: "包装", value: 35, maximum: 50, unit: "秒" },
      ],
    ),
    status(
      { x: 630, y: 690, width: 700, height: 360 },
      greenBase,
      "关键设备状态",
      3,
      [
        { label: "冲压机 A01", value: "运行", tone: "normal" },
        { label: "机器人 R03", value: "运行", tone: "normal" },
        { label: "检测台 Q02", value: "待料", tone: "warning" },
        { label: "输送线 L01", value: "运行", tone: "normal" },
        { label: "包装机 P02", value: "保养", tone: "offline" },
        { label: "空压站 U01", value: "运行", tone: "normal" },
      ],
    ),
    alarms(
      { x: 1350, y: 690, width: 540, height: 360 },
      greenBase,
      "产线实时异常",
      [
        { time: "15:42", source: "检测台 Q02", message: "工件到位信号延迟 18 秒", tone: "warning" },
        { time: "15:18", source: "包装机 P02", message: "计划保养，预计 16:10 恢复", tone: "offline" },
        { time: "14:56", source: "机器人 R03", message: "夹具寿命剩余 8%", tone: "danger" },
        { time: "14:12", source: "输送线 L01", message: "节拍恢复至目标区间", tone: "normal" },
      ],
    ),
  ];
};

const energyTemplate = (): CanvasNode[] => {
  const colors = { text: "#fff8e8", accent: "#ffbf54", fill: "#251f14", border: "#8b6c32" };
  return [
    background("#17140e"),
    title(
      showcaseTitle("energy-safety"),
      showcaseSubtitle("energy-safety", "水、电、气、碳排与安全告警统一监测"),
      colors,
    ),
    datetime(colors),
    metric({ x: 30, y: 130, width: 348, height: 140 }, amberBase, "今日用电", "28,460", "kWh", "同比 -3.2%", "电"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, amberBase, "今日用水", "1,286", "m³", "预算占比 76%", "水"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, amberBase, "天然气", "3,820", "Nm³", "较昨日 +1.6%", "气"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, amberBase, "碳排估算", "18.6", "tCO₂", "月目标内", "碳"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, amberBase, "未处置告警", "7", "条", "高优先级 2 条", "!"),
    chart("area-chart", { x: 30, y: 300, width: 850, height: 360 }, "综合能耗趋势", ["00", "04", "08", "12", "16", "20", "24"], [42, 38, 66, 82, 75, 61, 48], "MWh", "#ffbf54"),
    ranking(
      { x: 900, y: 300, width: 600, height: 360 },
      amberBase,
      "区域能耗排名",
      [
        { label: "一号熔炼车间", value: 82, unit: "MWh", trend: "up" },
        { label: "二号成型车间", value: 71, unit: "MWh", trend: "down" },
        { label: "动力站", value: 66, unit: "MWh", trend: "flat" },
        { label: "原料仓储", value: 48, unit: "MWh", trend: "up" },
        { label: "研发办公区", value: 29, unit: "MWh", trend: "down" },
      ],
    ),
    gauge({ x: 1520, y: 300, width: 370, height: 360 }, amberBase, "本月能源预算", 76, 100, "%", "剩余预算 24%"),
    alarms(
      { x: 30, y: 690, width: 760, height: 360 },
      amberBase,
      "安全告警处置",
      [
        { time: "15:36", source: "熔炼炉 T-03", message: "炉壁温度超过二级阈值", tone: "danger" },
        { time: "15:08", source: "空压站 P-02", message: "出口压力连续波动", tone: "warning" },
        { time: "14:40", source: "消防泵房网关", message: "通信心跳中断", tone: "offline" },
        { time: "13:25", source: "危化品库", message: "通风联锁恢复正常", tone: "normal" },
      ],
    ),
    progress(
      { x: 820, y: 690, width: 520, height: 360 },
      amberBase,
      "能源目标达成",
      [
        { label: "电力预算", value: 76, maximum: 100, unit: "%" },
        { label: "用水预算", value: 69, maximum: 100, unit: "%" },
        { label: "天然气预算", value: 81, maximum: 100, unit: "%" },
        { label: "碳排预算", value: 72, maximum: 100, unit: "%" },
      ],
    ),
    status(
      { x: 1370, y: 690, width: 520, height: 360 },
      amberBase,
      "重点区域状态",
      2,
      [
        { label: "动力站", value: "正常", tone: "normal" },
        { label: "危化品库", value: "预警", tone: "warning" },
        { label: "一车间", value: "正常", tone: "normal" },
        { label: "消防泵房", value: "离线", tone: "offline" },
      ],
    ),
  ];
};

const parkTemplate = (existingNodes: CanvasNode[]): CanvasNode[] => {
  const colors = { text: "#e8f8ff", accent: "#5cc9ff", fill: "#081d2d", border: "#2f7797" };
  const existingModel = existingNodes.find((node) => node.type === "model-3d");
  return [
    background("#061522"),
    title(
      showcaseTitle("industrial-park-operations"),
      showcaseSubtitle("industrial-park-operations", "楼宇、通行、停车、能耗与事件协同监控"),
      colors,
    ),
    datetime(colors),
    metric({ x: 30, y: 130, width: 348, height: 140 }, parkBase, "在线楼宇", "18", "栋", "重点区域 6 个", "楼"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, parkBase, "今日入园", "3,286", "人次", "访客 186 人次", "人"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, parkBase, "停车占用", "72.6", "%", "空余 328 个", "车"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, parkBase, "当日能耗", "86.4", "MWh", "较昨日 -2.8%", "能"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, parkBase, "待处置事件", "9", "起", "高优先级 2 起", "!"),
    progress(
      { x: 30, y: 300, width: 420, height: 340 },
      parkBase,
      "园区空间使用率",
      [
        { label: "生产区", value: 86, maximum: 100, unit: "%" },
        { label: "仓储区", value: 74, maximum: 100, unit: "%" },
        { label: "办公区", value: 68, maximum: 100, unit: "%" },
        { label: "停车区", value: 73, maximum: 100, unit: "%" },
      ],
    ),
    status(
      { x: 30, y: 670, width: 420, height: 380 },
      parkBase,
      "出入口与道路",
      2,
      [
        { label: "东门", value: "畅通", tone: "normal" },
        { label: "南门", value: "拥堵", tone: "warning" },
        { label: "物流门", value: "畅通", tone: "normal" },
        { label: "北侧道路", value: "施工", tone: "offline" },
      ],
    ),
    model({ x: 480, y: 300, width: 920, height: 500 }, existingModel),
    chart(
      "area-chart",
      { x: 480, y: 830, width: 920, height: 220 },
      "今日园区人流趋势",
      ["00", "04", "08", "12", "16", "20", "24"],
      [86, 52, 648, 482, 726, 365, 118],
      "人次",
      "#5cc9ff",
    ),
    status(
      { x: 1430, y: 300, width: 460, height: 340 },
      parkBase,
      "重点区域状态",
      2,
      [
        { label: "危化品库", value: "正常", tone: "normal" },
        { label: "动力中心", value: "预警", tone: "warning" },
        { label: "消防泵房", value: "正常", tone: "normal" },
        { label: "污水站", value: "离线", tone: "offline" },
      ],
    ),
    timeline(
      { x: 1430, y: 670, width: 460, height: 380 },
      parkBase,
      "园区事件时间线",
      [
        { time: "15:30", title: "南门车辆排队", detail: "已增开 2 条临时通道", tone: "warning" },
        { time: "14:52", title: "动力中心压力预警", detail: "运维班组已到场确认", tone: "danger" },
        { time: "13:40", title: "访客团进入 B 区", detail: "预约与陪同人员核验完成", tone: "normal" },
        { time: "11:18", title: "污水站网关失联", detail: "正在切换备用通信链路", tone: "offline" },
      ],
    ),
  ];
};

const warehouseTemplate = (): CanvasNode[] => {
  const colors = { text: "#f2efff", accent: "#a99df5", fill: "#1b1931", border: "#625a9d" };
  return [
    background("#121022"),
    title(
      showcaseTitle("warehouse-logistics"),
      showcaseSubtitle("warehouse-logistics", "库存、吞吐、作业任务、月台与车辆协同监控"),
      colors,
    ),
    datetime(colors),
    metric({ x: 30, y: 130, width: 348, height: 140 }, logisticsBase, "库存总量", "128,640", "件", "SKU 3,826 种", "库"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, logisticsBase, "库容使用率", "78.3", "%", "可用库位 1,248", "位"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, logisticsBase, "今日入库", "6,420", "件", "已完成 42 车", "入"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, logisticsBase, "今日出库", "5,986", "件", "准时率 97.6%", "出"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, logisticsBase, "待执行任务", "36", "单", "超时任务 3 单", "!"),
    chart(
      "area-chart",
      { x: 30, y: 300, width: 820, height: 360 },
      "24 小时出入库吞吐",
      ["00", "04", "08", "12", "16", "20", "24"],
      [320, 245, 860, 1120, 980, 735, 428],
      "件/时",
      "#a99df5",
    ),
    ranking(
      { x: 870, y: 300, width: 640, height: 360 },
      logisticsBase,
      "库区库容使用率排名",
      [
        { label: "成品区 C", value: 91, unit: "%", trend: "up" },
        { label: "原料区 A", value: 82, unit: "%", trend: "flat" },
        { label: "冷链区 E", value: 76, unit: "%", trend: "up" },
        { label: "半成品区 B", value: 74, unit: "%", trend: "down" },
        { label: "备件区 D", value: 63, unit: "%", trend: "down" },
      ],
    ),
    gauge({ x: 1530, y: 300, width: 360, height: 360 }, logisticsBase, "订单准时率", 97.6, 100, "%", "目标 ≥ 96%"),
    status(
      { x: 30, y: 690, width: 600, height: 360 },
      logisticsBase,
      "装卸月台状态",
      3,
      [
        { label: "1 号月台", value: "装货", tone: "normal" },
        { label: "2 号月台", value: "卸货", tone: "normal" },
        { label: "3 号月台", value: "等待", tone: "warning" },
        { label: "4 号月台", value: "空闲", tone: "normal" },
        { label: "5 号月台", value: "检修", tone: "offline" },
        { label: "6 号月台", value: "装货", tone: "normal" },
      ],
    ),
    dataTable(
      { x: 650, y: 690, width: 600, height: 360 },
      logisticsBase,
      "当班波次任务",
      ["波次", "作业区", "任务", "进度"],
      [
        ["WV-260906-08", "成品 C", "拣选复核", "68 / 76"],
        ["WV-260906-09", "月台 1", "出库装车", "39 / 45"],
        ["WV-260906-10", "原料 A", "入库上架", "42 / 48"],
        ["WV-260906-11", "备件 D", "循环盘点", "16 / 20"],
      ],
      3,
    ),
    status(
      { x: 1270, y: 690, width: 620, height: 360 },
      logisticsBase,
      "搬运设备状态",
      3,
      [
        { label: "AGV 在线", value: "26 / 28", tone: "normal" },
        { label: "叉车可用", value: "14 / 16", tone: "normal" },
        { label: "堆垛机", value: "5 / 6", tone: "warning" },
        { label: "输送线", value: "8 / 8", tone: "normal" },
        { label: "扫码站", value: "11 / 12", tone: "warning" },
        { label: "失联设备", value: "1 台", tone: "offline" },
      ],
    ),
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
    metric({ x: 30, y: 130, width: 348, height: 140 }, waterBase, "今日处理量", "48,620", "m³", "设计负荷 81.0%", "量"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, waterBase, "出水 COD", "23.6", "mg/L", "限值 ≤ 50", "质"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, waterBase, "出水氨氮", "1.42", "mg/L", "限值 ≤ 5", "氮"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, waterBase, "吨水电耗", "0.286", "kWh", "较昨日 -1.8%", "电"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, waterBase, "设备在线率", "96.4", "%", "离线设备 3 台", "机"),
    status(
      { x: 30, y: 300, width: 500, height: 360 },
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
      { x: 550, y: 300, width: 800, height: 360 },
      "24 小时出水流量",
      ["00", "04", "08", "12", "16", "20", "24"],
      [1820, 1740, 2050, 2260, 2180, 1940, 1860],
      "m³/h",
      "#4fb7ff",
    ),
    gauge({ x: 1370, y: 300, width: 520, height: 360 }, waterBase, "水质达标率", 99.2, 100, "%", "本月有效样本 2,864 组"),
    chart(
      "bar-chart",
      { x: 30, y: 690, width: 700, height: 360 },
      "工艺单元能耗",
      ["提升泵", "曝气", "回流泵", "脱水", "消毒"],
      [28, 46, 19, 14, 8],
      "MWh",
      "#348ed8",
    ),
    chart(
      "radar-chart",
      { x: 750, y: 690, width: 560, height: 360 },
      "关键水质指标",
      ["COD", "氨氮", "总磷", "悬浮物", "pH 稳定度"],
      [86, 92, 89, 84, 96],
      "%",
      "#4fb7ff",
    ),
    alarms(
      { x: 1330, y: 690, width: 560, height: 360 },
      waterBase,
      "设备与水质告警",
      [
        { time: "15:28", source: "二沉池 LT-07", message: "液位接近高位阈值", tone: "warning" },
        { time: "14:56", source: "2# 鼓风机", message: "轴承振动连续升高", tone: "danger" },
        { time: "13:42", source: "液位计 L-07", message: "设备通信中断", tone: "offline" },
        { time: "12:18", source: "出水 COD", message: "在线仪表自动校准完成", tone: "normal" },
      ],
    ),
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
    metric({ x: 30, y: 130, width: 348, height: 140 }, dataCenterBase, "IT 实时负载", "2.86", "MW", "容量占用 71.5%", "IT"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, dataCenterBase, "实时 PUE", "1.32", "", "目标 ≤ 1.40", "能"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, dataCenterBase, "机柜使用率", "76.8", "%", "空闲机柜 116 个", "柜"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, dataCenterBase, "UPS 负载率", "58.4", "%", "后备时间 42 分钟", "UPS"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, dataCenterBase, "活动告警", "12", "条", "严重告警 2 条", "!"),
    chart(
      "area-chart",
      { x: 30, y: 300, width: 820, height: 360 },
      "24 小时 IT 负载趋势",
      ["00", "04", "08", "12", "16", "20", "24"],
      [2.22, 2.08, 2.46, 2.72, 2.86, 2.64, 2.38],
      "MW",
      "#f08ba6",
    ),
    chart(
      "donut-chart",
      { x: 870, y: 300, width: 640, height: 360 },
      "机房容量使用率",
      ["A1", "A2", "B1", "B2", "C1", "C2"],
      [82, 76, 69, 88, 64, 72],
      "%",
      "#c96989",
    ),
    gauge({ x: 1530, y: 300, width: 360, height: 360 }, dataCenterBase, "制冷容量利用率", 68.2, 100, "%", "剩余容量 1.26 MW"),
    status(
      { x: 30, y: 690, width: 620, height: 360 },
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
      { x: 670, y: 690, width: 580, height: 360 },
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
      { x: 1270, y: 690, width: 620, height: 360 },
      dataCenterBase,
      "基础设施活动告警",
      [
        { time: "15:36", source: "冷机 CH-03", message: "冷冻水供水温度高于设定值", tone: "warning" },
        { time: "15:02", source: "列头柜 P07", message: "采集网关连续 120 秒无心跳", tone: "offline" },
        { time: "14:28", source: "A2-17 机柜", message: "冷通道温度达到 29.4℃", tone: "danger" },
        { time: "13:45", source: "UPS-2B", message: "旁路切换自检完成", tone: "normal" },
      ],
    ),
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
    description: "深色科技主题，组合车辆、钥匙、人员、动用趋势与 3D 场区主视图。",
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
    componentSummary: "5 指标卡 · 3D 场景 · 状态矩阵 · 环形进度 · 趋势图",
    tags: ["车辆在位", "钥匙管理", "3D 场区"],
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
      backgroundColor: "#071a1d",
      surfaceColor: "#0c2927",
      textColor: "#e9fff6",
      accentColor: "#48e0a4",
      borderColor: "#2d826d",
    },
    componentSummary: "5 指标卡 · 产量面积图 · 产线对比 · 设备状态 · 实时告警",
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
      backgroundColor: "#17140e",
      surfaceColor: "#292417",
      textColor: "#fff8e8",
      accentColor: "#ffbf54",
      borderColor: "#8b6c32",
    },
    componentSummary: "5 指标卡 · 能耗面积图 · 区域排名 · 预算进度 · 实时告警",
    tags: ["能耗分析", "安全告警", "区域状态"],
    showcase: canvasTemplateShowcases["energy-safety"],
  },
  {
    id: "industrial-park-operations",
    code: "PARK-03",
    name: "工业园区综合态势",
    description: "围绕楼宇、人员、车辆、能耗和事件组织园区运行态势，并预留 3D 园区主视区。",
    category: "园区运营",
    theme: "dark",
    canvasTheme: {
      mode: "custom",
      presetId: "custom",
      backgroundPattern: "circuit",
      fontFamily: "industrial",
      glowIntensity: 0.6,
      panelRadius: 6,
      backgroundColor: "#061522",
      surfaceColor: "#0b2637",
      textColor: "#e8f8ff",
      accentColor: "#5cc9ff",
      borderColor: "#2f7797",
    },
    componentSummary: "5 指标卡 · 3D 园区主视图 · 人流趋势 · 事件时间线",
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
      backgroundColor: "#121022",
      surfaceColor: "#211e3a",
      textColor: "#f2efff",
      accentColor: "#a99df5",
      borderColor: "#625a9d",
    },
    componentSummary: "5 指标卡 · 吞吐面积图 · 库容排名 · 波次表格 · 设备状态",
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
    componentSummary: "5 指标卡 · IT 负载面积图 · 容量环图 · 设施状态 · 活动告警",
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
