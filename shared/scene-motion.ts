import { AppError } from "./errors";
import { requireIdentifier } from "./canvas-schema";

export type MotionVector = [number, number, number];
export type MotionValue = MotionVector | string | number | boolean;
export type MotionTarget = { instanceId: string; objectId: string | null };
export type MotionProperty = "position" | "rotation" | "scale" | "color" | "opacity" | "visible";
export type MotionKeyframe<T = MotionValue> = { timeMs: number; value: T };
export type SceneMotionTrack = { id: string; type: "object"; target: MotionTarget; property: MotionProperty; easing: "linear" | "smooth"; keyframes: MotionKeyframe[] }
  | { id: string; type: "camera"; property: "position" | "target"; easing: "linear" | "smooth"; keyframes: MotionKeyframe<MotionVector>[] };
export type SceneMotion = { id: string; name: string; version: 1; durationMs: number; repeat: number; fill: "hold" | "restore"; tracks: SceneMotionTrack[] };
const invalid = (message: string): never => { throw new AppError(400, "invalid_scene_motion", message); };
const object = (value: unknown, fields: string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) return invalid("动画配置必须是对象且只包含支持的字段。");
  return value as Record<string, unknown>;
};
const duration = (value: unknown, min = 1, max = 60000): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return invalid(`动画时间/次数必须是 ${min}–${max} 的整数。`);
  return value;
};
function vector(value: unknown): MotionVector {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > 1000000)) return invalid("动画向量必须包含三个有限坐标，绝对值不超过100万。");
  return [...value] as MotionVector;
}
export const motionChannel = (track: SceneMotionTrack) => track.type === "camera" ? `camera:${track.property}` : JSON.stringify(["object", track.target.instanceId, track.target.objectId, track.property]);
export function validateSceneMotions(value: unknown): SceneMotion[] {
  if (!Array.isArray(value) || value.length > 100) return invalid("单场景最多100个动画。");
  const motions = value.map((value): SceneMotion => {
    const input = object(value, ["id", "name", "version", "durationMs", "repeat", "fill", "tracks"]);
    if (input.version !== 1) invalid("不支持的动画版本。");
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100) invalid("动画名称必须是1–100个字符。");
    const durationMs = duration(input.durationMs), repeat = duration(input.repeat, 1, 100);
    if (durationMs * repeat > 60000) invalid("单次动画含重复最多60秒。");
    if (input.fill !== "hold" && input.fill !== "restore") invalid("动画结束方式必须为 hold 或 restore。");
    if (!Array.isArray(input.tracks) || !input.tracks.length || input.tracks.length > 64) invalid("每个动画必须包含1–64条轨道。");
    const tracks = (input.tracks as unknown[]).map((value): SceneMotionTrack => {
      const track = object(value, ["id", "type", "target", "property", "easing", "keyframes"]);
      if (track.type !== "object" && track.type !== "camera") invalid("轨道类型不支持。");
      if (track.easing !== "linear" && track.easing !== "smooth") invalid("插值方式不支持。");
      const isCamera = track.type === "camera";
      if (!(isCamera ? ["position", "target"] : ["position", "rotation", "scale", "color", "opacity", "visible"]).includes(String(track.property))) invalid("轨道属性不支持。");
      if (!Array.isArray(track.keyframes) || track.keyframes.length < 2 || track.keyframes.length > 128) invalid("轨道必须包含2–128个关键帧。");
      const keyframes = (track.keyframes as unknown[]).map((value): MotionKeyframe => {
        const frame = object(value, ["timeMs", "value"]); const timeMs = duration(frame.timeMs, 0, durationMs);
        const input = frame.value;
        if (["position", "target", "rotation", "scale"].includes(String(track.property))) {
          const value = vector(input);
          if (track.property === "scale" && value.some((item) => Math.abs(item) < .001)) invalid("动画缩放不能退化为零。");
          return { timeMs, value };
        }
        if (track.property === "color") { if (typeof input !== "string" || !/^#[0-9a-f]{6}$/i.test(input)) invalid("动画颜色必须为六位十六进制色值。"); return { timeMs, value: input as string }; }
        if (track.property === "opacity") { if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 1) invalid("动画透明度必须是0–1。"); return { timeMs, value: input as number }; }
        if (typeof input !== "boolean") invalid("动画显隐必须是布尔值。"); return { timeMs, value: input as boolean };
      });
      if (keyframes[0].timeMs !== 0 || keyframes.at(-1)!.timeMs !== durationMs || keyframes.some((frame, index) => index > 0 && frame.timeMs <= keyframes[index - 1].timeMs)) invalid("关键帧必须严格递增，并覆盖0到动画时长。");
      if (track.property === "scale") for (let index = 1; index < keyframes.length; index++) {
        const previous = keyframes[index-1].value as MotionVector, current = keyframes[index].value as MotionVector;
        if (current.some((value, axis) => value * previous[axis] < 0)) invalid("相邻缩放关键帧不能跨越零；镜像方向应保持一致。");
      }
      const id = requireIdentifier(track.id, "track.id");
      if (isCamera) { if (track.target !== undefined) invalid("镜头轨道不能指定模型对象。"); return { id, type: "camera", property: track.property as "position" | "target", easing: track.easing as "linear", keyframes: keyframes as MotionKeyframe<MotionVector>[] }; }
      const target = object(track.target, ["instanceId", "objectId"]);
      return { id, type: "object", target: { instanceId: requireIdentifier(target.instanceId, "instanceId"), objectId: target.objectId === null ? null : requireIdentifier(target.objectId, "objectId") }, property: track.property as MotionProperty, easing: track.easing as "linear", keyframes };
    });
    if (new Set(tracks.map((track) => track.id)).size !== tracks.length || new Set(tracks.map(motionChannel)).size !== tracks.length) invalid("轨道ID或动画目标属性重复。");
    return { id: requireIdentifier(input.id, "motion.id"), name: (input.name as string).trim(), version: 1, durationMs, repeat, fill: input.fill as "hold" | "restore", tracks };
  });
  if (new Set(motions.map((motion) => motion.id)).size !== motions.length) invalid("动画ID不能重复。");
  return motions;
}

export function sampleMotionTrack(track: SceneMotionTrack, timeMs: number): MotionValue {
  const frames = track.keyframes;
  if (timeMs <= 0) return structuredClone(frames[0].value);
  if (timeMs >= frames.at(-1)!.timeMs) return structuredClone(frames.at(-1)!.value);
  const index = frames.findIndex((frame) => frame.timeMs > timeMs);
  const from = frames[index - 1], to = frames[index];
  let progress = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
  if (track.easing === "smooth") progress = progress * progress * (3 - 2 * progress);
  if (Array.isArray(from.value) && Array.isArray(to.value)) return from.value.map((value, axis) => value + ((to.value as MotionVector)[axis] - value) * progress) as MotionVector;
  if (typeof from.value === "number" && typeof to.value === "number") return from.value + (to.value - from.value) * progress;
  if (typeof from.value === "boolean") return from.value;
  // Interpolate color in linear light; renderer converts this value to its working space.
  const srgbToLinear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const linearToSrgb = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
  const component = (color: string, offset: number) => srgbToLinear(parseInt(color.slice(offset, offset+2),16)/255);
  return "#" + [1,3,5].map((offset) => { const a = component(from.value as string, offset), b = component(to.value as string, offset); return Math.round(Math.max(0,Math.min(1,linearToSrgb(a+(b-a)*progress))) * 255).toString(16).padStart(2,"0"); }).join("");
}
