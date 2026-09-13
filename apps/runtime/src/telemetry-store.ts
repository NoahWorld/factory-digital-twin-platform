import { existsSync,readFileSync,writeFileSync,renameSync,rmSync } from "node:fs";
import { SqliteDatabase } from "./sqlite-database";
import type { TelemetryService,TelemetryRecord,TelemetryRow,TelemetryQuery,TelemetryDiagnostic } from "../../../shared/telemetry";

const MAX_PENDING = 10000,MAX_ROWS = 1000000,RETENTION_DAYS = 7;
type Health = { dropped:number;lastPersistedAt:string|null;errorCode:string|null };
/** Bounded writes in a separate WAL database. Queue acceptance is not persistence. */
export class TelemetryStore implements TelemetryService {
  private db:SqliteDatabase;
  private pending:TelemetryRecord[] = [];
  private health = new Map<string,Health>();
  private timer:ReturnType<typeof setInterval>;
  private count:number;
  private lastPruned = 0;
  private closed = false;
  private globalError:string|null = null;
  private writeFailed = false;
  private healthDirty = true;
  private gapPath:string;
  private runningPath:string;
  constructor(path:string) {
    this.gapPath = path+".gaps.json"; this.runningPath = path+".running";
    this.db = new SqliteDatabase(path); this.db.connection.exec("PRAGMA busy_timeout=50;");
    this.count = Number(this.db.statement("SELECT COUNT(*) AS count FROM metric_history").get()!.count);
    this.globalError = this.status("@runtime").errorCode;
    try { const saved = JSON.parse(readFileSync(this.gapPath,"utf8")); this.globalError = saved.globalError; for (const [id,value] of saved.health as Array<[string,Health]>) { const current = this.status(id); this.health.set(id,{ ...value,dropped:Math.max(current.dropped,value.dropped) }); } } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== "ENOENT") { this.db.close(); throw reason; } }
    try {
      if (existsSync(this.runningPath)) { this.globalError ??= "telemetry_unclean_shutdown"; this.reportGap("@runtime",this.globalError); }
      writeFileSync(this.runningPath,new Date().toISOString(),{ mode:0o600 });
    } catch (reason) { this.db.close(); throw reason; }
    this.timer = setInterval(() => this.flush(),100); this.timer.unref();
  }
  private status(projectId:string) {
    let status = this.health.get(projectId);
    if (!status) {
      let row:Health|undefined;
      try { row = this.db.statement("SELECT dropped,last_persisted_at AS lastPersistedAt,error_code AS errorCode FROM telemetry_health WHERE project_id=?").get(projectId) as Health|undefined; } catch { row = { dropped:0,lastPersistedAt:null,errorCode:"telemetry_read_failed" }; }
      status = row ?? { dropped:0,lastPersistedAt:null,errorCode:null }; this.health.set(projectId,status);
    }
    return status;
  }
  enqueue(records:TelemetryRecord[]) {
    if (this.closed || !records.length) return;
    const accepted = Math.max(0,MAX_PENDING-this.pending.length);
    this.pending.push(...records.slice(0,accepted));
    for (const record of records.slice(accepted)) this.reportGap(record.projectId,"telemetry_queue_overflow",1);
  }
  reportGap(projectId:string,code:string,count=0) { const status = this.status(projectId); if (status.errorCode !== code || count) this.healthDirty = true; status.dropped += count; status.errorCode = code; }
  diagnostics(projectId:string):TelemetryDiagnostic { const status = this.status(projectId); return { ...status,state:status.errorCode || this.globalError ? "degraded":"ready",errorCode:status.errorCode ?? this.globalError,pending:this.pending.filter((row) => row.projectId === projectId).length,retentionDays:RETENTION_DAYS,maxRows:MAX_ROWS }; }
  flush() {
    if (this.closed) return;
    const records = this.pending.splice(0,1000),now = new Date().toISOString(),projects = new Set(records.map((row) => row.projectId));
    if (!records.length && Date.now()-this.lastPruned <= 60000 && !this.healthDirty) return;
    const db = this.db.connection; let inserted = 0,removed = 0;
    try {
      db.exec("BEGIN IMMEDIATE");
      const insert = this.db.statement("INSERT OR IGNORE INTO metric_history(project_id,scope_id,config_revision,sample_id,asset_id,asset_record_id,metric_key,source_id,binding_id,value_json,value_type,unit,source_timestamp,collected_at,quality,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      for (const row of records) inserted += Number(insert.run(row.projectId,row.scopeId,row.configRevision,row.sampleId,row.assetId,row.assetRecordId,row.metricKey,row.sourceId,row.bindingId,JSON.stringify(row.value),row.valueType,row.unit,row.sourceTimestamp,row.collectedAt,row.quality,row.errorCode).changes);
      if (Date.now()-this.lastPruned > 60000) removed += Number(this.db.statement("DELETE FROM metric_history WHERE collected_at<?").run(new Date(Date.now()-RETENTION_DAYS*86400000).toISOString()).changes);
      if (this.count+inserted-removed > MAX_ROWS) removed += Number(this.db.statement("DELETE FROM metric_history WHERE id IN (SELECT id FROM metric_history ORDER BY id LIMIT ?)").run(this.count+inserted-removed-MAX_ROWS).changes);
      const writeHealth = this.db.statement("INSERT INTO telemetry_health(project_id,dropped,last_persisted_at,error_code) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET dropped=excluded.dropped,last_persisted_at=excluded.last_persisted_at,error_code=excluded.error_code");
      for (const [id,status] of this.health) writeHealth.run(id,status.dropped,projects.has(id) ? now:status.lastPersistedAt,status.errorCode);
      for (const id of projects) if (!this.health.has(id)) writeHealth.run(id,0,now,null);
      db.exec("COMMIT"); this.writeFailed = false; this.healthDirty = false; this.count += inserted-removed; if (Date.now()-this.lastPruned > 60000) this.lastPruned = Date.now();
      for (const id of projects) this.status(id).lastPersistedAt = now;
      try { rmSync(this.gapPath,{ force:true }); } catch { this.globalError = "telemetry_gap_cleanup_failed"; }
    } catch {
      try { db.exec("ROLLBACK"); } catch { /* Preserve diagnostic; the host still has the database handle. */ }
      this.writeFailed = true; this.healthDirty = true; this.globalError = "telemetry_write_failed"; this.reportGap("@runtime","telemetry_write_failed");
      for (const id of projects) this.reportGap(id,"telemetry_write_failed",records.filter((row) => row.projectId === id).length);
      try { const temporary = this.gapPath+".next"; writeFileSync(temporary,JSON.stringify({ globalError:this.globalError,health:[...this.health] }),{ mode:0o600 }); renameSync(temporary,this.gapPath); }
      catch { console.error(JSON.stringify({ event:"telemetry_gap_persistence_failed",errorCode:"telemetry_write_failed",lostRecords:records.length })); }
    }
  }
  query(projectId:string,input:TelemetryQuery) {
    const rows = this.db.statement(`SELECT id,project_id AS projectId,scope_id AS scopeId,config_revision AS configRevision,sample_id AS sampleId,asset_id AS assetId,asset_record_id AS assetRecordId,metric_key AS metricKey,source_id AS sourceId,binding_id AS bindingId,value_json AS valueJson,value_type AS valueType,unit,source_timestamp AS sourceTimestamp,collected_at AS collectedAt,quality,error_code AS errorCode FROM metric_history WHERE project_id=? AND scope_id=? AND collected_at>=? AND collected_at<=? AND (? IS NULL OR id<?) AND (? IS NULL OR asset_id=?) AND (? IS NULL OR metric_key=?) AND (? IS NULL OR config_revision=?) ORDER BY id DESC LIMIT ?`).all(projectId,input.scopeId,input.from,input.to,input.beforeId,input.beforeId,input.assetId,input.assetId,input.metricKey,input.metricKey,input.configRevision,input.configRevision,input.limit+1) as Array<Omit<TelemetryRow,"value">&{ valueJson:string }>;
    const more = rows.length > input.limit,selected = rows.slice(0,input.limit).map(({ valueJson,...row }) => ({ ...row,value:JSON.parse(valueJson) })) as TelemetryRow[];
    return { records:selected,nextCursor:more ? selected.at(-1)!.id:null };
  }
  removeProject(projectId:string) {
    this.pending = this.pending.filter((row) => row.projectId !== projectId);
    const result = this.db.statement("DELETE FROM metric_history WHERE project_id=?").run(projectId); this.count -= Number(result.changes);
    this.db.statement("DELETE FROM telemetry_health WHERE project_id=?").run(projectId); this.health.delete(projectId);
  }
  async reconcileProjects(ids:Set<string>) {
    const projects = this.db.statement("SELECT DISTINCT project_id AS id FROM metric_history UNION SELECT project_id AS id FROM telemetry_health").all() as Array<{ id:string }>;
    for (const id of new Set([...projects.map((project) => project.id),...this.health.keys()])) if (id !== "@runtime" && !ids.has(id)) this.removeProject(id);
    this.flush();
  }
  close() { if (this.closed) return; clearInterval(this.timer); while (this.pending.length) this.flush(); this.flush(); this.closed = true; this.db.close(); if (this.writeFailed) throw new Error("Telemetry shutdown could not persist all records or diagnostics; retain telemetry gap recovery files."); rmSync(this.runningPath,{ force:true }); }
}
