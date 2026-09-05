import { AppError, type AppEnv, type DatabaseResult } from "./auth";

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
export type PanelFrameNodeType = "panel-frame";
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
export type Model3DNodeType = "model-3d";
export type CanvasNodeType =
  | ChartNodeType
  | ShapeNodeType
  | DecorationNodeType
  | PanelFrameNodeType
  | DashboardNodeType
  | BasicNodeType
  | Model3DNodeType;

export type CanvasThemeMode = "dark" | "light" | "custom";
export type CanvasThemePresetId =
  | "deep-blue"
  | "steel-orange"
  | "energy-green"
  | "command-gold"
  | "light-industrial"
  | "custom";
export type CanvasBackgroundPattern = "none" | "grid" | "dots" | "circuit";
export type CanvasFontFamily = "system" | "industrial" | "data";

export type CanvasTheme = {
  mode: CanvasThemeMode;
  presetId: CanvasThemePresetId;
  backgroundPattern: CanvasBackgroundPattern;
  fontFamily: CanvasFontFamily;
  glowIntensity: number;
  panelRadius: number;
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

export type DecorationProps = {
  text: string;
  subtitle: string;
  textColor: string;
  accentColor: string;
  fillColor: string;
  borderColor: string;
  opacity: number;
  align: "left" | "center" | "right";
  showDate: boolean;
  showSeconds: boolean;
};

export type PanelFrameStyle = "outline" | "corners" | "cut" | "glass" | "neon";

export type PanelFrameProps = {
  title: string;
  subtitle: string;
  showHeader: boolean;
  style: PanelFrameStyle;
  textColor: string;
  accentColor: string;
  fillColor: string;
  borderColor: string;
  opacity: number;
  glowStrength: number;
  headerHeight: number;
  cornerSize: number;
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

export type RankingListItem = {
  label: string;
  value: number;
  unit: string;
  trend: "up" | "down" | "flat";
};

export type RankingListProps = DashboardBaseProps & { items: RankingListItem[] };

export type AlarmListItem = {
  time: string;
  source: string;
  message: string;
  tone: DashboardTone;
};

export type AlarmListProps = DashboardBaseProps & { items: AlarmListItem[] };

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

export type EventTimelineProps = DashboardBaseProps & { items: TimelineItem[] };

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
  align: "left" | "center" | "right";
  fontSize: number;
  fontWeight: number;
  scrollMode: "none" | "horizontal" | "vertical";
  scrollDuration: number;
};

export type TextLinkProps = BasicAppearanceProps & {
  text: string;
  href: string;
  align: "left" | "center" | "right";
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
  props: ChartProps | ShapeProps | DecorationProps | PanelFrameProps | DashboardProps | BasicProps | Model3DProps;
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

export type CanvasPatch = {
  expectedRevision: number;
  theme?: CanvasTheme;
  upsertNodes: CanvasNode[];
  deleteNodeIds: string[];
};

type CanvasRow = {
  project_id: string;
  width: number;
  height: number;
  background_color: string;
  theme_mode: CanvasThemeMode;
  theme_preset_id: CanvasThemePresetId;
  theme_background_pattern: CanvasBackgroundPattern;
  theme_font_family: CanvasFontFamily;
  theme_glow_intensity: number;
  theme_panel_radius: number;
  theme_surface_color: string;
  theme_text_color: string;
  theme_accent_color: string;
  theme_border_color: string;
  revision: number;
  updated_at: string;
};

type CanvasNodeRow = {
  id: string;
  node_type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  props_json: string;
  resource_refs_json: string;
  data_binding_refs_json: string;
};

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_THEME: CanvasTheme = {
  mode: "dark",
  presetId: "deep-blue",
  backgroundPattern: "circuit",
  fontFamily: "industrial",
  glowIntensity: 0.65,
  panelRadius: 6,
  backgroundColor: "#04131f",
  surfaceColor: "#08273b",
  textColor: "#e9f8ff",
  accentColor: "#55d8ff",
  borderColor: "#276f8d",
};
const MAX_PATCH_NODES = 100;
const MAX_POINTS = 32;
const MAX_PROPS_BYTES = 16 * 1024;
const MAX_MODEL_NODE_TRANSFORMS = 100;
const MAX_MODEL_NODE_APPEARANCES = 100;
const MAX_PROGRESS_ITEMS = 12;
const MAX_STATUS_ITEMS = 24;
const MAX_STREAM_ITEMS = 20;
const MAX_TABLE_COLUMNS = 8;
const MAX_TABLE_ROWS = 20;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const encoder = new TextEncoder();
const minimumNodeSizes: Record<CanvasNodeType, { width: number; height: number }> = {
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
  "panel-frame": { width: 260, height: 180 },
  "metric-card": { width: 200, height: 120 },
  "radial-gauge": { width: 240, height: 220 },
  "progress-list": { width: 280, height: 220 },
  "status-grid": { width: 300, height: 200 },
  "ranking-list": { width: 300, height: 220 },
  "alarm-list": { width: 320, height: 220 },
  "data-table": { width: 360, height: 220 },
  "event-timeline": { width: 320, height: 240 },
  "model-3d": { width: 360, height: 240 },
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

const invalid = (code: string, message: string): never => {
  throw new AppError(400, code, message);
};

const requireObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("invalid_canvas_patch", `${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
};

const requireNumber = (value: unknown, label: string, minimum: number, maximum: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid("invalid_canvas_node", `${label} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value as number;
};

const requireIdentifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    invalid("invalid_canvas_node", `${label} must be a stable identifier of at most 120 characters.`);
  }
  return value as string;
};

const requireString = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== "string" || value.length > maximum) {
    invalid("invalid_canvas_node", `${label} must be a string of at most ${maximum} characters.`);
  }
  return value as string;
};

const requireNonEmptyString = (value: unknown, label: string, maximum: number): string => {
  const text = requireString(value, label, maximum);
  if (text.trim().length === 0) {
    invalid("invalid_canvas_node", `${label} must not be empty.`);
  }
  return text;
};

const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    invalid("invalid_canvas_node", `${label} must be a boolean.`);
  }
  return value as boolean;
};

const requireColor = (value: unknown, label: string): string => {
  const color = requireString(value, label, 7);
  if (!colorPattern.test(color)) {
    invalid("invalid_canvas_node", `${label} must be a six-digit hexadecimal color.`);
  }
  return color;
};

const validateCanvasTheme = (value: unknown): CanvasTheme => {
  const theme = requireObject(value, "theme");
  if (theme.mode !== "dark" && theme.mode !== "light" && theme.mode !== "custom") {
    invalid("invalid_canvas_theme", "theme.mode must be dark, light, or custom.");
  }
  if (
    theme.presetId !== "deep-blue" &&
    theme.presetId !== "steel-orange" &&
    theme.presetId !== "energy-green" &&
    theme.presetId !== "command-gold" &&
    theme.presetId !== "light-industrial" &&
    theme.presetId !== "custom"
  ) {
    invalid("invalid_canvas_theme", "theme.presetId is not a supported theme preset.");
  }
  if (
    theme.backgroundPattern !== "none" &&
    theme.backgroundPattern !== "grid" &&
    theme.backgroundPattern !== "dots" &&
    theme.backgroundPattern !== "circuit"
  ) {
    invalid("invalid_canvas_theme", "theme.backgroundPattern must be none, grid, dots, or circuit.");
  }
  if (theme.fontFamily !== "system" && theme.fontFamily !== "industrial" && theme.fontFamily !== "data") {
    invalid("invalid_canvas_theme", "theme.fontFamily must be system, industrial, or data.");
  }
  const requireThemeColor = (color: unknown, label: string): string => {
    if (typeof color !== "string" || !colorPattern.test(color)) {
      invalid("invalid_canvas_theme", `${label} must be a six-digit hexadecimal color.`);
    }
    return color as string;
  };
  const requireThemeNumber = (number: unknown, label: string, minimum: number, maximum: number): number => {
    if (typeof number !== "number" || !Number.isFinite(number) || number < minimum || number > maximum) {
      invalid("invalid_canvas_theme", `${label} must be a finite number between ${minimum} and ${maximum}.`);
    }
    return number as number;
  };
  return {
    mode: theme.mode as CanvasThemeMode,
    presetId: theme.presetId as CanvasThemePresetId,
    backgroundPattern: theme.backgroundPattern as CanvasBackgroundPattern,
    fontFamily: theme.fontFamily as CanvasFontFamily,
    glowIntensity: requireThemeNumber(theme.glowIntensity, "theme.glowIntensity", 0, 1),
    panelRadius: requireThemeNumber(theme.panelRadius, "theme.panelRadius", 0, 24),
    backgroundColor: requireThemeColor(theme.backgroundColor, "theme.backgroundColor"),
    surfaceColor: requireThemeColor(theme.surfaceColor, "theme.surfaceColor"),
    textColor: requireThemeColor(theme.textColor, "theme.textColor"),
    accentColor: requireThemeColor(theme.accentColor, "theme.accentColor"),
    borderColor: requireThemeColor(theme.borderColor, "theme.borderColor"),
  };
};

const presentStoredTheme = (row: CanvasRow): CanvasTheme => {
  try {
    return validateCanvasTheme({
      mode: row.theme_mode,
      presetId: row.theme_preset_id,
      backgroundPattern: row.theme_background_pattern,
      fontFamily: row.theme_font_family,
      glowIntensity: row.theme_glow_intensity,
      panelRadius: row.theme_panel_radius,
      backgroundColor: row.background_color,
      surfaceColor: row.theme_surface_color,
      textColor: row.theme_text_color,
      accentColor: row.theme_accent_color,
      borderColor: row.theme_border_color,
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 400) {
      throw new AppError(
        500,
        "invalid_canvas_storage",
        `Stored canvas ${row.project_id} has an invalid theme: ${error.message}`,
      );
    }
    throw error;
  }
};

const requireModelCameraView = (
  value: unknown,
  label: string,
): ModelCameraView => {
  if (value !== "isometric" && value !== "front" && value !== "top") {
    invalid("invalid_canvas_node", `${label} must be isometric, front, or top.`);
  }
  return value as ModelCameraView;
};

const requireVector3Tuple = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): Vector3Tuple => {
  if (!Array.isArray(value) || value.length !== 3) {
    invalid("invalid_canvas_node", `${label} must contain exactly three numbers.`);
  }
  const values = value as unknown[];
  return [
    requireNumber(values[0], `${label}[0]`, minimum, maximum),
    requireNumber(values[1], `${label}[1]`, minimum, maximum),
    requireNumber(values[2], `${label}[2]`, minimum, maximum),
  ];
};

const requireModelNodeTransforms = (
  value: unknown,
): Record<string, ModelNodeTransform> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("invalid_canvas_node", "props.transformOverrides must be a JSON object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_MODEL_NODE_TRANSFORMS) {
    invalid(
      "invalid_canvas_node",
      `props.transformOverrides cannot contain more than ${MAX_MODEL_NODE_TRANSFORMS} model nodes.`,
    );
  }

  const result: Record<string, ModelNodeTransform> = {};
  for (const [nodeName, rawTransform] of entries) {
    if (nodeName.length === 0 || nodeName.length > 240 || nodeName !== nodeName.trim()) {
      invalid(
        "invalid_canvas_node",
        "Model node names in props.transformOverrides must contain 1 to 240 characters without surrounding whitespace.",
      );
    }
    const transform = requireObject(
      rawTransform,
      `props.transformOverrides[${JSON.stringify(nodeName)}]`,
    );
    result[nodeName] = {
      position: requireVector3Tuple(
        transform.position,
        `props.transformOverrides[${JSON.stringify(nodeName)}].position`,
        -1_000_000,
        1_000_000,
      ),
      rotation: requireVector3Tuple(
        transform.rotation,
        `props.transformOverrides[${JSON.stringify(nodeName)}].rotation`,
        -3_600,
        3_600,
      ),
      scale: requireVector3Tuple(
        transform.scale,
        `props.transformOverrides[${JSON.stringify(nodeName)}].scale`,
        0.001,
        1_000,
      ),
    };
  }
  return result;
};

const requireModelNodeAppearances = (
  value: unknown,
): Record<string, ModelNodeAppearance> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("invalid_canvas_node", "props.appearanceOverrides must be a JSON object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_MODEL_NODE_APPEARANCES) {
    invalid(
      "invalid_canvas_node",
      `props.appearanceOverrides cannot contain more than ${MAX_MODEL_NODE_APPEARANCES} model nodes.`,
    );
  }

  const result: Record<string, ModelNodeAppearance> = {};
  for (const [nodeName, rawAppearance] of entries) {
    if (nodeName.length === 0 || nodeName.length > 240 || nodeName !== nodeName.trim()) {
      invalid(
        "invalid_canvas_node",
        "Model node names in props.appearanceOverrides must contain 1 to 240 characters without surrounding whitespace.",
      );
    }
    const appearance = requireObject(
      rawAppearance,
      `props.appearanceOverrides[${JSON.stringify(nodeName)}]`,
    );
    result[nodeName] = {
      color: requireColor(
        appearance.color,
        `props.appearanceOverrides[${JSON.stringify(nodeName)}].color`,
      ),
      opacity: requireNumber(
        appearance.opacity,
        `props.appearanceOverrides[${JSON.stringify(nodeName)}].opacity`,
        0,
        1,
      ),
      visible: requireBoolean(
        appearance.visible,
        `props.appearanceOverrides[${JSON.stringify(nodeName)}].visible`,
      ),
    };
  }
  return result;
};

const requireAlignment = (value: unknown, label: string): DecorationProps["align"] => {
  if (value !== "left" && value !== "center" && value !== "right") {
    invalid("invalid_canvas_node", `${label} must be left, center, or right.`);
  }
  return value as DecorationProps["align"];
};

const requireDashboardTone = (value: unknown, label: string): DashboardTone => {
  if (value !== "normal" && value !== "warning" && value !== "danger" && value !== "offline") {
    invalid("invalid_canvas_node", `${label} must be normal, warning, danger, or offline.`);
  }
  return value as DashboardTone;
};

const requireDashboardBase = (props: Record<string, unknown>): DashboardBaseProps => ({
  title: requireNonEmptyString(props.title, "props.title", 120),
  textColor: requireColor(props.textColor, "props.textColor"),
  accentColor: requireColor(props.accentColor, "props.accentColor"),
  fillColor: requireColor(props.fillColor, "props.fillColor"),
  borderColor: requireColor(props.borderColor, "props.borderColor"),
  sample: requireBoolean(props.sample, "props.sample"),
});

const requireBasicAppearance = (props: Record<string, unknown>): BasicAppearanceProps => ({
  textColor: requireColor(props.textColor, "props.textColor"),
  accentColor: requireColor(props.accentColor, "props.accentColor"),
  fillColor: requireColor(props.fillColor, "props.fillColor"),
  borderColor: requireColor(props.borderColor, "props.borderColor"),
  borderRadius: requireNumber(props.borderRadius, "props.borderRadius", 0, 100),
});

const requireFontWeight = (value: unknown, label: string): number => {
  const fontWeight = requireNumber(value, label, 100, 900);
  if (!Number.isInteger(fontWeight)) {
    invalid("invalid_canvas_node", `${label} must be an integer.`);
  }
  return fontWeight;
};

const requireSafeHttpUrl = (
  value: unknown,
  label: string,
  allowEmpty: boolean,
): string => {
  const url = allowEmpty
    ? requireString(value, label, 2048)
    : requireNonEmptyString(value, label, 2048);
  if (url.length === 0 && allowEmpty) return url;
  const parsed = (() => {
    try {
      return new URL(url);
    } catch {
      throw new AppError(400, "invalid_canvas_node", `${label} must be a valid HTTP or HTTPS URL.`);
    }
  })();
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    invalid("invalid_canvas_node", `${label} must use the HTTP or HTTPS protocol.`);
  }
  return url;
};

const requireBasicOptions = (value: unknown): BasicOption[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) {
    invalid("invalid_canvas_node", "props.options must contain between 1 and 24 options.");
  }
  const values = new Set<string>();
  return (value as unknown[]).map((rawOption, index) => {
    const option = requireObject(rawOption, `props.options[${index}]`);
    const optionValue = requireNonEmptyString(option.value, `props.options[${index}].value`, 80);
    if (values.has(optionValue)) {
      invalid("invalid_canvas_node", `props.options[${index}].value must be unique.`);
    }
    values.add(optionValue);
    return {
      label: requireNonEmptyString(option.label, `props.options[${index}].label`, 80),
      value: optionValue,
    };
  });
};

const requireStringArray = (value: unknown, label: string, identifiers = false): string[] => {
  if (!Array.isArray(value) || value.length > MAX_POINTS) {
    invalid("invalid_canvas_node", `${label} must contain at most ${MAX_POINTS} strings.`);
  }
  return (value as unknown[]).map((item, index) => identifiers
    ? requireIdentifier(item, `${label}[${index}]`)
    : requireNonEmptyString(item, `${label}[${index}]`, 80));
};

const isDecorationNodeType = (value: unknown): value is DecorationNodeType =>
  value === "screen-title" ||
  value === "background-decoration" ||
  value === "datetime" ||
  value === "section-title" ||
  value === "card-background" ||
  value === "icon-background";

const isPanelFrameNodeType = (value: unknown): value is PanelFrameNodeType =>
  value === "panel-frame";

const isModel3DNodeType = (value: unknown): value is Model3DNodeType =>
  value === "model-3d";

const isDashboardNodeType = (value: unknown): value is DashboardNodeType =>
  value === "metric-card" ||
  value === "radial-gauge" ||
  value === "progress-list" ||
  value === "status-grid" ||
  value === "ranking-list" ||
  value === "alarm-list" ||
  value === "data-table" ||
  value === "event-timeline";

const isBasicNodeType = (value: unknown): value is BasicNodeType =>
  value === "plain-text" ||
  value === "text-link" ||
  value === "image" ||
  value === "carousel" ||
  value === "button" ||
  value === "switch" ||
  value === "checkbox-group" ||
  value === "radio-group" ||
  value === "select";

const isCanvasNodeType = (value: unknown): value is CanvasNodeType =>
  value === "line-chart" ||
  value === "bar-chart" ||
  value === "area-chart" ||
  value === "pie-chart" ||
  value === "donut-chart" ||
  value === "radar-chart" ||
  value === "rectangle" ||
  value === "circle" ||
  isDecorationNodeType(value) ||
  isPanelFrameNodeType(value) ||
  isDashboardNodeType(value) ||
  isBasicNodeType(value) ||
  isModel3DNodeType(value);

const validateNode = (value: unknown): CanvasNode => {
  const node = requireObject(value, "canvas node");
  const rawType = node.type;
  if (!isCanvasNodeType(rawType)) {
    invalid("unsupported_canvas_node_type", "The requested canvas node type is not in the approved component whitelist.");
  }
  const type = rawType as CanvasNodeType;

  const props = requireObject(node.props, "canvas node props");
  let validatedProps: ChartProps | ShapeProps | DecorationProps | PanelFrameProps | DashboardProps | BasicProps | Model3DProps | null = null;

  if (
    type === "line-chart" ||
    type === "bar-chart" ||
    type === "area-chart" ||
    type === "pie-chart" ||
    type === "donut-chart" ||
    type === "radar-chart"
  ) {
    const categories = requireStringArray(props.categories, "props.categories");
    const minimumPoints = type === "radar-chart" ? 3 : 2;
    if (categories.length < minimumPoints || !Array.isArray(props.values) || props.values.length !== categories.length || props.values.length > MAX_POINTS) {
      invalid("invalid_canvas_node", `props.values must contain one finite value for every category, with ${minimumPoints} to ${MAX_POINTS} points.`);
    }
    const nonNegative = type === "pie-chart" || type === "donut-chart" || type === "radar-chart";
    const values = (props.values as unknown[]).map((item, index) => requireNumber(item, `props.values[${index}]`, nonNegative ? 0 : -1_000_000_000, 1_000_000_000));
    if ((type === "pie-chart" || type === "donut-chart") && values.every((item) => item === 0)) {
      invalid("invalid_canvas_node", "Pie and donut chart values must have a total greater than zero.");
    }
    validatedProps = {
      title: requireNonEmptyString(props.title, "props.title", 120),
      categories,
      values,
      unit: requireString(props.unit, "props.unit", 24),
      color: requireColor(props.color, "props.color"),
    };
  } else if (type === "rectangle" || type === "circle") {
    validatedProps = {
      fillColor: requireColor(props.fillColor, "props.fillColor"),
      borderColor: requireColor(props.borderColor, "props.borderColor"),
      borderWidth: requireNumber(props.borderWidth, "props.borderWidth", 0, 20),
      borderRadius: requireNumber(props.borderRadius, "props.borderRadius", 0, 200),
      opacity: requireNumber(props.opacity, "props.opacity", 0.05, 1),
    };
  } else if (isDecorationNodeType(type)) {
    const text = type === "background-decoration" || type === "card-background"
      ? requireString(props.text, "props.text", 120)
      : requireNonEmptyString(
          props.text,
          "props.text",
          type === "icon-background" ? 4 : 120,
        );
    validatedProps = {
      text,
      subtitle: requireString(props.subtitle, "props.subtitle", 160),
      textColor: requireColor(props.textColor, "props.textColor"),
      accentColor: requireColor(props.accentColor, "props.accentColor"),
      fillColor: requireColor(props.fillColor, "props.fillColor"),
      borderColor: requireColor(props.borderColor, "props.borderColor"),
      opacity: requireNumber(props.opacity, "props.opacity", 0.05, 1),
      align: requireAlignment(props.align, "props.align"),
      showDate: requireBoolean(props.showDate, "props.showDate"),
      showSeconds: requireBoolean(props.showSeconds, "props.showSeconds"),
    };
  } else if (isPanelFrameNodeType(type)) {
    if (
      props.style !== "outline" &&
      props.style !== "corners" &&
      props.style !== "cut" &&
      props.style !== "glass" &&
      props.style !== "neon"
    ) {
      invalid("invalid_canvas_node", "props.style must be outline, corners, cut, glass, or neon.");
    }
    validatedProps = {
      title: requireNonEmptyString(props.title, "props.title", 120),
      subtitle: requireString(props.subtitle, "props.subtitle", 160),
      showHeader: requireBoolean(props.showHeader, "props.showHeader"),
      style: props.style as PanelFrameStyle,
      textColor: requireColor(props.textColor, "props.textColor"),
      accentColor: requireColor(props.accentColor, "props.accentColor"),
      fillColor: requireColor(props.fillColor, "props.fillColor"),
      borderColor: requireColor(props.borderColor, "props.borderColor"),
      opacity: requireNumber(props.opacity, "props.opacity", 0.05, 1),
      glowStrength: requireNumber(props.glowStrength, "props.glowStrength", 0, 1),
      headerHeight: requireNumber(props.headerHeight, "props.headerHeight", 32, 80),
      cornerSize: requireNumber(props.cornerSize, "props.cornerSize", 8, 48),
    };
  } else if (isDashboardNodeType(type)) {
    const base = requireDashboardBase(props);
    if (type === "metric-card") {
      validatedProps = {
        ...base,
        value: requireString(props.value, "props.value", 40),
        unit: requireString(props.unit, "props.unit", 24),
        subtitle: requireString(props.subtitle, "props.subtitle", 120),
        icon: requireString(props.icon, "props.icon", 4),
      };
    } else if (type === "radial-gauge") {
      const value = requireNumber(props.value, "props.value", 0, 1_000_000_000);
      const maximum = requireNumber(props.maximum, "props.maximum", 0.000001, 1_000_000_000);
      if (value > maximum) {
        invalid("invalid_canvas_node", "props.value must not be greater than props.maximum.");
      }
      validatedProps = {
        ...base,
        value,
        maximum,
        unit: requireString(props.unit, "props.unit", 24),
        subtitle: requireString(props.subtitle, "props.subtitle", 120),
      };
    } else if (type === "progress-list") {
      if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > MAX_PROGRESS_ITEMS) {
        invalid("invalid_canvas_node", `props.items must contain between 1 and ${MAX_PROGRESS_ITEMS} progress items.`);
      }
      const items = (props.items as unknown[]).map((rawItem, index): ProgressListItem => {
        const item = requireObject(rawItem, `props.items[${index}]`);
        const value = requireNumber(item.value, `props.items[${index}].value`, 0, 1_000_000_000);
        const maximum = requireNumber(item.maximum, `props.items[${index}].maximum`, 0.000001, 1_000_000_000);
        if (value > maximum) {
          invalid("invalid_canvas_node", `props.items[${index}].value must not be greater than its maximum.`);
        }
        return {
          label: requireNonEmptyString(item.label, `props.items[${index}].label`, 80),
          value,
          maximum,
          unit: requireString(item.unit, `props.items[${index}].unit`, 24),
        };
      });
      validatedProps = { ...base, items };
    } else if (type === "status-grid") {
      const columns = requireNumber(props.columns, "props.columns", 1, 6);
      if (!Number.isInteger(columns)) {
        invalid("invalid_canvas_node", "props.columns must be an integer.");
      }
      if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > MAX_STATUS_ITEMS) {
        invalid("invalid_canvas_node", `props.items must contain between 1 and ${MAX_STATUS_ITEMS} status items.`);
      }
      const items = (props.items as unknown[]).map((rawItem, index): StatusGridItem => {
        const item = requireObject(rawItem, `props.items[${index}]`);
        return {
          label: requireNonEmptyString(item.label, `props.items[${index}].label`, 80),
          value: requireString(item.value, `props.items[${index}].value`, 80),
          tone: requireDashboardTone(item.tone, `props.items[${index}].tone`),
        };
      });
      validatedProps = { ...base, columns, items };
    } else if (type === "ranking-list") {
      if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > MAX_PROGRESS_ITEMS) {
        invalid("invalid_canvas_node", `props.items must contain between 1 and ${MAX_PROGRESS_ITEMS} ranking items.`);
      }
      const items = (props.items as unknown[]).map((rawItem, index): RankingListItem => {
        const item = requireObject(rawItem, `props.items[${index}]`);
        if (item.trend !== "up" && item.trend !== "down" && item.trend !== "flat") {
          invalid("invalid_canvas_node", `props.items[${index}].trend must be up, down, or flat.`);
        }
        return {
          label: requireNonEmptyString(item.label, `props.items[${index}].label`, 80),
          value: requireNumber(item.value, `props.items[${index}].value`, 0, 1_000_000_000),
          unit: requireString(item.unit, `props.items[${index}].unit`, 24),
          trend: item.trend as RankingListItem["trend"],
        };
      });
      validatedProps = { ...base, items };
    } else if (type === "alarm-list") {
      if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > MAX_STREAM_ITEMS) {
        invalid("invalid_canvas_node", `props.items must contain between 1 and ${MAX_STREAM_ITEMS} alarm items.`);
      }
      const items = (props.items as unknown[]).map((rawItem, index): AlarmListItem => {
        const item = requireObject(rawItem, `props.items[${index}]`);
        return {
          time: requireNonEmptyString(item.time, `props.items[${index}].time`, 32),
          source: requireNonEmptyString(item.source, `props.items[${index}].source`, 80),
          message: requireNonEmptyString(item.message, `props.items[${index}].message`, 240),
          tone: requireDashboardTone(item.tone, `props.items[${index}].tone`),
        };
      });
      validatedProps = { ...base, items };
    } else if (type === "data-table") {
      const columns = requireStringArray(props.columns, "props.columns");
      if (columns.length < 2 || columns.length > MAX_TABLE_COLUMNS) {
        invalid("invalid_canvas_node", `props.columns must contain between 2 and ${MAX_TABLE_COLUMNS} columns.`);
      }
      if (!Array.isArray(props.rows) || props.rows.length < 1 || props.rows.length > MAX_TABLE_ROWS) {
        invalid("invalid_canvas_node", `props.rows must contain between 1 and ${MAX_TABLE_ROWS} rows.`);
      }
      const rows = (props.rows as unknown[]).map((rawRow, rowIndex): string[] => {
        if (!Array.isArray(rawRow) || rawRow.length !== columns.length) {
          invalid("invalid_canvas_node", `props.rows[${rowIndex}] must contain exactly ${columns.length} cells.`);
        }
        return (rawRow as unknown[]).map((cell, columnIndex) => requireString(cell, `props.rows[${rowIndex}][${columnIndex}]`, 120));
      });
      const highlightColumn = requireNumber(props.highlightColumn, "props.highlightColumn", -1, columns.length - 1);
      if (!Number.isInteger(highlightColumn)) {
        invalid("invalid_canvas_node", "props.highlightColumn must be an integer.");
      }
      validatedProps = { ...base, columns, rows, highlightColumn };
    } else if (type === "event-timeline") {
      if (!Array.isArray(props.items) || props.items.length < 1 || props.items.length > MAX_STREAM_ITEMS) {
        invalid("invalid_canvas_node", `props.items must contain between 1 and ${MAX_STREAM_ITEMS} timeline items.`);
      }
      const items = (props.items as unknown[]).map((rawItem, index): TimelineItem => {
        const item = requireObject(rawItem, `props.items[${index}]`);
        return {
          time: requireNonEmptyString(item.time, `props.items[${index}].time`, 32),
          title: requireNonEmptyString(item.title, `props.items[${index}].title`, 120),
          detail: requireString(item.detail, `props.items[${index}].detail`, 240),
          tone: requireDashboardTone(item.tone, `props.items[${index}].tone`),
        };
      });
      validatedProps = { ...base, items };
    } else {
      invalid("unsupported_canvas_node_type", `Dashboard node type ${type} is not implemented.`);
    }
  } else if (isBasicNodeType(type)) {
    if (type === "image" || type === "carousel") {
      if (props.fit !== "contain" && props.fit !== "cover" && props.fit !== "fill") {
        invalid("invalid_canvas_node", "props.fit must be contain, cover, or fill.");
      }
      const imageProps: ImageProps = {
        alt: requireString(props.alt, "props.alt", 160),
        fit: props.fit as ImageProps["fit"],
        backgroundColor: requireColor(props.backgroundColor, "props.backgroundColor"),
        borderColor: requireColor(props.borderColor, "props.borderColor"),
        borderRadius: requireNumber(props.borderRadius, "props.borderRadius", 0, 100),
      };
      validatedProps = type === "image"
        ? imageProps
        : {
            ...imageProps,
            autoplay: requireBoolean(props.autoplay, "props.autoplay"),
            interval: requireNumber(props.interval, "props.interval", 2, 60),
            showArrows: requireBoolean(props.showArrows, "props.showArrows"),
            showDots: requireBoolean(props.showDots, "props.showDots"),
          };
    } else {
      const appearance = requireBasicAppearance(props);
      if (type === "plain-text" || type === "text-link" || type === "button") {
        const fontSize = requireNumber(props.fontSize, "props.fontSize", 10, 120);
        const fontWeight = requireFontWeight(props.fontWeight, "props.fontWeight");
        const text = requireNonEmptyString(
          props.text,
          "props.text",
          type === "plain-text" ? 1000 : 120,
        );
        if (type === "plain-text") {
          if (
            props.scrollMode !== "none" &&
            props.scrollMode !== "horizontal" &&
            props.scrollMode !== "vertical"
          ) {
            invalid("invalid_canvas_node", "props.scrollMode must be none, horizontal, or vertical.");
          }
          validatedProps = {
            ...appearance,
            text,
            align: requireAlignment(props.align, "props.align"),
            fontSize,
            fontWeight,
            scrollMode: props.scrollMode as PlainTextProps["scrollMode"],
            scrollDuration: requireNumber(props.scrollDuration, "props.scrollDuration", 3, 120),
          };
        } else if (type === "text-link") {
          validatedProps = {
            ...appearance,
            text,
            href: requireSafeHttpUrl(props.href, "props.href", false),
            align: requireAlignment(props.align, "props.align"),
            fontSize,
            fontWeight,
            openInNewTab: requireBoolean(props.openInNewTab, "props.openInNewTab"),
            underline: requireBoolean(props.underline, "props.underline"),
          };
        } else {
          validatedProps = {
            ...appearance,
            text,
            href: requireSafeHttpUrl(props.href, "props.href", true),
            fontSize,
            fontWeight,
            openInNewTab: requireBoolean(props.openInNewTab, "props.openInNewTab"),
            disabled: requireBoolean(props.disabled, "props.disabled"),
          };
        }
      } else if (type === "switch") {
        validatedProps = {
          ...appearance,
          label: requireString(props.label, "props.label", 120),
          defaultChecked: requireBoolean(props.defaultChecked, "props.defaultChecked"),
          onText: requireString(props.onText, "props.onText", 24),
          offText: requireString(props.offText, "props.offText", 24),
        };
      } else {
        const options = requireBasicOptions(props.options);
        const optionValues = new Set(options.map((option) => option.value));
        if (type === "checkbox-group") {
          const selectedValues = requireStringArray(
            props.selectedValues,
            "props.selectedValues",
          );
          if (
            new Set(selectedValues).size !== selectedValues.length ||
            selectedValues.some((value) => !optionValues.has(value))
          ) {
            invalid("invalid_canvas_node", "props.selectedValues must contain unique values from props.options.");
          }
          const columns = requireNumber(props.columns, "props.columns", 1, 4);
          if (!Number.isInteger(columns)) {
            invalid("invalid_canvas_node", "props.columns must be an integer.");
          }
          validatedProps = {
            ...appearance,
            title: requireString(props.title, "props.title", 120),
            options,
            selectedValues,
            columns,
          };
        } else {
          const selectedValue = requireString(props.selectedValue, "props.selectedValue", 80);
          if (selectedValue.length > 0 && !optionValues.has(selectedValue)) {
            invalid("invalid_canvas_node", "props.selectedValue must be empty or match a value from props.options.");
          }
          if (type === "radio-group") {
            const columns = requireNumber(props.columns, "props.columns", 1, 4);
            if (!Number.isInteger(columns)) {
              invalid("invalid_canvas_node", "props.columns must be an integer.");
            }
            validatedProps = {
              ...appearance,
              title: requireString(props.title, "props.title", 120),
              options,
              selectedValue,
              columns,
            };
          } else {
            validatedProps = {
              ...appearance,
              label: requireString(props.label, "props.label", 120),
              placeholder: requireString(props.placeholder, "props.placeholder", 80),
              options,
              selectedValue,
            };
          }
        }
      }
    }
  } else {
    validatedProps = {
      backgroundColor: requireColor(props.backgroundColor, "props.backgroundColor"),
      backgroundOpacity: props.backgroundOpacity === undefined
        ? 1
        : requireNumber(props.backgroundOpacity, "props.backgroundOpacity", 0, 1),
      environmentLightColor: props.environmentLightColor === undefined
        ? "#daf4ff"
        : requireColor(props.environmentLightColor, "props.environmentLightColor"),
      environmentLightIntensity: props.environmentLightIntensity === undefined
        ? 2.1
        : requireNumber(
            props.environmentLightIntensity,
            "props.environmentLightIntensity",
            0,
            10,
          ),
      keyLightColor: props.keyLightColor === undefined
        ? "#ffffff"
        : requireColor(props.keyLightColor, "props.keyLightColor"),
      keyLightIntensity: props.keyLightIntensity === undefined
        ? 2.4
        : requireNumber(props.keyLightIntensity, "props.keyLightIntensity", 0, 10),
      cameraFov: props.cameraFov === undefined
        ? 42
        : requireNumber(props.cameraFov, "props.cameraFov", 15, 90),
      cameraView: props.cameraView === undefined
        ? "isometric"
        : requireModelCameraView(props.cameraView, "props.cameraView"),
      autoRotate: requireBoolean(props.autoRotate, "props.autoRotate"),
      rotationSpeed: requireNumber(props.rotationSpeed, "props.rotationSpeed", 0, 5),
      showGrid: requireBoolean(props.showGrid, "props.showGrid"),
      appearanceOverrides: requireModelNodeAppearances(props.appearanceOverrides),
      transformOverrides: requireModelNodeTransforms(props.transformOverrides),
    };
  }

  const acceptedProps = validatedProps;
  if (acceptedProps === null) {
    throw new AppError(
      400,
      "unsupported_canvas_node_type",
      `Canvas node type ${type} does not have a property validator.`,
    );
  }

  const minimumSize = minimumNodeSizes[type];
  const width = requireNumber(node.width, "node.width", minimumSize.width, 3840);
  const height = requireNumber(node.height, "node.height", minimumSize.height, 2160);
  if ((type === "circle" || type === "icon-background") && Math.abs(width - height) > 0.001) {
    invalid("invalid_canvas_node", "Square canvas nodes must keep a 1:1 width-to-height ratio.");
  }
  const resourceRefs = requireStringArray(node.resourceRefs, "node.resourceRefs", true);
  if (type === "model-3d" && resourceRefs.length > 1) {
    invalid("invalid_canvas_node", "A 3D model component can reference at most one model asset.");
  }
  if (type === "image" && resourceRefs.length > 1) {
    invalid("invalid_canvas_node", "An image component can reference at most one image asset.");
  }
  if (type === "carousel" && resourceRefs.length > 12) {
    invalid("invalid_canvas_node", "A carousel component can reference at most 12 image assets.");
  }
  if (
    isBasicNodeType(type) &&
    type !== "image" &&
    type !== "carousel" &&
    resourceRefs.length > 0
  ) {
    invalid("invalid_canvas_node", "This basic component type does not accept resource references.");
  }

  const validated: CanvasNode = {
    id: requireIdentifier(node.id, "node.id"),
    type,
    x: requireNumber(node.x, "node.x", -7680, 7680),
    y: requireNumber(node.y, "node.y", -4320, 4320),
    width,
    height,
    zIndex: requireNumber(node.zIndex, "node.zIndex", 0, 100000),
    props: acceptedProps,
    resourceRefs,
    dataBindingRefs: requireStringArray(node.dataBindingRefs, "node.dataBindingRefs", true),
  };

  if (!Number.isInteger(validated.zIndex)) {
    invalid("invalid_canvas_node", "node.zIndex must be an integer.");
  }

  if (encoder.encode(JSON.stringify(validated.props)).byteLength > MAX_PROPS_BYTES) {
    invalid("canvas_node_too_large", `A node's properties cannot exceed ${MAX_PROPS_BYTES} bytes.`);
  }
  return validated;
};

export const validateCanvasPatch = (value: Record<string, unknown>): CanvasPatch => {
  const expectedRevision = value.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
    invalid("invalid_canvas_revision", "expectedRevision must be a non-negative integer.");
  }
  if (!Array.isArray(value.upsertNodes) || !Array.isArray(value.deleteNodeIds)) {
    invalid("invalid_canvas_patch", "upsertNodes and deleteNodeIds must be arrays.");
  }
  const upsertValues = value.upsertNodes as unknown[];
  const deleteValues = value.deleteNodeIds as unknown[];
  const theme = value.theme === undefined ? undefined : validateCanvasTheme(value.theme);
  if (upsertValues.length + deleteValues.length === 0 && theme === undefined) {
    invalid("empty_canvas_patch", "A canvas patch must contain at least one change.");
  }
  if (upsertValues.length + deleteValues.length > MAX_PATCH_NODES) {
    invalid("canvas_patch_too_large", `A single patch cannot change more than ${MAX_PATCH_NODES} nodes.`);
  }

  const upsertNodes = upsertValues.map(validateNode);
  const deleteNodeIds = deleteValues.map((id, index) => requireIdentifier(id, `deleteNodeIds[${index}]`));
  const allIds = [...upsertNodes.map((node) => node.id), ...deleteNodeIds];
  if (new Set(allIds).size !== allIds.length) {
    invalid("duplicate_canvas_node_id", "Node IDs must not be duplicated across upserts and deletes.");
  }
  return { expectedRevision: expectedRevision as number, theme, upsertNodes, deleteNodeIds };
};

const parseStoredArray = (json: string, label: string): unknown[] => {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) throw new Error("not an array");
    return value;
  } catch (error) {
    throw new AppError(500, "invalid_canvas_storage", `${label} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const presentStoredNode = (row: CanvasNodeRow): CanvasNode => {
  let props: unknown;
  try {
    props = JSON.parse(row.props_json);
  } catch (error) {
    throw new AppError(500, "invalid_canvas_storage", `Node ${row.id} has invalid props JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return validateNode({
      id: row.id, type: row.node_type, x: row.x, y: row.y, width: row.width, height: row.height,
      zIndex: row.z_index, props, resourceRefs: parseStoredArray(row.resource_refs_json, `Node ${row.id} resource refs`),
      dataBindingRefs: parseStoredArray(row.data_binding_refs_json, `Node ${row.id} data binding refs`),
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 400) {
      throw new AppError(500, "invalid_canvas_storage", `Stored node ${row.id} violates the canvas schema: ${error.message}`);
    }
    throw error;
  }
};

export const getCanvas = async (env: AppEnv, projectId: string): Promise<CanvasDocument> => {
  const canvas = await env.DB.prepare(
    `SELECT project_id, width, height, background_color, theme_mode, theme_preset_id,
       theme_background_pattern, theme_font_family, theme_glow_intensity, theme_panel_radius,
       theme_surface_color, theme_text_color, theme_accent_color, theme_border_color, revision, updated_at
     FROM project_canvases WHERE project_id = ?`,
  ).bind(projectId).first<CanvasRow>();
  if (!canvas) {
    return { projectId, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, theme: { ...DEFAULT_THEME }, revision: 0, updatedAt: null, nodes: [] };
  }
  const rows = await env.DB.prepare(
    `SELECT id, node_type, x, y, width, height, z_index, props_json, resource_refs_json, data_binding_refs_json
     FROM canvas_nodes WHERE project_id = ? ORDER BY z_index ASC, id ASC`,
  ).bind(projectId).all<CanvasNodeRow>();
  return {
    projectId: canvas.project_id, width: canvas.width, height: canvas.height,
    theme: presentStoredTheme(canvas),
    revision: canvas.revision, updatedAt: canvas.updated_at,
    nodes: rows.results.map(presentStoredNode),
  };
};

const changes = (result: DatabaseResult | undefined): number => {
  const count = result?.meta?.changes;
  if (typeof count !== "number") {
    throw new AppError(500, "missing_database_result", "D1 did not report the canvas revision update result.");
  }
  return count;
};

export const applyCanvasPatch = async (
  env: AppEnv,
  projectId: string,
  userId: string,
  patch: CanvasPatch,
): Promise<CanvasDocument> => {
  const modelNodes = patch.upsertNodes.filter((node) => node.type === "model-3d");
  const modelAssetRefs = [...new Set(modelNodes.flatMap((node) => node.resourceRefs))];
  const duplicateNamesByAssetId = new Map<string, Set<string>>();
  for (const assetId of modelAssetRefs) {
    const row = await env.DB.prepare(
      "SELECT id, inspection_json FROM model_assets WHERE id = ? AND project_id = ?",
    ).bind(assetId, projectId).first<{ id: string; inspection_json: string }>();
    if (!row) {
      throw new AppError(
        400,
        "invalid_model_asset_reference",
        `Model asset ${assetId} does not belong to project ${projectId}.`,
      );
    }
    let inspection: unknown;
    try {
      inspection = JSON.parse(row.inspection_json);
    } catch (error) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} has invalid inspection JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} inspection is not a JSON object.`,
      );
    }
    const inspectionObject = inspection as Record<string, unknown>;
    if (
      !Array.isArray(inspectionObject.duplicateNodeNames)
      || inspectionObject.duplicateNodeNames.some((name) => typeof name !== "string")
    ) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} inspection does not contain a valid duplicateNodeNames list.`,
      );
    }
    duplicateNamesByAssetId.set(
      assetId,
      new Set(inspectionObject.duplicateNodeNames as string[]),
    );
  }

  for (const node of modelNodes) {
    const transformOverrides = (node.props as Model3DProps).transformOverrides;
    const appearanceOverrides = (node.props as Model3DProps).appearanceOverrides;
    const transformedNodeNames = Object.keys(transformOverrides);
    const appearanceNodeNames = Object.keys(appearanceOverrides);
    if (transformedNodeNames.length === 0 && appearanceNodeNames.length === 0) continue;

    const assetId = node.resourceRefs[0];
    if (!assetId) {
      const hasAppearanceOverride = appearanceNodeNames.length > 0;
      throw new AppError(
        400,
        hasAppearanceOverride
          ? "model_appearance_without_asset"
          : "model_transform_without_asset",
        `Canvas node ${node.id} cannot store model node ${
          hasAppearanceOverride ? "appearances" : "transforms"
        } without a model asset.`,
      );
    }
    const duplicateNames = duplicateNamesByAssetId.get(assetId);
    const duplicateTransformName = transformedNodeNames.find((name) => duplicateNames?.has(name));
    if (duplicateTransformName) {
      throw new AppError(
        400,
        "ambiguous_model_node_transform",
        `Canvas node ${node.id} cannot transform duplicate model node name ${JSON.stringify(duplicateTransformName)}. Rename the model nodes and upload the model again.`,
      );
    }
    const duplicateAppearanceName = appearanceNodeNames.find((name) => duplicateNames?.has(name));
    if (duplicateAppearanceName) {
      throw new AppError(
        400,
        "ambiguous_model_node_appearance",
        `Canvas node ${node.id} cannot configure the appearance of duplicate model node name ${JSON.stringify(duplicateAppearanceName)}. Rename the model nodes and upload the model again.`,
      );
    }
  }

  const imageAssetRefs = [...new Set(
    patch.upsertNodes
      .filter((node) => node.type === "image" || node.type === "carousel")
      .flatMap((node) => node.resourceRefs),
  )];
  for (const assetId of imageAssetRefs) {
    const imageAsset = await env.DB.prepare(
      "SELECT id FROM image_assets WHERE id = ? AND project_id = ?",
    ).bind(assetId, projectId).first<{ id: string }>();
    if (!imageAsset) {
      throw new AppError(
        400,
        "invalid_image_asset_reference",
        `Image asset ${assetId} does not belong to project ${projectId}.`,
      );
    }
  }

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO project_canvases
       (project_id, width, height, background_color, theme_mode, theme_preset_id,
        theme_background_pattern, theme_font_family, theme_glow_intensity, theme_panel_radius,
        theme_surface_color, theme_text_color, theme_accent_color, theme_border_color,
        revision, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(
      projectId,
      DEFAULT_WIDTH,
      DEFAULT_HEIGHT,
      DEFAULT_THEME.backgroundColor,
      DEFAULT_THEME.mode,
      DEFAULT_THEME.presetId,
      DEFAULT_THEME.backgroundPattern,
      DEFAULT_THEME.fontFamily,
      DEFAULT_THEME.glowIntensity,
      DEFAULT_THEME.panelRadius,
      DEFAULT_THEME.surfaceColor,
      DEFAULT_THEME.textColor,
      DEFAULT_THEME.accentColor,
      DEFAULT_THEME.borderColor,
      userId,
      now,
    ),
  ];

  for (const node of patch.upsertNodes) {
    statements.push(env.DB.prepare(
      `INSERT INTO canvas_nodes
       (id, project_id, node_type, x, y, width, height, z_index, props_json, resource_refs_json, data_binding_refs_json, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)
       ON CONFLICT(project_id, id) DO UPDATE SET
         node_type = excluded.node_type, x = excluded.x, y = excluded.y,
         width = excluded.width, height = excluded.height, z_index = excluded.z_index,
         props_json = excluded.props_json, resource_refs_json = excluded.resource_refs_json,
         data_binding_refs_json = excluded.data_binding_refs_json, updated_at = excluded.updated_at`,
    ).bind(
      node.id, projectId, node.type, node.x, node.y, node.width, node.height, node.zIndex,
      JSON.stringify(node.props), JSON.stringify(node.resourceRefs), JSON.stringify(node.dataBindingRefs), now,
      projectId, patch.expectedRevision,
    ));
  }

  for (const nodeId of patch.deleteNodeIds) {
    statements.push(env.DB.prepare(
      `DELETE FROM canvas_nodes WHERE id = ? AND project_id = ?
       AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`,
    ).bind(nodeId, projectId, projectId, patch.expectedRevision));
  }

  statements.push(env.DB.prepare(
    `UPDATE projects SET updated_at = ?
     WHERE id = ?
     AND EXISTS (
       SELECT 1 FROM project_canvases
       WHERE project_id = ? AND revision = ?
     )`,
  ).bind(now, projectId, projectId, patch.expectedRevision));

  statements.push(patch.theme
    ? env.DB.prepare(
      `UPDATE project_canvases SET
         background_color = ?, theme_mode = ?, theme_preset_id = ?,
         theme_background_pattern = ?, theme_font_family = ?, theme_glow_intensity = ?,
         theme_panel_radius = ?, theme_surface_color = ?, theme_text_color = ?,
         theme_accent_color = ?, theme_border_color = ?,
         revision = revision + 1, updated_by_user_id = ?, updated_at = ?
       WHERE project_id = ? AND revision = ?`,
    ).bind(
      patch.theme.backgroundColor,
      patch.theme.mode,
      patch.theme.presetId,
      patch.theme.backgroundPattern,
      patch.theme.fontFamily,
      patch.theme.glowIntensity,
      patch.theme.panelRadius,
      patch.theme.surfaceColor,
      patch.theme.textColor,
      patch.theme.accentColor,
      patch.theme.borderColor,
      userId,
      now,
      projectId,
      patch.expectedRevision,
    )
    : env.DB.prepare(
      `UPDATE project_canvases SET revision = revision + 1, updated_by_user_id = ?, updated_at = ?
       WHERE project_id = ? AND revision = ?`,
    ).bind(userId, now, projectId, patch.expectedRevision));

  const results = await env.DB.batch(statements);
  if (changes(results.at(-1)) !== 1) {
    throw new AppError(409, "canvas_revision_conflict", "The canvas changed since it was loaded. Reload it before saving again.");
  }
  return getCanvas(env, projectId);
};
