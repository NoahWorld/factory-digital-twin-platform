import { parseRuntimeProjectSnapshot,type RuntimeProjectSnapshot,type PublicationVersion } from "./runtime-project";

export const MAX_PACKAGE_BYTES = 512*1024*1024;
export const MAX_PACKAGE_ENTRIES = 2001;
export type PackageResource = { path:string;kind:"model" | "image";id:string;byteSize:number;sha256:string };
export type ProjectPackageManifest = {
  kind:"newpower.project-package";packageVersion:1;
  source:{ projectId:string;versionId:string;versionNumber:number;versionLabel:string;snapshotSha256:string };
  snapshot:RuntimeProjectSnapshot;
  requiredEndpoints:Array<{ endpointRef:string;sourceIds:string[] }>;
  files:PackageResource[];
};
const fail = (message:string):never => { throw new Error(`项目包无效：${message}`); };
const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const known = (value:Record<string,unknown>,fields:string[]) => Object.keys(value).every((key) => fields.includes(key));
const identifier = (value:unknown):value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
export const packageResourcePath = (kind:"model" | "image",id:string) => `resources/${kind}/${id}`;

/** The portable copy changes only environment references; source SHA records the
 * originating immutable version, not a claim that the sanitized copy is identical. */
export function createPackageManifest(original:RuntimeProjectSnapshot,version:PublicationVersion):ProjectPackageManifest {
  const snapshot = structuredClone(original),used = new Set(snapshot.dataSources.flatMap((source) => source.config.endpointRef ? [source.config.endpointRef] : []));
  for (const source of snapshot.dataSources) if (!source.config.endpointRef) {
    let endpointRef = `source-${source.id}`,suffix = 1;
    while (used.has(endpointRef)) endpointRef = `source-${source.id}-${suffix++}`;
    used.add(endpointRef); source.config = { ...source.config,url:"",endpointRef,credentialRef:null };
  }
  const endpoints = new Map<string,string[]>();
  for (const source of snapshot.dataSources) (endpoints.get(source.config.endpointRef!) ?? (endpoints.set(source.config.endpointRef!,[]),endpoints.get(source.config.endpointRef!)!)).push(source.id);
  return parseProjectPackageManifest({ kind:"newpower.project-package",packageVersion:1,
    source:{ projectId:original.project.id,versionId:version.id,versionNumber:version.versionNumber,versionLabel:version.label,snapshotSha256:version.sha256 },snapshot,
    requiredEndpoints:[...endpoints].map(([endpointRef,sourceIds]) => ({ endpointRef,sourceIds })),
    files:[...snapshot.resources.models.map((model) => ({ path:packageResourcePath("model",model.id),kind:"model",id:model.id,byteSize:model.byteSize,sha256:model.sha256 })),...snapshot.resources.images.map((image) => ({ path:packageResourcePath("image",image.id),kind:"image",id:image.id,byteSize:image.byteSize,sha256:image.sha256 }))],
  });
}

export function parseProjectPackageManifest(input:unknown):ProjectPackageManifest {
  if (!object(input) || !known(input,["kind","packageVersion","source","snapshot","requiredEndpoints","files"]) || input.kind !== "newpower.project-package" || input.packageVersion !== 1 || !object(input.source)) return fail("不支持的包格式或字段。");
  const source = input.source;
  if (!known(source,["projectId","versionId","versionNumber","versionLabel","snapshotSha256"]) || !identifier(source.projectId) || !identifier(source.versionId) || !Number.isSafeInteger(source.versionNumber) || (source.versionNumber as number) < 1 || typeof source.versionLabel !== "string" || source.versionLabel.length > 200 || typeof source.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.snapshotSha256)) return fail("来源版本信息不正确。");
  const snapshot = parseRuntimeProjectSnapshot(input.snapshot);
  if (snapshot.project.id !== source.projectId || snapshot.dataSources.some((source) => source.config.url !== "" || !source.config.endpointRef)) return fail("项目身份不符或包含未外部化的连接地址。");
  if (!Array.isArray(input.files) || input.files.length+1 > MAX_PACKAGE_ENTRIES) return fail("文件条目过多。");
  const resources = new Map<string,{ byteSize:number;sha256:string }>([...snapshot.resources.models.map((resource) => [packageResourcePath("model",resource.id),resource] as const),...snapshot.resources.images.map((resource) => [packageResourcePath("image",resource.id),resource] as const)]);
  const files = input.files.map((file):PackageResource => {
    if (!object(file) || !known(file,["path","kind","id","byteSize","sha256"]) || (file.kind !== "model" && file.kind !== "image") || !identifier(file.id) || file.path !== packageResourcePath(file.kind,file.id)) return fail("文件路径或类型不正确。");
    const resource = resources.get(file.path as string);
    if (!resource || file.byteSize !== resource.byteSize || file.sha256 !== resource.sha256) return fail("文件清单与资源报告不一致。");
    return { path:file.path as string,kind:file.kind,id:file.id,byteSize:resource.byteSize,sha256:resource.sha256 };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length || files.length !== resources.size) return fail("文件重复或依赖缺失。");
  if (files.reduce((total,file) => total+file.byteSize,0) > MAX_PACKAGE_BYTES) return fail("文件总大小超过512MiB。");
  if (!Array.isArray(input.requiredEndpoints)) return fail("缺少环境端点清单。");
  const requiredEndpoints = input.requiredEndpoints.map((entry):{ endpointRef:string;sourceIds:string[] } => {
    if (!object(entry) || !known(entry,["endpointRef","sourceIds"]) || typeof entry.endpointRef !== "string" || !Array.isArray(entry.sourceIds) || !entry.sourceIds.every(identifier)) return fail("端点清单格式不正确。");
    const expected = snapshot.dataSources.filter((source) => source.config.endpointRef === entry.endpointRef).map((source) => source.id).sort();
    if (!expected.length || JSON.stringify([...entry.sourceIds].sort()) !== JSON.stringify(expected)) return fail("端点清单与数据源引用不一致。");
    return { endpointRef:entry.endpointRef,sourceIds:[...entry.sourceIds] };
  });
  const expectedRefs = new Set(snapshot.dataSources.map((source) => source.config.endpointRef));
  if (new Set(requiredEndpoints.map((entry) => entry.endpointRef)).size !== requiredEndpoints.length || requiredEndpoints.length !== expectedRefs.size) return fail("端点引用缺失或重复。");
  return { kind:"newpower.project-package",packageVersion:1,source:source as ProjectPackageManifest["source"],snapshot,files,requiredEndpoints };
}

export type PackageIdentityMap = { projectId:string;assets:Record<string,string>;sources:Record<string,string>;bindings:Record<string,string>;models:Record<string,string>;images:Record<string,string> };
export function remapPackageSnapshot(input:RuntimeProjectSnapshot,mapping:PackageIdentityMap,name:string,runtimeRevision:number):RuntimeProjectSnapshot {
  const snapshot = structuredClone(input),mapped = (kind:keyof Omit<PackageIdentityMap,"projectId">,id:string) => mapping[kind][id] ?? fail(`缺少${kind}身份映射。`);
  snapshot.project = { id:mapping.projectId,name,runtimeRevision }; snapshot.definition.projectId = mapping.projectId;
  snapshot.assets = snapshot.assets.map((asset) => ({ ...asset,id:mapped("assets",asset.id),projectId:mapping.projectId }));
  snapshot.dataSources = snapshot.dataSources.map((source) => ({ ...source,id:mapped("sources",source.id),projectId:mapping.projectId }));
  snapshot.assetDataBindings = snapshot.assetDataBindings.map((binding) => ({ ...binding,id:mapped("bindings",binding.id),assetRecordId:mapped("assets",binding.assetRecordId),dataSourceId:mapped("sources",binding.dataSourceId) }));
  snapshot.resources.models = snapshot.resources.models.map((model) => ({ ...model,id:mapped("models",model.id),projectId:mapping.projectId,familyId:mapped("models",model.familyId),previousVersionId:model.previousVersionId ? mapped("models",model.previousVersionId) : null }));
  snapshot.resources.images = snapshot.resources.images.map((image) => ({ ...image,id:mapped("images",image.id),projectId:mapping.projectId }));
  for (const page of snapshot.definition.pages) for (const node of page.nodes) node.resourceRefs = node.resourceRefs.map((id) => node.type === "model-3d" ? mapped("models",id) : mapped("images",id));
  for (const scene of snapshot.definition.scenes) for (const instance of scene.instances) instance.modelAssetId = mapped("models",instance.modelAssetId);
  snapshot.legacyModelNames = Object.fromEntries(Object.entries(snapshot.legacyModelNames).map(([id,names]) => [mapped("models",id),names]));
  // Object IDs, clip IDs, business assetIds and project-scoped graph identities
  // deliberately stay opaque and stable; never replace substrings in literals.
  return parseRuntimeProjectSnapshot(snapshot);
}


/** Keep the legacy v1 identity algorithm unchanged. New wire snapshots retain
 * their original validated manifest identity across normalized runtime upgrades. */
export function projectPackageIdentity(input:unknown):unknown {
  const parsed = parseProjectPackageManifest(input);
  return parsed.snapshot.snapshotVersion === 1 ? parsed:input;
}
