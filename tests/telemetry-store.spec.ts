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
    store.enqueue([{ ...row,sampleId:"failed" }]);store.flush();expect(store.diagnostics("p")).toMatchObject({ state:"degraded",errorCode:"telemetry_write_failed",dropped:1 });
    db.exec("DROP TRIGGER fail_history");store.flush();expect(db.prepare("SELECT dropped FROM telemetry_health WHERE project_id='p'").get()!.dropped).toBe(1);
    store.enqueue(Array.from({ length:10001 },(_,index) => ({ ...row,sampleId:`bulk-${index}` })));expect(store.diagnostics("p")).toMatchObject({ pending:10000,dropped:2,errorCode:"telemetry_queue_overflow" });
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
