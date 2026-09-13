import { DatabaseSync } from "node:sqlite";
import { createHash,randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir,readdir,readFile } from "node:fs/promises";
import { dirname,join } from "node:path";
import { backupSqlite } from "../../../scripts/sqlite-backup.mjs";

type Migration = { name: string; sql: string; sha256: string };
type Applied = { name: string; sha256: string };
const applied = (db: DatabaseSync): Applied[] => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_migrations'").get()
  ? db.prepare("SELECT name,sha256 FROM runtime_migrations ORDER BY name").all() as Applied[] : [];
function validateHistory(history: Applied[], migrations: Migration[]) {
  if (history.some((record,index) => migrations[index]?.name !== record.name)) throw new Error("Runtime migration history is not a contiguous prefix of this build.");
  for (const record of history) {
    const source = migrations.find((migration) => migration.name === record.name);
    if (!source || source.sha256 !== record.sha256) throw new Error(`Migration history does not match this build: ${record.name}. Database has not been changed.`);
  }
}

export async function migrateRuntimeDatabase(databasePath: string,migrationsDirectory: string,backupDirectory = join(dirname(databasePath),"backups")) {
  const entries = await readdir(migrationsDirectory,{ withFileTypes: true });
  const migrations = await Promise.all(entries.filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name)).sort((a,b) => a.name.localeCompare(b.name)).map(async (entry): Promise<Migration> => {
    const sql = await readFile(join(migrationsDirectory,entry.name),"utf8");
    return { name: entry.name,sql,sha256: createHash("sha256").update(sql).digest("hex") };
  }));
  if (!migrations.length) throw new Error("No runtime migrations were found.");
  await mkdir(dirname(databasePath),{ recursive: true,mode: 0o700 });
  const existed = existsSync(databasePath);
  let history: Applied[] = [];
  if (existed) {
    const reader = new DatabaseSync(databasePath,{ readOnly: true });
    try {
      history = applied(reader);
      const tables = reader.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (!history.length && tables.length) throw new Error("Existing database has no runtime migration history. Use a new runtime directory or an explicit import; it will not be reset.");
      validateHistory(history,migrations);
    } finally { reader.close(); }
  }
  if (history.length === migrations.length) return { applied: [] as string[],backupPath: null };
  const backupPath = existed ? join(backupDirectory,`before-migration-${new Date().toISOString().replaceAll(/[:.]/g,"-")}-${randomUUID()}.sqlite`) : null;
  if (backupPath) await backupSqlite(databasePath,backupPath,{ requiredTable: history.length ? "runtime_migrations" : undefined });
  const db = new DatabaseSync(databasePath,{ enableForeignKeyConstraints: true,timeout: 5000 });
  const names: string[] = [];
  try {
    db.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;");
    try {
      db.exec("CREATE TABLE IF NOT EXISTS runtime_migrations (name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)");
      const current = applied(db); validateHistory(current,migrations);
      for (const migration of migrations) if (!current.some((record) => record.name === migration.name)) {
        db.exec(migration.sql);
        db.prepare("INSERT INTO runtime_migrations (name,sha256,applied_at) VALUES (?,?,?)").run(migration.name,migration.sha256,new Date().toISOString());
        names.push(migration.name);
      }
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length) throw new Error(`Migration would leave ${violations.length} foreign-key violations.`);
      if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("Migrated database failed integrity checking.");
      db.exec("COMMIT");
    } catch (reason) {
      try { db.exec("ROLLBACK"); } catch (rollback) { throw new AggregateError([reason,rollback],"Migration and rollback failed; retain the verified backup."); }
      throw reason;
    }
  } finally { db.close(); }
  return { applied: names,backupPath };
}
