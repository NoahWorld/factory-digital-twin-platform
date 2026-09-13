import { backupSqlite } from "./sqlite-backup.mjs";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";

export async function migrateWithBackup({ stateDirectory, configPath, backupDirectory, applyMigration, projectDirectory = process.cwd() }) {
  if (!stateDirectory || !configPath || !isAbsolute(stateDirectory) || !isAbsolute(configPath) || !existsSync(configPath)) {
    throw new Error("Provide absolute existing NEWPOWER_TEST_STATE_DIR and NEWPOWER_TEST_CONFIG paths.");
  }
  const candidates = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") {
        const db = new DatabaseSync(path, { readOnly: true });
        try { if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_canvases'").get()) candidates.push(path); }
        finally { db.close(); }
      }
    }
  };
  walk(join(stateDirectory, "v3", "d1"));
  if (candidates.length !== 1) throw new Error("Cannot identify exactly one existing NewPower database. Migration has not run.");
  const destination = backupDirectory ?? join(dirname(stateDirectory), "backups");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const backupPath = join(destination, `before-migration-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomUUID()}.sqlite`);
  await backupSqlite(candidates[0],backupPath,{ requiredTable: "project_canvases" });
  // No catch-and-continue between the verified backup and the schema change.
  if (applyMigration) await applyMigration({ backupPath, databasePath: candidates[0] });
  else {
    const result = spawnSync("pnpm", ["--filter", "@factory-twin/api", "exec", "wrangler", "d1", "migrations", "apply", "factory-digital-twin-config", "--local", "--persist-to", stateDirectory, "--config", configPath], { cwd: projectDirectory, stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error(`Local migration failed; verified backup retained at ${backupPath}.`);
  }
  return backupPath;
}
