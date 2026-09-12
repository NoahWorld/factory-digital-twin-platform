import { AppError } from "./errors";
import { requireIdentifier } from "./canvas-schema";
import type { ModelAsset } from "./model-assets";
import { modelObjectSourceKey, type ModelObject, type ModelAnimation } from "./model-inspection";
import { validateScene, type SceneDefinition } from "./scene-definition";

export type ObjectReplacementMap = Record<string, string | null>;
export type ReplacementReference = { objectId: string; name: string; bindings: number; motionTracks: number; transform: boolean; appearance: boolean; suggestedId: string | null; match: "identity" | "source" | "name" | "unresolved" };
export type ReplacementPlan = { instanceId: string; oldAssetId: string; newAssetId: string; references: ReplacementReference[]; candidates: ModelObject[]; addedObjects: number; removedObjects: number;
  clipReferences: Array<{ clipId: string; name: string; tracks: number; duration: number; maxTime: number; suggestedId: string | null; match: ReplacementReference["match"] }>; clipCandidates: ModelAnimation[] };
const invalid = (message: string): never => { throw new AppError(400, "invalid_model_replacement", message); };

export function referencedInstanceObjects(scene: SceneDefinition, instanceId: string) {
  const instance = scene.instances.find((instance) => instance.id === instanceId);
  if (!instance) invalid("要替换的模型实例不存在。");
  return new Set([...Object.keys(instance!.objectTransforms), ...Object.keys(instance!.objectAppearances), ...scene.assetBindings.filter((binding) => binding.instanceId === instanceId).map((binding) => binding.objectId),
    ...(scene.motions ?? []).flatMap((motion) => motion.tracks.flatMap((track) => track.type === "object" && track.target.instanceId === instanceId && track.target.objectId !== null ? [track.target.objectId] : []))]);
}
export function referencedInstanceClips(scene: SceneDefinition, instanceId: string) {
  return new Set((scene.motions ?? []).flatMap((motion) => motion.tracks.flatMap((track) => track.type === "clip" && track.target.instanceId === instanceId ? [track.clipId] : [])));
}
export function planModelReplacement(scene: SceneDefinition, instanceId: string, previous: ModelAsset, next: ModelAsset): ReplacementPlan {
  const instance = scene.instances.find((instance) => instance.id === instanceId);
  if (!instance || instance.modelAssetId !== previous.id || previous.projectId !== next.projectId) invalid("模型替换的来源或项目不匹配。");
  if (!previous.inspection.objects || !next.inspection.objects) invalid("请先补充两个模型的资源检查报告。");
  const old = previous.inspection.objects!, candidates = next.inspection.objects!.filter((object) => object.inDefaultScene === true);
  const choose = (object?: ModelObject): { suggestedId: string | null; match: ReplacementReference["match"] } => {
    if (!object) return { suggestedId: null, match: "unresolved" };
    if (candidates.some((candidate) => candidate.objectId === object.objectId)) return { suggestedId: object.objectId, match: "identity" };
    const sourceKey = modelObjectSourceKey(object);
    const source = sourceKey ? candidates.filter((candidate) => modelObjectSourceKey(candidate) === sourceKey) : [];
    if (source.length === 1) return { suggestedId: source[0].objectId, match: "source" };
    const names = object.name && !object.nameIsGenerated && old.filter((item) => item.name === object.name).length === 1 ? candidates.filter((candidate) => !candidate.nameIsGenerated && candidate.name === object.name) : [];
    return names.length === 1 ? { suggestedId: names[0].objectId, match: "name" } : { suggestedId: null, match: "unresolved" };
  };
  const oldClips = previous.inspection.clips ?? [], clipCandidates = (next.inspection.clips ?? []).filter((clip) => clip.inDefaultScene);
  const clipReferences = [...referencedInstanceClips(scene,instanceId)].map((clipId) => {
    const clip = oldClips.find((clip) => clip.clipId === clipId);
    let suggestedId: string | null = clipCandidates.find((candidate) => candidate.clipId === clipId)?.clipId ?? null;
    let match: ReplacementReference["match"] = suggestedId ? "identity" : "unresolved";
    if (!suggestedId && clip?.sourceId) { suggestedId = clipCandidates.find((candidate) => candidate.sourceId === clip.sourceId)?.clipId ?? null; if (suggestedId) match = "source"; }
    if (!suggestedId && clip?.name && oldClips.filter((item) => item.name === clip.name).length === 1) {
      const names = clipCandidates.filter((item) => item.name === clip.name); if (names.length === 1) { suggestedId = names[0].clipId; match = "name"; }
    }
    const tracks = (scene.motions ?? []).flatMap((motion) => motion.tracks).filter((track) => track.type === "clip" && track.target.instanceId === instanceId && track.clipId === clipId);
    const maxTime = Math.max(0,...tracks.flatMap((track) => track.keyframes.map((frame) => Number(frame.value))));
    return { clipId,name: clip?.name || `动画片段 ${clipId.slice(0,8)}`,duration: clip?.duration ?? 0,maxTime,tracks: tracks.length,suggestedId,match };
  });
  return { instanceId, oldAssetId: previous.id, newAssetId: next.id, candidates, clipReferences, clipCandidates,
    references: [...referencedInstanceObjects(scene, instanceId)].map((objectId) => ({ objectId, name: old.find((object) => object.objectId === objectId)?.name || `已失效对象 ${objectId.slice(0,8)}`,
      bindings: scene.assetBindings.filter((binding) => binding.instanceId === instanceId && binding.objectId === objectId).length,
      motionTracks: (scene.motions ?? []).flatMap((motion) => motion.tracks).filter((track) => track.type === "object" && track.target.instanceId === instanceId && track.target.objectId === objectId).length,
      transform: !!instance!.objectTransforms[objectId], appearance: !!instance!.objectAppearances[objectId], ...choose(old.find((object) => object.objectId === objectId)) })),
    addedObjects: candidates.filter((candidate) => !old.some((object) => object.objectId === candidate.objectId)).length,
    removedObjects: old.filter((object) => !candidates.some((candidate) => candidate.objectId === object.objectId)).length };
}

export function replaceInstanceResource(scene: SceneDefinition, instanceId: string, expectedAssetId: string, newAssetId: string, value: unknown, clipValue: unknown = {}, clipTimeScales: Record<string,number> = {}): SceneDefinition {
  requireIdentifier(instanceId, "instanceId"); requireIdentifier(expectedAssetId, "expectedAssetId"); requireIdentifier(newAssetId, "newAssetId");
  const instance = scene.instances.find((instance) => instance.id === instanceId);
  if (!instance || instance.modelAssetId !== expectedAssetId) invalid("实例的模型版本已经改变，请重新打开替换预览。");
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("对象映射必须是对象。");
  const map = value as ObjectReplacementMap; const refs = referencedInstanceObjects(scene, instanceId);
  if (Object.keys(map).some((key) => !refs.has(key)) || [...refs].some((id) => !Object.prototype.hasOwnProperty.call(map, id))) invalid("每个受影响对象都必须明确映射或移除。");
  for (const target of Object.values(map)) if (target !== null) requireIdentifier(target, "replacement.objectId");
  const targetIds = Object.values(map).filter((id) => id !== null);
  if (new Set(targetIds).size !== targetIds.length) invalid("多个旧对象不能映射到同一个新对象；请明确移除多余映射。");
  if (!clipValue || typeof clipValue !== "object" || Array.isArray(clipValue)) invalid("动画片段映射必须是对象。");
  const clipMap = clipValue as ObjectReplacementMap, clipRefs = referencedInstanceClips(scene,instanceId);
  if (Object.keys(clipMap).some((id) => !clipRefs.has(id)) || [...clipRefs].some((id) => !Object.hasOwn(clipMap,id))) invalid("每个受影响动画片段都必须明确映射或移除。");
  for (const target of Object.values(clipMap)) if (target !== null) requireIdentifier(target,"replacement.clipId");
  const clipTargets = Object.values(clipMap).filter((id) => id !== null);
  if (new Set(clipTargets).size !== clipTargets.length) invalid("多个旧动画片段不能映射到同一新片段，请明确移除多余轨道。");
  if (!clipTimeScales || typeof clipTimeScales !== "object" || Array.isArray(clipTimeScales) || Object.entries(clipTimeScales).some(([id,scale]) => !clipRefs.has(id) || typeof scale !== "number" || !Number.isFinite(scale) || scale < 0)) invalid("片段时间缩放无效。");
  const replacement = structuredClone(instance!); replacement.modelAssetId = newAssetId;
  const remap = <T>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).flatMap(([id, value]) => map[id] === null ? [] : [[map[id]!, value]]));
  replacement.objectTransforms = remap(replacement.objectTransforms); replacement.objectAppearances = remap(replacement.objectAppearances);
  const motions = scene.motions?.map((motion) => ({ ...motion, tracks: motion.tracks.flatMap((track) => {
    if (track.type === "clip" && track.target.instanceId === instanceId) {
      const nextId = clipMap[track.clipId];
      return nextId === null ? [] : [{ ...track,clipId: nextId,keyframes: track.keyframes.map((frame) => ({ ...frame,value: frame.value * (clipTimeScales[track.clipId] ?? 1) })) }];
    }
    if (track.type !== "object" || track.target.instanceId !== instanceId || track.target.objectId === null) return [track];
    const nextId = map[track.target.objectId];
    return nextId === null ? [] : [{ ...track, target: { ...track.target, objectId: nextId } }];
  }) })).filter((motion) => motion.tracks.length);
  return validateScene({ ...scene, ...(motions === undefined ? {} : { motions }), instances: scene.instances.map((item) => item.id === instanceId ? replacement : item),
    assetBindings: scene.assetBindings.flatMap((binding) => binding.instanceId !== instanceId ? [binding] : map[binding.objectId] === null ? [] : [{ ...binding, objectId: map[binding.objectId]! }]) });
}

export function validateReplacementTargets(plan: ReplacementPlan, map: ObjectReplacementMap, clipMap: ObjectReplacementMap = {}, clipTimeScales: Record<string,number> = {}) {
  const ids = new Set(plan.candidates.map((object) => object.objectId));
  for (const value of Object.values(map)) if (value !== null && !ids.has(value)) invalid("新对象不在候选模型的默认场景中。");
  const clipIds = new Set(plan.clipCandidates.map((clip) => clip.clipId));
  for (const value of Object.values(clipMap)) if (value !== null && !clipIds.has(value)) invalid("新动画片段不在候选模型的可运行场景中。");
  for (const ref of plan.clipReferences) {
    const clip = plan.clipCandidates.find((clip) => clip.clipId === clipMap[ref.clipId]);
    if (clip && ref.maxTime * (clipTimeScales[ref.clipId] ?? 1) > clip.duration + 1e-6) invalid("旧轨道采样时间超出新动画片段范围，请启用同比时间调整或先修改轨道。");
  }
}
