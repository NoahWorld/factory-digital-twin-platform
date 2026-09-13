import { queryHistorySeries } from "./history-series";
import type { HistorySeriesQuery } from "../../../shared/history-series";
import { AlarmEngine } from "./alarm-engine";
import type { AlarmEvaluationPlan,AlarmQuery } from "../../../shared/alarms";
import { existsSync,readFileSync,writeFileSync,renameSync,rmSync } from "node:fs";
import { SqliteDatabase } from "./sqlite-database";
import type { TelemetryService,TelemetryRecord,TelemetryRow,TelemetryQuery,TelemetryDiagnostic } from "../../../shared/telemetry";

const MAX_PENDING = 10000,MAX_ROWS = 1000000,RETENTION_DAYS = 7;
type PendingRecord = TelemetryRecord & { alarmGeneration:number };
type Health = { dropped:number;lastPersistedAt:string|null;errorCode:string|null };
/** Bounded writes in a separate WAL database. Queue acceptance is not persistence. */
export class TelemetryStore implements TelemetryService {
  private db:SqliteDatabase;
  private pending:PendingRecord[][] = [];
  private pendingCount = 0;
  private alarms:AlarmEngine;
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
    this.alarms = new AlarmEngine(this.db);
    this.count = Number(this.db.statement("SELECT COUNT(*) AS count FROM metric_history").get()!.count);
    this.globalError = this.status("@runtime").errorCode;
    try { const saved = JSON.parse(readFileSync(this.gapPath,"utf8")); this.globalError = saved.globalError; for (const [id,value] of saved.health as Array<[string,Health]>) { const current = this.status(id); this.health.set(id,{ ...value,dropped:Math.max(current.dropped,value.dropped+(saved.pendingCounts?.[id] ?? 0)) }); } } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== "ENOENT") { this.db.close(); throw reason; } }
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
    // A source frame is accepted atomically, so alarms never see half a frame.
    if (records.length > MAX_PENDING-this.pendingCount) { const counts = new Map<string,number>(); for (const row of records) { counts.set(row.projectId,(counts.get(row.projectId) ?? 0)+1);this.alarms.markUncertain(row.projectId,row.scopeId); } for (const [id,count] of counts) this.reportGap(id,"telemetry_queue_overflow",count);return; }
    this.pending.push(records.map((row) => ({ ...row,alarmGeneration:this.alarms.generation(row.projectId,row.scopeId) })));this.pendingCount += records.length;
  }
  reportGap(projectId:string,code:string,count=0) { const status = this.status(projectId); if (status.errorCode !== code || count) this.healthDirty = true; status.dropped += count; status.errorCode = code; }
  diagnostics(projectId:string):TelemetryDiagnostic { const status = this.status(projectId); return { ...status,state:status.errorCode || this.globalError ? "degraded":"ready",errorCode:status.errorCode ?? this.globalError,pending:this.pending.reduce((count,rows) => count+rows.filter((row) => row.projectId === projectId).length,0),retentionDays:RETENTION_DAYS,maxRows:MAX_ROWS }; }
  flush() {
    if (this.closed) return;
    const records:PendingRecord[] = [],batches:PendingRecord[][] = [];
    while (this.pending.length && (!records.length || records.length+this.pending[0].length <= 1000)) { const batch = this.pending.shift()!;batches.push(batch);records.push(...batch); }
    this.pendingCount -= records.length;
    const now = new Date().toISOString(),projects = new Set(records.map((row) => row.projectId));
    if (!records.length && Date.now()-this.lastPruned <= 60000 && !this.healthDirty) return;
    const db = this.db.connection; let inserted = 0,removed = 0;
    try {
      db.exec("BEGIN IMMEDIATE");
      const insert = this.db.statement("INSERT OR IGNORE INTO metric_history(project_id,scope_id,config_revision,sample_id,asset_id,asset_record_id,metric_key,source_id,binding_id,value_json,value_type,unit,source_timestamp,collected_at,quality,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      const accepted:PendingRecord[] = [];
      for (const row of records) { const changes = Number(insert.run(row.projectId,row.scopeId,row.configRevision,row.sampleId,row.assetId,row.assetRecordId,row.metricKey,row.sourceId,row.bindingId,JSON.stringify(row.value),row.valueType,row.unit,row.sourceTimestamp,row.collectedAt,row.quality,row.errorCode).changes);inserted += changes;if (changes) accepted.push(row); }
      const commitAlarmMemory = this.alarms.stage(accepted);this.alarms.prune();
      if (Date.now()-this.lastPruned > 60000) removed += Number(this.db.statement("DELETE FROM metric_history WHERE collected_at<?").run(new Date(Date.now()-RETENTION_DAYS*86400000).toISOString()).changes);
      if (this.count+inserted-removed > MAX_ROWS) removed += Number(this.db.statement("DELETE FROM metric_history WHERE id IN (SELECT id FROM metric_history ORDER BY id LIMIT ?)").run(this.count+inserted-removed-MAX_ROWS).changes);
      const writeHealth = this.db.statement("INSERT INTO telemetry_health(project_id,dropped,last_persisted_at,error_code) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET dropped=excluded.dropped,last_persisted_at=excluded.last_persisted_at,error_code=excluded.error_code");
      for (const [id,status] of this.health) writeHealth.run(id,status.dropped,projects.has(id) ? now:status.lastPersistedAt,status.errorCode);
      for (const id of projects) if (!this.health.has(id)) writeHealth.run(id,0,now,null);
      db.exec("COMMIT"); commitAlarmMemory(); this.writeFailed = false; this.healthDirty = false; this.count += inserted-removed; if (Date.now()-this.lastPruned > 60000) this.lastPruned = Date.now();
      for (const id of projects) { const status = this.status(id);status.lastPersistedAt = now;if (status.errorCode === "telemetry_write_failed" && status.dropped === 0) { status.errorCode = null;this.healthDirty = true; } }
      const global = this.status("@runtime");if (this.globalError === "telemetry_write_failed" && global.dropped === 0) { this.globalError = null;if (global.errorCode === "telemetry_write_failed") global.errorCode = null;this.healthDirty = true; }
      try { rmSync(this.gapPath,{ force:true }); } catch { this.globalError = "telemetry_gap_cleanup_failed"; }
    } catch {
      try { db.exec("ROLLBACK"); } catch { /* Preserve diagnostic; the host still has the database handle. */ }
      this.writeFailed = true; this.healthDirty = true; this.globalError = "telemetry_write_failed"; this.reportGap("@runtime","telemetry_write_failed");
      this.pending.unshift(...batches);this.pendingCount += records.length;
      for (const row of records) this.alarms.markUncertain(row.projectId,row.scopeId);
      for (const id of projects) this.reportGap(id,"telemetry_write_failed");
      this.persistGap();
    }
  }
  private persistGap() {
    const pendingCounts:Record<string,number> = Object.create(null);for (const rows of this.pending) for (const row of rows) { pendingCounts[row.projectId] = (pendingCounts[row.projectId] ?? 0)+1;this.status(row.projectId); }
    try { const temporary = this.gapPath+".next";writeFileSync(temporary,JSON.stringify({ globalError:this.globalError,health:[...this.health],pendingCounts,uncommittedRecords:this.pendingCount }),{ mode:0o600 });renameSync(temporary,this.gapPath); }
    catch { console.error(JSON.stringify({ event:"telemetry_gap_persistence_failed",errorCode:"telemetry_write_failed",uncommittedRecords:this.pendingCount })); }
  }
  private drain() { while (this.pending.length) { this.flush();if (this.writeFailed) return false; }return true; }
  querySeries(projectId:string,input:HistorySeriesQuery) { return queryHistorySeries(this.db,projectId,input); }
  query(projectId:string,input:TelemetryQuery) {
    const rows = this.db.statement(`SELECT id,project_id AS projectId,scope_id AS scopeId,config_revision AS configRevision,sample_id AS sampleId,asset_id AS assetId,asset_record_id AS assetRecordId,metric_key AS metricKey,source_id AS sourceId,binding_id AS bindingId,value_json AS valueJson,value_type AS valueType,unit,source_timestamp AS sourceTimestamp,collected_at AS collectedAt,quality,error_code AS errorCode FROM metric_history WHERE project_id=? AND scope_id=? AND collected_at>=? AND collected_at<=? AND (? IS NULL OR id<?) AND (? IS NULL OR asset_id=?) AND (? IS NULL OR metric_key=?) AND (? IS NULL OR config_revision=?) ORDER BY id DESC LIMIT ?`).all(projectId,input.scopeId,input.from,input.to,input.beforeId,input.beforeId,input.assetId,input.assetId,input.metricKey,input.metricKey,input.configRevision,input.configRevision,input.limit+1) as Array<Omit<TelemetryRow,"value">&{ valueJson:string }>;
    const more = rows.length > input.limit,selected = rows.slice(0,input.limit).map(({ valueJson,...row }) => ({ ...row,value:JSON.parse(valueJson) })) as TelemetryRow[];
    return { records:selected,nextCursor:more ? selected.at(-1)!.id:null };
  }
  removeProject(projectId:string) {
    this.pending = this.pending.map((rows) => rows.filter((row) => row.projectId !== projectId)).filter((rows) => rows.length); this.pendingCount = this.pending.reduce((count,rows) => count+rows.length,0);
    this.alarms.removeProject(projectId);
    const result = this.db.statement("DELETE FROM metric_history WHERE project_id=?").run(projectId); this.count -= Number(result.changes);
    this.db.statement("DELETE FROM telemetry_health WHERE project_id=?").run(projectId); this.health.delete(projectId);
  }
  configureAlarms(plan:AlarmEvaluationPlan) {
    if (this.alarms.configured(plan)) return;
    if (!this.drain()) throw new Error("Alarm configuration awaits failed telemetry persistence recovery.");
    this.alarms.configure(plan);
  }
  deactivateAlarms(projectId:string,scopeId:string) { this.drain();this.alarms.deactivate(projectId,scopeId); }
  queryAlarms(projectId:string,scopeId:string,input:AlarmQuery) { return this.alarms.query(projectId,scopeId,input); }
  async reconcileProjects(ids:Set<string>) {
    const projects = this.db.statement("SELECT DISTINCT project_id AS id FROM metric_history UNION SELECT project_id AS id FROM telemetry_health UNION SELECT project_id AS id FROM alarm_episodes UNION SELECT project_id AS id FROM alarm_states").all() as Array<{ id:string }>;
    for (const id of new Set([...projects.map((project) => project.id),...this.health.keys()])) if (id !== "@runtime" && !ids.has(id)) this.removeProject(id);
    this.flush();
  }
  close() {
    if (this.closed) return;clearInterval(this.timer);this.drain();
    if (!this.pending.length) this.flush();
    if (this.writeFailed) { for (const rows of this.pending) for (const row of rows) this.reportGap(row.projectId,"telemetry_shutdown_gap",1);this.pending = [];this.pendingCount = 0;this.persistGap(); }
    this.closed = true;this.db.close();
    if (this.writeFailed) throw new Error("Telemetry shutdown could not persist all records or diagnostics; retain telemetry gap recovery files.");
    rmSync(this.runningPath,{ force:true });
  }
}
