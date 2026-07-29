import type {
  CanvasNode,
  CanvasNodeType,
  ChartProps,
  DashboardBaseProps,
  DecorationProps,
  Model3DProps,
  ProgressListItem,
  ShapeProps,
  StatusGridItem,
} from "./types";

export type CanvasTemplateId =
  | "equipment-maintenance"
  | "equipment-support"
  | "production-operations"
  | "energy-safety";

export type CanvasTemplate = {
  id: CanvasTemplateId;
  name: string;
  description: string;
  category: string;
  theme: "light" | "dark" | "green" | "amber";
  componentSummary: string;
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
  type: "line-chart" | "bar-chart",
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
    title("装备修理统计态势", "维修保障 · 送修交接 · 质量反馈", colors),
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
    progress(
      { x: 1120, y: 720, width: 770, height: 330 },
      lightBase,
      "人员技能与任务完成",
      [
        { label: "高级技师", value: 8, maximum: 10, unit: "人" },
        { label: "中级修理工", value: 16, maximum: 20, unit: "人" },
        { label: "初级修理工", value: 22, maximum: 30, unit: "人" },
      ],
    ),
  ];
};

const supportTemplate = (existingNodes: CanvasNode[]): CanvasNode[] => {
  const colors = { text: "#e8fbff", accent: "#45d8ff", fill: "#071a2a", border: "#287c9e" };
  const existingModel = existingNodes.find((node) => node.type === "model-3d");
  return [
    background("#04111d"),
    title("装备场综合保障看板", "车辆、车位、钥匙柜与装备状态综合监控", colors),
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
    status(
      { x: 30, y: 670, width: 430, height: 380 },
      darkBase,
      "人员进出场情况",
      2,
      [
        { label: "部队人员", value: "42 人", tone: "normal" },
        { label: "地方人员", value: "8 人", tone: "warning" },
        { label: "在场", value: "39 人", tone: "normal" },
        { label: "离场", value: "11 人", tone: "offline" },
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
    title("智慧产线运营总览", "产量、节拍、质量、设备与人员协同监测", colors),
    datetime(colors),
    metric({ x: 30, y: 130, width: 348, height: 140 }, greenBase, "今日产量", "12,680", "件", "计划达成 96.2%", "产"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, greenBase, "平均节拍", "42.6", "秒", "目标 ≤ 45 秒", "速"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, greenBase, "一次合格率", "99.1", "%", "较昨日 +0.3%", "质"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, greenBase, "设备 OEE", "87.4", "%", "目标 85%", "效"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, greenBase, "在岗人员", "126", "人", "缺岗 2 人", "人"),
    chart("line-chart", { x: 30, y: 300, width: 850, height: 360 }, "24 小时产量趋势", ["00", "04", "08", "12", "16", "20", "24"], [420, 510, 680, 820, 760, 690, 590], "件", "#48e0a4"),
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
    progress(
      { x: 1350, y: 690, width: 540, height: 360 },
      greenBase,
      "质量缺陷分布",
      [
        { label: "尺寸偏差", value: 5, maximum: 20, unit: "件" },
        { label: "外观划伤", value: 8, maximum: 20, unit: "件" },
        { label: "装配漏项", value: 2, maximum: 20, unit: "件" },
      ],
    ),
  ];
};

const energyTemplate = (): CanvasNode[] => {
  const colors = { text: "#fff8e8", accent: "#ffbf54", fill: "#251f14", border: "#8b6c32" };
  return [
    background("#17140e"),
    title("厂区能源与安全监控", "水、电、气、碳排与安全告警统一监测", colors),
    datetime(colors),
    metric({ x: 30, y: 130, width: 348, height: 140 }, amberBase, "今日用电", "28,460", "kWh", "同比 -3.2%", "电"),
    metric({ x: 393, y: 130, width: 348, height: 140 }, amberBase, "今日用水", "1,286", "m³", "预算占比 76%", "水"),
    metric({ x: 756, y: 130, width: 348, height: 140 }, amberBase, "天然气", "3,820", "Nm³", "较昨日 +1.6%", "气"),
    metric({ x: 1119, y: 130, width: 348, height: 140 }, amberBase, "碳排估算", "18.6", "tCO₂", "月目标内", "碳"),
    metric({ x: 1482, y: 130, width: 408, height: 140 }, amberBase, "未处置告警", "7", "条", "高优先级 2 条", "!"),
    chart("line-chart", { x: 30, y: 300, width: 850, height: 360 }, "综合能耗趋势", ["00", "04", "08", "12", "16", "20", "24"], [42, 38, 66, 82, 75, 61, 48], "MWh", "#ffbf54"),
    chart("bar-chart", { x: 900, y: 300, width: 600, height: 360 }, "区域能耗排行", ["一车间", "二车间", "仓储", "动力站", "办公区"], [82, 71, 48, 66, 29], "MWh", "#ff9d52"),
    gauge({ x: 1520, y: 300, width: 370, height: 360 }, amberBase, "本月能源预算", 76, 100, "%", "剩余预算 24%"),
    status(
      { x: 30, y: 690, width: 760, height: 360 },
      amberBase,
      "安全告警",
      3,
      [
        { label: "高温告警", value: "2 条", tone: "danger" },
        { label: "压力预警", value: "3 条", tone: "warning" },
        { label: "烟感告警", value: "0 条", tone: "normal" },
        { label: "设备离线", value: "2 台", tone: "offline" },
        { label: "门禁异常", value: "0 条", tone: "normal" },
        { label: "漏水检测", value: "0 条", tone: "normal" },
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

export const canvasTemplates: CanvasTemplate[] = [
  {
    id: "equipment-maintenance",
    name: "装备修理统计态势",
    description: "浅色维修保障主题，包含申请流程、修理闭环、故障排行与人员质量概览。",
    category: "维修保障",
    theme: "light",
    componentSummary: "6 指标卡 · 环形进度 · 进度排行 · 状态矩阵 · 图表",
  },
  {
    id: "equipment-support",
    name: "装备场综合保障",
    description: "深色科技主题，组合车辆、钥匙、人员、动用趋势与 3D 场区主视图。",
    category: "装备保障",
    theme: "dark",
    componentSummary: "5 指标卡 · 3D 场景 · 状态矩阵 · 环形进度 · 趋势图",
  },
  {
    id: "production-operations",
    name: "智慧产线运营总览",
    description: "面向生产运营的产量、节拍、质量、OEE 与设备状态综合大屏。",
    category: "生产运营",
    theme: "green",
    componentSummary: "5 指标卡 · 双图表 · 工序进度 · 设备状态",
  },
  {
    id: "energy-safety",
    name: "能源与安全监控",
    description: "聚合水电气、碳排预算、安全告警和重点区域运行状态。",
    category: "能源安全",
    theme: "amber",
    componentSummary: "5 指标卡 · 能耗趋势 · 预算进度 · 告警矩阵",
  },
];

const canvasTemplateIds = new Set<CanvasTemplateId>(
  canvasTemplates.map((template) => template.id),
);

export const isCanvasTemplateId = (value: string): value is CanvasTemplateId =>
  canvasTemplateIds.has(value as CanvasTemplateId);

export const instantiateCanvasTemplate = (
  templateId: CanvasTemplateId,
  existingNodes: CanvasNode[],
): CanvasNode[] => {
  if (templateId === "equipment-maintenance") return maintenanceTemplate();
  if (templateId === "equipment-support") return supportTemplate(existingNodes);
  if (templateId === "production-operations") return productionTemplate();
  if (templateId === "energy-safety") return energyTemplate();
  const exhaustiveCheck: never = templateId;
  throw new Error(`Unsupported canvas template: ${exhaustiveCheck}`);
};
