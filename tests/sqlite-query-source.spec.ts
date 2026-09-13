import { test,expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdir,readFile,link,symlink } from "node:fs/promises";
import { join,resolve } from "node:path";
import { createSqliteQuerySource } from "../apps/runtime/src/sqlite-query-source";
import { validateSqliteQuery } from "../apps/runtime/src/sqlite-query-contract";
import type { DataSource } from "../apps/api/src/data-sources";
import type { AppEnv } from "../apps/api/src/auth";
const source:DataSource = { id:"query-source",projectId:"project",name:"Private query",sourceType:"sqlite_query",config:{ url:"",credentialRef:null,queryRef:"equipment",intervalSeconds:1,timeoutMs:1000,timestampPath:null },createdAt:"",updatedAt:"" };
async function fixture(root:string) {
  const directory = join(root,"runtime"),databasePath = join(root,"source.sqlite");await mkdir(directory,{ recursive:true });
  for (const name of ["config.sqlite","telemetry.sqlite"]) { const db = new DatabaseSync(join(directory,name));db.exec("CREATE TABLE private(value TEXT)");db.close(); }
  const db = new DatabaseSync(databasePath);db.exec("CREATE TABLE samples(id INTEGER PRIMARY KEY,temperature REAL,note TEXT,raw BLOB,large INTEGER); INSERT INTO samples VALUES(1,42.5,NULL,x'0102',9223372036854775807); INSERT INTO samples VALUES(2,NULL,'second',NULL,2);");db.close();
  const definition = { projectIds:["project"],databasePath,sql:"SELECT id,temperature,note FROM samples WHERE id=?",parameters:[1],tables:{ samples:["id","temperature","note","raw","large"] },maxRows:10 };
  const env = { RUNTIME_POLLING_ENABLED:"true" } as AppEnv,create = (patch:Record<string,unknown> = {}) => createSqliteQuerySource(env,{ sqliteQueries:{ equipment:validateSqliteQuery({ ...definition,...patch }) } },{ directory,environmentDirectory:root,workerPath:resolve("apps/runtime/dist/sqlite-query-worker.mjs") });
  return { directory,databasePath,definition,create };
}

test("private SQLite queries preserve NULL and safe values with exact column and row contracts",async ({},testInfo) => {
  const f = await fixture(testInfo.outputPath("query"));const sample = await f.create()(source,"request");expect(sample.payload).toEqual({ rows:[{ id:1,temperature:42.5,note:null }] });
  expect((await f.create({ sql:"SELECT id,temperature FROM samples WHERE id=99",parameters:[] })(source,"request")).payload).toEqual({ rows:[] });
  expect((await f.create({ sql:"SELECT count(*) AS n FROM samples",parameters:[] })(source,"request")).payload).toEqual({ rows:[{ n:2 }] });
  await expect(f.create({ sql:"SELECT large FROM samples WHERE id=1",parameters:[] })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_integer_precision" });
  await expect(f.create({ sql:"SELECT raw FROM samples WHERE id=1",parameters:[] })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_value_type_invalid" });
  await expect(f.create({ sql:"SELECT id AS value,temperature AS value FROM samples",parameters:[] })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_columns_invalid" });
  await expect(f.create({ sql:"SELECT id FROM samples",parameters:[],maxRows:1 })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_row_limit" });
});

test("SQLite denies writes, extra statements, unauthorized columns, dangerous functions and own runtime files",async ({},testInfo) => {
  const f = await fixture(testInfo.outputPath("query")),before = await readFile(f.databasePath);
  for (const sql of ["DELETE FROM samples","PRAGMA table_info(samples)","ATTACH ':memory:' AS other","SELECT load_extension('private-extension')","CREATE TABLE extra(value)"]) {
    await expect(f.create({ sql,parameters:[] })(source,"request"),sql).rejects.toMatchObject({ code:"sqlite_query_not_allowed" });
  }
  await expect(f.create({ sql:"SELECT id FROM samples; DELETE FROM samples",parameters:[] })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_multiple_statements" });
  await expect(f.create({ sql:"SELECT temperature FROM samples",parameters:[],tables:{ samples:["id"] } })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_not_allowed" });
  expect(() => validateSqliteQuery({ ...f.definition,sql:"SELECT id FROM samples\0; DELETE FROM samples" })).toThrow();
  await expect(f.create()({ ...source,projectId:"outsider" },"request")).rejects.toMatchObject({ code:"sqlite_query_not_authorized" });
  const hardlink = join(testInfo.outputPath("query"),"runtime-hardlink.sqlite"),alias = join(testInfo.outputPath("query"),"runtime-symlink.sqlite");await link(join(f.directory,"config.sqlite"),hardlink);await symlink(join(f.directory,"config.sqlite"),alias);
  for (const databasePath of [join(f.directory,"config.sqlite"),hardlink,alias]) await expect(f.create({ databasePath })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_file_not_allowed" });
  expect(await readFile(f.databasePath)).toEqual(before);
});

test("query total timeout, cancellation and process capacity recover without blocking the caller",async ({},testInfo) => {
  const f = await fixture(testInfo.outputPath("query")),sql = "WITH RECURSIVE counter(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM counter) SELECT sum(x) FROM counter",collect = f.create({ sql,parameters:[] });
  const running = collect(source,"request");let queryFinished = false;void running.catch(() => {}).finally(() => { queryFinished = true; });await new Promise((resolve) => setTimeout(resolve,50));expect(queryFinished).toBe(false);await expect(running).rejects.toMatchObject({ code:"sqlite_query_timeout" });
  const controllers = Array.from({ length:6 },() => new AbortController()),jobs = controllers.map((controller) => collect(source,"request",controller.signal));for (const job of jobs) void job.catch(() => {});
  await expect(collect(source,"over-capacity")).rejects.toMatchObject({ code:"sqlite_query_capacity" });for (const controller of controllers) controller.abort();for (const job of jobs) await expect(job).rejects.toMatchObject({ code:"data_source_cancelled" });
  expect((await f.create()(source,"recovered")).payload).toEqual({ rows:[{ id:1,temperature:42.5,note:null }] });
});


test("keyed SQLite results preserve device identity when rows disappear and reject duplicate keys",async ({},testInfo) => {
  const f = await fixture(testInfo.outputPath("query")),definition = { sql:"SELECT 'DEVICE-' || id AS assetId,temperature FROM samples ORDER BY id",parameters:[],rowKey:"assetId" };
  expect((await f.create(definition)(source,"request")).payload).toEqual({ records:{ "DEVICE-1":{ assetId:"DEVICE-1",temperature:42.5 },"DEVICE-2":{ assetId:"DEVICE-2",temperature:null } } });
  const db = new DatabaseSync(f.databasePath);db.exec("DELETE FROM samples WHERE id=1");db.close();expect((await f.create(definition)(source,"request")).payload).toEqual({ records:{ "DEVICE-2":{ assetId:"DEVICE-2",temperature:null } } });
  await expect(f.create({ ...definition,sql:"SELECT 'DEVICE' AS assetId FROM samples UNION ALL SELECT 'DEVICE' AS assetId FROM samples" })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_row_key_invalid" });
});

test("views and virtual table internals cannot expose unregistered data",async ({},testInfo) => {
  const f = await fixture(testInfo.outputPath("query")),db = new DatabaseSync(f.databasePath);db.exec("CREATE VIEW exposure AS SELECT large FROM samples; CREATE VIEW safe_view AS SELECT id,temperature FROM samples; CREATE VIRTUAL TABLE search USING fts5(content); INSERT INTO search VALUES('private fixture text');");db.close();
  expect((await f.create({ sql:"SELECT * FROM safe_view WHERE id=1",parameters:[],tables:{ safe_view:["id","temperature"],samples:["id","temperature"] } })(source,"request")).payload).toEqual({ rows:[{ id:1,temperature:42.5 }] });
  await expect(f.create({ sql:"SELECT * FROM exposure",parameters:[],tables:{ exposure:["large"],samples:["id"] } })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_not_allowed" });
  await expect(f.create({ sql:"SELECT * FROM search_data",parameters:[],tables:{ search:["content"] } })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_not_allowed" });
  const denied = await f.create({ sql:"SELECT content FROM search",parameters:[],tables:{ search:["content"] } })(source,"request").then(() => null,(error) => error);
  expect(denied).toMatchObject({ code:"sqlite_query_not_allowed" });expect(String(denied)).not.toContain(f.databasePath);
});

test("SQLite result bytes and locked files fail explicitly without partial results",async ({},testInfo) => {
  const f = await fixture(testInfo.outputPath("query")),db = new DatabaseSync(f.databasePath);db.exec("CREATE TABLE large_rows(value TEXT)");const insert = db.prepare("INSERT INTO large_rows VALUES(?)");insert.run("x".repeat(180000));insert.run("y".repeat(180000));
  await expect(f.create({ sql:"SELECT value FROM large_rows",parameters:[],tables:{ large_rows:["value"] } })(source,"request")).rejects.toMatchObject({ code:"sqlite_query_output_limit" });
  db.exec("BEGIN EXCLUSIVE");try { await expect(f.create()(source,"locked")).rejects.toMatchObject({ code:"sqlite_query_locked" }); } finally { db.exec("ROLLBACK");db.close(); }
  expect((await f.create()(source,"recovered")).payload).toEqual({ rows:[{ id:1,temperature:42.5,note:null }] });
});
