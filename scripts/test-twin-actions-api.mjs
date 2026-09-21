import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "twin-actions-test-"));
const require = createRequire(import.meta.url);
const message = { type: "message", title: "设备", text: "设备已选中\n查看详情" };
try {
  execFileSync(process.execPath, [join(root, "apps/web/node_modules/typescript/bin/tsc"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--strict", "--skipLibCheck", "--rootDir", root, "--outDir", temporary, join(root, "apps/api/src/canvas.ts"), join(root, "apps/api/src/standalone-scenes.ts")], { stdio: "inherit" });
  const { parseTwinActions, parseCanvasNodeInteraction } = require(join(temporary, "shared/twin-actions.js"));
  const { validateCanvasPatch, applyCanvasPatch, getCanvas } = require(join(temporary, "apps/api/src/canvas.js"));
  const { validateStandaloneScenePatch, applyStandaloneScenePatch, getStandaloneScene } = require(join(temporary, "apps/api/src/standalone-scenes.js"));
  const { validateTwinActionReferences } = require(join(temporary, "apps/api/src/twin-action-references.js"));
  const allActions = [message, { type: "select-asset", assetId: "pump-1" }, { type: "panel", nodeId: "panel", operation: "toggle" }, { type: "focus-model", projectId: "scene", instanceId: "model" }, { type: "set-text", nodeId: "label", text: "新内容" }];
  assert.deepEqual(parseTwinActions(allActions), { ok: true, value: allActions });
  assert.equal(parseTwinActions(Array(8).fill(message)).ok, true);
  for (const value of [null, {}, Array(9).fill(message), [{ ...message, code: "alert(1)" }], [{ type: "script", text: "alert(1)" }], [{ ...message, text: "" }], [{ ...message, text: "x".repeat(2001) }], [{ ...message, title: "x".repeat(81) }], [{ ...message, text: "bad\u0000" }], [{ type: "focus-model", projectId: "scene\n", instanceId: "model" }]]) assert.equal(parseTwinActions(value).ok, false, JSON.stringify(value));
  assert.equal(parseCanvasNodeInteraction({ clickActions: [], hiddenInPreview: false }).ok, true);
  for (const value of [null, {}, { clickActions: [], hiddenInPreview: "false" }, { clickActions: [], hiddenInPreview: false, script: "x" }]) assert.equal(parseCanvasNodeInteraction(value).ok, false);

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(join(root, "apps/api/migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(readFileSync(join(root, "apps/api/migrations", name), "utf8"));
  database.exec(`INSERT INTO users (id,email,display_name,password_hash,password_salt,password_iterations,created_at,updated_at) VALUES ('user','user@example.invalid','User','hash','salt',100000,'now','now');`);
  for (const [id, kind] of [["canvas", "2d"], ["scene", "3d"], ["unrelated", "3d"], ["private", "3d"]]) {
    database.prepare("INSERT INTO projects (id,name,status,created_at,updated_at,project_type) VALUES (?,?,'draft','now','now',?)").run(id, id, kind);
    if (id !== "private") database.prepare("INSERT INTO project_members VALUES (?, 'user', 'editor', 'now', 'now')").run(id);
    if (kind === "3d") database.prepare("INSERT INTO standalone_3d_scenes (project_id,linked_2d_project_id,updated_at) VALUES (?,?,'now')").run(id, id === "scene" ? "canvas" : null);
  }
  database.exec("INSERT INTO assets VALUES ('asset-row', 'canvas', 'pump-1', NULL, 'Pump', 'pump', '{}', 'now', 'now')");
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
  const node = (id, interaction) => ({ id, type: "plain-text", x: 0, y: 0, width: 320, height: 100, zIndex: 0, props: { text: "Text", align: "left", fontSize: 24, fontWeight: 400, scrollMode: "none", scrollDuration: 12, textColor: "#ffffff", accentColor: "#55d8ff", fillColor: "#071525", borderColor: "#123456", borderRadius: 0 }, resourceRefs: [], dataBindingRefs: [], ...(interaction === undefined ? {} : { interaction }) });
  const canvasPatch = (revision, nodes, deletes = []) => validateCanvasPatch({ expectedRevision: revision, upsertNodes: nodes, deleteNodeIds: deletes });
  const instance = (actions) => ({ id: "model", assetId: null, modelAssetId: "builtin:aqua-helix-hd-v1", label: "Pump", renderMode: "interactive", sortOrder: 0, transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }, visible: true, ...(actions === undefined ? {} : { clickActions: actions }) });
  const scenePatch = (revision, instances, extra = {}) => validateStandaloneScenePatch({ expectedRevision: revision, upsertInstances: instances, deleteInstanceIds: [], ...extra });
  let canvas = await applyCanvasPatch(env, "canvas", "user", canvasPatch(0, [node("label"), node("panel"), node("trigger", { hiddenInPreview: false, clickActions: [{ type: "panel", nodeId: "panel", operation: "show" }] })]));
  assert.equal(canvas.nodes.find(node => node.id === "label").interaction, undefined);
  assert.equal(canvas.nodes.find(node => node.id === "trigger").interaction.clickActions[0].nodeId, "panel");
  await assert.rejects(() => applyCanvasPatch(env, "canvas", "user", canvasPatch(1, [], ["panel"])), error => error.code === "invalid_twin_action_reference" && error.message.includes("trigger"));
  assert.equal((await getCanvas(env, "canvas")).revision, 1);
  canvas = await applyCanvasPatch(env, "canvas", "user", canvasPatch(1, [node("trigger", { hiddenInPreview: true, clickActions: [] })], ["panel"]));
  assert.deepEqual(canvas.nodes.find(node => node.id === "trigger").interaction, { hiddenInPreview: true, clickActions: [] });
  const legacy = await applyStandaloneScenePatch(env, "scene", user, scenePatch(0, [instance()]));
  assert.equal(Object.hasOwn(legacy.instances[0], "clickActions"), false);
  const sceneActions = [message, { type: "set-text", nodeId: "label", text: "模型选中" }, { type: "select-asset", assetId: "pump-1" }, { type: "focus-model", projectId: "scene", instanceId: "model" }];
  const scene = await applyStandaloneScenePatch(env, "scene", user, scenePatch(1, [instance(sceneActions)]));
  assert.deepEqual(scene.instances[0].clickActions, sceneActions);
  await assert.rejects(() => applyStandaloneScenePatch(env, "scene", user, scenePatch(2, [], { linked2dProjectId: null })), error => error.code === "invalid_twin_action_reference");
  assert.equal((await getStandaloneScene(env, "scene")).linked2dProjectId, "canvas");
  const base = { kind: "canvas", projectId: "canvas", nodes: [node("label")] };
  const refs = (actions, extras = []) => ({ ...base, nodes: [...base.nodes, node("trigger", { hiddenInPreview: false, clickActions: actions }), ...extras] });
  await validateTwinActionReferences(env, "user", refs([{ type: "focus-model", projectId: "scene", instanceId: "model" }]));
  for (const action of [{ type: "focus-model", projectId: "scene", instanceId: "missing" }, { type: "focus-model", projectId: "private", instanceId: "model" }, { type: "focus-model", projectId: "unrelated", instanceId: "model" }, { type: "select-asset", assetId: "missing" }, { type: "panel", nodeId: "embedded", operation: "show" }, { type: "set-text", nodeId: "embedded", text: "bad" }]) await assert.rejects(() => validateTwinActionReferences(env, "user", refs([action], [{ id: "embedded", type: "scene-3d", props: { sceneProjectId: "scene" } }])), error => error.code === "invalid_twin_action_reference");
  assert.throws(() => validateCanvasPatch({ expectedRevision: 0, deleteNodeIds: [], upsertNodes: [{ ...node("embedded"), type: "scene-3d", props: { sceneProjectId: "scene", interactionEnabled: true }, width: 980, height: 620, interaction: { hiddenInPreview: false, clickActions: [] } }] }), error => error.code === "invalid_canvas_interaction");
  const empty = await applyStandaloneScenePatch(env, "scene", user, scenePatch(2, [instance([])]));
  assert.deepEqual(empty.instances[0].clickActions, []);
  assert.equal(database.prepare("SELECT click_actions_json FROM standalone_3d_instances WHERE project_id = 'scene'").get().click_actions_json, "[]");
  database.close();
  console.log("PASS: strict declarative actions, limits, legacy/empty round trips, SQL persistence, merged-target deletion and cross-project permission checks.");
} finally { rmSync(temporary, { recursive: true, force: true }); }
