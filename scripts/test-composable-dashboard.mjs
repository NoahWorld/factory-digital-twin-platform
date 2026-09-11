import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "factory-composable-dashboard-test-"));
const require = createRequire(import.meta.url);

const node = (overrides) => ({
  id: "node-1",
  type: "scene-3d",
  x: 0,
  y: 0,
  width: 980,
  height: 620,
  zIndex: 1,
  props: { sceneProjectId: "factory-scene-1", interactionEnabled: true },
  resourceRefs: [],
  dataBindingRefs: [],
  ...overrides,
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
    join(root, "apps/api/src/canvas.ts"),
  ], { cwd: root, stdio: "inherit" });

  const { validateCanvasPatch } = require(join(temporary, "apps/api/src/canvas.js"));
  const validated = validateCanvasPatch({
    expectedRevision: 0,
    deleteNodeIds: [],
    upsertNodes: [
      node({}),
      node({
        id: "node-2",
        type: "asset-detail",
        x: 1000,
        width: 420,
        height: 400,
        props: {
          title: "设备实时数据",
          emptyText: "请点击设备",
          showMetadata: true,
          maximumMetrics: 6,
          textColor: "#eafaff",
          accentColor: "#55d8ff",
          fillColor: "#0b2638",
          borderColor: "#286783",
        },
      }),
    ],
  });
  assert.deepEqual(validated.upsertNodes.map((item) => item.type), ["scene-3d", "asset-detail"]);
  assert.equal(validated.upsertNodes[0].props.sceneProjectId, "factory-scene-1");
  assert.throws(
    () => validateCanvasPatch({
      expectedRevision: 0,
      deleteNodeIds: [],
      upsertNodes: [node({ resourceRefs: ["model-1"] })],
    }),
    (error) => error.code === "invalid_canvas_node" && error.status === 400,
  );
  assert.throws(
    () => validateCanvasPatch({
      expectedRevision: 0,
      deleteNodeIds: [],
      upsertNodes: [node({
        type: "asset-detail",
        props: {
          title: "设备实时数据",
          emptyText: "",
          showMetadata: true,
          maximumMetrics: 13,
          textColor: "#eafaff",
          accentColor: "#55d8ff",
          fillColor: "#0b2638",
          borderColor: "#286783",
        },
      })],
    }),
    (error) => error.code === "invalid_canvas_node" && error.status === 400,
  );

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = join(root, "apps/api/migrations");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations.filter((name) => name < "0020_")) {
    database.exec(readFileSync(join(migrationDirectory, migration), "utf8"));
  }
  database.prepare(`
    INSERT INTO users (
      id, email, login_name, display_name, password_hash, password_salt,
      password_iterations, is_active, created_at, updated_at
    ) VALUES ('user-1', 'owner@example.com', 'owner', 'Owner', 'hash', 'salt', 100000, 1, 'now', 'now')
  `).run();
  database.prepare(
    "INSERT INTO projects (id, name, status, created_at, updated_at, project_type) VALUES ('project-2d', '2D 看板', 'draft', 'now', 'now', '2d')",
  ).run();
  database.prepare(
    "INSERT INTO project_canvases (project_id, updated_by_user_id, updated_at) VALUES ('project-2d', 'user-1', 'now')",
  ).run();
  database.prepare(`
    INSERT INTO canvas_nodes (
      id, project_id, node_type, x, y, width, height, z_index,
      props_json, resource_refs_json, data_binding_refs_json, updated_at
    ) VALUES ('old-node', 'project-2d', 'plain-text', 0, 0, 160, 48, 1, '{}', '[]', '[]', 'now')
  `).run();
  database.exec(readFileSync(join(migrationDirectory, "0020_composable_dashboard_nodes.sql"), "utf8"));
  assert.equal(database.prepare("SELECT node_type FROM canvas_nodes WHERE id = 'old-node'").get().node_type, "plain-text");
  const insert = database.prepare(`
    INSERT INTO canvas_nodes (
      id, project_id, node_type, x, y, width, height, z_index,
      props_json, resource_refs_json, data_binding_refs_json, updated_at
    ) VALUES (?, 'project-2d', ?, 0, 0, ?, ?, ?, '{}', '[]', '[]', 'now')
  `);
  insert.run("scene-node", "scene-3d", 980, 620, 2);
  insert.run("detail-node", "asset-detail", 420, 400, 3);
  assert.deepEqual(
    database.prepare("SELECT node_type FROM canvas_nodes WHERE id != 'old-node' ORDER BY z_index").all().map((row) => row.node_type),
    ["scene-3d", "asset-detail"],
  );
  database.close();

  console.log("PASS: composable 2D/3D node validation, invalid inputs, migration preservation and database round-trip.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
