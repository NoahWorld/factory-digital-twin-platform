import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrateWithBackup } from "../scripts/migration-backup.mjs";

test("migration cannot run after backup failure; successful backup precedes the schema change", async () => {
  const root = process.env.NEWPOWER_ARTIFACTS_DIR ?? resolve("test-results"); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "migration-guard-"));
  const stateDirectory = join(directory, "state"); const sqliteDir = join(stateDirectory, "v3", "d1");
  mkdirSync(sqliteDir, { recursive: true });
  const databasePath = join(sqliteDir, "project.sqlite"); const configPath = join(directory, "wrangler.jsonc");
  writeFileSync(configPath, "{}");
  const source = new DatabaseSync(databasePath); source.exec("CREATE TABLE project_canvases (id TEXT); INSERT INTO project_canvases VALUES ('retained');"); source.close();
  let called = 0;
  try {
    const blocked = join(directory, "not-a-directory"); writeFileSync(blocked, "block backup");
    await expect(migrateWithBackup({ stateDirectory, configPath, backupDirectory: blocked, applyMigration: () => { called++; } })).rejects.toThrow();
    expect(called).toBe(0);
    const backupPath = await migrateWithBackup({ stateDirectory, configPath, applyMigration: ({ backupPath, databasePath }: { backupPath: string; databasePath: string }) => {
      const saved = new DatabaseSync(backupPath, { readOnly: true }); expect(saved.prepare("SELECT id FROM project_canvases").get()?.id).toBe("retained"); saved.close();
      const active = new DatabaseSync(databasePath); active.exec("ALTER TABLE project_canvases ADD COLUMN revision INTEGER DEFAULT 1"); active.close(); called++;
    } });
    expect(called).toBe(1);
    const saved = new DatabaseSync(backupPath, { readOnly: true }); expect(saved.prepare("PRAGMA table_info(project_canvases)").all().map((row) => row.name)).toEqual(["id"]); saved.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
