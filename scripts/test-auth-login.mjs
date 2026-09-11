import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "factory-auth-test-"));
const require = createRequire(import.meta.url);

const createStatement = (query, handlers = {}) => {
  const statement = {
    query,
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
    first: handlers.first ?? (async () => null),
    all: handlers.all ?? (async () => ({ results: [] })),
    run: handlers.run ?? (async () => ({ meta: { changes: 1 } })),
  };
  return statement;
};

try {
  execFileSync(process.execPath, [
    join(root, "apps/web/node_modules/typescript/bin/tsc"),
    "--target", "ES2022",
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--strict",
    "--skipLibCheck",
    "--rootDir", root,
    "--outDir", temporary,
    join(root, "apps/api/src/auth.ts"),
    join(root, "shared/auth-constraints.ts"),
  ], { cwd: root, stdio: "inherit" });

  const {
    AppError,
    INITIAL_ADMIN_LOGIN_NAME,
    createPasswordRecord,
    createUser,
    validateLoginIdentifier,
    verifyCredentials,
  } = require(join(temporary, "apps/api/src/auth.js"));

  assert.equal(INITIAL_ADMIN_LOGIN_NAME, "admin");
  assert.equal(validateLoginIdentifier(" ADMIN "), "admin");
  assert.equal(validateLoginIdentifier("Owner@Example.com"), "owner@example.com");
  assert.throws(
    () => validateLoginIdentifier("ad"),
    (error) => error instanceof AppError && error.code === "invalid_login_name",
  );
  assert.throws(
    () => validateLoginIdentifier("admin account"),
    (error) => error instanceof AppError && error.code === "invalid_login_name",
  );

  const password = "Local-admin-login-2026";
  const passwordRecord = await createPasswordRecord(password);
  const storedUser = {
    id: "user-admin",
    email: "owner@example.com",
    login_name: "admin",
    display_name: "平台管理员",
    password_hash: passwordRecord.hash,
    password_salt: passwordRecord.salt,
    password_iterations: passwordRecord.iterations,
    is_active: 1,
  };
  const credentialDatabase = {
    prepare(query) {
      if (query.includes("FROM users")) {
        assert.match(query, /WHERE email = \? OR login_name = \?/);
        const statement = createStatement(query);
        statement.first = async () => {
          const [email, loginName] = statement.values;
          return email === storedUser.email || loginName === storedUser.login_name
            ? storedUser
            : null;
        };
        return statement;
      }
      if (query.includes("FROM user_roles")) {
        return createStatement(query, {
          all: async () => ({ results: [{ role: "platform_admin" }] }),
        });
      }
      throw new Error(`Unexpected authentication query: ${query}`);
    },
  };

  const byAccount = await verifyCredentials(
    { DB: credentialDatabase },
    validateLoginIdentifier("admin"),
    password,
  );
  assert.equal(byAccount.loginName, "admin");
  assert.deepEqual(byAccount.roles, ["platform_admin"]);

  const byEmail = await verifyCredentials(
    { DB: credentialDatabase },
    validateLoginIdentifier("OWNER@EXAMPLE.COM"),
    password,
  );
  assert.equal(byEmail.id, storedUser.id);

  await assert.rejects(
    () => verifyCredentials({ DB: credentialDatabase }, "admin", "wrong-password"),
    (error) => error instanceof AppError && error.code === "invalid_credentials",
  );

  const batch = [];
  const creationDatabase = {
    prepare(query) {
      return createStatement(query);
    },
    async batch(statements) {
      batch.push(...statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const created = await createUser(
    { DB: creationDatabase },
    {
      email: "new-admin@example.com",
      loginName: "admin",
      displayName: "新管理员",
      password,
      roles: ["platform_admin"],
    },
  );
  assert.equal(created.loginName, "admin");
  assert.match(batch[0].query, /id, email, login_name, display_name/);
  assert.equal(batch[0].values[2], "admin");

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(readFileSync(join(root, "apps/api/migrations/0001_initial.sql"), "utf8"));
  database.exec(readFileSync(join(root, "apps/api/migrations/0002_access_control.sql"), "utf8"));
  const insertUser = database.prepare(`
    INSERT INTO users (
      id, email, display_name, password_hash, password_salt, password_iterations,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, 'hash', 'salt', 100000, 1, ?, ?)
  `);
  insertUser.run("oldest-admin", "oldest@example.com", "最早管理员", "2026-01-01", "2026-01-01");
  insertUser.run("newer-admin", "newer@example.com", "后续管理员", "2026-02-01", "2026-02-01");
  const insertRole = database.prepare(
    "INSERT INTO user_roles (user_id, role, created_at) VALUES (?, 'platform_admin', '2026-01-01')",
  );
  insertRole.run("oldest-admin");
  insertRole.run("newer-admin");
  database.exec(readFileSync(join(root, "apps/api/migrations/0016_admin_login_name.sql"), "utf8"));

  const migratedUsers = database.prepare(
    "SELECT id, login_name FROM users ORDER BY created_at ASC",
  ).all().map((row) => ({ id: row.id, login_name: row.login_name }));
  assert.deepEqual(migratedUsers, [
    { id: "oldest-admin", login_name: "admin" },
    { id: "newer-admin", login_name: null },
  ]);
  assert.throws(
    () => database.prepare("UPDATE users SET login_name = 'ADMIN' WHERE id = 'newer-admin'").run(),
    /UNIQUE constraint failed/i,
  );
  database.close();

  const indexSource = readFileSync(join(root, "apps/api/src/index.ts"), "utf8");
  assert.match(indexSource, /body\.identifier \?\? body\.email/);

  console.log("PASS: admin and email login, credential failures, bootstrap persistence and legacy-admin migration.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
