import { mkdir,readFile,writeFile,readdir,rm,stat,rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AppError,currentProjectEditPredicate,currentProjectCreatePredicate,requireCurrentProjectEditor,type AppEnv,type DatabaseStatement } from "../../api/src/auth";
import { inspectPackageRequest,type InspectedPackage } from "./package-inspector";
import { canonicalJson } from "../../api/src/package-resource-validation";
import { projectPackageIdentity,parseProjectPackageManifest,remapPackageSnapshot,type PackageIdentityMap } from "../../../shared/project-package";
import type { PackageService,PackageInspection,PackageInstallRequest,PackageInstallResult } from "../../../shared/package-service";
import { readPublicationVersion,verifyPublicationResource } from "../../api/src/publications";
import type { ModelAsset } from "../../../shared/model-assets";

const EXPIRES_MS = 60*60*1000;
const uuid = (value:string) => /^[0-9a-f-]{36}$/.test(value);
const hash = (value:string|Uint8Array) => createHash("sha256").update(value).digest("hex");
const cancelled = (signal:AbortSignal) => { if (signal.aborted) throw new AppError(499,"package_install_cancelled","Package installation cancelled."); };
type Owner = { userId:string;createdAt:number;expiresAt:number };
type Identity = { entity_kind:string;source_id:string;target_id:string;resource_sha256:string|null };
const kinds = { assets:"asset",sources:"source",bindings:"binding",models:"model",images:"image" } as const;

export class LocalPackageService implements PackageService {
  private installing = new Set<string>();
  private activeUploads = 0;
  constructor(private env:AppEnv,private directory:string) {}
  private async exclusive<T>(id:string,operation:() => Promise<T>):Promise<T> {
    if (this.installing.has(id)) throw new AppError(409,"package_install_in_progress","This inspection has an active installation or cleanup operation.");
    this.installing.add(id);
    try { return await operation(); } finally { this.installing.delete(id); }
  }
  async initialize() {
    await mkdir(this.directory,{ recursive:true,mode:0o700 });
    for (const entry of await readdir(this.directory,{ withFileTypes:true })) if (entry.isDirectory() && uuid(entry.name)) await this.exclusive(entry.name,() => this.recoverJournal(entry.name));
    await this.prune();
  }
  private async journal(id:string,value:unknown) {
    const filename = join(this.location(id),"install-journal.json"),temporary = join(this.location(id),"install-journal.next");
    await writeFile(temporary,JSON.stringify(value),{ mode:0o600 }); await rename(temporary,filename);
  }
  private async recoverJournal(id:string) {
    let record:{ projectId:string;objects:Array<{ key:string }>;completed?:boolean };
    try { record = JSON.parse(await readFile(join(this.location(id),"install-journal.json"),"utf8")); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === "ENOENT") return; throw reason; }
    if (record.completed) return;
    for (const object of record.objects) {
      if (!uuid(record.projectId) || !object.key.startsWith(`imports/${record.projectId}/${id}/`)) throw new Error("Invalid package installation recovery record.");
      const referenced = await this.env.DB.prepare("SELECT object_key FROM model_assets WHERE object_key=? UNION ALL SELECT object_key FROM image_assets WHERE object_key=? LIMIT 1").bind(object.key,object.key).first();
      if (!referenced) await this.env.PROJECT_FILES!.delete(object.key);
    }
    await this.journal(id,{ ...record,completed:true });
    await rm(join(this.location(id),"cleanup-required.json"),{ force:true });
  }
  private location(id:string) { if (!uuid(id)) throw new AppError(404,"package_inspection_not_found","Package inspection not found."); return join(this.directory,id); }
  private async readOwnerFile(id:string):Promise<Owner> { return JSON.parse(await readFile(join(this.location(id),"owner.json"),"utf8")); }
  private async owner(id:string,userId:string,allowExpired=false) {
    let owner:Owner; try { owner = await this.readOwnerFile(id); } catch { throw new AppError(404,"package_inspection_not_found","Package inspection not found."); }
    if (owner.userId !== userId) throw new AppError(404,"package_inspection_not_found","Package inspection not found.");
    if (!allowExpired && owner.expiresAt <= Date.now()) throw new AppError(410,"package_inspection_expired","Package inspection expired; upload it again.");
    return owner;
  }
  private async prune() {
    for (const entry of await readdir(this.directory,{ withFileTypes:true })) {
      if (!entry.isDirectory() || !uuid(entry.name) || this.installing.has(entry.name)) continue;
      await this.exclusive(entry.name,async () => {
        let owner:Owner; try { owner = await this.readOwnerFile(entry.name); } catch { return; }
        await this.recoverJournal(entry.name);
        if (await this.env.DB.prepare("SELECT 1 FROM project_package_imports WHERE id=?").bind(entry.name).first()) { await rm(join(this.directory,entry.name),{ recursive:true }); return; }
        try { await stat(join(this.directory,entry.name,"cleanup-required.json")); return; } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason; }
        if (typeof owner.expiresAt === "number" && owner.expiresAt < Date.now()) await rm(join(this.directory,entry.name),{ recursive:true });
      });
    }
  }
  async inspect(request:Request,userId:string):Promise<PackageInspection> {
    await this.prune();
    const pendingCount = (await readdir(this.directory)).length;
    if (this.activeUploads >= 2 || pendingCount+this.activeUploads >= 8) throw new AppError(429,"package_staging_limit","Too many pending package uploads; finish or discard an existing inspection.");
    this.activeUploads++;
    const id = crypto.randomUUID(),directory = this.location(id),createdAt = Date.now();
    try {
      const owner:Owner = { userId,createdAt,expiresAt:createdAt+EXPIRES_MS };
      const inspected = await inspectPackageRequest(request,directory,() => writeFile(join(directory,"owner.json"),JSON.stringify(owner),{ flag:"wx",mode:0o600 }));
      const { manifest } = inspected;
      return { id,expiresAt:new Date(owner.expiresAt).toISOString(),projectName:manifest.snapshot.project.name,sourceProjectId:manifest.source.projectId,sourceVersionId:manifest.source.versionId,sourceVersionNumber:manifest.source.versionNumber,pages:manifest.snapshot.definition.pages.length,models:manifest.snapshot.resources.models.length,images:manifest.snapshot.resources.images.length,assets:manifest.snapshot.assets.length,alarms:manifest.snapshot.alarmRules?.length ?? 0,bytes:manifest.files.reduce((total,file) => total+file.byteSize,0),requiredEndpoints:manifest.requiredEndpoints };
    } finally { this.activeUploads--; }
  }
  async discard(id:string,userId:string) { return this.exclusive(id,async () => {
    try { await this.owner(id,userId,true); }
    catch (reason) { if (!await this.env.DB.prepare("SELECT 1 FROM project_package_imports WHERE id=? AND created_by=?").bind(id,userId).first()) throw reason; }
    await this.recoverJournal(id);
    let recovery:{ projectId:string;objects:Array<{ key:string }> }|undefined;
    try { recovery = JSON.parse(await readFile(join(this.location(id),"cleanup-required.json"),"utf8")); } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason; }
    if (recovery) for (const object of recovery.objects) {
      if (!uuid(recovery.projectId) || !object.key.startsWith(`imports/${recovery.projectId}/${id}/`)) throw new AppError(409,"package_cleanup_record_invalid","Package cleanup record is invalid.");
      const referenced = await this.env.DB.prepare("SELECT object_key FROM model_assets WHERE object_key=? UNION ALL SELECT object_key FROM image_assets WHERE object_key=? LIMIT 1").bind(object.key,object.key).first();
      if (!referenced) await this.env.PROJECT_FILES!.delete(object.key);
    }
    await rm(this.location(id),{ recursive:true,force:true });
  }); }
  async install(input:PackageInstallRequest,userId:string,signal:AbortSignal):Promise<PackageInstallResult> {
    return this.exclusive(input.inspectionId,async () => {
      this.location(input.inspectionId);
      const consumed = await this.env.DB.prepare("SELECT project_id,version_id FROM project_package_imports WHERE id=? AND created_by=?").bind(input.inspectionId,userId).first<{ project_id:string;version_id:string }>();
      if (consumed) {
        if (input.targetProjectId && input.targetProjectId !== consumed.project_id) throw new AppError(409,"package_inspection_consumed","This inspection was already installed for a different target.");
        await requireCurrentProjectEditor(this.env,userId,consumed.project_id);
        const { version,snapshot } = await readPublicationVersion(this.env,consumed.project_id,consumed.version_id);
        return { projectId:consumed.project_id,versionId:version.id,versionNumber:version.versionNumber,alreadyInstalled:true,activated:false,requiredEndpoints:[...new Set(snapshot.dataSources.map((source) => source.config.endpointRef!))] };
      }
      await this.owner(input.inspectionId,userId); return this.installOwned(input,userId,signal);
    });
  }
  private async installOwned(input:PackageInstallRequest,userId:string,signal:AbortSignal):Promise<PackageInstallResult> {
    const directory = this.location(input.inspectionId),saved = JSON.parse(await readFile(join(directory,"inspected.json"),"utf8")) as InspectedPackage;
    const wire = saved.wireManifest ?? saved.manifest,manifest = parseProjectPackageManifest(wire),manifestHash = hash(canonicalJson(projectPackageIdentity(wire))),projectId = input.targetProjectId ?? crypto.randomUUID(),isNew = !input.targetProjectId;
    cancelled(signal);
    const consumed = await this.env.DB.prepare("SELECT project_id,version_id,package_manifest_sha256 FROM project_package_imports WHERE id=? AND created_by=?").bind(input.inspectionId,userId).first<{ project_id:string;version_id:string;package_manifest_sha256:string }>();
    if (consumed) {
      if ((input.targetProjectId && input.targetProjectId !== consumed.project_id) || consumed.package_manifest_sha256 !== manifestHash) throw new AppError(409,"package_inspection_consumed","This inspection was already installed for a different target or content.");
      await requireCurrentProjectEditor(this.env,userId,consumed.project_id);
      const { version } = await readPublicationVersion(this.env,consumed.project_id,consumed.version_id);
      return { projectId:consumed.project_id,versionId:version.id,versionNumber:version.versionNumber,alreadyInstalled:true,activated:false,requiredEndpoints:manifest.requiredEndpoints.map((entry) => entry.endpointRef) };
    }
    const current = isNew ? null : await this.env.DB.prepare("SELECT name,runtime_revision FROM projects WHERE id=?").bind(projectId).first<{ name:string;runtime_revision:number }>();
    if (!isNew && !current) throw new AppError(404,"project_not_found","Target project not found.");
    if (!isNew) await requireCurrentProjectEditor(this.env,userId,projectId);
    const prior = isNew ? null : await this.env.DB.prepare("SELECT version_id,package_manifest_sha256 FROM project_package_imports WHERE project_id=? AND source_project_id=? AND source_version_id=?").bind(projectId,manifest.source.projectId,manifest.source.versionId).first<{ version_id:string;package_manifest_sha256:string }>();
    if (prior) {
      if (prior.package_manifest_sha256 !== manifestHash) throw new AppError(409,"package_origin_conflict","The same source version was previously installed with different content.");
      const { version } = await readPublicationVersion(this.env,projectId,prior.version_id);
      return { projectId,versionId:version.id,versionNumber:version.versionNumber,alreadyInstalled:true,activated:false,requiredEndpoints:manifest.requiredEndpoints.map((entry) => entry.endpointRef) };
    }
    if (!isNew && (!Number.isSafeInteger(input.expectedRuntimeRevision) || input.expectedRuntimeRevision !== current!.runtime_revision)) throw new AppError(409,"package_target_changed","Target project changed; refresh before installing this version.");
    const projectName = isNew ? input.projectName?.trim() || manifest.snapshot.project.name : current!.name;
    if (projectName.length < 2 || projectName.length > 100) throw new AppError(400,"invalid_project_name","Project name must contain 2–100 characters.");
    const old = isNew ? [] : (await this.env.DB.prepare("SELECT entity_kind,source_id,target_id,resource_sha256 FROM project_package_identities WHERE project_id=? AND source_project_id=?").bind(projectId,manifest.source.projectId).all<Identity>()).results;
    const mapping:PackageIdentityMap = { projectId,assets:{},sources:{},bindings:{},models:{},images:{} },identities:Identity[] = [];
    const entities = { assets:manifest.snapshot.assets,sources:manifest.snapshot.dataSources,bindings:manifest.snapshot.assetDataBindings,models:manifest.snapshot.resources.models,images:manifest.snapshot.resources.images };
    for (const kind of Object.keys(kinds) as Array<keyof typeof kinds>) for (const item of entities[kind]) {
      const existing = old.find((identity) => identity.entity_kind === kinds[kind] && identity.source_id === item.id),sha256 = "sha256" in item ? item.sha256 : null;
      if (existing && existing.resource_sha256 !== sha256) throw new AppError(409,"package_resource_origin_conflict","A source resource ID was reused with different bytes.");
      const target_id = existing?.target_id ?? crypto.randomUUID(); mapping[kind][item.id] = target_id;
      if (!existing) identities.push({ entity_kind:kinds[kind],source_id:item.id,target_id,resource_sha256:sha256 });
    }
    const snapshot = remapPackageSnapshot(manifest.snapshot,mapping,projectName,current?.runtime_revision ?? 0),config = JSON.stringify(snapshot),versionId = crypto.randomUUID(),now = new Date().toISOString();
    const staged:Array<{ kind:"model"|"image";id:string;key:string;sourceId:string }> = [];
    if (manifest.files.length && !this.env.PROJECT_FILES) throw new AppError(503,"package_storage_unavailable","Package installation requires project file storage.");
    const planned = manifest.files.filter((file) => !old.some((identity) => identity.entity_kind === file.kind && identity.source_id === file.id)).map((file) => {
      const id = mapping[file.kind === "model" ? "models" : "images"][file.id]; return { kind:file.kind,id,key:`imports/${projectId}/${input.inspectionId}/${id}`,sourceId:file.id };
    });
    const journal = { projectId,versionId,objects:planned,completed:false };
    await this.recoverJournal(input.inspectionId); await this.journal(input.inspectionId,journal);
    let committed = false;
    try {
      for (const file of manifest.files) {
        cancelled(signal); const targetId = mapping[file.kind === "model" ? "models" : "images"][file.id];
        if (old.some((identity) => identity.entity_kind === file.kind && identity.source_id === file.id)) { await verifyPublicationResource(this.env,projectId,file.kind,targetId,file,signal); continue; }
        const name = saved.resources[file.path]; if (!/^resource-\d+\.bin$/.test(name)) throw new Error("Invalid private staging filename.");
        const bytes = await readFile(join(directory,name)); if (bytes.length !== file.byteSize || hash(bytes) !== file.sha256) throw new AppError(409,"package_staging_changed","Staged resource integrity changed; upload the package again.");
        const metadata = file.kind === "model" ? snapshot.resources.models.find((model) => model.id === targetId)! : snapshot.resources.images.find((image) => image.id === targetId)!;
        const key = `imports/${projectId}/${input.inspectionId}/${targetId}`;
        await this.env.PROJECT_FILES!.put(key,Uint8Array.from(bytes).buffer,{ httpMetadata:{ contentType:metadata.contentType },customMetadata:{ projectId,assetId:targetId,sha256:file.sha256 } });
        staged.push({ kind:file.kind,id:targetId,key,sourceId:file.id });
      }
      cancelled(signal);
      const revision = current?.runtime_revision ?? 0,guard = `EXISTS(SELECT 1 FROM projects WHERE id=? AND runtime_revision=?) AND ${currentProjectEditPredicate}`,statements:DatabaseStatement[] = [];
      if (isNew) {
        statements.push(this.env.DB.prepare(`INSERT INTO projects(id,name,status,created_at,updated_at,created_by_user_id) SELECT ?,?,'draft',?,?,? WHERE ${currentProjectCreatePredicate}`).bind(projectId,projectName,now,now,userId,userId));
        statements.push(this.env.DB.prepare("INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) SELECT ?,?,'owner',?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=?)").bind(projectId,userId,now,now,projectId));
      }
      const versionStatementIndex = statements.length;
      statements.push(this.env.DB.prepare(`INSERT INTO project_versions(id,project_id,version_number,config_json,created_at,snapshot_sha256,source_revision,created_by,label) SELECT ?,?,COALESCE((SELECT MAX(version_number) FROM project_versions WHERE project_id=?),0)+1,?,?,?,?,?,? WHERE ${guard}`).bind(versionId,projectId,projectId,config,now,hash(config),revision,userId,manifest.source.versionLabel,projectId,revision,userId,projectId));
      const versionGuard = "EXISTS(SELECT 1 FROM project_versions WHERE id=?)";
      const sorted:ModelAsset[] = []; const remaining = [...snapshot.resources.models];
      while (remaining.length) { const index = remaining.findIndex((model) => !model.previousVersionId || sorted.some((item) => item.id === model.previousVersionId)); if (index < 0) throw new Error("Invalid model version order."); sorted.push(remaining.splice(index,1)[0]); }
      for (const model of sorted) {
        const file = staged.find((item) => item.kind === "model" && item.id === model.id); if (!file) continue;
        statements.push(this.env.DB.prepare(`INSERT INTO model_assets(id,project_id,original_filename,format,content_type,byte_size,sha256,object_key,inspection_json,created_by_user_id,created_at,family_id,version_number,previous_version_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${versionGuard}`).bind(model.id,projectId,model.originalFilename,model.format,model.contentType,model.byteSize,model.sha256,file.key,JSON.stringify(model.inspection),userId,model.createdAt,model.familyId,model.versionNumber,model.previousVersionId,versionId));
      }
      for (const image of snapshot.resources.images) {
        const file = staged.find((item) => item.kind === "image" && item.id === image.id); if (!file) continue;
        statements.push(this.env.DB.prepare(`INSERT INTO image_assets(id,project_id,original_filename,format,content_type,byte_size,sha256,object_key,created_by_user_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${versionGuard}`).bind(image.id,projectId,image.originalFilename,image.format,image.contentType,image.byteSize,image.sha256,file.key,userId,image.createdAt,versionId));
      }
      for (const identity of identities) statements.push(this.env.DB.prepare(`INSERT INTO project_package_identities(project_id,source_project_id,entity_kind,source_id,target_id,resource_sha256) SELECT ?,?,?,?,?,? WHERE ${versionGuard}`).bind(projectId,manifest.source.projectId,identity.entity_kind,identity.source_id,identity.target_id,identity.resource_sha256,versionId));
      for (const model of snapshot.resources.models) statements.push(this.env.DB.prepare(`INSERT INTO project_version_model_assets(version_id,model_asset_id) SELECT ?,? WHERE ${versionGuard}`).bind(versionId,model.id,versionId));
      for (const image of snapshot.resources.images) statements.push(this.env.DB.prepare(`INSERT INTO project_version_image_assets(version_id,image_asset_id) SELECT ?,? WHERE ${versionGuard}`).bind(versionId,image.id,versionId));
      statements.push(this.env.DB.prepare(`INSERT INTO project_package_imports(id,project_id,source_project_id,source_version_id,source_snapshot_sha256,package_manifest_sha256,version_id,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${versionGuard}`).bind(input.inspectionId,projectId,manifest.source.projectId,manifest.source.versionId,manifest.source.snapshotSha256,manifestHash,versionId,userId,now,versionId));
      const result = await this.env.DB.batch(statements);
      if (result[versionStatementIndex]?.meta?.changes !== 1) { if (!isNew) await requireCurrentProjectEditor(this.env,userId,projectId); throw new AppError(409,"package_target_changed","Target configuration changed before installation; nothing was installed."); }
      committed = true; await this.journal(input.inspectionId,{ ...journal,completed:true }); const { version } = await readPublicationVersion(this.env,projectId,versionId);
      return { projectId,versionId,versionNumber:version.versionNumber,alreadyInstalled:false,activated:false,requiredEndpoints:manifest.requiredEndpoints.map((entry) => entry.endpointRef) };
    } catch (reason) {
      if (!committed) {
        try { await this.recoverJournal(input.inspectionId); }
        catch { await writeFile(join(directory,"cleanup-required.json"),JSON.stringify({ projectId,objects:planned }),{ mode:0o600 }); throw new AppError(500,"package_cleanup_required","Installation failed; staged object cleanup needs retry. The recovery record is retained with this inspection."); }
      }
      throw reason;
    }
  }
}
