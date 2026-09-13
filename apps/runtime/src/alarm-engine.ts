import { randomUUID } from "node:crypto";
import { evaluateInteractionCondition } from "../../../shared/interaction-runtime";
import type { AlarmEvaluationPlan,AlarmEvaluationRule,AlarmEpisode,AlarmQuery,AlarmRecord,AlarmRuleStatus } from "../../../shared/alarms";
import type { TelemetryRecord } from "../../../shared/telemetry";
import { SqliteDatabase } from "./sqlite-database";

type State = { rule_id:string;signature:string;active_episode_id:string|null };
/** Uses the telemetry transaction; caller publishes staged memory only after COMMIT. */
export class AlarmEngine {
  private plans = new Map<string,AlarmEvaluationPlan>();
  private latest = new Map<string,Map<string,TelemetryRecord>>();
  private uncertain = new Set<string>();
  private generations = new Map<string,number>();
  generation(projectId:string,scopeId:string) { return this.generations.get(this.scope(projectId,scopeId)) ?? 0; }
  constructor(private db:SqliteDatabase) { this.db.statement("UPDATE alarm_states SET confirmation='pending'").run(); }
  private scope(projectId:string,scopeId:string) { return JSON.stringify([projectId,scopeId]); }
  private metric(assetId:string,metricKey:string) { return JSON.stringify([assetId,metricKey]); }
  private event(projectId:string,scopeId:string,id:string,kind:AlarmRecord["kind"],values:TelemetryRecord[],now:string) {
    this.db.statement("INSERT INTO alarm_events(project_id,scope_id,episode_id,kind,observed_at,values_json) VALUES(?,?,?,?,?,?)").run(projectId,scopeId,id,kind,now,JSON.stringify(values.map(({ metricKey,value,unit,quality,sourceTimestamp }) => ({ metricKey,value,unit,quality,sourceTimestamp }))));
  }
  configured(plan:AlarmEvaluationPlan) { return this.plans.get(this.scope(plan.projectId,plan.scopeId))?.revision === plan.revision; }
  configure(plan:AlarmEvaluationPlan) {
    const key = this.scope(plan.projectId,plan.scopeId);
    if (this.plans.get(key)?.revision === plan.revision) return;
    const now = new Date().toISOString(),rules = new Map(plan.rules.filter((entry) => entry.rule.enabled).map((entry) => [entry.rule.id,entry]));
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const states = this.db.statement("SELECT rule_id,signature,active_episode_id FROM alarm_states WHERE project_id=? AND scope_id=?").all(plan.projectId,plan.scopeId) as State[];
      for (const state of states) if (rules.get(state.rule_id)?.signature !== state.signature) {
        if (state.active_episode_id) {
          this.db.statement("UPDATE alarm_episodes SET ended_at=?,end_reason='configuration_changed' WHERE id=? AND ended_at IS NULL").run(now,state.active_episode_id);
          this.event(plan.projectId,plan.scopeId,state.active_episode_id,"retired",[],now);
        }
        this.db.statement("DELETE FROM alarm_states WHERE project_id=? AND scope_id=? AND rule_id=?").run(plan.projectId,plan.scopeId,state.rule_id);
      }
      for (const { rule,signature } of rules.values()) this.db.statement("INSERT INTO alarm_states(project_id,scope_id,rule_id,signature,rule_json,configuration_revision,confirmation,active_episode_id,updated_at) VALUES(?,?,?,?,?,?,'pending',NULL,?) ON CONFLICT(project_id,scope_id,rule_id) DO UPDATE SET rule_json=excluded.rule_json,configuration_revision=excluded.configuration_revision,confirmation='pending',updated_at=excluded.updated_at").run(plan.projectId,plan.scopeId,rule.id,signature,JSON.stringify(rule),plan.revision,now);
      this.db.connection.exec("COMMIT");this.plans.set(key,plan);this.latest.delete(key);this.uncertain.delete(key);this.generations.set(key,(this.generations.get(key) ?? 0)+1);
    } catch (reason) { this.db.connection.exec("ROLLBACK");throw reason; }
  }
  stage(records:Array<TelemetryRecord & { alarmGeneration?:number }>):() => void {
    const staged = new Map<string,Map<string,TelemetryRecord>>(),stagedGenerations = new Map<string,number>();
    const groups = new Map<string,Array<TelemetryRecord & { alarmGeneration?:number }>>();
    for (const row of records) { const key = JSON.stringify([row.projectId,row.scopeId,row.sampleId]);const group = groups.get(key) ?? [];group.push(row);groups.set(key,group); }
    for (const rows of groups.values()) {
      const first = rows[0],key = this.scope(first.projectId,first.scopeId),plan = this.plans.get(key);
      if (!plan || plan.revision !== first.configRevision) continue;
      const generation = this.generation(first.projectId,first.scopeId);
      if (rows.some((row) => row.alarmGeneration !== undefined && row.alarmGeneration !== generation)) continue;
      stagedGenerations.set(key,generation);
      let latest = staged.get(key);if (!latest) { latest = new Map(this.latest.get(key) ?? []);staged.set(key,latest);if (this.uncertain.has(key)) this.db.statement("UPDATE alarm_states SET confirmation='unknown' WHERE project_id=? AND scope_id=?").run(first.projectId,first.scopeId); }
      // All metrics in the accepted source frame become visible together.
      for (const row of rows) latest.set(this.metric(row.assetId,row.metricKey),row);
      for (const entry of plan.rules) if (entry.rule.enabled && rows.some((row) => row.assetId === entry.rule.assetId && entry.metrics.some((metric) => metric.metricKey === row.metricKey))) this.evaluate(plan,entry,latest);
    }
    return () => { for (const [key,value] of staged) if ((this.generations.get(key) ?? 0) === stagedGenerations.get(key)) { this.latest.set(key,value);this.uncertain.delete(key); } };
  }
  private evaluate(plan:AlarmEvaluationPlan,entry:AlarmEvaluationRule,latest:Map<string,TelemetryRecord>) {
    const { rule } = entry,now = new Date().toISOString();
    const state = this.db.statement("SELECT rule_id,signature,active_episode_id FROM alarm_states WHERE project_id=? AND scope_id=? AND rule_id=?").get(plan.projectId,plan.scopeId,rule.id) as State|undefined;
    if (!state || state.signature !== entry.signature) return;
    const values = entry.metrics.map((metric) => latest.get(this.metric(rule.assetId,metric.metricKey)));
    const available = values.every((row,index) => row && row.quality === "good" && row.value !== null && row.bindingId === entry.metrics[index].bindingId && row.sourceId === entry.metrics[index].sourceId && Date.now()-Date.parse(row.sourceTimestamp ?? row.collectedAt) <= entry.metrics[index].staleAfterSeconds*1000);
    const resolve = (value:Parameters<Parameters<typeof evaluateInteractionCondition>[1]>[0]) => value.kind === "literal" ? value.value:value.kind === "metric" ? latest.get(this.metric(value.assetId,value.metricKey))?.value ?? undefined:undefined;
    const triggered = available ? evaluateInteractionCondition(rule.condition,resolve):undefined;
    const recovered = available ? rule.recoveryCondition ? evaluateInteractionCondition(rule.recoveryCondition,resolve):triggered === undefined ? undefined:!triggered:undefined;
    this.db.statement("UPDATE alarm_states SET confirmation=?,updated_at=? WHERE project_id=? AND scope_id=? AND rule_id=?").run(available && triggered !== undefined ? "known":"unknown",now,plan.projectId,plan.scopeId,rule.id);
    if (!state.active_episode_id && triggered === true) {
      const id = randomUUID();
      this.db.statement("INSERT INTO alarm_episodes(id,project_id,scope_id,rule_id,signature,asset_id,name,severity,message,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,plan.projectId,plan.scopeId,rule.id,entry.signature,rule.assetId,rule.name,rule.severity,rule.message,now);
      this.db.statement("UPDATE alarm_states SET active_episode_id=? WHERE project_id=? AND scope_id=? AND rule_id=?").run(id,plan.projectId,plan.scopeId,rule.id);this.event(plan.projectId,plan.scopeId,id,"triggered",values as TelemetryRecord[],now);
    } else if (state.active_episode_id && recovered === true && triggered !== true) {
      this.db.statement("UPDATE alarm_episodes SET ended_at=?,end_reason='recovered' WHERE id=? AND ended_at IS NULL").run(now,state.active_episode_id);
      this.db.statement("UPDATE alarm_states SET active_episode_id=NULL WHERE project_id=? AND scope_id=? AND rule_id=?").run(plan.projectId,plan.scopeId,rule.id);this.event(plan.projectId,plan.scopeId,state.active_episode_id,"recovered",values as TelemetryRecord[],now);
    }
  }
  prune() {
    const cutoff = new Date(Date.now()-30*86400000).toISOString();
    this.db.statement("DELETE FROM alarm_events WHERE observed_at<?").run(cutoff);
    const count = Number(this.db.statement("SELECT COUNT(*) AS count FROM alarm_events").get()!.count);
    if (count > 200000) this.db.statement("DELETE FROM alarm_events WHERE id IN (SELECT id FROM alarm_events ORDER BY id LIMIT ?)").run(count-200000);
    this.db.statement("DELETE FROM alarm_episodes WHERE ended_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM alarm_events WHERE episode_id=alarm_episodes.id)").run();
  }
  markUncertain(projectId:string,scopeId:string) { const key = this.scope(projectId,scopeId);this.latest.delete(key);this.uncertain.add(key);this.generations.set(key,(this.generations.get(key) ?? 0)+1); }
  deactivate(projectId:string,scopeId:string) { const key = this.scope(projectId,scopeId);this.markUncertain(projectId,scopeId);this.plans.delete(key);this.db.statement("UPDATE alarm_states SET confirmation='pending' WHERE project_id=? AND scope_id=?").run(projectId,scopeId);this.uncertain.delete(key); }
  removeProject(projectId:string) {
    this.db.statement("DELETE FROM alarm_states WHERE project_id=?").run(projectId);this.db.statement("DELETE FROM alarm_episodes WHERE project_id=?").run(projectId);
    for (const key of this.generations.keys()) if (JSON.parse(key)[0] === projectId) { this.plans.delete(key);this.latest.delete(key);this.uncertain.delete(key);this.generations.delete(key); }
  }
  query(projectId:string,scopeId:string,input:AlarmQuery) {
    const active = this.db.statement("SELECT e.id,e.rule_id AS ruleId,e.asset_id AS assetId,e.name,e.severity,e.message,e.occurred_at AS occurredAt,e.ended_at AS endedAt,e.end_reason AS endReason,s.confirmation FROM alarm_episodes e JOIN alarm_states s ON s.active_episode_id=e.id WHERE e.project_id=? AND e.scope_id=? AND e.ended_at IS NULL ORDER BY e.occurred_at DESC LIMIT 201").all(projectId,scopeId) as AlarmEpisode[];
    const rows = this.db.statement("SELECT v.id,v.episode_id AS episodeId,e.rule_id AS ruleId,e.asset_id AS assetId,e.severity,e.message,v.kind,v.observed_at AS observedAt,v.values_json AS valuesJson FROM alarm_events v JOIN alarm_episodes e ON e.id=v.episode_id WHERE v.project_id=? AND v.scope_id=? AND v.observed_at>=? AND v.observed_at<=? AND (? IS NULL OR v.id<?) AND (?='all' OR (?='active' AND e.ended_at IS NULL) OR (?='ended' AND e.ended_at IS NOT NULL)) ORDER BY v.id DESC LIMIT ?").all(projectId,scopeId,input.from,input.to,input.before,input.before,input.state,input.state,input.state,input.limit+1) as Array<Omit<AlarmRecord,"values">&{ valuesJson:string }>;
    const records = rows.slice(0,input.limit).map(({ valuesJson,...row }) => ({ ...row,values:JSON.parse(valuesJson) })) as AlarmRecord[];
    const ruleStates = this.db.statement("SELECT rule_id AS ruleId,confirmation,active_episode_id AS activeEpisodeId FROM alarm_states WHERE project_id=? AND scope_id=? ORDER BY rule_id LIMIT 200").all(projectId,scopeId) as AlarmRuleStatus[];
    if (this.uncertain.has(this.scope(projectId,scopeId))) { for (const episode of active) episode.confirmation = "unknown";for (const state of ruleStates) state.confirmation = "unknown"; }
    return { retentionDays:30,maxEvents:200000,ruleStates,active:active.slice(0,200),activeTruncated:active.length > 200,records,nextCursor:rows.length > input.limit ? records.at(-1)!.id:null };
  }
}
