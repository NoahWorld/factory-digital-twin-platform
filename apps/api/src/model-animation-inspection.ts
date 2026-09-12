import type { Root, Node, GLTF } from "@gltf-transform/core";
import type { ModelAnimation, ModelObject } from "../../../shared/model-inspection";

/** Validate decoded core glTF animation samplers without copying their keyframes into the report. */
export function inspectModelAnimations(root: Root, objects: ModelObject[], visible: Set<Node>, source: GLTF.IGLTF): ModelAnimation[] {
  const nodes = root.listNodes(); const nodeIndices = new Map(nodes.map((node,index) => [node,index]));
  const nodeObjects = new Map(objects.filter((object) => object.primitiveIndex === undefined && !object.attachment).map((object) => [object.nodeIndex,object]));
  const sourceIds = new Set<string>(); let work = 0;
  return root.listAnimations().map((animation,animationIndex) => {
    const sourceId = animation.getExtras().newpowerAnimationId;
    if (sourceId !== undefined && (typeof sourceId !== "string" || !sourceId.trim() || sourceId.length > 200 || sourceIds.has(sourceId))) throw new Error(`animations[${animationIndex}].extras.newpowerAnimationId 必须非空且唯一`);
    if (typeof sourceId === "string") sourceIds.add(sourceId);
    if (!animation.listChannels().length) throw new Error(`动画 ${animationIndex} 没有通道`);
    let startTime = Infinity, duration = 0, inDefaultScene = true;
    const targets = new Set<string>();
    const channels = animation.listChannels().map((channel,channelIndex) => {
      const target = channel.getTargetNode(), path = channel.getTargetPath(), sampler = channel.getSampler();
      if (!target || !path || !["translation","rotation","scale","weights"].includes(path) || !sampler) throw new Error(`动画 ${animationIndex} 的通道目标或采样器不支持`);
      const index = nodeIndices.get(target)!; const identity = nodeObjects.get(index);
      if (!identity) throw new Error(`动画 ${animationIndex} 的目标节点缺失`);
      const key = JSON.stringify([index,path]); if (targets.has(key)) throw new Error(`动画 ${animationIndex} 包含重复目标属性`); targets.add(key);
      if (path !== "weights" && source.nodes?.[index].matrix !== undefined) throw new Error(`动画 ${animationIndex} 的 TRS 目标不能同时定义 matrix`);
      inDefaultScene &&= visible.has(target);
      const input = sampler.getInput(), output = sampler.getOutput(), interpolation = sampler.getInterpolation();
      const rawAnimation = source.animations?.[animationIndex];
      const rawInput = rawAnimation && source.accessors?.[rawAnimation.samplers[rawAnimation.channels[channelIndex].sampler].input];
      if (!rawInput?.min || !rawInput.max) throw new Error(`动画 ${animationIndex} 的时间输入缺少 min/max`);
      if (!input || input.getType() !== "SCALAR" || input.getComponentType() !== 5126 || input.getNormalized() || input.getCount() < 1) throw new Error(`动画 ${animationIndex} 的时间输入必须是非空 FLOAT SCALAR`);
      if (!output || !["LINEAR","STEP","CUBICSPLINE"].includes(interpolation)) throw new Error(`动画 ${animationIndex} 缺少受支持的输出或插值方式`);
      const outputType = path === "rotation" ? "VEC4" : path === "weights" ? "SCALAR" : "VEC3";
      const float = output.getComponentType() === 5126 && !output.getNormalized();
      const normalized = [5120,5121,5122,5123].includes(output.getComponentType()) && output.getNormalized();
      if (output.getType() !== outputType || (!float && !((path === "rotation" || path === "weights") && normalized))) throw new Error(`动画 ${animationIndex} 的 ${path} 输出类型无效`);
      let weightCount = 1;
      if (path === "weights") {
        const counts = target.getMesh()?.listPrimitives().map((primitive) => primitive.listTargets().length) ?? [];
        weightCount = counts[0] ?? 0;
        if (!weightCount || counts.some((count) => count !== weightCount)) throw new Error(`动画 ${animationIndex} 的形态目标数量无效`);
      }
      const multiplier = interpolation === "CUBICSPLINE" ? 3 : 1;
      if (multiplier === 3 && input.getCount() < 2) throw new Error(`动画 ${animationIndex} 的立方插值至少需要两个关键帧`);
      if (output.getCount() !== input.getCount() * multiplier * weightCount) throw new Error(`动画 ${animationIndex} 的输出数量与关键帧/形态目标数量不匹配`);
      work += input.getCount() + output.getCount() * output.getElementSize();
      if (work > 20_000_000) throw new Error("动画检查超过2000万分量预算，请拆分模型");
      let previous = -Infinity;
      for (let frame = 0; frame < input.getCount(); frame++) {
        const time = input.getScalar(frame);
        if (!Number.isFinite(time) || time < 0 || time <= previous) throw new Error(`动画 ${animationIndex} 时间必须非负、有限且严格递增`);
        previous = time; startTime = Math.min(startTime,time); duration = Math.max(duration,time);
      }
      if (rawInput.min.length !== 1 || rawInput.max.length !== 1 || typeof rawInput.min[0] !== "number" || typeof rawInput.max[0] !== "number" || Math.fround(rawInput.min[0]) !== input.getScalar(0) || Math.fround(rawInput.max[0]) !== previous) throw new Error(`动画 ${animationIndex} 的时间 min/max 与实际关键帧不一致`);
      const values: number[] = [];
      for (let frame = 0; frame < output.getCount(); frame++) {
        output.getElement(frame,values);
        if (values.some((value) => !Number.isFinite(value))) throw new Error(`动画 ${animationIndex} 输出包含非有限数值`);
        if (path === "rotation" && (multiplier === 1 || frame % 3 === 1)) {
          const tolerance = output.getComponentType() === 5126 ? .001 : [5120,5121].includes(output.getComponentType()) ? .01 : .0001;
          if (Math.abs(Math.hypot(...values)-1) > tolerance) throw new Error(`动画 ${animationIndex} 旋转值必须是单位四元数`);
        }
      }
      return { objectId: identity.objectId, path, interpolation };
    });
    return { clipId: crypto.randomUUID(),animationIndex,name: animation.getName(),sourceId: typeof sourceId === "string" ? sourceId : null,startTime,duration,inDefaultScene,channels };
  });
}
