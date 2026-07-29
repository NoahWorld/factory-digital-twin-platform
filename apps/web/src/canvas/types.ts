export const CANVAS_DRAG_TYPE = "application/x-factory-twin-component";

export type ChartNodeType = "line-chart" | "bar-chart";
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
  | "status-grid";
export type CanvasNodeType =
  | ChartNodeType
  | ShapeNodeType
  | DecorationNodeType
  | Model3DNodeType
  | DashboardNodeType;

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

export type DashboardProps =
  | MetricCardProps
  | RadialGaugeProps
  | ProgressListProps
  | StatusGridProps;

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
  backgroundColor: string;
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
};

export const componentLabels: Record<CanvasNodeType, string> = {
  "line-chart": "折线图",
  "bar-chart": "柱状图",
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
};

export const defaultNodeSizes: Record<CanvasNodeType, { width: number; height: number }> = {
  "line-chart": { width: 520, height: 300 },
  "bar-chart": { width: 520, height: 300 },
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
};

export const minimumNodeSizes: Record<CanvasNodeType, { width: number; height: number }> = {
  "line-chart": { width: 240, height: 160 },
  "bar-chart": { width: 240, height: 160 },
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
};

export const isChartNodeType = (value: string): value is ChartNodeType =>
  value === "line-chart" || value === "bar-chart";

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
  value === "status-grid";

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
              return "items" in defaults
                ? { ...defaults, items: defaults.items.map((item) => ({ ...item })) }
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
  isDashboardNodeType(value);

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
};

export type ChartPropsResult =
  | { ok: true; value: ChartProps }
  | { ok: false; message: string };

export const parseChartProps = (props: Record<string, unknown>): ChartPropsResult => {
  if (typeof props.title !== "string" || props.title.trim().length === 0 || props.title.length > 120) {
    return { ok: false, message: "title 必须是 1–120 个字符的文本" };
  }

  if (!Array.isArray(props.categories) || !props.categories.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 80)) {
    return { ok: false, message: "categories 必须是非空文本数组，单项不超过 80 个字符" };
  }

  if (!Array.isArray(props.values) || !props.values.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return { ok: false, message: "values 必须是有限数值数组" };
  }

  if (props.categories.length !== props.values.length || props.values.length < 2) {
    return { ok: false, message: "categories 与 values 数量必须一致，且至少包含 2 项" };
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
