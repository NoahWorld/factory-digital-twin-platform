import { DatabaseSync,backup } from "node:sqlite";
import { mkdir,open,unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function backupSqlite(databasePath,backupPath,{ requiredTable } = {}) {
  await mkdir(dirname(backupPath),{ recursive: true,mode: 0o700 });
  const placeholder = await open(backupPath,"wx",0o600); await placeholder.close();
  try {
    const source = new DatabaseSync(databasePath,{ readOnly: true });
    try { await backup(source,backupPath); } finally { source.close(); }
    const verified = new DatabaseSync(backupPath,{ readOnly: true });
    try {
      if (verified.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Backup integrity check failed. Migration has not run.");
      if (requiredTable && !verified.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(requiredTable)) throw new Error("Backup schema does not match the expected database. Migration has not run.");
    } finally { verified.close(); }
    return backupPath;
  } catch (reason) {
    try { await unlink(backupPath); }
    catch (cleanup) { if (cleanup.code !== "ENOENT") throw new AggregateError([reason,cleanup],`Backup failed and incomplete file could not be removed: ${backupPath}`); }
    throw reason;
  }
}
