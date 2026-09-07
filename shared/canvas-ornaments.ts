import { isIconId, type IconId } from "./icon-catalog";

export type OrnamentNodeType = "card-title" | "vector-icon";
export const isOrnamentNodeType = (value: unknown): value is OrnamentNodeType => value === "card-title" || value === "vector-icon";
export const titleVariants = { plain: "简洁图文", underline: "细线标题", band: "渐变色带", corner: "工业切角" } as const;
export const titleFonts = {
  inherit: { label: "跟随画布", family: "inherit" },
  sans: { label: "现代黑体", family: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  serif: { label: "典雅宋体", family: '"Songti SC", SimSun, serif' },
  mono: { label: "等宽数字", family: '"SFMono-Regular", Consolas, "Microsoft YaHei", monospace' },
} as const;
export type VectorIconProps = {
  icon: IconId | "none";
  iconSize: number;
  iconColor: string;
  strokeWidth: number;
  rotation: number;
  opacity: number;
};
export type CardTitleProps = VectorIconProps & {
  text: string;
  variant: keyof typeof titleVariants;
  fontFamily: keyof typeof titleFonts;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  letterSpacing: number;
  textColor: string;
  align: "left" | "center" | "right";
  gap: number;
  padding: number;
  accentColor: string;
  fillColor: string;
  backgroundOpacity: number;
};
export type OrnamentProps = CardTitleProps | VectorIconProps;
export const ornamentDefaults: Record<OrnamentNodeType, OrnamentProps> = {
  "vector-icon": { icon: "factory", iconSize: 48, iconColor: "#55d8ff", strokeWidth: 1.8, rotation: 0, opacity: 1 },
  "card-title": {
    icon: "wrench", iconSize: 22, iconColor: "#55d8ff", strokeWidth: 1.8, rotation: 0, opacity: 1,
    text: "装备故障情况统计", variant: "plain", fontFamily: "inherit", fontSize: 22, fontWeight: 600,
    italic: false, underline: false, letterSpacing: 0.5, textColor: "#e9f8ff", align: "left",
    gap: 12, padding: 12, accentColor: "#55d8ff", fillColor: "#123650", backgroundOpacity: 0,
  },
};
export const ornamentMinimumSizes = { "card-title": { width: 120, height: 32 }, "vector-icon": { width: 24, height: 24 } } as const;
export const ornamentDefaultSizes = { "card-title": { width: 360, height: 56 }, "vector-icon": { width: 72, height: 72 } } as const;

type ParseResult = { ok: true; value: OrnamentProps } | { ok: false; message: string };
const numberIn = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const color = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

// Frontend drafts and API persistence use the same strict contract. Invalid values are never coerced.
export function parseOrnamentProps(type: OrnamentNodeType, props: Record<string, unknown>): ParseResult {
  if (!isIconId(props.icon) && !(type === "card-title" && props.icon === "none")) return { ok: false, message: "请选择本地图标库中的有效图标。" };
  if (!numberIn(props.iconSize, 8, 256)) return { ok: false, message: "图标大小必须为 8–256 px。" };
  if (!numberIn(props.strokeWidth, 0.5, 4)) return { ok: false, message: "图标线条粗细必须为 0.5–4。" };
  if (!numberIn(props.rotation, -180, 180)) return { ok: false, message: "图标旋转角度必须为 -180–180°。" };
  if (!numberIn(props.opacity, 0, 1)) return { ok: false, message: "透明度必须为 0–1。" };
  if (!color(props.iconColor)) return { ok: false, message: "图标颜色必须是六位十六进制颜色。" };
  const iconProps: VectorIconProps = { icon: props.icon as IconId | "none", iconSize: props.iconSize, iconColor: props.iconColor, strokeWidth: props.strokeWidth, rotation: props.rotation, opacity: props.opacity };
  if (type === "vector-icon") return { ok: true, value: iconProps };
  if (typeof props.text !== "string" || props.text.trim().length === 0 || props.text.length > 120) return { ok: false, message: "标题必须为 1–120 个字符。" };
  if (typeof props.variant !== "string" || !Object.hasOwn(titleVariants, props.variant)) return { ok: false, message: "标题样式无效。" };
  if (typeof props.fontFamily !== "string" || !Object.hasOwn(titleFonts, props.fontFamily)) return { ok: false, message: "字体样式无效。" };
  if (!numberIn(props.fontSize, 10, 96)) return { ok: false, message: "文字大小必须为 10–96 px。" };
  if (!numberIn(props.fontWeight, 300, 900) || props.fontWeight % 100 !== 0) return { ok: false, message: "字重必须是 300–900 之间的整百数。" };
  if (typeof props.italic !== "boolean" || typeof props.underline !== "boolean") return { ok: false, message: "斜体和下划线必须为布尔值。" };
  if (!numberIn(props.letterSpacing, 0, 12)) return { ok: false, message: "字间距必须为 0–12 px。" };
  if (!numberIn(props.gap, 0, 64) || !numberIn(props.padding, 0, 48)) return { ok: false, message: "图文间距须为 0–64 px，水平内边距须为 0–48 px。" };
  if (!numberIn(props.backgroundOpacity, 0, 1)) return { ok: false, message: "背景透明度必须为 0–1。" };
  if (![props.textColor, props.accentColor, props.fillColor].every(color)) return { ok: false, message: "文字、装饰和背景颜色必须是六位十六进制颜色。" };
  if (props.align !== "left" && props.align !== "center" && props.align !== "right") return { ok: false, message: "请选择有效的对齐方式。" };
  return { ok: true, value: {
    ...iconProps, text: props.text, variant: props.variant as CardTitleProps["variant"], fontFamily: props.fontFamily as CardTitleProps["fontFamily"],
    fontSize: props.fontSize, fontWeight: props.fontWeight, italic: props.italic, underline: props.underline,
    letterSpacing: props.letterSpacing, textColor: props.textColor as string, align: props.align, gap: props.gap, padding: props.padding,
    accentColor: props.accentColor as string, fillColor: props.fillColor as string, backgroundOpacity: props.backgroundOpacity,
  } };
}
