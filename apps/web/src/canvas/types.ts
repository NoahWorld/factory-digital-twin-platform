export const CANVAS_DRAG_TYPE = "application/x-factory-twin-component";

export type CanvasNodeType = "line-chart" | "bar-chart";

export type ChartProps = {
  title: string;
  categories: string[];
  values: number[];
  unit: string;
  color: string;
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

const paletteDefaults: Record<CanvasNodeType, ChartProps> = {
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

export const componentLabels: Record<CanvasNodeType, string> = {
  "line-chart": "折线图",
  "bar-chart": "柱状图",
};

export const createCanvasNode = (
  type: CanvasNodeType,
  x: number,
  y: number,
  zIndex: number,
): CanvasNode => {
  const defaults = paletteDefaults[type];
  return {
    id: crypto.randomUUID(),
    type,
    x,
    y,
    width: 520,
    height: 300,
    zIndex,
    props: { ...defaults, categories: [...defaults.categories], values: [...defaults.values] },
    resourceRefs: [],
    dataBindingRefs: [],
  };
};

export const isCanvasNodeType = (value: string): value is CanvasNodeType =>
  value === "line-chart" || value === "bar-chart";

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
