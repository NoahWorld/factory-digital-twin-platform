import { test,expect } from "@playwright/test";
import { mkdir,writeFile,cp,stat,readdir } from "node:fs/promises";
import { join,resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteDatabase } from "../apps/runtime/src/sqlite-database";
import { FileBucket } from "../apps/runtime/src/file-bucket";
import { migrateRuntimeDatabase } from "../apps/runtime/src/migrations";

test("SQLite bindings are independent and batch changes, foreign keys and rollback match the API contract", async () => {
  const db = new SqliteDatabase(":memory:"),other = new SqliteDatabase(":memory:");
  try {
    db.connection.exec("CREATE TABLE parent(id TEXT PRIMARY KEY); CREATE TABLE child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES parent(id));");
    const insert = db.prepare("INSERT INTO parent(id) VALUES(?)"),a = insert.bind("a"),b = insert.bind("b");
    const result = await db.batch([a,b]); expect(result.map((item) => item.meta?.changes)).toEqual([1,1]);
    expect((await db.prepare("SELECT id FROM parent ORDER BY id").all<{ id: string }>()).results.map((row) => row.id)).toEqual(["a","b"]);
    await expect(db.batch([db.prepare("INSERT INTO parent(id) VALUES(?)").bind("rolled-back"),db.prepare("INSERT INTO child(id,parent_id) VALUES(?,?)").bind("child","missing")])).rejects.toThrow();
    expect(await db.prepare("SELECT id FROM parent WHERE id=?").bind("rolled-back").first()).toBeNull();
    expect((await db.prepare("UPDATE parent SET id=id WHERE id=?").bind("missing").run()).meta?.changes).toBe(0);
    await expect(db.batch([other.prepare("SELECT 1")])).rejects.toThrow("belong");
    expect(() => insert.bind(undefined)).toThrow("binding value");
  } finally { db.close();other.close(); }
});

test("runtime migrations use the same SQL, verify a backup before upgrades and roll back failed migrations", async ({},testInfo) => {
  const root = testInfo.outputPath("migration-test"),directory = join(root,"migrations"),databasePath = join(root,"data","config.sqlite");
  await mkdir(root,{ recursive: true }); await cp(resolve("apps/api/migrations"),directory,{ recursive: true });
  const migrationCount = (await readdir(directory)).filter((name) => name.endsWith(".sql")).length;
  const first = await migrateRuntimeDatabase(databasePath,directory); expect(first.applied).toHaveLength(migrationCount); expect(first.applied).toContain("0017_project_publications.sql"); expect(first.backupPath).toBeNull();
  expect((await migrateRuntimeDatabase(databasePath,directory)).applied).toEqual([]);
  await writeFile(join(directory,"9001_runtime_probe.sql"),"CREATE TABLE runtime_probe(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO runtime_probe VALUES(1,'retained');");
  const upgrade = await migrateRuntimeDatabase(databasePath,directory); expect(upgrade.applied).toEqual(["9001_runtime_probe.sql"]); expect(upgrade.backupPath).toBeTruthy();
  const backup = new DatabaseSync(upgrade.backupPath!,{ readOnly: true });
  try { expect(backup.prepare("SELECT COUNT(*) AS n FROM runtime_migrations").get()?.n).toBe(migrationCount); expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='runtime_probe'").get()).toBeUndefined(); } finally { backup.close(); }
  expect((await stat(upgrade.backupPath!)).mode & 0o777).toBe(0o600);
  await writeFile(join(directory,"9002_runtime_failure.sql"),"INSERT INTO runtime_probe VALUES(2,'must-roll-back'); SELECT missing FROM missing_table;");
  const blocked = join(root,"not-a-directory"); await writeFile(blocked,"block");
  await expect(migrateRuntimeDatabase(databasePath,directory,blocked)).rejects.toThrow();
  await expect(migrateRuntimeDatabase(databasePath,directory)).rejects.toThrow();
  const read = new DatabaseSync(databasePath,{ readOnly: true });
  try { expect(read.prepare("SELECT COUNT(*) AS n FROM runtime_migrations").get()?.n).toBe(migrationCount+1); expect(read.prepare("SELECT COUNT(*) AS n FROM runtime_probe").get()?.n).toBe(1); expect(read.prepare("PRAGMA foreign_key_check").all()).toEqual([]); } finally { read.close(); }
  await writeFile(join(directory,"0001_initial.sql"),"SELECT 1;"); // A newly inserted earlier migration cannot rewrite history.
  await expect(migrateRuntimeDatabase(databasePath,directory)).rejects.toThrow("history");
});

test("filesystem resources are immutable, binary-safe and keyed without filesystem traversal", async ({},testInfo) => {
  const root = testInfo.outputPath("objects"),bucket = new FileBucket(root),key = "../../outside.bin";
  const bytes = new Uint8Array([0,255,2,3,4]);
  await bucket.put(key,bytes.buffer,{ httpMetadata: { contentType: "application/octet-stream" },customMetadata: { fixture: "local" } });
  const object = await bucket.get(key); expect(object).not.toBeNull(); expect(object!.size).toBe(5);
  expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(bytes);
  await expect(bucket.put(key,new Uint8Array([9]).buffer,{ httpMetadata: { contentType: "application/octet-stream" },customMetadata: {} })).rejects.toThrow();
  expect(new Uint8Array(await new Response((await bucket.get(key))!.body).arrayBuffer())).toEqual(bytes);
  await expect(stat(join(root,"..","outside.bin"))).rejects.toThrow();
  await bucket.delete(key); await bucket.delete(key); expect(await bucket.get(key)).toBeNull();
});
