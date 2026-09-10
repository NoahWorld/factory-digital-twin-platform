import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "factory-standalone-3d-test-"));
const require = createRequire(import.meta.url);

const settings = {
  animationSpeed: 1,
  autoRotate: false,
  backgroundColor: "#071525",
  backgroundOpacity: 1,
  cameraFov: 42,
  cameraView: "isometric",
  environmentLightColor: "#daf4ff",
  environmentLightIntensity: 2.1,
  keyLightColor: "#ffffff",
  keyLightIntensity: 2.4,
  modelScale: 1,
  playAnimations: true,
  rotationSpeed: 0.35,
  showGrid: true,
};

const instance = (id = "instance-1") => ({
  assetId: "pump-001",
  id,
  label: "一号水泵",
  modelAssetId: "builtin:aqua-helix-hd-v1",
  renderMode: "interactive",
  sortOrder: 0,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  visible: true,
});

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
    join(root, "apps/api/src/standalone-scenes.ts"),
    join(root, "apps/api/src/auth.ts"),
    join(root, "shared/standalone-3d.ts"),
    join(root, "shared/workshop-layout.ts"),
    join(root, "shared/builtin-models.ts"),
    join(root, "shared/auth-constraints.ts"),
  ], { cwd: root, stdio: "inherit" });

  const { validateStandaloneScenePatch } = require(
    join(temporary, "apps/api/src/standalone-scenes.js"),
  );
  const { workshopInstances, workshopSettings } = require(join(temporary, "shared/workshop-layout.js"));
  const { builtinModels } = require(join(temporary, "shared/builtin-models.js"));
  const { STANDALONE_3D_LIMITS: limits } = require(join(temporary, "shared/standalone-3d.js"));
  const workshop = validateStandaloneScenePatch({
    deleteInstanceIds: [], expectedRevision: 0, settings: workshopSettings, upsertInstances: workshopInstances,
  });
  assert.equal(workshop.upsertInstances.length, 98);
  assert.ok(workshopInstances.length <= Math.min(limits.maximumInstances, limits.maximumPatchInstances));
  assert.equal(new Set(workshopInstances.map((item) => item.id)).size, workshopInstances.length);
  const resources = [...new Set(workshopInstances.map((item) => item.modelAssetId))].map((id) => {
    const model = builtinModels.find((item) => item.id === id);
    assert.ok(model, `Missing workshop resource: ${id}`);
    return model;
  });
  assert.equal(resources.length, 21);
  assert.ok(resources.reduce((sum, model) => sum + model.byteSize, 0) <= limits.maximumUniqueModelBytes);
  const modelFor = (item) => resources.find((model) => model.id === item.modelAssetId);
  assert.ok(workshopInstances.reduce((sum, item) => sum + modelFor(item).inspection.meshCount, 0) <= limits.maximumEstimatedMeshInstances);
  assert.equal(workshopInstances.filter((item) => modelFor(item).inspection.animationCount > 0).length, 6);
  assert.ok(workshopInstances.every((item) => item.assetId === null), "Demo must not pretend to bind real equipment");
  const valid = validateStandaloneScenePatch({
    deleteInstanceIds: [],
    expectedRevision: 0,
    linked2dProjectId: "project-2d",
    settings,
    upsertInstances: [{
      ...instance(),
      animation: { enabled: false, speed: 1.4 },
      appearance: { color: "#3aa8c8", opacity: 0.72 },
    }],
  });
  assert.equal(valid.upsertInstances[0].assetId, "pump-001");
  assert.deepEqual(valid.upsertInstances[0].animation, { enabled: false, speed: 1.4 });
  assert.deepEqual(valid.upsertInstances[0].appearance, { color: "#3aa8c8", opacity: 0.72 });
  assert.equal(valid.settings.cameraView, "isometric");
  const defaults = validateStandaloneScenePatch({
    deleteInstanceIds: [], expectedRevision: 0, upsertInstances: [instance()],
  });
  assert.deepEqual(defaults.upsertInstances[0].animation, { enabled: true, speed: 1 });
  assert.deepEqual(defaults.upsertInstances[0].appearance, { color: null, opacity: 1 });
  assert.throws(
    () => validateStandaloneScenePatch({ expectedRevision: 0 }),
    (error) => error.code === "empty_scene_patch" && error.status === 400,
  );
  assert.throws(
    () => validateStandaloneScenePatch({
      deleteInstanceIds: [],
      expectedRevision: 0,
      upsertInstances: Array.from({ length: 101 }, (_, index) => instance(`instance-${index}`)),
    }),
    (error) => error.code === "scene_patch_too_large" && error.status === 400,
  );
  assert.throws(
    () => validateStandaloneScenePatch({
      deleteInstanceIds: [],
      expectedRevision: 0,
      upsertInstances: [{ ...instance(), assetId: "bad asset id" }],
    }),
    (error) => error.code === "invalid_business_asset_id" && error.status === 400,
  );
  assert.throws(
    () => validateStandaloneScenePatch({
      deleteInstanceIds: [],
      expectedRevision: 0,
      upsertInstances: [{ ...instance(), appearance: { color: "blue", opacity: 1 } }],
    }),
    (error) => error.code === "invalid_scene_instance_appearance" && error.status === 400,
  );
  assert.throws(
    () => validateStandaloneScenePatch({
      deleteInstanceIds: [],
      expectedRevision: 0,
      upsertInstances: [{ ...instance(), animation: { enabled: true, speed: 4 } }],
    }),
    (error) => error.code === "invalid_scene_number" && error.status === 400,
  );

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(readFileSync(join(root, "apps/api/migrations/0001_initial.sql"), "utf8"));
  database.exec(readFileSync(join(root, "apps/api/migrations/0002_access_control.sql"), "utf8"));
  database.exec(readFileSync(join(root, "apps/api/migrations/0018_standalone_3d_projects.sql"), "utf8"));
  database.exec(readFileSync(join(root, "apps/api/migrations/0019_standalone_3d_instance_presentation.sql"), "utf8"));
  database.prepare(`
    INSERT INTO users (
      id, email, display_name, password_hash, password_salt, password_iterations,
      is_active, created_at, updated_at
    ) VALUES ('user-1', 'owner@example.com', 'Owner', 'hash', 'salt', 100000, 1, 'now', 'now')
  `).run();
  database.prepare(
    "INSERT INTO projects (id, name, status, created_at, updated_at, project_type) VALUES (?, ?, 'draft', 'now', 'now', ?)",
  ).run("project-2d", "2D 看板", "2d");
  database.prepare(
    "INSERT INTO projects (id, name, status, created_at, updated_at, project_type) VALUES (?, ?, 'draft', 'now', 'now', ?)",
  ).run("project-3d", "3D 厂房", "3d");
  database.prepare(
    "INSERT INTO standalone_3d_scenes (project_id, linked_2d_project_id, updated_by_user_id, updated_at) VALUES (?, ?, ?, ?)",
  ).run("project-3d", "project-2d", "user-1", "now");
  database.prepare(`
    INSERT INTO standalone_3d_instances (
      id, project_id, model_asset_id, business_asset_key, label, render_mode, sort_order, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("instance-1", "project-3d", "model-1", "pump-001", "一号水泵", "interactive", 0, "now");
  assert.deepEqual(
    database.prepare("SELECT project_type FROM projects ORDER BY id").all().map((row) => row.project_type),
    ["2d", "3d"],
  );
  assert.equal(
    database.prepare("SELECT business_asset_key FROM standalone_3d_instances WHERE project_id = 'project-3d'").get().business_asset_key,
    "pump-001",
  );
  const storedPresentation = database.prepare("SELECT animation_enabled, animation_speed, color_override, opacity FROM standalone_3d_instances WHERE project_id = 'project-3d'").get();
  assert.equal(storedPresentation.animation_enabled, 1);
  assert.equal(storedPresentation.animation_speed, 1);
  assert.equal(storedPresentation.color_override, null);
  assert.equal(storedPresentation.opacity, 1);
  assert.throws(
    () => database.prepare("UPDATE standalone_3d_instances SET opacity = 1.2 WHERE project_id = 'project-3d'").run(),
    /CHECK constraint failed/i,
  );
  assert.throws(
    () => database.prepare(
      "INSERT INTO projects (id, name, status, created_at, updated_at, project_type) VALUES ('bad', 'Bad', 'draft', 'now', 'now', '4d')",
    ).run(),
    /CHECK constraint failed/i,
  );
  database.close();

  console.log("PASS: standalone 3D patch validation, instance presentation, 98-instance workshop catalog/budgets, project types and normalized scene migrations.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
