import { validateAlarmRules,validateAlarmCatalog,type AlarmRule } from "./alarm-rules";
import { parseProjectDefinition,type ProjectDefinition } from "./project-definition";
import { validateBindingCatalog,type MetricCatalogEntry } from "./component-bindings";
import { interactionAssetIds,ruleValues } from "./interactions";
import type { ModelAsset } from "./model-assets";
import type { Asset } from "../apps/api/src/assets";
import { validateAssetCreate } from "../apps/api/src/assets";
import type { AssetDataBinding } from "../apps/api/src/asset-data-bindings";
import { validateAssetDataBindingCreate } from "../apps/api/src/asset-data-bindings";
import type { DataSource } from "../apps/api/src/data-sources";
import { validateDataSourceCreate } from "../apps/api/src/data-sources";
import type { ImageAsset } from "../apps/api/src/image-assets";
import { modelObjectLocator } from "./model-inspection";

/** Private server snapshot; public running routes return definition/catalog projections.
 * Export must externalize any legacy direct endpoint before packaging this envelope. */
export type LegacyModelNames = { names:Record<string,string[]>;unstableNames:string[] };
export type RuntimeProjectSnapshot = {
  kind:"newpower.runtime-project";snapshotVersion:1|2;
  alarmRules?:AlarmRule[];requiredCapabilities?:string[];
  project:{ id:string;name:string;runtimeRevision:number };
  definition:ProjectDefinition;
  assets:Asset[];assetDataBindings:AssetDataBinding[];dataSources:DataSource[];
  resources:{ models:ModelAsset[];images:ImageAsset[] };
  legacyModelNames:Record<string,LegacyModelNames>;
};
export type PublicationVersion = { id:string;projectId:string;versionNumber:number;label:string;sourceRevision:number;sha256:string;createdAt:string;active:boolean };
export type PublicationPointer = { versionId:string;revision:number;updatedAt:string } | null;
export const MAX_RUNTIME_SNAPSHOT_BYTES = 8*1024*1024;
const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value:unknown):value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const date = (value:unknown):value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const natural = (value:unknown):value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const bad = (message:string):never => { throw new Error(`运行快照无效：${message}`); };
const list = (value:unknown,label:string):Record<string,unknown>[] => { if (!Array.isArray(value) || !value.every(record)) return bad(label); return value; };
const unique = <T>(items:T[],key:(item:T) => string,label:string) => { if (new Set(items.map(key)).size !== items.length) bad(`${label}不能重复。`); };

export function runtimeResourceIds(definition:ProjectDefinition) {
  const nodes = definition.pages.flatMap((page) => page.nodes);
  return {
    models:[...new Set([...nodes.filter((node) => node.type === "model-3d").flatMap((node) => node.resourceRefs),...definition.scenes.flatMap((scene) => scene.instances.map((instance) => instance.modelAssetId))])],
    images:[...new Set(nodes.filter((node) => node.type === "image" || node.type === "carousel").flatMap((node) => node.resourceRefs))],
  };
}

function resourceMetadata(value:Record<string,unknown>,projectId:string,kind:"model" | "image") {
  if (!id(value.id) || value.projectId !== projectId || !date(value.createdAt) || typeof value.originalFilename !== "string" || !value.originalFilename || value.originalFilename.length > 240 || /[/\\\u0000]/.test(value.originalFilename)
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || !natural(value.byteSize) || value.byteSize < 1 || value.byteSize > (kind === "model" ? 25 : 8)*1024*1024) bad("资源元数据或所属项目不正确。");
  const types:Record<string,string> = kind === "model" ? { glb:"model/gltf-binary",gltf:"model/gltf+json" } : { png:"image/png",jpeg:"image/jpeg",webp:"image/webp" };
  if (typeof value.format !== "string" || !Object.hasOwn(types,value.format) || value.contentType !== types[value.format]) bad("资源格式或内容类型不正确。");
}

function modelMetadata(value:Record<string,unknown>,projectId:string):ModelAsset {
  resourceMetadata(value,projectId,"model");
  if (!id(value.familyId) || !natural(value.versionNumber) || value.versionNumber < 1 || !(value.previousVersionId === null || id(value.previousVersionId)) || !record(value.inspection)) bad("模型版本元数据不正确。");
  const report = value.inspection as Record<string,unknown>;
  if (report.format !== value.format || report.reportVersion !== 2 || report.objectManifestVersion !== 2 || report.animationManifestVersion !== 1 || typeof report.gltfVersion !== "string" || !report.gltfVersion.startsWith("2.") || report.externalResourceCount !== 0) bad("模型需要完整的可运行检查报告。");
  for (const field of ["nodeCount","sceneCount","meshCount","materialCount","textureCount","imageCount","animationCount","namedNodeCount","triangleCount","sceneTriangleCount","vertexCount"]) if (!natural(report[field])) bad(`模型报告${field}不正确。`);
  const objects = list(report.objects,"模型对象清单不正确。"),clips = list(report.clips,"模型动画清单不正确。");
  unique(objects,(object) => String(object.objectId),"模型对象ID"); unique(objects,(object) => modelObjectLocator(object as any),"模型对象定位");
  const objectIds = new Set(objects.map((object) => object.objectId));
  for (const object of objects) {
    if (!id(object.objectId) || !natural(object.nodeIndex) || object.nodeIndex >= (report.nodeCount as number) || (object.primitiveIndex !== undefined && !natural(object.primitiveIndex)) || (object.attachment !== undefined && !["mesh","camera","light"].includes(String(object.attachment)))
      || typeof object.name !== "string" || typeof object.mesh !== "boolean" || typeof object.inDefaultScene !== "boolean" || !(object.parentObjectId === null || objectIds.has(object.parentObjectId)) || !(object.sourceId === null || typeof object.sourceId === "string")) bad("模型对象字段或父引用不正确。");
  }
  const parents = new Map(objects.map((object) => [object.objectId,object.parentObjectId])),checked = new Set<unknown>();
  for (const object of objects) {
    const path = new Set<unknown>(); let current:unknown = object.objectId;
    while (current !== null && !checked.has(current)) { if (path.has(current)) bad("模型父引用存在循环。"); path.add(current); current = parents.get(current); }
    path.forEach((entry) => checked.add(entry));
  }
  unique(clips,(clip) => String(clip.clipId),"片段ID"); unique(clips,(clip) => String(clip.animationIndex),"片段索引");
  for (const clip of clips) {
    if (!id(clip.clipId) || !natural(clip.animationIndex) || clip.animationIndex >= (report.animationCount as number) || typeof clip.name !== "string" || typeof clip.startTime !== "number" || !Number.isFinite(clip.startTime) || clip.startTime < 0 || typeof clip.duration !== "number" || !Number.isFinite(clip.duration) || clip.duration < clip.startTime || typeof clip.inDefaultScene !== "boolean" || !Array.isArray(clip.channels)) bad("原生片段字段不正确。");
    for (const channel of clip.channels as unknown[]) if (!record(channel) || !objectIds.has(channel.objectId) || !["translation","rotation","scale","weights"].includes(String(channel.path)) || !["LINEAR","STEP","CUBICSPLINE"].includes(String(channel.interpolation))) bad("原生片段通道不正确。");
  }
  if (!Array.isArray(report.duplicateNodeNames) || !report.duplicateNodeNames.every((name) => typeof name === "string")) bad("模型重复名称报告不正确。");
  return structuredClone(value) as unknown as ModelAsset;
}

export function snapshotMetricCatalog(snapshot:Pick<RuntimeProjectSnapshot,"assets" | "assetDataBindings">):MetricCatalogEntry[] {
  const assets = new Map(snapshot.assets.map((asset) => [asset.id,asset.assetId]));
  return snapshot.assetDataBindings.map((binding) => ({ assetId:assets.get(binding.assetRecordId)!,metricKey:binding.metricKey,valueType:binding.valueType,unit:binding.unit }));
}

export function parseRuntimeProjectSnapshot(input:unknown):RuntimeProjectSnapshot {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_RUNTIME_SNAPSHOT_BYTES) bad("快照元数据超过8MiB预算。");
  if (!record(input) || input.kind !== "newpower.runtime-project" || ![1,2].includes(Number(input.snapshotVersion)) || !record(input.project) || !id(input.project.id) || typeof input.project.name !== "string" || input.project.name.trim().length < 2 || input.project.name.length > 100 || !natural(input.project.runtimeRevision) || !record(input.resources)) return bad("快照格式、版本或项目信息不正确。");
  if (input.snapshotVersion !== 1 && input.snapshotVersion !== 2) return bad("不支持的快照版本。");
  if (input.snapshotVersion === 1 && (input.alarmRules !== undefined || input.requiredCapabilities !== undefined)) bad("旧快照不能携带新告警能力。");
  const alarmRules = input.snapshotVersion === 2 ? validateAlarmRules(input.alarmRules):[];
  const requiredCapabilities = input.snapshotVersion === 2 ? input.requiredCapabilities:[];
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.some((capability) => capability !== "alarm-rules-v1") || new Set(requiredCapabilities).size !== requiredCapabilities.length) bad("运行器不支持包中声明的必要能力。");
  if (alarmRules.length > 0 && !(requiredCapabilities as string[]).includes("alarm-rules-v1")) bad("告警配置缺少必要能力声明。");
  const project = { id:input.project.id,name:input.project.name,runtimeRevision:input.project.runtimeRevision },definition = parseProjectDefinition(input.definition);
  if (definition.projectId !== project.id) bad("项目定义所属项目不一致。");
  const assets = list(input.assets,"资产列表不正确。").map((asset):Asset => {
    if (!id(asset.id) || asset.projectId !== project.id || !date(asset.createdAt) || !date(asset.updatedAt)) return bad("资产身份不正确。");
    const fields = validateAssetCreate({ assetId:asset.assetId,name:asset.name,assetType:asset.assetType,modelNode:asset.modelNode,metadata:asset.metadata });
    return { id:asset.id,projectId:project.id,...fields,createdAt:asset.createdAt,updatedAt:asset.updatedAt };
  });
  unique(assets,(asset) => asset.id,"资产记录ID"); unique(assets,(asset) => asset.assetId,"资产ID"); unique(assets.filter((asset) => asset.modelNode !== null),(asset) => asset.modelNode!,"模型节点映射");
  const dataSources = list(input.dataSources,"数据源列表不正确。").map((source):DataSource => {
    if (!id(source.id) || source.projectId !== project.id || !date(source.createdAt) || !date(source.updatedAt)) return bad("数据源身份不正确。");
    return { id:source.id,projectId:project.id,...validateDataSourceCreate({ name:source.name,sourceType:source.sourceType,config:source.config }),createdAt:source.createdAt,updatedAt:source.updatedAt };
  });
  unique(dataSources,(source) => source.id,"数据源ID");
  const sourceMap = new Map(dataSources.map((source) => [source.id,source])),assetRecords = new Set(assets.map((asset) => asset.id));
  const assetDataBindings = list(input.assetDataBindings,"指标映射列表不正确。").map((binding):AssetDataBinding => {
    if (!id(binding.id) || !id(binding.assetRecordId) || !assetRecords.has(binding.assetRecordId) || !date(binding.createdAt) || !date(binding.updatedAt)) return bad("指标映射所属资产不正确。");
    const fields = validateAssetDataBindingCreate({ dataSourceId:binding.dataSourceId,metricKey:binding.metricKey,sourcePath:binding.sourcePath,valueType:binding.valueType,unit:binding.unit,staleAfterSeconds:binding.staleAfterSeconds });
    const source = sourceMap.get(fields.dataSourceId); if (!source) return bad("指标映射数据源缺失。");
    return { id:binding.id,assetRecordId:binding.assetRecordId,...fields,dataSourceName:source.name,dataSourceType:source.sourceType,createdAt:binding.createdAt,updatedAt:binding.updatedAt };
  });
  unique(assetDataBindings,(binding) => binding.id,"指标映射ID"); unique(assetDataBindings,(binding) => JSON.stringify([binding.assetRecordId,binding.metricKey]),"资产指标键");
  const resources = { models:list(input.resources.models,"模型资源清单不正确。").map((value) => modelMetadata(value,project.id)),images:list(input.resources.images,"图片资源清单不正确。").map((value) => { resourceMetadata(value,project.id,"image"); return structuredClone(value) as unknown as ImageAsset; }) };
  unique(resources.models,(model) => model.id,"模型资源ID"); unique(resources.images,(image) => image.id,"图片资源ID");
  const legacyModelNames:Record<string,LegacyModelNames> = Object.create(null);
  if (!record(input.legacyModelNames)) bad("旧模型运行名称清单缺失。");
  for (const [assetId,manifest] of Object.entries(input.legacyModelNames as Record<string,unknown>)) {
    const model = resources.models.find((model) => model.id === assetId); if (!model || !record(manifest) || !record(manifest.names) || !Array.isArray(manifest.unstableNames) || !manifest.unstableNames.every((name) => typeof name === "string")) bad("旧模型名称清单所属资源不正确。");
    const locators = new Set(model!.inspection.objects?.filter((object) => object.inDefaultScene).map(modelObjectLocator));
    const names = (manifest as LegacyModelNames).names,unstableNames = (manifest as LegacyModelNames).unstableNames;
    const copied:Record<string,string[]> = Object.create(null);
    for (const [name,values] of Object.entries(names)) {
      if (!name || !Array.isArray(values) || !values.length || !values.every((value) => typeof value === "string" && locators.has(value))) bad("旧模型名称定位清单不正确。");
      copied[name] = [...values as string[]];
    }
    if (unstableNames.some((name) => !Object.hasOwn(copied,name))) bad("不稳定名称未包含在旧模型清单中。");
    legacyModelNames[assetId] = { names:copied,unstableNames:[...new Set(unstableNames)] };
  }
  const snapshot:RuntimeProjectSnapshot = { kind:"newpower.runtime-project",snapshotVersion:input.snapshotVersion,...(input.snapshotVersion === 2 ? { alarmRules,requiredCapabilities:requiredCapabilities as string[] }:{}),project,definition,assets,assetDataBindings,dataSources,resources,legacyModelNames };
  const modelMap = new Map(resources.models.map((model) => [model.id,model]));
  for (const model of resources.models) {
    const root = modelMap.get(model.familyId),previous = model.previousVersionId ? modelMap.get(model.previousVersionId) : undefined;
    if (!root || root.versionNumber !== 1 || root.previousVersionId !== null || (model.versionNumber === 1 && model.id !== model.familyId) || (model.versionNumber > 1 && (!previous || previous.familyId !== model.familyId || previous.versionNumber >= model.versionNumber))) bad("模型资源版本链不完整或不一致。");
  }
  validateSnapshotReferences(snapshot); return snapshot;
}

export function validateSnapshotReferences(snapshot:RuntimeProjectSnapshot) {
  const { definition,resources } = snapshot,ids = runtimeResourceIds(definition),models = new Map(resources.models.map((model) => [model.id,model])),images = new Set(resources.images.map((image) => image.id)),assets = new Set(snapshot.assets.map((asset) => asset.assetId)),catalog = snapshotMetricCatalog(snapshot);
  validateAlarmCatalog(snapshot.alarmRules ?? [],catalog,assets);
  if (ids.models.some((id) => !models.has(id)) || ids.images.some((id) => !images.has(id))) bad("页面或场景依赖的资源缺失。");
  for (const binding of definition.dataBindings) { const error = validateBindingCatalog(binding,catalog); if (error) bad(error); }
  for (const assetId of interactionAssetIds(definition.interactions)) if (!assets.has(assetId)) bad(`交互引用的资产${assetId}不存在。`);
  for (const rule of definition.interactions.rules) for (const value of ruleValues(rule)) if (value.kind === "metric" && !catalog.some((item) => item.assetId === value.assetId && item.metricKey === value.metricKey)) bad("交互引用的指标不存在。");
  for (const rule of definition.interactions.rules) if (rule.trigger.type === "data.change" && rule.trigger.sourceId && rule.trigger.metricKey && !catalog.some((item) => item.assetId === rule.trigger.sourceId && item.metricKey === rule.trigger.metricKey)) bad("交互触发器引用的指标不存在。");
  const legacyAssets = new Set(definition.pages.flatMap((page) => page.nodes).filter((node) => node.type === "model-3d" && !node.sceneId).flatMap((node) => node.resourceRefs));
  if (legacyAssets.size) for (const asset of snapshot.assets) if (asset.modelNode !== null) {
    const matches = [...legacyAssets].map((id) => snapshot.legacyModelNames[id]?.names[asset.modelNode!]);
    if (!matches.some((values) => values?.length === 1) || matches.some((values) => values && values.length > 1) || [...legacyAssets].some((id) => snapshot.legacyModelNames[id]?.unstableNames.includes(asset.modelNode!))) bad(`旧资产映射${asset.assetId}/${asset.modelNode}无法在模型中稳定且唯一定位，请先在3D编辑器转换为可复用场景并核对对象绑定。`);
  }
  for (const page of definition.pages) for (const asset of snapshot.assets) if (asset.modelNode !== null) {
    const matches = page.nodes.filter((node) => node.type === "model-3d" && !node.sceneId).reduce((count,node) => count+(snapshot.legacyModelNames[node.resourceRefs[0]]?.names[asset.modelNode!]?.length ?? 0),0);
    if (matches > 1) bad(`页面${page.name}的资产${asset.assetId}匹配多个旧模型对象。`);
  }
  for (const node of definition.pages.flatMap((page) => page.nodes)) if (node.type === "model-3d" && !node.sceneId) {
    if (!node.resourceRefs.length) bad(`三维组件${node.id}尚未配置模型。`);
    const names = snapshot.legacyModelNames[node.resourceRefs[0]];
    if (!names) bad("旧模型运行名称清单缺失。");
    for (const name of [...Object.keys(node.props.transformOverrides as object ?? {}),...Object.keys(node.props.appearanceOverrides as object ?? {})]) if (names.names[name]?.length !== 1 || names.unstableNames.includes(name)) bad(`旧模型节点${name}无法稳定且唯一定位，请先转换为可复用场景并核对对象覆盖。`);
  }
  for (const scene of definition.scenes) {
    const instances = new Map(scene.instances.map((instance) => [instance.id,instance]));
    const validObject = (instanceId:string,objectId:string) => models.get(instances.get(instanceId)!.modelAssetId)?.inspection.objects?.some((object) => object.objectId === objectId && object.inDefaultScene);
    for (const instance of scene.instances) for (const objectId of [...Object.keys(instance.objectTransforms),...Object.keys(instance.objectAppearances)]) if (!validObject(instance.id,objectId)) bad("实例覆盖引用的对象不属于当前资源。");
    for (const binding of scene.assetBindings) if (!assets.has(binding.assetId) || !validObject(binding.instanceId,binding.objectId)) bad("三维资产或对象映射已失效。");
    for (const motion of scene.motions ?? []) for (const track of motion.tracks) {
      if (track.type === "object" && track.target.objectId !== null && !validObject(track.target.instanceId,track.target.objectId)) bad("动画对象引用已失效。");
      if (track.type === "clip") {
        const clip = models.get(instances.get(track.target.instanceId)!.modelAssetId)!.inspection.clips?.find((clip) => clip.clipId === track.clipId && clip.inDefaultScene);
        if (!clip || track.keyframes.some((frame) => frame.value > clip.duration+1e-6)) bad("原生动画片段或采样范围已失效。");
      }
    }
  }
}
