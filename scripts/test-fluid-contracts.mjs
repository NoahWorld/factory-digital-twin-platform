import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "fluid-contracts-"));
const require = createRequire(import.meta.url);
const fixture = JSON.parse(readFileSync(join(root, "apps/backend/src/test/resources/fluid-validation-cases.json"), "utf8"));
try {
  execFileSync(process.execPath, [join(root, "apps/web/node_modules/typescript/bin/tsc"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--strict", "--skipLibCheck", "--rootDir", root, "--outDir", temporary, join(root, "apps/api/src/standalone-scenes.ts")], { stdio: "inherit" });
  const { parseFluids, createFluidDefinition } = require(join(temporary, "shared/fluids.js"));
  const { validateStandaloneScenePatch, applyStandaloneScenePatch, getStandaloneScene } = require(join(temporary, "apps/api/src/standalone-scenes.js"));
  for (const entry of fixture.cases) {
    const fluid = { ...structuredClone(fixture.base), ...entry.changes };
    if (entry.remove) delete fluid[entry.remove];
    const input = Object.hasOwn(entry, "input") ? entry.input : [fluid];
    assert.equal(parseFluids(input).ok, entry.valid, entry.name);
    if (entry.valid) assert.deepEqual(validateStandaloneScenePatch({ expectedRevision: 0, fluids: input }).fluids, input);
    else assert.throws(() => validateStandaloneScenePatch({ expectedRevision: 0, fluids: input }), error => error.status === 400 && error.code === "invalid_scene_fluids", entry.name);
  }
  assert.deepEqual(createFluidDefinition("new").points, []);
  assert.equal(parseFluids([createFluidDefinition("new")]).ok, false, "A draft with no path cannot be persisted");
  assert.equal(parseFluids([fixture.base, fixture.base]).ok, false);
  for (const number of [NaN, Infinity, -Infinity]) {
    assert.equal(parseFluids([{ ...fixture.base, speed: number }]).ok, false);
    assert.equal(parseFluids([{ ...fixture.base, points: [[number, 0, 0], [1, 1, 1]] }]).ok, false);
  }
  for (const count of [32, 33]) assert.equal(parseFluids(Array.from({ length: count }, (_, index) => ({ ...fixture.base, id: `fluid-${index}` }))).ok, count === 32);
  for (const count of [64, 65]) assert.equal(parseFluids([{ ...fixture.base, points: Array.from({ length: count }, (_, index) => [index, 0, 0]) }]).ok, count === 64);
  const parsed = parseFluids([fixture.base]);
  parsed.value[0].points[0][0] = 999;
  assert.equal(fixture.base.points[0][0], 0, "Parser returns independent coordinates");

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(root, "apps/api/migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(readFileSync(join(root, "apps/api/migrations", name), "utf8"));
  database.exec("INSERT INTO users (id,email,display_name,password_hash,password_salt,password_iterations,created_at,updated_at) VALUES ('user','user@example.invalid','User','hash','salt',100000,'now','now')");
  database.exec("INSERT INTO projects (id,name,status,created_at,updated_at,project_type) VALUES ('scene','Fluid test','draft','now','now','3d')");
  database.exec("INSERT INTO standalone_3d_scenes (project_id,updated_at) VALUES ('scene','now')");
  const prepare = (sql, params = []) => ({
    bind: (...values) => prepare(sql, values),
    first: async () => database.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: database.prepare(sql).run(...params).changes } }),
  });
  const env = { DB: { prepare, batch: async statements => {
    database.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } } };
  const user = { id: "user", roles: [], email: "user@example.invalid", loginName: "user", displayName: "User" };
  assert.deepEqual((await getStandaloneScene(env, "scene")).fluids, [], "Legacy scene migrates to no fluids");
  const instance = { id: "model", assetId: null, modelAssetId: "builtin:aqua-helix-hd-v1", label: "Pump", renderMode: "interactive", sortOrder: 0, transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }, visible: true };
  const allKinds = ["gas", "liquid", "molten"].map(kind => ({ ...fixture.base, id: kind, kind, mode: "diffuse" }));
  let scene = await applyStandaloneScenePatch(env, "scene", user, validateStandaloneScenePatch({ expectedRevision: 0, fluids: allKinds, upsertInstances: [instance] }));
  assert.deepEqual(scene.fluids, allKinds);
  assert.equal(scene.revision, 1);
  assert.equal(scene.instances.length, 1);
  assert.deepEqual(JSON.parse(database.prepare("SELECT fluids_json FROM standalone_3d_scenes WHERE project_id='scene'").get().fluids_json), allKinds);
  scene = await applyStandaloneScenePatch(env, "scene", user, validateStandaloneScenePatch({ expectedRevision: 1, settings: { ...scene.settings, showGrid: false } }));
  assert.deepEqual(scene.fluids, allKinds, "A legacy settings-only client must preserve saved fluids");
  await assert.rejects(() => applyStandaloneScenePatch(env, "scene", user, validateStandaloneScenePatch({ expectedRevision: 1, fluids: [] })), error => error.status === 409);
  assert.deepEqual((await getStandaloneScene(env, "scene")).fluids, allKinds);
  database.exec("CREATE TRIGGER reject_test_instance BEFORE INSERT ON standalone_3d_instances WHEN NEW.id='blocked' BEGIN SELECT RAISE(ABORT, 'test transaction failure'); END");
  await assert.rejects(() => applyStandaloneScenePatch(env, "scene", user, validateStandaloneScenePatch({ expectedRevision: 2, fluids: [], upsertInstances: [{ ...instance, id: "blocked" }] })), /test transaction failure/);
  assert.equal((await getStandaloneScene(env, "scene")).revision, 2);
  assert.deepEqual((await getStandaloneScene(env, "scene")).fluids, allKinds, "A failed model mutation rolls back fluids and revision in the same transaction");
  scene = await applyStandaloneScenePatch(env, "scene", user, validateStandaloneScenePatch({ expectedRevision: 2, fluids: [] }));
  assert.deepEqual(scene.fluids, [], "Explicit empty array removes all fluids");
  assert.equal(scene.instances.length, 1);
  database.prepare("UPDATE standalone_3d_scenes SET fluids_json=? WHERE project_id='scene'").run(JSON.stringify([{ ...fixture.base, speed: 0 }]));
  await assert.rejects(() => getStandaloneScene(env, "scene"), error => error.status === 500 && error.code === "invalid_scene_storage");
  database.close();
  console.log(`PASS: ${fixture.cases.length} shared TS/Java fixtures, finite/quantity limits, real SQL save/load, legacy preservation, clear, revision conflict, transaction rollback and corrupt-storage rejection.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
