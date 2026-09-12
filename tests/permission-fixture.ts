import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
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
  const runSql = (sql: string) => {
    const file = join(stateDir, `permission-fixture-${userId}.sql`);
    writeFileSync(file, sql, { mode: 0o600 });
    try {
      const result = spawnSync("pnpm", ["--filter", "@factory-twin/api", "exec", "wrangler", "d1", "execute", "factory-digital-twin-config", "--local", "--persist-to", stateDir, "--config", config, "--file", file], { encoding: "utf8", timeout: 30_000 });
      if (result.status !== 0) throw new Error(`Isolated permission fixture SQL failed (exit ${result.status}).`);
    } finally { unlinkSync(file); }
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
