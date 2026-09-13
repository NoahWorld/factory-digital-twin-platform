import { test,expect } from "@playwright/test";
import { resolve } from "node:path";
import { AlarmEngine } from "../apps/runtime/src/alarm-engine";
import { SqliteDatabase } from "../apps/runtime/src/sqlite-database";
import { migrateRuntimeDatabase } from "../apps/runtime/src/migrations";
import type { AlarmEvaluationPlan } from "../shared/alarms";
import type { TelemetryRecord } from "../shared/telemetry";

const input = (value:number|null,quality:TelemetryRecord["quality"]="good",sequence=1,metricKey="temperature"):TelemetryRecord => ({ projectId:"p",scopeId:"draft",configRevision:1,sampleId:`epoch/job/${sequence}`,assetId:"D",assetRecordId:"a",metricKey,sourceId:"s",bindingId:metricKey,value,valueType:"number",unit:"C",sourceTimestamp:null,collectedAt:new Date().toISOString(),quality,errorCode:quality === "good" ? null:"data_source_stale" });
const plan = ():AlarmEvaluationPlan => ({ projectId:"p",scopeId:"draft",revision:1,rules:[{ signature:"temperature-rule",rule:{ id:"high",name:"高温",assetId:"D",enabled:true,severity:"warning",message:"设备温度过高",condition:{ op:"gt",left:{ kind:"metric",assetId:"D",metricKey:"temperature" },right:{ kind:"literal",value:45 } },recoveryCondition:{ op:"lt",left:{ kind:"metric",assetId:"D",metricKey:"temperature" },right:{ kind:"literal",value:40 } } },metrics:[{ metricKey:"temperature",bindingId:"temperature",sourceId:"s",staleAfterSeconds:6 }] }] });

test("alarm episodes trigger once, remain unknown through stale input and restart, recover with hysteresis, and retire on configuration replacement",async ({},testInfo) => {
  const path = testInfo.outputPath("telemetry.sqlite");await migrateRuntimeDatabase(path,resolve("apps/runtime/telemetry-migrations"));const db = new SqliteDatabase(path);let engine = new AlarmEngine(db);
  const accept = (records:TelemetryRecord[]) => { db.connection.exec("BEGIN IMMEDIATE");try { const commit = engine.stage(records);db.connection.exec("COMMIT");commit(); } catch (reason) { db.connection.exec("ROLLBACK");throw reason; } };
  const active = () => db.statement("SELECT * FROM alarm_episodes WHERE ended_at IS NULL").all();
  try {
    const config = plan();engine.configure(config);accept([input(50)]);expect(active()).toHaveLength(1);const id = active()[0].id;
    accept([input(51,"good",2)]);expect(db.statement("SELECT * FROM alarm_events").all()).toHaveLength(1);
    accept([input(null,"stale",3)]);expect(active()[0].id).toBe(id);expect(db.statement("SELECT confirmation FROM alarm_states").get()!.confirmation).toBe("unknown");
    engine = new AlarmEngine(db);engine.configure(config);expect(db.statement("SELECT confirmation FROM alarm_states").get()!.confirmation).toBe("pending");
    accept([input(42,"good",4)]);expect(active()[0].id).toBe(id);accept([input(39,"good",5)]);expect(active()).toHaveLength(0);expect(db.statement("SELECT kind FROM alarm_events ORDER BY id").all().map((row) => row.kind)).toEqual(["triggered","recovered"]);
    accept([input(50,"good",6)]);const second = active()[0].id;
    engine.configure({ ...config,revision:2 });accept([{ ...input(50,"good",7),configRevision:2 }]);expect(active()[0].id).toBe(second);
    engine.configure({ ...config,revision:3,rules:[{ ...config.rules[0],signature:"changed-rule",rule:{ ...config.rules[0].rule,message:"阈值配置更新" } }] });expect(active()).toHaveLength(0);expect(db.statement("SELECT end_reason FROM alarm_episodes WHERE id=?").get(second)!.end_reason).toBe("configuration_changed");
    accept([{ ...input(50,"good",8),configRevision:3 }]);expect(active()).toHaveLength(1);expect(active()[0].id).not.toBe(second);
  } finally { db.close(); }
});

test("same-frame metrics become visible together and rolled-back staged values cannot influence later alarms",async ({},testInfo) => {
  const path = testInfo.outputPath("telemetry.sqlite");await migrateRuntimeDatabase(path,resolve("apps/runtime/telemetry-migrations"));const db = new SqliteDatabase(path),engine = new AlarmEngine(db),config = plan();
  const rule = config.rules[0];rule.metrics.push({ metricKey:"pressure",bindingId:"pressure",sourceId:"s",staleAfterSeconds:6 });rule.rule.recoveryCondition = null;rule.rule.condition = { op:"all",conditions:[rule.rule.condition,{ op:"gt",left:{ kind:"metric",assetId:"D",metricKey:"pressure" },right:{ kind:"literal",value:45 } }] };
  const accept = (values:TelemetryRecord[],rollback=false) => { db.connection.exec("BEGIN IMMEDIATE");const commit = engine.stage(values);db.connection.exec(rollback ? "ROLLBACK":"COMMIT");if (!rollback) commit(); };
  try {
    engine.configure(config);accept([input(10),input(50,"good",1,"pressure")]);accept([input(50,"good",2),input(10,"good",2,"pressure")]);expect(db.statement("SELECT * FROM alarm_events").all()).toEqual([]);
    accept([input(50,"good",3),input(50,"good",3,"pressure")],true);expect(db.statement("SELECT * FROM alarm_events").all()).toEqual([]);
    accept([input(51,"good",4)]);expect(db.statement("SELECT * FROM alarm_events").all()).toEqual([]);
    accept([input(50,"good",5,"pressure")]);expect(db.statement("SELECT * FROM alarm_events").all()).toHaveLength(1);
  } finally { db.close(); }
});

test("alarm retention caps events, preserves unresolved episodes and removes expired ended episodes",async ({},testInfo) => {
  const path = testInfo.outputPath("telemetry.sqlite");await migrateRuntimeDatabase(path,resolve("apps/runtime/telemetry-migrations"));const db = new SqliteDatabase(path),engine = new AlarmEngine(db);
  try {
    engine.configure(plan());db.connection.exec("BEGIN IMMEDIATE");const commit = engine.stage([input(50)]);db.connection.exec("COMMIT");commit();const id = db.statement("SELECT id FROM alarm_episodes WHERE ended_at IS NULL").get()!.id;
    db.statement("WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<200001) INSERT INTO alarm_events(project_id,scope_id,episode_id,kind,observed_at,values_json) SELECT 'p','draft',?,'triggered',?,'[]' FROM seq").run(id,new Date().toISOString());
    engine.prune();expect(db.statement("SELECT COUNT(*) AS n FROM alarm_events").get()!.n).toBe(200000);expect(db.statement("SELECT COUNT(*) AS n FROM alarm_episodes WHERE ended_at IS NULL").get()!.n).toBe(1);
    db.statement("UPDATE alarm_events SET observed_at='2000-01-01T00:00:00.000Z'").run();engine.prune();expect(db.statement("SELECT COUNT(*) AS n FROM alarm_events").get()!.n).toBe(0);expect(db.statement("SELECT COUNT(*) AS n FROM alarm_episodes WHERE ended_at IS NULL").get()!.n).toBe(1);
    db.connection.exec("BEGIN IMMEDIATE");const recovered = engine.stage([input(39,"good",2)]);db.connection.exec("COMMIT");recovered();db.statement("UPDATE alarm_events SET observed_at='2000-01-01T00:00:00.000Z'").run();engine.prune();expect(db.statement("SELECT COUNT(*) AS n FROM alarm_episodes").get()!.n).toBe(0);expect(db.statement("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});
