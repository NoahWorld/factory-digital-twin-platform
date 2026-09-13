import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { request } from "@playwright/test";
import { createPasswordRecord } from "../apps/api/src/auth";
import { session } from "./support";

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export async function permissionFixture(projectId: string, member: boolean) {
  const stateDir = process.env.NEWPOWER_TEST_STATE_DIR;
  const config = process.env.NEWPOWER_TEST_CONFIG;
  if (!stateDir || !config) throw new Error("Permission fixtures require NEWPOWER_TEST_STATE_DIR and NEWPOWER_TEST_CONFIG for the isolated local Worker.");
  const identity = session();
  const url = new URL(identity.apiBase);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Permission fixtures only support local HTTP.");
  const userId = crypto.randomUUID();
  const email = `binding-viewer-${userId}@example.invalid`;
  const password = randomBytes(32).toString("base64url");
  const record = await createPasswordRecord(password);
  const now = new Date().toISOString();
  // A second Wrangler/workerd process can lock the live fixture database even
  // for cleanup. Write only the already-owned local test DB with SQLite WAL.
  const candidates:string[] = [];
  const find = (directory:string) => {
    for (const entry of readdirSync(directory,{ withFileTypes:true })) {
      const filename = join(directory,entry.name);
      if (entry.isDirectory()) find(filename);
      else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") {
        const db = new DatabaseSync(filename,{ readOnly:true,timeout:5000 });
        try { if (db.prepare("SELECT name FROM sqlite_master WHERE name='project_canvases'").get()) candidates.push(filename); } finally { db.close(); }
      }
    }
  };
  find(join(stateDir,"v3","d1")); if (candidates.length !== 1) throw new Error("Cannot identify one isolated permission database.");
  const runSql = (sql:string) => {
    const db = new DatabaseSync(candidates[0],{ timeout:5000,enableForeignKeyConstraints:true });
    try { db.exec("BEGIN IMMEDIATE"); db.exec(sql); db.exec("COMMIT"); }
    catch (reason) { db.exec("ROLLBACK"); throw reason; }
    finally { db.close(); }
  };
  runSql(`INSERT INTO users (id,email,display_name,password_hash,password_salt,password_iterations,is_active,created_at,updated_at)
    VALUES (${[userId, email, "M1 permission fixture", record.hash, record.salt].map(sqlString).join(",")},${record.iterations},1,${sqlString(now)},${sqlString(now)});
    INSERT INTO user_roles (user_id,role,created_at) VALUES (${sqlString(userId)},'viewer',${sqlString(now)});
    ${member ? `INSERT INTO project_members (project_id,user_id,role,created_at,updated_at) VALUES (${sqlString(projectId)},${sqlString(userId)},'viewer',${sqlString(now)},${sqlString(now)});` : ""}`);
  const api = await request.newContext({ baseURL: identity.apiBase });
  const response = await api.post("/api/v1/auth/login", { data: { email, password } });
  if (!response.ok()) throw new Error(`Fixture login failed with HTTP ${response.status()}.`);
  return { api, dispose: async () => {
    await api.dispose();
    runSql(`DELETE FROM users WHERE id = ${sqlString(userId)};`);
  } };
}
