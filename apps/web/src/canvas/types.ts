export const CANVAS_DRAG_TYPE = "application/x-factory-twin-component";

export type ChartNodeType =
  | "line-chart"
  | "bar-chart"
  | "area-chart"
  | "pie-chart"
  | "donut-chart"
  | "radar-chart";
export type ShapeNodeType = "rectangle" | "circle";
export type DecorationNodeType =
  | "screen-title"
  | "background-decoration"
  | "datetime"
  | "section-title"
  | "card-background"
  | "icon-background";
export type Model3DNodeType = "model-3d";
export type DashboardNodeType =
  | "metric-card"
  | "radial-gauge"
  | "progress-list"
  | "status-grid"
  | "ranking-list"
  | "alarm-list"
  | "data-table"
  | "event-timeline";
export type BasicNodeType =
  | "plain-text"
  | "text-link"
  | "image"
  | "carousel"
  | "button"
  | "switch"
  | "checkbox-group"
  | "radio-group"
  | "select";
export type CanvasNodeType =
  | ChartNodeType
  | ShapeNodeType
  | DecorationNodeType
  | Model3DNodeType
  | DashboardNodeType
  | BasicNodeType;

export type CanvasThemeMode = "dark" | "light" | "custom";

export type CanvasTheme = {
  mode: CanvasThemeMode;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  accentColor: string;
  borderColor: string;
};

export type ChartProps = {
  title: string;
  categories: string[];
  values: number[];
  unit: string;
  color: string;
};

export type ShapeProps = {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  opacity: number;
};

export type TextAlign = "left" | "center" | "right";

export type DecorationProps = {
  text: string;
  subtitle: string;
  textColor: string;
  accentColor: string;
  fillColor: string;
  borderColor: string;
  opacity: number;
  align: TextAlign;
  showDate: boolean;
  showSeconds: boolean;
};

export type DashboardTone = "normal" | "warning" | "danger" | "offline";

export type DashboardBaseProps = {
  title: string;
  textColor: string;
  accentColor: string;
  fillColor: string;
  borderColor: string;
  sample: boolean;
};

export type MetricCardProps = DashboardBaseProps & {
  value: string;
  unit: string;
  subtitle: string;
  icon: string;
};

export type RadialGaugeProps = DashboardBaseProps & {
  value: number;
  maximum: number;
  unit: string;
  subtitle: string;
};

export type ProgressListItem = {
  label: string;
  value: number;
  maximum: number;
  unit: string;
};

export type ProgressListProps = DashboardBaseProps & {
  items: ProgressListItem[];
};

export type StatusGridItem = {
  label: string;
  value: string;
  tone: DashboardTone;
};

export type StatusGridProps = DashboardBaseProps & {
  columns: number;
  items: StatusGridItem[];
};

export type RankingTrend = "up" | "down" | "flat";

export type RankingListItem = {
  label: string;
  value: number;
  unit: string;
  trend: RankingTrend;
};

export type RankingListProps = DashboardBaseProps & {
  items: RankingListItem[];
};

export type AlarmListItem = {
  time: string;
  source: string;
  message: string;
  tone: DashboardTone;
};

export type AlarmListProps = DashboardBaseProps & {
  items: AlarmListItem[];
};

export type DataTableProps = DashboardBaseProps & {
  columns: string[];
  rows: string[][];
  highlightColumn: number;
};

export type TimelineItem = {
  time: string;
  title: string;
  detail: string;
  tone: DashboardTone;
};

export type EventTimelineProps = DashboardBaseProps & {
  items: TimelineItem[];
};

export type DashboardProps =
  | MetricCardProps
  | RadialGaugeProps
  | ProgressListProps
  | StatusGridProps
  | RankingListProps
  | AlarmListProps
  | DataTableProps
  | EventTimelineProps;

export type BasicOption = {
  label: string;
  value: string;
};

export type BasicAppearanceProps = {
  textColor: string;
  accentColor: string;
  fillColor: string;
  borderColor: string;
  borderRadius: number;
};

export type PlainTextProps = BasicAppearanceProps & {
  text: string;
  align: TextAlign;
  fontSize: number;
  fontWeight: number;
  scrollMode: "none" | "horizontal" | "vertical";
  scrollDuration: number;
};

export type TextLinkProps = BasicAppearanceProps & {
  text: string;
  href: string;
  align: TextAlign;
  fontSize: number;
  fontWeight: number;
  openInNewTab: boolean;
  underline: boolean;
};

export type ImageProps = {
  alt: string;
  fit: "contain" | "cover" | "fill";
  backgroundColor: string;
  borderColor: string;
  borderRadius: number;
};

export type CarouselProps = ImageProps & {
  autoplay: boolean;
  interval: number;
  showArrows: boolean;
  showDots: boolean;
};

export type ButtonProps = BasicAppearanceProps & {
  text: string;
  href: string;
  fontSize: number;
  fontWeight: number;
  openInNewTab: boolean;
  disabled: boolean;
};

export type SwitchProps = BasicAppearanceProps & {
  label: string;
  defaultChecked: boolean;
  onText: string;
  offText: string;
};

export type CheckboxGroupProps = BasicAppearanceProps & {
  title: string;
  options: BasicOption[];
  selectedValues: string[];
  columns: number;
};

export type RadioGroupProps = BasicAppearanceProps & {
  title: string;
  options: BasicOption[];
  selectedValue: string;
  columns: number;
};

export type SelectProps = BasicAppearanceProps & {
  label: string;
  placeholder: string;
  options: BasicOption[];
  selectedValue: string;
};

export type BasicProps =
  | PlainTextProps
  | TextLinkProps
  | ImageProps
  | CarouselProps
  | ButtonProps
  | SwitchProps
  | CheckboxGroupProps
  | RadioGroupProps
  | SelectProps;

export type Vector3Tuple = [number, number, number];

export type ModelNodeTransform = {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
};

export type ModelNodeAppearance = {
  color: string;
  opacity: number;
  visible: boolean;
};

export type ModelCameraView = "isometric" | "front" | "top";

export type Model3DProps = {
  backgroundColor: string;
  backgroundOpacity: number;
  environmentLightColor: string;
  environmentLightIntensity: number;
  keyLightColor: string;
  keyLightIntensity: number;
  cameraFov: number;
  cameraView: ModelCameraView;
  autoRotate: boolean;
  rotationSpeed: number;
  showGrid: boolean;
  appearanceOverrides: Record<string, ModelNodeAppearance>;
  transformOverrides: Record<string, ModelNodeTransform>;
};

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  props: Record<string, unknown>;
  resourceRefs: string[];
  dataBindingRefs: string[];
};

export type CanvasDocument = {
  projectId: string;
  width: number;
  height: number;
  theme: CanvasTheme;
  revision: number;
  updatedAt: string | null;
  nodes: CanvasNode[];
};

export type CanvasProject = {
  id: string;
  name: string;
  status: "draft" | "published" | "archived";
  projectRole: "owner" | "editor" | "viewer" | null;
};

export type CanvasResponse = {
  project: CanvasProject;
  canvas: CanvasDocument;
  editable: boolean;
  requestId: string;
};

export type CanvasPatchResponse = {
  canvas: CanvasDocument;
  requestId: string;
};

const chartDefaults: Record<ChartNodeType, ChartProps> = {
  "line-chart": {
    title: "设备运行趋势",
    categories: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"],
    values: [62, 71, 68, 82, 76, 88, 84],
    unit: "%",
    color: "#66d9ff",
  },
  "bar-chart": {
    title: "产线小时产量",
    categories: ["一线", "二线", "三线", "四线", "五线", "六线"],
    values: [78, 92, 64, 86, 73, 95],
    unit: "件",
    color: "#46e3b7",
  },
  "area-chart": {
    title: "24 小时综合能耗",
    categories: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
    values: [42, 36, 58, 82, 74, 61, 48],
    unit: "MWh",
    color: "#55d8ff",
  },
  "pie-chart": {
    title: "设备状态分布",
    categories: ["运行", "待机", "预警", "离线"],
    values: [68, 18, 9, 5],
    unit: "台",
    color: "#46e3b7",
  },
  "donut-chart": {
    title: "能源消费构成",
    categories: ["生产用电", "动力用电", "照明", "其他"],
    values: [56, 24, 12, 8],
    unit: "%",
    color: "#55d8ff",
  },
  "radar-chart": {
    title: "产线综合能力",
    categories: ["产能", "质量", "交付", "能效", "安全", "维护"],
    values: [92, 88, 84, 76, 96, 81],
    unit: "分",
    color: "#a78bfa",
  },
};

const shapeDefaults: Record<ShapeNodeType, ShapeProps> = {
  rectangle: {
    fillColor: "#1f8bb6",
    borderColor: "#76dcff",
    borderWidth: 2,
    borderRadius: 12,
    opacity: 0.78,
  },
  circle: {
    fillColor: "#25a88a",
    borderColor: "#88f0d4",
    borderWidth: 2,
    borderRadius: 0,
    opacity: 0.78,
  },
};

const decorationDefaults: Record<DecorationNodeType, DecorationProps> = {
  "screen-title": {
    text: "智慧工厂生产运营中心",
    subtitle: "SMART FACTORY OPERATIONS CENTER",
    textColor: "#eafaff",
    accentColor: "#5ad8ff",
    fillColor: "#071a2b",
    borderColor: "#2f7898",
    opacity: 0.96,
    align: "center",
    showDate: true,
    showSeconds: true,
  },
  "background-decoration": {
    text: "",
    subtitle: "",
    textColor: "#dff8ff",
    accentColor: "#35c8ff",
    fillColor: "#071525",
    borderColor: "#1b5f7a",
    opacity: 0.55,
    align: "center",
    showDate: true,
    showSeconds: true,
  },
  datetime: {
    text: "实时数据",
    subtitle: "",
    textColor: "#dff8ff",
    accentColor: "#58d6ff",
    fillColor: "#081a2a",
    borderColor: "#2c6c86",
    opacity: 0.9,
    align: "right",
    showDate: true,
    showSeconds: true,
  },
  "section-title": {
    text: "生产运行概览",
    subtitle: "",
    textColor: "#eafaff",
    accentColor: "#58d6ff",
    fillColor: "#0a2234",
    borderColor: "#276982",
    opacity: 0.92,
    align: "left",
    showDate: true,
    showSeconds: true,
  },
  "card-background": {
    text: "",
    subtitle: "",
    textColor: "#dff8ff",
    accentColor: "#39c7f3",
    fillColor: "#0b2638",
    borderColor: "#286783",
    opacity: 0.82,
    align: "left",
    showDate: true,
    showSeconds: true,
  },
  "icon-background": {
    text: "01",
    subtitle: "",
    textColor: "#e9fbff",
    accentColor: "#55d8ff",
    fillColor: "#0a2638",
    borderColor: "#2d7896",
    opacity: 0.92,
    align: "center",
    showDate: true,
    showSeconds: true,
  },
};

const model3DDefaults: Record<Model3DNodeType, Model3DProps> = {
  "model-3d": {
    backgroundColor: "#071525",
    backgroundOpacity: 1,
    environmentLightColor: "#daf4ff",
    environmentLightIntensity: 2.1,
    keyLightColor: "#ffffff",
    keyLightIntensity: 2.4,
    cameraFov: 42,
    cameraView: "isometric",
    autoRotate: true,
    rotationSpeed: 0.35,
    showGrid: true,
    appearanceOverrides: {},
    transformOverrides: {},
  },
};

const dashboardDefaults: Record<DashboardNodeType, DashboardProps> = {
  "metric-card": {
    title: "设备在线率",
    value: "98.6",
    unit: "%",
    subtitle: "较昨日 +0.8%",
    icon: "↗",
    textColor: "#eafaff",
    accentColor: "#55d8ff",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
  "radial-gauge": {
    title: "任务完成率",
    value: 86,
    maximum: 100,
    unit: "%",
    subtitle: "目标 90%",
    textColor: "#eafaff",
    accentColor: "#46e3b7",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
  "progress-list": {
    title: "保障申请流程",
    items: [
      { label: "申请准备", value: 8, maximum: 10, unit: "项" },
      { label: "分级审批", value: 5, maximum: 10, unit: "项" },
      { label: "送修交接", value: 7, maximum: 10, unit: "项" },
    ],
    textColor: "#eafaff",
    accentColor: "#55d8ff",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
  "status-grid": {
    title: "设备状态",
    columns: 3,
    items: [
      { label: "01 号设备", value: "运行", tone: "normal" },
      { label: "02 号设备", value: "预警", tone: "warning" },
      { label: "03 号设备", value: "离线", tone: "offline" },
    ],
    textColor: "#eafaff",
    accentColor: "#55d8ff",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
  "ranking-list": {
    title: "产线实时产量排行",
    items: [
      { label: "四号产线", value: 1286, unit: "件", trend: "up" },
      { label: "一号产线", value: 1168, unit: "件", trend: "up" },
      { label: "二号产线", value: 1085, unit: "件", trend: "flat" },
      { label: "三号产线", value: 964, unit: "件", trend: "down" },
    ],
    textColor: "#eafaff",
    accentColor: "#55d8ff",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
  "alarm-list": {
    title: "实时告警",
    items: [
      { time: "14:26:08", source: "冲压机 A-03", message: "主轴温度超过预警阈值", tone: "warning" },
      { time: "14:18:31", source: "装配线 B", message: "工位 07 安全门开启", tone: "danger" },
      { time: "13:55:02", source: "空压站", message: "2 号机组通信中断", tone: "offline" },
    ],
    textColor: "#eafaff",
    accentColor: "#ffbd59",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
  "data-table": {
    title: "设备运行明细",
    columns: ["设备", "状态", "负载", "产量"],
    rows: [
      ["冲压机 A-01", "运行", "78%", "326 件"],
      ["冲压机 A-02", "待机", "12%", "285 件"],
      ["装配线 B-01", "运行", "91%", "418 件"],
      ["包装线 C-01", "预警", "64%", "192 件"],
    ],
    highlightColumn: 1,
    textColor: "#eafaff",
    accentColor: "#46e3b7",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
  "event-timeline": {
    title: "生产事件时间线",
    items: [
      { time: "14:30", title: "批次切换完成", detail: "工单 WO-260905-08 已上线", tone: "normal" },
      { time: "14:18", title: "安全门告警", detail: "装配线 B · 工位 07", tone: "danger" },
      { time: "13:42", title: "质量抽检通过", detail: "抽检 20 件，合格率 100%", tone: "normal" },
      { time: "13:10", title: "设备进入待机", detail: "冲压机 A-02 等待物料", tone: "warning" },
    ],
    textColor: "#eafaff",
    accentColor: "#55d8ff",
    fillColor: "#0b2638",
    borderColor: "#286783",
    sample: true,
  },
};

const basicAppearanceDefaults: BasicAppearanceProps = {
  textColor: "#eafaff",
  accentColor: "#55d8ff",
  fillColor: "#0b2638",
  borderColor: "#286783",
  borderRadius: 10,
};

const basicDefaults: Record<BasicNodeType, BasicProps> = {
  "plain-text": {
    ...basicAppearanceDefaults,
    text: "设备运行正常 · 当前产线效率 98.6%",
    align: "left",
    fontSize: 24,
    fontWeight: 500,
    scrollMode: "none",
    scrollDuration: 12,
  },
  "text-link": {
    ...basicAppearanceDefaults,
    text: "查看生产详情",
    href: "https://example.com",
    align: "left",
    fontSize: 22,
    fontWeight: 600,
    openInNewTab: true,
    underline: true,
  },
  image: {
    alt: "看板图片",
    fit: "cover",
    backgroundColor: "#071525",
    borderColor: "#286783",
    borderRadius: 10,
  },
  carousel: {
    alt: "看板轮播图",
    fit: "cover",
    backgroundColor: "#071525",
    borderColor: "#286783",
    borderRadius: 10,
    autoplay: true,
    interval: 5,
    showArrows: true,
    showDots: true,
  },
  button: {
    ...basicAppearanceDefaults,
    text: "查看详情",
    href: "",
    fontSize: 20,
    fontWeight: 600,
    openInNewTab: false,
    disabled: false,
  },
  switch: {
    ...basicAppearanceDefaults,
    label: "设备控制",
    defaultChecked: true,
    onText: "开启",
    offText: "关闭",
  },
  "checkbox-group": {
    ...basicAppearanceDefaults,
    title: "展示区域",
    options: [
      { label: "生产", value: "production" },
      { label: "能耗", value: "energy" },
      { label: "告警", value: "alarm" },
    ],
    selectedValues: ["production", "energy"],
    columns: 1,
  },
  "radio-group": {
    ...basicAppearanceDefaults,
    title: "时间范围",
    options: [
      { label: "今日", value: "today" },
      { label: "本周", value: "week" },
      { label: "本月", value: "month" },
    ],
    selectedValue: "today",
    columns: 1,
  },
  select: {
    ...basicAppearanceDefaults,
    label: "选择产线",
    placeholder: "请选择",
    options: [
      { label: "一号产线", value: "line-1" },
      { label: "二号产线", value: "line-2" },
      { label: "三号产线", value: "line-3" },
    ],
    selectedValue: "",
  },
};

export const componentLabels: Record<CanvasNodeType, string> = {
  "line-chart": "折线图",
  "bar-chart": "柱状图",
  "area-chart": "面积图",
  "pie-chart": "饼图",
  "donut-chart": "环形图",
  "radar-chart": "雷达图",
  rectangle: "矩形",
  circle: "圆形",
  "screen-title": "大屏标题",
  "background-decoration": "背景点缀",
  datetime: "时间日期",
  "section-title": "标题",
  "card-background": "小卡片背景",
  "icon-background": "小图标背景",
  "model-3d": "3D 模型",
  "metric-card": "指标卡",
  "radial-gauge": "环形进度",
  "progress-list": "进度排行",
  "status-grid": "状态矩阵",
  "ranking-list": "数据排名",
  "alarm-list": "实时告警",
  "data-table": "业务表格",
  "event-timeline": "事件时间线",
  "plain-text": "纯文本",
  "text-link": "文字超链接",
  image: "图片",
  carousel: "轮播图",
  button: "按钮",
  switch: "Switch",
  "checkbox-group": "多选框",
  "radio-group": "单选框",
  select: "下拉菜单",
};

export const defaultNodeSizes: Record<CanvasNodeType, { width: number; height: number }> = {
  "line-chart": { width: 520, height: 300 },
  "bar-chart": { width: 520, height: 300 },
  "area-chart": { width: 520, height: 300 },
  "pie-chart": { width: 420, height: 320 },
  "donut-chart": { width: 420, height: 320 },
  "radar-chart": { width: 440, height: 360 },
  rectangle: { width: 360, height: 220 },
  circle: { width: 260, height: 260 },
  "screen-title": { width: 760, height: 110 },
  "background-decoration": { width: 420, height: 150 },
  datetime: { width: 320, height: 96 },
  "section-title": { width: 300, height: 64 },
  "card-background": { width: 360, height: 220 },
  "icon-background": { width: 96, height: 96 },
  "model-3d": { width: 720, height: 460 },
  "metric-card": { width: 280, height: 150 },
  "radial-gauge": { width: 320, height: 300 },
  "progress-list": { width: 420, height: 320 },
  "status-grid": { width: 480, height: 300 },
  "ranking-list": { width: 440, height: 340 },
  "alarm-list": { width: 520, height: 360 },
  "data-table": { width: 620, height: 360 },
  "event-timeline": { width: 460, height: 360 },
  "plain-text": { width: 360, height: 84 },
  "text-link": { width: 280, height: 64 },
  image: { width: 420, height: 260 },
  carousel: { width: 520, height: 300 },
  button: { width: 200, height: 64 },
  switch: { width: 260, height: 72 },
  "checkbox-group": { width: 320, height: 170 },
  "radio-group": { width: 320, height: 170 },
  select: { width: 300, height: 82 },
};

export const minimumNodeSizes: Record<CanvasNodeType, { width: number; height: number }> = {
  "line-chart": { width: 240, height: 160 },
  "bar-chart": { width: 240, height: 160 },
  "area-chart": { width: 240, height: 160 },
  "pie-chart": { width: 240, height: 200 },
  "donut-chart": { width: 240, height: 200 },
  "radar-chart": { width: 260, height: 220 },
  rectangle: { width: 240, height: 160 },
  circle: { width: 240, height: 240 },
  "screen-title": { width: 360, height: 72 },
  "background-decoration": { width: 200, height: 72 },
  datetime: { width: 220, height: 72 },
  "section-title": { width: 160, height: 48 },
  "card-background": { width: 160, height: 100 },
  "icon-background": { width: 64, height: 64 },
  "model-3d": { width: 360, height: 240 },
  "metric-card": { width: 200, height: 120 },
  "radial-gauge": { width: 240, height: 220 },
  "progress-list": { width: 280, height: 220 },
  "status-grid": { width: 300, height: 200 },
  "ranking-list": { width: 300, height: 220 },
  "alarm-list": { width: 320, height: 220 },
  "data-table": { width: 360, height: 220 },
  "event-timeline": { width: 320, height: 240 },
  "plain-text": { width: 160, height: 48 },
  "text-link": { width: 160, height: 48 },
  image: { width: 160, height: 100 },
  carousel: { width: 240, height: 160 },
  button: { width: 120, height: 48 },
  switch: { width: 160, height: 48 },
  "checkbox-group": { width: 200, height: 96 },
  "radio-group": { width: 200, height: 96 },
  select: { width: 180, height: 64 },
};

export const isChartNodeType = (value: string): value is ChartNodeType =>
  value === "line-chart" ||
  value === "bar-chart" ||
  value === "area-chart" ||
  value === "pie-chart" ||
  value === "donut-chart" ||
  value === "radar-chart";

export const isShapeNodeType = (value: string): value is ShapeNodeType =>
  value === "rectangle" || value === "circle";

export const isDecorationNodeType = (value: string): value is DecorationNodeType =>
  value === "screen-title" ||
  value === "background-decoration" ||
  value === "datetime" ||
  value === "section-title" ||
  value === "card-background" ||
  value === "icon-background";

export const isModel3DNodeType = (value: string): value is Model3DNodeType =>
  value === "model-3d";

export const isDashboardNodeType = (value: string): value is DashboardNodeType =>
  value === "metric-card" ||
  value === "radial-gauge" ||
  value === "progress-list" ||
  value === "status-grid" ||
  value === "ranking-list" ||
  value === "alarm-list" ||
  value === "data-table" ||
  value === "event-timeline";

export const isBasicNodeType = (value: string): value is BasicNodeType =>
  value === "plain-text" ||
  value === "text-link" ||
  value === "image" ||
  value === "carousel" ||
  value === "button" ||
  value === "switch" ||
  value === "checkbox-group" ||
  value === "radio-group" ||
  value === "select";

export const isBackgroundNodeType = (value: CanvasNodeType): boolean =>
  value === "background-decoration" || value === "card-background";

export const isSquareNodeType = (value: CanvasNodeType): boolean =>
  value === "circle" || value === "icon-background";

export const createCanvasNode = (
  type: CanvasNodeType,
  x: number,
  y: number,
  zIndex: number,
): CanvasNode => {
  const size = defaultNodeSizes[type];
  const props = isChartNodeType(type)
    ? (() => {
        const defaults = chartDefaults[type];
        return { ...defaults, categories: [...defaults.categories], values: [...defaults.values] };
      })()
    : isShapeNodeType(type)
      ? { ...shapeDefaults[type] }
      : isDecorationNodeType(type)
        ? { ...decorationDefaults[type] }
        : isDashboardNodeType(type)
          ? (() => {
              const defaults = dashboardDefaults[type];
              if ("items" in defaults) {
                return { ...defaults, items: defaults.items.map((item) => ({ ...item })) };
              }
              if ("rows" in defaults) {
                return {
                  ...defaults,
                  columns: [...defaults.columns],
                  rows: defaults.rows.map((row) => [...row]),
                };
              }
              return { ...defaults };
            })()
          : isBasicNodeType(type)
            ? (() => {
                const defaults = basicDefaults[type];
                return "options" in defaults
                  ? { ...defaults, options: defaults.options.map((option) => ({ ...option })) }
                  : { ...defaults };
              })()
            : { ...model3DDefaults[type] };

  return {
    id: crypto.randomUUID(),
    type,
    x,
    y,
    width: size.width,
    height: size.height,
    zIndex,
    props,
    resourceRefs: [],
    dataBindingRefs: [],
  };
};

export const isCanvasNodeType = (value: string): value is CanvasNodeType =>
  isChartNodeType(value) ||
  isShapeNodeType(value) ||
  isDecorationNodeType(value) ||
  isModel3DNodeType(value) ||
  isDashboardNodeType(value) ||
  isBasicNodeType(value);

export type DashboardPropsResult =
  | { ok: true; value: DashboardProps }
  | { ok: false; message: string };

const parseDashboardBase = (
  props: Record<string, unknown>,
): { ok: true; value: DashboardBaseProps } | { ok: false; message: string } => {
  if (typeof props.title !== "string" || props.title.trim().length === 0 || props.title.length > 120) {
    return { ok: false, message: "title 必须是 1–120 个字符的文本" };
  }
  if (
    !isHexColor(props.textColor) ||
    !isHexColor(props.accentColor) ||
    !isHexColor(props.fillColor) ||
    !isHexColor(props.borderColor)
  ) {
    return { ok: false, message: "所有颜色字段都必须是六位十六进制颜色" };
  }
  if (typeof props.sample !== "boolean") {
    return { ok: false, message: "sample 必须是布尔值" };
  }
  return {
    ok: true,
    value: {
      title: props.title,
      textColor: props.textColor,
      accentColor: props.accentColor,
      fillColor: props.fillColor,
      borderColor: props.borderColor,
      sample: props.sample,
    },
  };
};

const parseDashboardNumber = (
  value: unknown,
  label: string,
  minimum = 0,
  maximum = 1_000_000_000,
): { ok: true; value: number } | { ok: false; message: string } => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    return { ok: false, message: `${label} 必须是 ${minimum}–${maximum} 之间的有限数值` };
  }
  return { ok: true, value };
};

export const parseDashboardProps = (
  type: DashboardNodeType,
  props: Record<string, unknown>,
): DashboardPropsResult => {
  const base = parseDashboardBase(props);
  if (!base.ok) return base;

  if (type === "metric-card") {
    if (
      typeof props.value !== "string" ||
      props.value.length > 40 ||
      typeof props.unit !== "string" ||
      props.unit.length > 24 ||
      typeof props.subtitle !== "string" ||
      props.subtitle.length > 120 ||
      typeof props.icon !== "string" ||
      props.icon.length > 4
    ) {
      return { ok: false, message: "指标值、单位、副标题或图标文本超出长度限制" };
    }
    return {
      ok: true,
      value: {
        ...base.value,
        value: props.value,
        unit: props.unit,
        subtitle: props.subtitle,
        icon: props.icon,
      },
    };
  }

  if (type === "radial-gauge") {
    const value = parseDashboardNumber(props.value, "value");
    if (!value.ok) return value;
    const maximum = parseDashboardNumber(props.maximum, "maximum", 0.000001);
    if (!maximum.ok) return maximum;
    if (value.value > maximum.value) {
      return { ok: false, message: "value 不能大于 maximum" };
    }
    if (
      typeof props.unit !== "string" ||
      props.unit.length > 24 ||
      typeof props.subtitle !== "string" ||
      props.subtitle.length > 120
    ) {
      return { ok: false, message: "unit 或 subtitle 超出长度限制" };
    }
    return {
      ok: true,
      value: {
        ...base.value,
        value: value.value,
        maximum: maximum.value,
        unit: props.unit,
        subtitle: props.subtitle,
      },
    };
  }

  if (type === "progress-list") {
    if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > 12) {
      return { ok: false, message: "items 必须包含 1–12 项进度数据" };
    }
    const items: ProgressListItem[] = [];
    for (const [index, rawItem] of props.items.entries()) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        return { ok: false, message: `items[${index}] 必须是对象` };
      }
      const item = rawItem as Record<string, unknown>;
      if (
        typeof item.label !== "string" ||
        item.label.trim().length === 0 ||
        item.label.length > 80 ||
        typeof item.unit !== "string" ||
        item.unit.length > 24
      ) {
        return { ok: false, message: `items[${index}] 的名称或单位无效` };
      }
      const value = parseDashboardNumber(item.value, `items[${index}].value`);
      if (!value.ok) return value;
      const maximum = parseDashboardNumber(item.maximum, `items[${index}].maximum`, 0.000001);
      if (!maximum.ok) return maximum;
      if (value.value > maximum.value) {
        return { ok: false, message: `items[${index}].value 不能大于 maximum` };
      }
      items.push({ label: item.label, value: value.value, maximum: maximum.value, unit: item.unit });
    }
    return { ok: true, value: { ...base.value, items } };
  }

  if (type === "status-grid") {
    if (
      typeof props.columns !== "number" ||
      !Number.isInteger(props.columns) ||
      props.columns < 1 ||
      props.columns > 6
    ) {
      return { ok: false, message: "columns 必须是 1–6 之间的整数" };
    }
    if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > 24) {
      return { ok: false, message: "items 必须包含 1–24 项状态数据" };
    }
    const items: StatusGridItem[] = [];
    for (const [index, rawItem] of props.items.entries()) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        return { ok: false, message: `items[${index}] 必须是对象` };
      }
      const item = rawItem as Record<string, unknown>;
      if (
        typeof item.label !== "string" ||
        item.label.trim().length === 0 ||
        item.label.length > 80 ||
        typeof item.value !== "string" ||
        item.value.length > 80
      ) {
        return { ok: false, message: `items[${index}] 的名称或状态值无效` };
      }
      if (
        item.tone !== "normal" &&
        item.tone !== "warning" &&
        item.tone !== "danger" &&
        item.tone !== "offline"
      ) {
        return { ok: false, message: `items[${index}].tone 不受支持` };
      }
      items.push({ label: item.label, value: item.value, tone: item.tone });
    }
    return { ok: true, value: { ...base.value, columns: props.columns, items } };
  }

  if (type === "ranking-list") {
    if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > 12) {
      return { ok: false, message: "items 必须包含 1–12 项排名数据" };
    }
    const items: RankingListItem[] = [];
    for (const [index, rawItem] of props.items.entries()) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        return { ok: false, message: `items[${index}] 必须是对象` };
      }
      const item = rawItem as Record<string, unknown>;
      if (
        typeof item.label !== "string" ||
        item.label.trim().length === 0 ||
        item.label.length > 80 ||
        typeof item.unit !== "string" ||
        item.unit.length > 24
      ) {
        return { ok: false, message: `items[${index}] 的名称或单位无效` };
      }
      const value = parseDashboardNumber(item.value, `items[${index}].value`);
      if (!value.ok) return value;
      if (item.trend !== "up" && item.trend !== "down" && item.trend !== "flat") {
        return { ok: false, message: `items[${index}].trend 不受支持` };
      }
      items.push({ label: item.label, value: value.value, unit: item.unit, trend: item.trend });
    }
    return { ok: true, value: { ...base.value, items } };
  }

  if (type === "alarm-list") {
    if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > 20) {
      return { ok: false, message: "items 必须包含 1–20 条告警" };
    }
    const items: AlarmListItem[] = [];
    for (const [index, rawItem] of props.items.entries()) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        return { ok: false, message: `items[${index}] 必须是对象` };
      }
      const item = rawItem as Record<string, unknown>;
      if (
        typeof item.time !== "string" || item.time.trim().length === 0 || item.time.length > 32 ||
        typeof item.source !== "string" || item.source.trim().length === 0 || item.source.length > 80 ||
        typeof item.message !== "string" || item.message.trim().length === 0 || item.message.length > 240
      ) {
        return { ok: false, message: `items[${index}] 的时间、来源或告警内容无效` };
      }
      if (
        item.tone !== "normal" && item.tone !== "warning" &&
        item.tone !== "danger" && item.tone !== "offline"
      ) {
        return { ok: false, message: `items[${index}].tone 不受支持` };
      }
      items.push({ time: item.time, source: item.source, message: item.message, tone: item.tone });
    }
    return { ok: true, value: { ...base.value, items } };
  }

  if (type === "data-table") {
    if (
      !Array.isArray(props.columns) ||
      props.columns.length < 2 ||
      props.columns.length > 8 ||
      !props.columns.every((column) => typeof column === "string" && column.trim().length > 0 && column.length <= 80)
    ) {
      return { ok: false, message: "columns 必须包含 2–8 个非空列名" };
    }
    if (!Array.isArray(props.rows) || props.rows.length < 1 || props.rows.length > 20) {
      return { ok: false, message: "rows 必须包含 1–20 行数据" };
    }
    const rows: string[][] = [];
    for (const [rowIndex, rawRow] of props.rows.entries()) {
      if (
        !Array.isArray(rawRow) || rawRow.length !== props.columns.length ||
        !rawRow.every((cell) => typeof cell === "string" && cell.length <= 120)
      ) {
        return { ok: false, message: `rows[${rowIndex}] 必须与列数一致，单元格不超过 120 个字符` };
      }
      rows.push([...rawRow] as string[]);
    }
    if (
      typeof props.highlightColumn !== "number" ||
      !Number.isInteger(props.highlightColumn) ||
      props.highlightColumn < -1 ||
      props.highlightColumn >= props.columns.length
    ) {
      return { ok: false, message: "highlightColumn 必须是 -1 或有效列下标" };
    }
    return {
      ok: true,
      value: {
        ...base.value,
        columns: [...props.columns] as string[],
        rows,
        highlightColumn: props.highlightColumn,
      },
    };
  }

  if (type === "event-timeline") {
    if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > 20) {
      return { ok: false, message: "items 必须包含 1–20 条事件" };
    }
    const items: TimelineItem[] = [];
    for (const [index, rawItem] of props.items.entries()) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        return { ok: false, message: `items[${index}] 必须是对象` };
      }
      const item = rawItem as Record<string, unknown>;
      if (
        typeof item.time !== "string" || item.time.trim().length === 0 || item.time.length > 32 ||
        typeof item.title !== "string" || item.title.trim().length === 0 || item.title.length > 120 ||
        typeof item.detail !== "string" || item.detail.length > 240
      ) {
        return { ok: false, message: `items[${index}] 的时间、标题或详情无效` };
      }
      if (
        item.tone !== "normal" && item.tone !== "warning" &&
        item.tone !== "danger" && item.tone !== "offline"
      ) {
        return { ok: false, message: `items[${index}].tone 不受支持` };
      }
      items.push({ time: item.time, title: item.title, detail: item.detail, tone: item.tone });
    }
    return { ok: true, value: { ...base.value, items } };
  }

  return { ok: false, message: `不支持的看板组件类型：${type}` };
};

export type ChartPropsResult =
  | { ok: true; value: ChartProps }
  | { ok: false; message: string };

export const parseChartProps = (
  type: ChartNodeType,
  props: Record<string, unknown>,
): ChartPropsResult => {
  if (typeof props.title !== "string" || props.title.trim().length === 0 || props.title.length > 120) {
    return { ok: false, message: "title 必须是 1–120 个字符的文本" };
  }

  if (!Array.isArray(props.categories) || !props.categories.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 80)) {
    return { ok: false, message: "categories 必须是非空文本数组，单项不超过 80 个字符" };
  }

  if (!Array.isArray(props.values) || !props.values.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return { ok: false, message: "values 必须是有限数值数组" };
  }

  const minimumPoints = type === "radar-chart" ? 3 : 2;
  if (
    props.categories.length !== props.values.length ||
    props.values.length < minimumPoints ||
    props.values.length > 32
  ) {
    return {
      ok: false,
      message: `categories 与 values 数量必须一致，且包含 ${minimumPoints}–32 项`,
    };
  }

  if (
    (type === "pie-chart" || type === "donut-chart" || type === "radar-chart") &&
    props.values.some((value) => value < 0)
  ) {
    return { ok: false, message: `${componentLabels[type]}的数据不能为负数` };
  }

  if (
    (type === "pie-chart" || type === "donut-chart") &&
    props.values.every((value) => value === 0)
  ) {
    return { ok: false, message: `${componentLabels[type]}的数据总和必须大于 0` };
  }

  if (typeof props.unit !== "string" || props.unit.length > 24 || typeof props.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(props.color)) {
    return { ok: false, message: "unit 必须不超过 24 个字符，color 必须是六位十六进制颜色" };
  }

  return {
    ok: true,
    value: {
      title: props.title,
      categories: props.categories,
      values: props.values,
      unit: props.unit,
      color: props.color,
    },
  };
};

export type ShapePropsResult =
  | { ok: true; value: ShapeProps }
  | { ok: false; message: string };

export const parseShapeProps = (props: Record<string, unknown>): ShapePropsResult => {
  if (typeof props.fillColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(props.fillColor)) {
    return { ok: false, message: "fillColor 必须是六位十六进制颜色" };
  }
  if (typeof props.borderColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(props.borderColor)) {
    return { ok: false, message: "borderColor 必须是六位十六进制颜色" };
  }
  if (typeof props.borderWidth !== "number" || !Number.isFinite(props.borderWidth) || props.borderWidth < 0 || props.borderWidth > 20) {
    return { ok: false, message: "borderWidth 必须是 0–20 之间的数值" };
  }
  if (typeof props.borderRadius !== "number" || !Number.isFinite(props.borderRadius) || props.borderRadius < 0 || props.borderRadius > 200) {
    return { ok: false, message: "borderRadius 必须是 0–200 之间的数值" };
  }
  if (typeof props.opacity !== "number" || !Number.isFinite(props.opacity) || props.opacity < 0.05 || props.opacity > 1) {
    return { ok: false, message: "opacity 必须是 0.05–1 之间的数值" };
  }

  return {
    ok: true,
    value: {
      fillColor: props.fillColor,
      borderColor: props.borderColor,
      borderWidth: props.borderWidth,
      borderRadius: props.borderRadius,
      opacity: props.opacity,
    },
  };
};

export type DecorationPropsResult =
  | { ok: true; value: DecorationProps }
  | { ok: false; message: string };

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

export const parseDecorationProps = (
  type: DecorationNodeType,
  props: Record<string, unknown>,
): DecorationPropsResult => {
  if (typeof props.text !== "string" || props.text.length > 120) {
    return { ok: false, message: "text 必须是不超过 120 个字符的文本" };
  }
  if (
    type !== "background-decoration" &&
    type !== "card-background" &&
    props.text.trim().length === 0
  ) {
    return { ok: false, message: "当前组件的 text 不能为空" };
  }
  if (type === "icon-background" && props.text.length > 4) {
    return { ok: false, message: "小图标背景的文字最多 4 个字符" };
  }
  if (typeof props.subtitle !== "string" || props.subtitle.length > 160) {
    return { ok: false, message: "subtitle 必须是不超过 160 个字符的文本" };
  }
  if (
    !isHexColor(props.textColor) ||
    !isHexColor(props.accentColor) ||
    !isHexColor(props.fillColor) ||
    !isHexColor(props.borderColor)
  ) {
    return { ok: false, message: "所有颜色字段都必须是六位十六进制颜色" };
  }
  if (
    typeof props.opacity !== "number" ||
    !Number.isFinite(props.opacity) ||
    props.opacity < 0.05 ||
    props.opacity > 1
  ) {
    return { ok: false, message: "opacity 必须是 0.05–1 之间的数值" };
  }
  if (props.align !== "left" && props.align !== "center" && props.align !== "right") {
    return { ok: false, message: "align 必须是 left、center 或 right" };
  }
  if (typeof props.showDate !== "boolean" || typeof props.showSeconds !== "boolean") {
    return { ok: false, message: "showDate 与 showSeconds 必须是布尔值" };
  }

  return {
    ok: true,
    value: {
      text: props.text,
      subtitle: props.subtitle,
      textColor: props.textColor,
      accentColor: props.accentColor,
      fillColor: props.fillColor,
      borderColor: props.borderColor,
      opacity: props.opacity,
      align: props.align,
      showDate: props.showDate,
      showSeconds: props.showSeconds,
    },
  };
};

export type BasicPropsResult =
  | { ok: true; value: BasicProps }
  | { ok: false; message: string };

const parseBasicAppearance = (
  props: Record<string, unknown>,
): { ok: true; value: BasicAppearanceProps } | { ok: false; message: string } => {
  if (
    !isHexColor(props.textColor) ||
    !isHexColor(props.accentColor) ||
    !isHexColor(props.fillColor) ||
    !isHexColor(props.borderColor)
  ) {
    return { ok: false, message: "所有颜色字段都必须是六位十六进制颜色" };
  }
  if (
    typeof props.borderRadius !== "number" ||
    !Number.isFinite(props.borderRadius) ||
    props.borderRadius < 0 ||
    props.borderRadius > 100
  ) {
    return { ok: false, message: "borderRadius 必须是 0–100 之间的数值" };
  }
  return {
    ok: true,
    value: {
      textColor: props.textColor,
      accentColor: props.accentColor,
      fillColor: props.fillColor,
      borderColor: props.borderColor,
      borderRadius: props.borderRadius,
    },
  };
};

const parseBasicTextStyle = (
  props: Record<string, unknown>,
): { ok: true; value: { fontSize: number; fontWeight: number } } | { ok: false; message: string } => {
  if (
    typeof props.fontSize !== "number" ||
    !Number.isFinite(props.fontSize) ||
    props.fontSize < 10 ||
    props.fontSize > 120
  ) {
    return { ok: false, message: "fontSize 必须是 10–120 之间的数值" };
  }
  if (
    typeof props.fontWeight !== "number" ||
    !Number.isInteger(props.fontWeight) ||
    props.fontWeight < 100 ||
    props.fontWeight > 900
  ) {
    return { ok: false, message: "fontWeight 必须是 100–900 之间的整数" };
  }
  return { ok: true, value: { fontSize: props.fontSize, fontWeight: props.fontWeight } };
};

const isSafeHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const parseBasicOptions = (
  value: unknown,
): { ok: true; value: BasicOption[] } | { ok: false; message: string } => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) {
    return { ok: false, message: "options 必须包含 1–24 个选项" };
  }
  const options: BasicOption[] = [];
  const values = new Set<string>();
  for (const [index, rawOption] of value.entries()) {
    if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
      return { ok: false, message: `options[${index}] 必须是对象` };
    }
    const option = rawOption as Record<string, unknown>;
    if (
      typeof option.label !== "string" ||
      option.label.trim().length === 0 ||
      option.label.length > 80 ||
      typeof option.value !== "string" ||
      option.value.trim().length === 0 ||
      option.value.length > 80
    ) {
      return { ok: false, message: `options[${index}] 的名称和值必须是 1–80 个字符` };
    }
    if (values.has(option.value)) {
      return { ok: false, message: `options[${index}].value 不能重复` };
    }
    values.add(option.value);
    options.push({ label: option.label, value: option.value });
  }
  return { ok: true, value: options };
};

export const parseBasicProps = (
  type: BasicNodeType,
  props: Record<string, unknown>,
): BasicPropsResult => {
  if (type === "image" || type === "carousel") {
    if (
      typeof props.alt !== "string" ||
      props.alt.length > 160 ||
      (props.fit !== "contain" && props.fit !== "cover" && props.fit !== "fill") ||
      !isHexColor(props.backgroundColor) ||
      !isHexColor(props.borderColor) ||
      typeof props.borderRadius !== "number" ||
      !Number.isFinite(props.borderRadius) ||
      props.borderRadius < 0 ||
      props.borderRadius > 100
    ) {
      return { ok: false, message: "图片替代文字、填充方式、颜色或圆角配置无效" };
    }
    const imageProps: ImageProps = {
      alt: props.alt,
      fit: props.fit,
      backgroundColor: props.backgroundColor,
      borderColor: props.borderColor,
      borderRadius: props.borderRadius,
    };
    if (type === "image") return { ok: true, value: imageProps };
    if (
      typeof props.autoplay !== "boolean" ||
      typeof props.interval !== "number" ||
      !Number.isFinite(props.interval) ||
      props.interval < 2 ||
      props.interval > 60 ||
      typeof props.showArrows !== "boolean" ||
      typeof props.showDots !== "boolean"
    ) {
      return { ok: false, message: "轮播图自动播放、间隔或指示器配置无效" };
    }
    return {
      ok: true,
      value: {
        ...imageProps,
        autoplay: props.autoplay,
        interval: props.interval,
        showArrows: props.showArrows,
        showDots: props.showDots,
      },
    };
  }

  const appearance = parseBasicAppearance(props);
  if (!appearance.ok) return appearance;

  if (type === "plain-text" || type === "text-link" || type === "button") {
    const textStyle = parseBasicTextStyle(props);
    if (!textStyle.ok) return textStyle;
    if (
      typeof props.text !== "string" ||
      props.text.trim().length === 0 ||
      props.text.length > (type === "plain-text" ? 1000 : 120)
    ) {
      return { ok: false, message: "text 不能为空且长度不能超过当前组件限制" };
    }
    if (type === "plain-text") {
      if (
        (props.align !== "left" && props.align !== "center" && props.align !== "right") ||
        (props.scrollMode !== "none" && props.scrollMode !== "horizontal" && props.scrollMode !== "vertical") ||
        typeof props.scrollDuration !== "number" ||
        !Number.isFinite(props.scrollDuration) ||
        props.scrollDuration < 3 ||
        props.scrollDuration > 120
      ) {
        return { ok: false, message: "文本对齐、滚动方向或滚动时长配置无效" };
      }
      return {
        ok: true,
        value: {
          ...appearance.value,
          ...textStyle.value,
          text: props.text,
          align: props.align,
          scrollMode: props.scrollMode,
          scrollDuration: props.scrollDuration,
        },
      };
    }
    if (
      typeof props.href !== "string" ||
      props.href.length > 2048 ||
      (type === "text-link" && !isSafeHttpUrl(props.href)) ||
      (type === "button" && props.href.length > 0 && !isSafeHttpUrl(props.href)) ||
      typeof props.openInNewTab !== "boolean"
    ) {
      return { ok: false, message: "链接必须是有效的 http 或 https 地址" };
    }
    if (type === "text-link") {
      if (
        (props.align !== "left" && props.align !== "center" && props.align !== "right") ||
        typeof props.underline !== "boolean"
      ) {
        return { ok: false, message: "链接的对齐或下划线配置无效" };
      }
      return {
        ok: true,
        value: {
          ...appearance.value,
          ...textStyle.value,
          text: props.text,
          href: props.href,
          align: props.align,
          openInNewTab: props.openInNewTab,
          underline: props.underline,
        },
      };
    }
    if (typeof props.disabled !== "boolean") {
      return { ok: false, message: "disabled 必须是布尔值" };
    }
    return {
      ok: true,
      value: {
        ...appearance.value,
        ...textStyle.value,
        text: props.text,
        href: props.href,
        openInNewTab: props.openInNewTab,
        disabled: props.disabled,
      },
    };
  }

  if (type === "switch") {
    if (
      typeof props.label !== "string" ||
      props.label.length > 120 ||
      typeof props.defaultChecked !== "boolean" ||
      typeof props.onText !== "string" ||
      props.onText.length > 24 ||
      typeof props.offText !== "string" ||
      props.offText.length > 24
    ) {
      return { ok: false, message: "Switch 的标签、默认状态或状态文字配置无效" };
    }
    return {
      ok: true,
      value: {
        ...appearance.value,
        label: props.label,
        defaultChecked: props.defaultChecked,
        onText: props.onText,
        offText: props.offText,
      },
    };
  }

  const options = parseBasicOptions(props.options);
  if (!options.ok) return options;
  const optionValues = new Set(options.value.map((option) => option.value));

  if (type === "checkbox-group") {
    if (
      !Array.isArray(props.selectedValues) ||
      !props.selectedValues.every((value) => typeof value === "string" && optionValues.has(value)) ||
      new Set(props.selectedValues).size !== props.selectedValues.length
    ) {
      return { ok: false, message: "selectedValues 必须是不重复且存在于 options 中的值" };
    }
    if (
      typeof props.title !== "string" ||
      props.title.length > 120 ||
      typeof props.columns !== "number" ||
      !Number.isInteger(props.columns) ||
      props.columns < 1 ||
      props.columns > 4
    ) {
      return { ok: false, message: "多选框标题或列数配置无效" };
    }
    return {
      ok: true,
      value: {
        ...appearance.value,
        title: props.title,
        options: options.value,
        selectedValues: props.selectedValues as string[],
        columns: props.columns,
      },
    };
  }

  if (
    typeof props.selectedValue !== "string" ||
    (props.selectedValue.length > 0 && !optionValues.has(props.selectedValue))
  ) {
    return { ok: false, message: "selectedValue 必须为空或存在于 options 中" };
  }
  if (type === "radio-group") {
    if (
      typeof props.title !== "string" ||
      props.title.length > 120 ||
      typeof props.columns !== "number" ||
      !Number.isInteger(props.columns) ||
      props.columns < 1 ||
      props.columns > 4
    ) {
      return { ok: false, message: "单选框标题或列数配置无效" };
    }
    return {
      ok: true,
      value: {
        ...appearance.value,
        title: props.title,
        options: options.value,
        selectedValue: props.selectedValue,
        columns: props.columns,
      },
    };
  }
  if (
    typeof props.label !== "string" ||
    props.label.length > 120 ||
    typeof props.placeholder !== "string" ||
    props.placeholder.length > 80
  ) {
    return { ok: false, message: "下拉菜单标签或占位文字配置无效" };
  }
  return {
    ok: true,
    value: {
      ...appearance.value,
      label: props.label,
      placeholder: props.placeholder,
      options: options.value,
      selectedValue: props.selectedValue,
    },
  };
};

export type Model3DPropsResult =
  | { ok: true; value: Model3DProps }
  | { ok: false; message: string };

const MAX_MODEL_NODE_TRANSFORMS = 100;
const MAX_MODEL_NODE_APPEARANCES = 100;

const parseVector3Tuple = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): { ok: true; value: Vector3Tuple } | { ok: false; message: string } => {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((item) =>
      typeof item !== "number"
      || !Number.isFinite(item)
      || item < minimum
      || item > maximum)
  ) {
    return {
      ok: false,
      message: `${label} 必须包含 3 个 ${minimum}–${maximum} 之间的有限数值`,
    };
  }
  return { ok: true, value: [value[0], value[1], value[2]] };
};

const parseTransformOverrides = (
  value: unknown,
): { ok: true; value: Record<string, ModelNodeTransform> } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, value: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "transformOverrides 必须是对象" };
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_MODEL_NODE_TRANSFORMS) {
    return {
      ok: false,
      message: `单个 3D 组件最多保存 ${MAX_MODEL_NODE_TRANSFORMS} 个节点变换`,
    };
  }

  const result: Record<string, ModelNodeTransform> = {};
  for (const [nodeName, rawTransform] of entries) {
    if (nodeName.length === 0 || nodeName.length > 240 || nodeName !== nodeName.trim()) {
      return { ok: false, message: "模型节点名必须为 1–240 个字符且首尾不能有空格" };
    }
    if (!rawTransform || typeof rawTransform !== "object" || Array.isArray(rawTransform)) {
      return { ok: false, message: `节点 ${nodeName} 的变换配置必须是对象` };
    }
    const transform = rawTransform as Record<string, unknown>;
    const position = parseVector3Tuple(
      transform.position,
      `${nodeName}.position`,
      -1_000_000,
      1_000_000,
    );
    if (!position.ok) return position;
    const rotation = parseVector3Tuple(
      transform.rotation,
      `${nodeName}.rotation`,
      -3_600,
      3_600,
    );
    if (!rotation.ok) return rotation;
    const scale = parseVector3Tuple(
      transform.scale,
      `${nodeName}.scale`,
      0.001,
      1_000,
    );
    if (!scale.ok) return scale;

    result[nodeName] = {
      position: position.value,
      rotation: rotation.value,
      scale: scale.value,
    };
  }
  return { ok: true, value: result };
};

const parseAppearanceOverrides = (
  value: unknown,
): { ok: true; value: Record<string, ModelNodeAppearance> } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, value: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "appearanceOverrides 必须是对象" };
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_MODEL_NODE_APPEARANCES) {
    return {
      ok: false,
      message: `单个 3D 组件最多保存 ${MAX_MODEL_NODE_APPEARANCES} 个节点外观`,
    };
  }

  const result: Record<string, ModelNodeAppearance> = {};
  for (const [nodeName, rawAppearance] of entries) {
    if (nodeName.length === 0 || nodeName.length > 240 || nodeName !== nodeName.trim()) {
      return { ok: false, message: "模型节点名必须为 1–240 个字符且首尾不能有空格" };
    }
    if (!rawAppearance || typeof rawAppearance !== "object" || Array.isArray(rawAppearance)) {
      return { ok: false, message: `节点 ${nodeName} 的外观配置必须是对象` };
    }
    const appearance = rawAppearance as Record<string, unknown>;
    if (!isHexColor(appearance.color)) {
      return { ok: false, message: `${nodeName}.color 必须是六位十六进制颜色` };
    }
    if (
      typeof appearance.opacity !== "number"
      || !Number.isFinite(appearance.opacity)
      || appearance.opacity < 0
      || appearance.opacity > 1
    ) {
      return { ok: false, message: `${nodeName}.opacity 必须是 0–1 之间的数值` };
    }
    if (typeof appearance.visible !== "boolean") {
      return { ok: false, message: `${nodeName}.visible 必须是布尔值` };
    }
    result[nodeName] = {
      color: appearance.color,
      opacity: appearance.opacity,
      visible: appearance.visible,
    };
  }
  return { ok: true, value: result };
};

export const parseModel3DProps = (props: Record<string, unknown>): Model3DPropsResult => {
  if (!isHexColor(props.backgroundColor)) {
    return { ok: false, message: "backgroundColor 必须是六位十六进制颜色" };
  }
  const backgroundOpacity = props.backgroundOpacity === undefined ? 1 : props.backgroundOpacity;
  if (
    typeof backgroundOpacity !== "number"
    || !Number.isFinite(backgroundOpacity)
    || backgroundOpacity < 0
    || backgroundOpacity > 1
  ) {
    return { ok: false, message: "backgroundOpacity 必须是 0–1 之间的数值" };
  }
  const environmentLightColor = props.environmentLightColor === undefined
    ? "#daf4ff"
    : props.environmentLightColor;
  if (!isHexColor(environmentLightColor)) {
    return { ok: false, message: "environmentLightColor 必须是六位十六进制颜色" };
  }
  const environmentLightIntensity = props.environmentLightIntensity === undefined
    ? 2.1
    : props.environmentLightIntensity;
  if (
    typeof environmentLightIntensity !== "number"
    || !Number.isFinite(environmentLightIntensity)
    || environmentLightIntensity < 0
    || environmentLightIntensity > 10
  ) {
    return { ok: false, message: "environmentLightIntensity 必须是 0–10 之间的数值" };
  }
  const keyLightColor = props.keyLightColor === undefined ? "#ffffff" : props.keyLightColor;
  if (!isHexColor(keyLightColor)) {
    return { ok: false, message: "keyLightColor 必须是六位十六进制颜色" };
  }
  const keyLightIntensity = props.keyLightIntensity === undefined
    ? 2.4
    : props.keyLightIntensity;
  if (
    typeof keyLightIntensity !== "number"
    || !Number.isFinite(keyLightIntensity)
    || keyLightIntensity < 0
    || keyLightIntensity > 10
  ) {
    return { ok: false, message: "keyLightIntensity 必须是 0–10 之间的数值" };
  }
  const cameraFov = props.cameraFov === undefined ? 42 : props.cameraFov;
  if (
    typeof cameraFov !== "number"
    || !Number.isFinite(cameraFov)
    || cameraFov < 15
    || cameraFov > 90
  ) {
    return { ok: false, message: "cameraFov 必须是 15–90 之间的数值" };
  }
  const cameraView = props.cameraView === undefined ? "isometric" : props.cameraView;
  if (cameraView !== "isometric" && cameraView !== "front" && cameraView !== "top") {
    return { ok: false, message: "cameraView 必须是 isometric、front 或 top" };
  }
  if (typeof props.autoRotate !== "boolean" || typeof props.showGrid !== "boolean") {
    return { ok: false, message: "autoRotate 与 showGrid 必须是布尔值" };
  }
  if (
    typeof props.rotationSpeed !== "number" ||
    !Number.isFinite(props.rotationSpeed) ||
    props.rotationSpeed < 0 ||
    props.rotationSpeed > 5
  ) {
    return { ok: false, message: "rotationSpeed 必须是 0–5 之间的数值" };
  }
  const transformOverrides = parseTransformOverrides(props.transformOverrides);
  if (!transformOverrides.ok) return transformOverrides;
  const appearanceOverrides = parseAppearanceOverrides(props.appearanceOverrides);
  if (!appearanceOverrides.ok) return appearanceOverrides;

  return {
    ok: true,
    value: {
      backgroundColor: props.backgroundColor,
      backgroundOpacity,
      environmentLightColor,
      environmentLightIntensity,
      keyLightColor,
      keyLightIntensity,
      cameraFov,
      cameraView,
      autoRotate: props.autoRotate,
      rotationSpeed: props.rotationSpeed,
      showGrid: props.showGrid,
      appearanceOverrides: appearanceOverrides.value,
      transformOverrides: transformOverrides.value,
    },
  };
};
