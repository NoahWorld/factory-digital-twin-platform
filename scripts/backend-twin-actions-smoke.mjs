// Local Java/PostgreSQL contract smoke. No mock server, unrelated ports or user projects.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.BACKEND_URL ?? "http://127.0.0.1:18080";
assert.equal(base, "http://127.0.0.1:18080", "This smoke test may only use the local 18080 deployment.");
const flags = new Set(process.argv.slice(2));
assert.ok([...flags].every(flag => ["--keep-fixture", "--cleanup"].includes(flag)), "Supported flags: --keep-fixture, --cleanup.");
assert.ok(!(flags.has("--keep-fixture") && flags.has("--cleanup")), "Choose either --keep-fixture or --cleanup.");
const manifestPath = join(root, "deploy/local/.local/twin-action-smoke.json");
const admin = JSON.parse(readFileSync(join(root, "deploy/local/.local/admin.json"), "utf8"));
let cookie = "";
async function call(path, { method = "GET", body, status = 200, as = cookie } = {}) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { Origin: base, ...(as ? { Cookie: as } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const value = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
  assert.ok(response.headers.get("x-request-id"), `${method} ${path}: missing request ID`);
  return { value, response };
}
const login = await call("/auth/login", { method: "POST", body: admin });
cookie = login.response.headers.get("set-cookie").split(";")[0];
const safeId = id => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id);
const persist = manifest => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });

async function cleanup(manifest) {
  assert.equal(manifest.base, base);
  assert.match(manifest.runId, /^twin-action-smoke-[a-f0-9-]{36}$/);
  assert.ok(Array.isArray(manifest.projects) && manifest.projects.length <= 3);
  assert.ok(Array.isArray(manifest.users) && manifest.users.length <= 1);
  // Verify names as well as IDs before deleting anything. The manifest never contains passwords.
  for (const entry of [...manifest.projects].reverse()) {
    assert.ok(safeId(entry.id));
    assert.equal(entry.name, `${manifest.runId} ${entry.kind}`);
    const project = (await call(`/projects/${entry.id}`)).value.project;
    assert.equal(project.name, entry.name, `Refusing to delete renamed/non-fixture project ${entry.id}.`);
    assert.equal((await call(`/projects/${entry.id}`, { method: "DELETE" })).value.deletedProjectId, entry.id);
    manifest.projects = manifest.projects.filter(project => project.id !== entry.id);
    persist(manifest);
    console.log(`CLEANUP deleted fixture project ${entry.id}`);
  }
  for (const entry of [...manifest.users]) {
    assert.ok(safeId(entry.id));
    assert.equal(entry.loginName, manifest.runId);
    const sql = `DELETE FROM users WHERE id='${entry.id}' AND login_name='${entry.loginName}' RETURNING id;`;
    const deleted = execFileSync("docker", ["compose", "--env-file", "deploy/local/.env", "-f", "deploy/local/compose.yml", "exec", "-T", "postgres", "psql", "-U", "twin", "-d", "factory_twin", "-v", "ON_ERROR_STOP=1", "-At"], { cwd: root, input: sql, encoding: "utf8" });
    assert.ok(deleted.split("\n").includes(entry.id), `Fixture account ${entry.id} was not deleted; retain manifest for inspection.`);
    manifest.users = manifest.users.filter(user => user.id !== entry.id);
    persist(manifest);
    console.log(`CLEANUP deleted fixture account ${entry.id}`);
  }
  rmSync(manifestPath);
}

if (flags.has("--cleanup")) {
  assert.ok(existsSync(manifestPath), `No fixture manifest: ${manifestPath}`);
  await cleanup(JSON.parse(readFileSync(manifestPath, "utf8")));
  console.log("PASS: only the recorded temporary fixture projects/account were removed.");
} else {
  assert.ok(!existsSync(manifestPath), `A previous fixture exists; run --cleanup first: ${manifestPath}`);
  const manifest = { base, runId: `twin-action-smoke-${randomUUID()}`, createdAt: new Date().toISOString(), projects: [], users: [] };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  const temporary = mkdtempSync(join(tmpdir(), "twin-action-api-smoke-"));
  let completed = false;
  const project = async kind => {
    const name = `${manifest.runId} ${kind}`;
    const value = (await call("/projects", { method: "POST", status: 201, body: { name, projectType: kind === "canvas" ? "2d" : "3d" } })).value.project;
    manifest.projects.push({ id: value.id, name, kind }); persist(manifest); return value.id;
  };
  try {
    execFileSync(process.execPath, [join(root, "apps/web/node_modules/typescript/bin/tsc"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--strict", "--skipLibCheck", "--rootDir", root, "--outDir", temporary, join(root, "apps/web/src/canvas/types.ts")], { stdio: "inherit" });
    const { createCanvasNode } = createRequire(import.meta.url)(join(temporary, "apps/web/src/canvas/types.js"));
    const canvasId = await project("canvas"), sceneId = await project("scene"), unrelatedId = await project("unrelated");
    const node = (type, id, x, y, props = {}) => ({ ...createCanvasNode(type, x, y, 1), id, props: { ...createCanvasNode(type, x, y, 1).props, ...props } });
    const label = node("plain-text", "message-label", 70, 80, { text: "点击模型，或点击下方联动按钮", fontSize: 30 });
    label.width = 720; label.height = 85;
    const panel = node("plain-text", "status-panel", 70, 310, { text: "设备面板已打开", fontSize: 28, fillColor: "#123456" });
    panel.width = 560; panel.height = 130; panel.interaction = { clickActions: [], hiddenInPreview: true };
    const detail = node("asset-detail", "asset-panel", 1280, 80); detail.width = 500; detail.height = 500;
    detail.interaction = { clickActions: [], hiddenInPreview: true };
    const fullscreen = node("fullscreen-toggle", "fullscreen", 70, 200); fullscreen.width = 260;
    let canvas = (await call(`/projects/${canvasId}/canvas`, { method: "PATCH", body: { expectedRevision: 0, upsertNodes: [label, panel, detail, fullscreen], deleteNodeIds: [] } })).value.canvas;
    assert.equal(canvas.nodes.find(item => item.id === label.id).interaction, undefined);
    await call(`/projects/${canvasId}/assets`, { method: "POST", status: 201, body: { assetId: "smoke-pump", name: "交互验证设备", assetType: "pump", modelNode: null, metadata: {} } });
    const models = (await call(`/projects/${sceneId}/model-assets`)).value.modelAssets;
    const model = models.find(item => /robot-arm|robotic-arm|mechanical-arm|industrial-arm/.test(item.id)) ?? models.find(item => /crate/.test(item.id));
    assert.ok(model, "A packaged robot arm or crate is required for the UI fixture.");
    const instance = { id: "demo-model", assetId: "smoke-pump", modelAssetId: model.id, label: "点击设备验证 2D/3D 联动", renderMode: "interactive", sortOrder: 0, transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }, visible: true };
    let scene = (await call(`/projects/${sceneId}/scene`, { method: "PATCH", body: { expectedRevision: 0, linked2dProjectId: canvasId, upsertInstances: [instance], deleteInstanceIds: [] } })).value.scene;
    assert.equal(Object.hasOwn(scene.instances[0], "clickActions"), false);
    const actions = [
      { type: "message", title: "交互验证", text: "已触发模型/按钮事件；设备详情、文字和面板已同步更新。" },
      { type: "panel", nodeId: panel.id, operation: "show" },
      { type: "set-text", nodeId: label.id, text: "2D 与 3D 交互成功" },
      { type: "select-asset", assetId: "smoke-pump" },
      { type: "panel", nodeId: detail.id, operation: "show" },
      { type: "focus-model", projectId: sceneId, instanceId: instance.id },
    ];
    scene = (await call(`/projects/${sceneId}/scene`, { method: "PATCH", body: { expectedRevision: scene.revision, upsertInstances: [{ ...instance, clickActions: actions }], deleteInstanceIds: [] } })).value.scene;
    const button = node("button", "action-button", 390, 200, { text: "验证 2D → 3D 联动", href: "" }); button.width = 370;
    button.interaction = { hiddenInPreview: false, clickActions: actions };
    canvas = (await call(`/projects/${canvasId}/canvas`, { method: "PATCH", body: { expectedRevision: canvas.revision, upsertNodes: [button], deleteNodeIds: [] } })).value.canvas;
    assert.deepEqual((await call(`/projects/${sceneId}/scene`)).value.scene.instances[0].clickActions, actions);
    assert.deepEqual((await call(`/projects/${canvasId}/canvas`)).value.canvas.nodes.find(item => item.id === button.id).interaction, button.interaction);
    console.log("PASS: old fields stay absent; all six declarative actions persist and round-trip through Java/PostgreSQL.");
    for (const upsert of [
      { ...button, interaction: { hiddenInPreview: false, clickActions: [{ type: "script", text: "alert(1)" }] } },
      { ...button, interaction: { hiddenInPreview: false, clickActions: Array(9).fill(actions[0]) } },
      { ...button, interaction: { hiddenInPreview: false, clickActions: [{ type: "panel", nodeId: "missing", operation: "show" }] } },
      { ...button, interaction: { hiddenInPreview: false, clickActions: [{ type: "focus-model", projectId: unrelatedId, instanceId: instance.id }] } },
    ]) await call(`/projects/${canvasId}/canvas`, { method: "PATCH", status: 400, body: { expectedRevision: canvas.revision, upsertNodes: [upsert], deleteNodeIds: [] } });
    await call(`/projects/${canvasId}/canvas`, { method: "PATCH", status: 400, body: { expectedRevision: canvas.revision, upsertNodes: [], deleteNodeIds: [panel.id] } });
    await call(`/projects/${sceneId}/scene`, { method: "PATCH", status: 400, body: { expectedRevision: scene.revision, upsertInstances: [], deleteInstanceIds: [], linked2dProjectId: null } });
    assert.equal((await call(`/projects/${canvasId}/canvas`)).value.canvas.revision, canvas.revision);
    assert.equal((await call(`/projects/${sceneId}/scene`)).value.scene.revision, scene.revision);
    console.log("PASS: unknown/oversized actions, dangling targets, unrelated scenes and unlinking reject atomically without revision changes.");
    const testUser = (await call("/users", { method: "POST", status: 201, body: { loginName: manifest.runId, email: `${manifest.runId}@local.test`, displayName: "Temporary interaction test", password: admin.password, role: "viewer", modules: ["2d", "3d"] } })).value.user;
    manifest.users.push({ id: testUser.id, loginName: manifest.runId }); persist(manifest);
    await call(`/projects/${canvasId}/members/${testUser.id}`, { method: "PUT", body: { role: "editor" } });
    const userLogin = await call("/auth/login", { method: "POST", body: { identifier: manifest.runId, password: admin.password } });
    const testCookie = userLogin.response.headers.get("set-cookie").split(";")[0];
    await call(`/projects/${canvasId}/canvas`, { method: "PATCH", as: testCookie, status: 404, body: { expectedRevision: canvas.revision, upsertNodes: [button], deleteNodeIds: [] } });
    await call(`/projects/${sceneId}/members/${testUser.id}`, { method: "PUT", body: { role: "viewer" } });
    await call(`/projects/${sceneId}/scene`, { method: "PATCH", as: testCookie, status: 403, body: { expectedRevision: scene.revision, upsertInstances: [{ ...instance, clickActions: [] }], deleteInstanceIds: [] } });
    await call(`/users/${testUser.id}/revoke-sessions`, { method: "POST" });
    console.log("PASS: source edit permission and target read permission are independently enforced.");
    scene = (await call(`/projects/${sceneId}/scene`, { method: "PATCH", body: { expectedRevision: scene.revision, upsertInstances: [{ ...instance, clickActions: [] }], deleteInstanceIds: [] } })).value.scene;
    assert.deepEqual((await call(`/projects/${sceneId}/scene`)).value.scene.instances[0].clickActions, []);
    scene = (await call(`/projects/${sceneId}/scene`, { method: "PATCH", body: { expectedRevision: scene.revision, upsertInstances: [{ ...instance, clickActions: actions }], deleteInstanceIds: [] } })).value.scene;
    completed = true;
    console.log(`PASS: explicit [] persists separately from legacy missing clickActions. UI scene fixture: ${sceneId}; canvas fixture: ${canvasId}.`);
    if (flags.has("--keep-fixture")) console.log(`Fixtures retained only for UI verification. Manifest: ${manifestPath}. Cleanup: node scripts/backend-twin-actions-smoke.mjs --cleanup`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (!completed || !flags.has("--keep-fixture")) await cleanup(manifest);
  }
}
