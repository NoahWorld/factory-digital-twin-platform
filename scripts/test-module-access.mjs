import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "module-access-test-"));
const require = createRequire(import.meta.url);
let database;

try {
  execFileSync(process.execPath, [
    join(root, "apps/web/node_modules/typescript/bin/tsc"),
    "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node",
    "--strict", "--skipLibCheck", "--rootDir", root, "--outDir", temporary,
    join(root, "apps/api/src/index.ts"),
  ], { cwd: root, stdio: "inherit" });
  const worker = require(join(temporary, "apps/api/src/index.js")).default;
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(root, "apps/api/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(root, "apps/api/migrations", name), "utf8"));
  }

  const now = new Date().toISOString();
  const addUser = (id, role, canAccess2d, canAccess3d) => {
    database.prepare(`INSERT INTO users (
      id, email, login_name, display_name, password_hash, password_salt, password_iterations,
      can_access_2d, can_access_3d, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'hash', 'salt', 100000, ?, ?, ?, ?)`)
      .run(id, `${id}@example.invalid`, id, id, canAccess2d, canAccess3d, now, now);
    database.prepare("INSERT INTO user_roles (user_id, role, created_at) VALUES (?, ?, ?)").run(id, role, now);
    const token = `session-${id}`;
    const tokenHash = createHash("sha256").update(token).digest("base64");
    database.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(`session-row-${id}`, id, tokenHash, new Date(Date.now() + 86_400_000).toISOString(), now, now);
    return token;
  };
  const admin = addUser("admin", "platform_admin", 0, 0);
  const operator = addUser("operator", "delivery_manager", 1, 0);
  const restricted = addUser("restricted", "viewer", 0, 0);
  for (const [id, type] of [["canvas", "2d"], ["scene", "3d"]]) {
    database.prepare(`INSERT INTO projects (id, name, status, project_type, created_at, updated_at)
      VALUES (?, ?, 'draft', ?, ?, ?)`).run(id, id, type, now, now);
    database.prepare(`INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
      VALUES (?, 'operator', 'owner', ?, ?)`).run(id, now, now);
  }

  const prepare = (sql, params = []) => ({
    bind: (...values) => prepare(sql, values),
    first: async () => database.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: database.prepare(sql).run(...params).changes } }),
  });
  const env = { DB: { prepare, batch: async (statements) => {
    database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } } };
  const call = async (token, method, path, body) => {
    const response = await worker.fetch(new Request(`https://example.test${path}`, {
      method,
      headers: { cookie: `factory_twin_session=${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      sessionToken: response.headers.get("set-cookie")?.match(/^factory_twin_session=([^;]+)/)?.[1] ?? null,
    };
  };

  assert.deepEqual((await call(admin, "GET", "/api/v1/auth/me")).body.user.modules, ["2d", "3d"]);
  assert.deepEqual((await call(operator, "GET", "/api/v1/auth/me")).body.user.modules, ["2d"]);
  assert.deepEqual((await call(restricted, "GET", "/api/v1/auth/me")).body.user.modules, []);
  assert.deepEqual((await call(operator, "GET", "/api/v1/projects")).body.projects.map((project) => project.id), ["canvas"]);
  assert.deepEqual((await call(restricted, "GET", "/api/v1/projects")).body.projects, []);
  assert.equal((await call(operator, "GET", "/api/v1/projects/canvas")).status, 200);
  const deniedScene = await call(operator, "GET", "/api/v1/projects/scene");
  assert.equal(deniedScene.status, 403);
  assert.equal(deniedScene.body.error, "module_access_denied");
  const deniedCreate = await call(operator, "POST", "/api/v1/projects", { name: "Forbidden scene", projectType: "3d" });
  assert.equal(deniedCreate.status, 403);
  assert.equal(deniedCreate.body.error, "module_access_denied");
  assert.equal((await call(operator, "GET", "/api/v1/users")).status, 403);

  const accounts = await call(admin, "GET", "/api/v1/users");
  assert.equal(accounts.status, 200);
  assert.deepEqual(accounts.body.users.find((user) => user.id === "admin").modules, ["2d", "3d"]);
  assert.deepEqual(accounts.body.users.find((user) => user.id === "operator").modules, ["2d"]);
  const newAccount = {
    email: "newuser@example.invalid", loginName: "newuser", displayName: "New user",
    password: "temporary-password-2026", role: "viewer", modules: ["3d"],
  };
  assert.equal((await call(admin, "POST", "/api/v1/users", { ...newAccount, modules: undefined })).body.error, "invalid_modules");
  const created = await call(admin, "POST", "/api/v1/users", newAccount);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.user.modules, ["3d"]);
  assert.deepEqual((await call(admin, "GET", "/api/v1/users")).body.users.find((user) => user.id === created.body.user.id).modules, ["3d"]);
  assert.equal((await call(operator, "PATCH", "/api/v1/users/operator/modules", { modules: ["3d"] })).status, 403);
  assert.equal((await call(admin, "PATCH", "/api/v1/users/admin/modules", { modules: [] })).body.error, "admin_modules_fixed");
  assert.equal((await call(admin, "PATCH", "/api/v1/users/operator/modules", { modules: ["2d", "2d"] })).body.error, "invalid_modules");

  const granted = await call(admin, "PATCH", "/api/v1/users/operator/modules", { modules: ["3d"] });
  assert.equal(granted.status, 200);
  assert.deepEqual((await call(operator, "GET", "/api/v1/auth/me")).body.user.modules, ["3d"]);
  assert.equal((await call(operator, "GET", "/api/v1/projects/canvas")).status, 403);
  assert.equal((await call(operator, "GET", "/api/v1/projects/scene")).status, 200);
  assert.deepEqual((await call(operator, "GET", "/api/v1/projects")).body.projects.map((project) => project.id), ["scene"]);

  const revoked = await call(admin, "PATCH", "/api/v1/users/operator/modules", { modules: [] });
  assert.equal(revoked.status, 200);
  assert.deepEqual((await call(operator, "GET", "/api/v1/projects")).body.projects, []);
  assert.equal((await call(operator, "GET", "/api/v1/projects/scene")).status, 403);

  const userPath = `/api/v1/users/${created.body.user.id}`;
  assert.equal((await call(operator, "GET", userPath)).status, 403);
  assert.equal((await call(operator, "PUT", userPath, { ...newAccount, role: "delivery_manager" })).status, 403);
  assert.equal((await call(operator, "DELETE", userPath)).status, 403);
  assert.equal((await call(admin, "GET", userPath)).body.user.role, "viewer");
  assert.equal((await call(admin, "PUT", "/api/v1/users/admin", {
    email: "admin@example.invalid", loginName: "admin", displayName: "Admin",
    role: "viewer", modules: [],
  })).body.error, "self_admin_required");
  assert.equal((await call(admin, "DELETE", "/api/v1/users/admin")).body.error, "self_delete_forbidden");

  const editedAccount = {
    email: "edited@example.invalid", loginName: "editeduser", displayName: "Edited user",
    role: "delivery_manager", modules: ["2d"], password: "changed-password-2026",
  };
  const edited = await call(admin, "PUT", userPath, editedAccount);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.user.email, editedAccount.email);
  assert.equal(edited.body.user.loginName, editedAccount.loginName);
  assert.equal(edited.body.user.displayName, editedAccount.displayName);
  assert.equal(edited.body.user.role, editedAccount.role);
  assert.deepEqual(edited.body.user.modules, ["2d"]);
  assert.deepEqual((await call(admin, "GET", userPath)).body.user, edited.body.user);
  const duplicate = await call(admin, "PUT", userPath, { ...editedAccount, email: "admin@example.invalid" });
  assert.equal(duplicate.status, 409);
  assert.equal((await call(admin, "GET", userPath)).body.user.email, editedAccount.email);
  assert.equal((await call(null, "POST", "/api/v1/auth/login", {
    identifier: editedAccount.loginName, password: newAccount.password,
  })).status, 401);
  const signedIn = await call(null, "POST", "/api/v1/auth/login", {
    identifier: editedAccount.loginName, password: editedAccount.password,
  });
  assert.equal(signedIn.status, 200);
  assert.ok(signedIn.sessionToken);

  const reset = await call(admin, "PUT", userPath, { ...editedAccount, password: "newer-password-2026" });
  assert.equal(reset.status, 200);
  assert.equal((await call(signedIn.sessionToken, "GET", "/api/v1/auth/me")).status, 401);
  const freshSession = await call(null, "POST", "/api/v1/auth/login", {
    identifier: editedAccount.loginName, password: "newer-password-2026",
  });
  assert.equal(freshSession.status, 200);
  assert.ok(freshSession.sessionToken);

  assert.equal((await call(admin, "DELETE", userPath)).status, 204);
  assert.equal((await call(freshSession.sessionToken, "GET", "/api/v1/auth/me")).status, 401);
  assert.equal((await call(admin, "GET", userPath)).body.user.active, false);
  assert.equal((await call(admin, "PATCH", `${userPath}/modules`, { modules: ["3d"] })).body.error, "user_inactive");
  assert.equal((await call(null, "POST", "/api/v1/auth/login", {
    identifier: editedAccount.loginName, password: "newer-password-2026",
  })).status, 401);
  const restored = await call(admin, "POST", `${userPath}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.user.active, true);
  assert.deepEqual(restored.body.user.modules, ["2d"]);
  assert.equal((await call(null, "POST", "/api/v1/auth/login", {
    identifier: editedAccount.loginName, password: "newer-password-2026",
  })).status, 200);
  console.log("PASS: module grants, user CRUD, administrator safeguards, password reset, deletion, session revocation, and restoration.");
} finally {
  database?.close();
  rmSync(temporary, { recursive: true, force: true });
}
