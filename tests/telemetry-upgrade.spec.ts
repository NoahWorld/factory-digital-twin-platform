import { test,expect,request as apiRequest } from "@playwright/test";
import { cp,mkdir,readdir } from "node:fs/promises";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes,randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { migrateRuntimeDatabase } from "../apps/runtime/src/migrations";
import { SqliteDatabase } from "../apps/runtime/src/sqlite-database";
import { createUser } from "../apps/api/src/auth";

test("upgrading a history-only runtime backs up telemetry and preserves authenticated history without inventing alarm events",async ({},testInfo) => {
  const directory = testInfo.outputPath("data"),baseline = testInfo.outputPath("baseline-migrations");await mkdir(baseline,{ recursive:true });await cp(resolve("apps/runtime/telemetry-migrations/0001_metric_history.sql"),join(baseline,"0001_metric_history.sql"));
  await migrateRuntimeDatabase(join(directory,"config.sqlite"),resolve("apps/api/migrations"));const config = new SqliteDatabase(join(directory,"config.sqlite")),password = randomBytes(24).toString("hex"),email = "telemetry-upgrade@example.invalid",projectId = randomUUID(),now = new Date().toISOString();
  try { const user = await createUser({ DB:config },{ email,password,displayName:"Upgrade fixture",roles:["platform_admin"] });await config.prepare("INSERT INTO projects(id,name,status,created_by_user_id,created_at,updated_at) VALUES(?,?,'draft',?,?,?)").bind(projectId,"Existing history project",user.id,now,now).run(); } finally { config.close(); }
  const telemetryPath = join(directory,"telemetry.sqlite");await migrateRuntimeDatabase(telemetryPath,baseline);const old = new DatabaseSync(telemetryPath);
  old.prepare("INSERT INTO metric_history(project_id,scope_id,config_revision,sample_id,asset_id,asset_record_id,metric_key,source_id,binding_id,value_json,value_type,unit,collected_at,quality) VALUES(?,'draft',1,'old-epoch/job/1','DEVICE','asset','temperature','source','binding','42','number','C',?,'good')").run(projectId,now);old.close();
  const { startRuntime } = await import(pathToFileURL(resolve("apps/runtime/dist/server.mjs")).href),runtime = await startRuntime({ dataDirectory:directory,port:0 }),api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    expect((await api.post("/api/v1/auth/login",{ data:{ email,password } })).status()).toBe(200);const history = await api.get(`/api/v1/projects/${projectId}/telemetry/history`);expect(history.status()).toBe(200);expect((await history.json()).records).toMatchObject([{ value:42,sampleId:"old-epoch/job/1",unit:"C" }]);
    const alarms = await api.get(`/api/v1/projects/${projectId}/alarms`);expect(alarms.status()).toBe(200);expect((await alarms.json()).records).toEqual([]);
    const backups = (await readdir(join(directory,"telemetry-backups"))).filter((name) => name.endsWith(".sqlite"));expect(backups).toHaveLength(1);const backup = new DatabaseSync(join(directory,"telemetry-backups",backups[0]),{ readOnly:true });try { expect(backup.prepare("SELECT COUNT(*) AS n FROM metric_history").get()!.n).toBe(1);expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='alarm_events'").get()).toBeUndefined(); } finally { backup.close(); }
  } finally { await api.dispose();await runtime.close(); }
});
