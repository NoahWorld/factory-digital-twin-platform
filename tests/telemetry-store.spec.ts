import { test,expect } from "@playwright/test";
import { join,resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateRuntimeDatabase } from "../apps/runtime/src/migrations";
import { TelemetryStore } from "../apps/runtime/src/telemetry-store";
import { parseTelemetryQuery,type TelemetryRecord } from "../shared/telemetry";

test("history deduplicates scope samples, reports bounded queue and failed writes, prunes and recovers deleted projects",async ({},testInfo) => {
  const path = testInfo.outputPath("telemetry.sqlite");await migrateRuntimeDatabase(path,resolve("apps/runtime/telemetry-migrations"));const store = new TelemetryStore(path),db = new DatabaseSync(path);
  const row:TelemetryRecord = { projectId:"p",scopeId:"draft",configRevision:1,sampleId:"epoch/job/1",assetId:"D",assetRecordId:"a",metricKey:"temperature",sourceId:"s",bindingId:"b",value:42,valueType:"number",unit:"C",sourceTimestamp:null,collectedAt:new Date().toISOString(),quality:"good",errorCode:null };
  try {
    store.enqueue([row,row,{ ...row,scopeId:"version-1" },{ ...row,sampleId:"expired",collectedAt:"2000-01-01T00:00:00.000Z" }]);store.flush();expect(db.prepare("SELECT COUNT(*) AS n FROM metric_history").get()!.n).toBe(2);
    const query = parseTelemetryQuery(new URLSearchParams(),"draft");expect(store.query("p",query).records).toHaveLength(1);expect(store.query("other",query).records).toEqual([]);
    db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON metric_history BEGIN SELECT RAISE(ABORT,'disk fixture'); END;");
    store.enqueue([{ ...row,sampleId:"failed" }]);store.flush();expect(store.diagnostics("p")).toMatchObject({ state:"degraded",errorCode:"telemetry_write_failed",dropped:0,pending:1 });
    db.exec("DROP TRIGGER fail_history");store.flush();expect(db.prepare("SELECT dropped FROM telemetry_health WHERE project_id='p'").get()!.dropped).toBe(0);
    store.enqueue(Array.from({ length:10001 },(_,index) => ({ ...row,sampleId:`bulk-${index}` })));expect(store.diagnostics("p")).toMatchObject({ pending:0,dropped:10001,errorCode:"telemetry_queue_overflow" });
    store.removeProject("p");store.flush();expect(db.prepare("SELECT COUNT(*) AS n FROM metric_history").get()!.n).toBe(0);
    store.enqueue([{ ...row,projectId:"deleted-during-crash" }]);store.flush();await store.reconcileProjects(new Set(["p"]));expect(db.prepare("SELECT COUNT(*) AS n FROM metric_history").get()!.n).toBe(0);
  } finally { store.close();db.close(); }
});


test("shutdown write failures remain explicit and their gap diagnostic survives restarting the store",async ({},testInfo) => {
  const path = testInfo.outputPath("telemetry.sqlite");await migrateRuntimeDatabase(path,resolve("apps/runtime/telemetry-migrations"));const store = new TelemetryStore(path),db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER fail_health BEFORE INSERT ON telemetry_health BEGIN SELECT RAISE(ABORT,'disk fixture'); END;");
  store.reportGap("p","telemetry_queue_overflow",3);
  expect(() => store.close()).toThrow("could not persist");
  db.exec("DROP TRIGGER fail_health");db.close();
  const restored = new TelemetryStore(path);
  try { expect(restored.diagnostics("p")).toMatchObject({ state:"degraded",dropped:3 });restored.flush(); }
  finally { restored.close(); }
  const reopened = new TelemetryStore(path);try { expect(reopened.diagnostics("p")).toMatchObject({ state:"degraded",dropped:3 }); } finally { reopened.close(); }
});

test("old queued good frames cannot clear an alarm uncertainty watermark after a newer quality frame is dropped",async ({},testInfo) => {
  const path = testInfo.outputPath("telemetry.sqlite");await migrateRuntimeDatabase(path,resolve("apps/runtime/telemetry-migrations"));const store = new TelemetryStore(path);
  const row:TelemetryRecord = { projectId:"p",scopeId:"draft",configRevision:1,sampleId:"initial",assetId:"D",assetRecordId:"a",metricKey:"temperature",sourceId:"s",bindingId:"b",value:50,valueType:"number",unit:"C",sourceTimestamp:null,collectedAt:new Date().toISOString(),quality:"good",errorCode:null };
  const query = () => store.queryAlarms("p","draft",{ from:new Date(Date.now()-3600000).toISOString(),to:new Date(Date.now()+1000).toISOString(),before:null,limit:100,state:"all" });
  try {
    store.configureAlarms({ projectId:"p",scopeId:"draft",revision:1,rules:[{ signature:"rule",rule:{ id:"high",name:"High temperature",assetId:"D",enabled:true,severity:"warning",message:"High",condition:{ op:"gt",left:{ kind:"metric",assetId:"D",metricKey:"temperature" },right:{ kind:"literal",value:45 } },recoveryCondition:null },metrics:[{ metricKey:"temperature",bindingId:"b",sourceId:"s",staleAfterSeconds:60 }] }] });
    store.enqueue([row]);store.flush();expect(query().active).toHaveLength(1);
    for (let index=0;index<10000;index++) store.enqueue([{ ...row,sampleId:`older-${index}`,value:30 }]);
    store.enqueue([{ ...row,sampleId:"lost-disconnection",quality:"error",value:null,errorCode:"data_source_disconnected" }]);expect(store.diagnostics("p").dropped).toBe(1);
    while (store.diagnostics("p").pending) store.flush();expect(query().active).toHaveLength(1);expect(query().active[0].confirmation).toBe("unknown");expect(query().records.map((event) => event.kind)).toEqual(["triggered"]);
    store.enqueue([{ ...row,sampleId:"new-confirmation",value:30 }]);store.flush();expect(query().active).toHaveLength(0);expect(query().records.map((event) => event.kind)).toEqual(["recovered","triggered"]);
  } finally { store.close(); }
});
