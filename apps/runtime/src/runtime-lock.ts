import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

/** Hold a native SQLite write lock in a separate ownership file. The OS releases
 * it on process death, so crash recovery never races a live host or relies on PID
 * reuse, lock-file age, or a non-atomic stale-file deletion. */
export async function acquireRuntimeLock(directory:string):Promise<() => Promise<void>> {
  const lease = new DatabaseSync(join(directory,"runtime-ownership.sqlite"),{ timeout:0 });
  try {
    lease.exec("CREATE TABLE IF NOT EXISTS runtime_owner(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL)");
    lease.exec("BEGIN IMMEDIATE");
    lease.prepare("INSERT INTO runtime_owner(id,pid) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid").run(process.pid);
  } catch (reason) {
    lease.close();
    if ((reason as { errcode?:number }).errcode === 5 || (reason instanceof Error && reason.message.includes("database is locked"))) throw new Error("Another runtime process already owns this data directory.");
    throw reason;
  }
  let released = false;
  return async () => { if (released) return; lease.close(); released = true; };
}
