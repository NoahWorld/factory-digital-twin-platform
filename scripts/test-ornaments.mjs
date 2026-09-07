import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "factory-ornaments-test-"));
const require = createRequire(import.meta.url);
try {
  execFileSync(process.execPath, [join(root, "apps/web/node_modules/typescript/bin/tsc"),
    "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--strict", "--skipLibCheck",
    "--rootDir", root, "--outDir", temporary,
    ...["apps/api/src/canvas.ts", "apps/api/src/project-covers.ts", "apps/web/src/canvas/types.ts", "apps/web/src/canvas/geometry.ts", "apps/web/src/canvas/themes.ts"].map((file) => join(root, file)),
  ], { cwd: root, stdio: "inherit" });
  const { createCanvasNode } = require(join(temporary, "apps/web/src/canvas/types.js"));
  const { resizeCanvasNode } = require(join(temporary, "apps/web/src/canvas/geometry.js"));
  const { applyCanvasThemeToNode, canvasThemePresets } = require(join(temporary, "apps/web/src/canvas/themes.js"));
  const { validateCanvasPatch } = require(join(temporary, "apps/api/src/canvas.js"));
  const { renderProjectCoverSvg } = require(join(temporary, "apps/api/src/project-covers.js"));
  const { parseOrnamentProps, titleVariants } = require(join(temporary, "shared/canvas-ornaments.js"));
  const { iconCatalog } = require(join(temporary, "shared/icon-catalog.js"));
  const patch = (node) => validateCanvasPatch({ expectedRevision: 0, upsertNodes: [node], deleteNodeIds: [] }).upsertNodes[0];
  const title = createCanvasNode("card-title", 24, 24, 1);
  const icon = createCanvasNode("vector-icon", 24, 110, 2);
  const animatedMinimumSizes = {
    "radar-sweep": { width: 160, height: 160 },
    "data-stream": { width: 200, height: 72 },
    "circuit-pulse": { width: 240, height: 120 },
    "energy-core": { width: 160, height: 160 },
    "industrial-flow": { width: 200, height: 64 },
    "scan-grid": { width: 240, height: 120 },
  };
  const animatedNodes = Object.keys(animatedMinimumSizes).map((type, index) =>
    createCanvasNode(type, 360 + index * 40, 160 + index * 40, 3 + index));
  const fullscreen = createCanvasNode("fullscreen-toggle", 96, 920, 20);
  assert.equal(iconCatalog.length, 36);
  for (const node of [title, icon]) {
    assert.deepEqual(patch(node).props, node.props);
    assert.ok(JSON.stringify(node).length < 1500, "nodes must contain configuration only");
    for (const entry of iconCatalog) assert.equal(patch({ ...node, props: { ...node.props, icon: entry.id } }).props.icon, entry.id);
    for (const invalid of [{ icon: "unknown" }, { icon: "<script>" }, { iconSize: 0 }, { iconSize: 257 }, { opacity: NaN }, { strokeWidth: 5 }, { iconColor: "url(https://example.com)" }]) {
      assert.equal(parseOrnamentProps(node.type, { ...node.props, ...invalid }).ok, false);
      assert.throws(() => patch({ ...node, props: { ...node.props, ...invalid } }));
    }
    assert.throws(() => patch({ ...node, resourceRefs: ["external-icon"] }));
    assert.throws(() => patch({ ...node, dataBindingRefs: ["unexpected-binding"] }));
    const themed = applyCanvasThemeToNode(node, canvasThemePresets["steel-orange"]);
    assert.equal(themed.props.iconColor, "#ff9f43");
    assert.equal(themed.props.icon, node.props.icon);
  }
  for (const invalid of [{ text: "" }, { text: "x".repeat(121) }, { fontSize: 97 }, { fontWeight: 650 }, { variant: "bad" }, { fontFamily: "__proto__" }, { italic: "true" }, { backgroundOpacity: -1 }, { gap: 65 }]) {
    assert.equal(parseOrnamentProps("card-title", { ...title.props, ...invalid }).ok, false);
    assert.throws(() => patch({ ...title, props: { ...title.props, ...invalid } }));
  }
  assert.equal(patch({ ...title, props: { ...title.props, icon: "none" } }).props.icon, "none");
  assert.throws(() => patch({ ...icon, props: { ...icon.props, icon: "none" } }));
  const smallIcon = resizeCanvasNode(icon, "south-east", -200, -20, 1920, 1080);
  assert.equal(smallIcon.width, 24);
  assert.equal(smallIcon.height, 24);
  assert.deepEqual(patch(smallIcon).props, icon.props);
  const smallTitle = resizeCanvasNode(title, "south-east", -500, -200, 1920, 1080);
  assert.equal(smallTitle.width, 120);
  assert.equal(smallTitle.height, 32);
  assert.deepEqual(patch(smallTitle).props, title.props, "resize must not mutate typography");
  for (const node of animatedNodes) {
    assert.deepEqual(patch(node).props, node.props);
    assert.ok(JSON.stringify(node).length < 1500, "animated decorations must contain configuration only");
    assert.throws(() => patch({ ...node, props: { ...node.props, accentColor: "url(https://example.com)" } }));
    assert.throws(() => patch({ ...node, props: { ...node.props, opacity: 0 } }));
    assert.throws(() => patch({ ...node, resourceRefs: ["external-animation"] }));
    assert.throws(() => patch({ ...node, dataBindingRefs: ["unexpected-binding"] }));
    const themed = applyCanvasThemeToNode(node, canvasThemePresets["steel-orange"]);
    assert.equal(themed.props.accentColor, "#ff9f43");
    const resized = resizeCanvasNode(node, "south-east", -2000, -2000, 1920, 1080);
    assert.deepEqual(
      { width: resized.width, height: resized.height },
      animatedMinimumSizes[node.type],
      `${node.type} must keep its frontend minimum size`,
    );
    assert.deepEqual(patch(resized).props, node.props);
  }
  const animatedCover = renderProjectCoverSvg({ projectId: "test", width: 1920, height: 1080, revision: 1, updatedAt: null, theme: canvasThemePresets["deep-blue"], nodes: animatedNodes });
  for (const node of animatedNodes) {
    assert.ok(animatedCover.includes(`data-decoration-type="${node.type}"`), `${node.type} must render in derived covers`);
  }
  assert.deepEqual(patch(fullscreen).props, fullscreen.props);
  assert.throws(() => patch({ ...fullscreen, props: { ...fullscreen.props, enterText: "" } }));
  assert.throws(() => patch({ ...fullscreen, props: { ...fullscreen.props, exitText: "x".repeat(121) } }));
  assert.throws(() => patch({ ...fullscreen, props: { ...fullscreen.props, disabled: "false" } }));
  assert.throws(() => patch({ ...fullscreen, resourceRefs: ["unexpected-resource"] }));
  const smallFullscreen = resizeCanvasNode(fullscreen, "south-east", -500, -200, 1920, 1080);
  assert.deepEqual({ width: smallFullscreen.width, height: smallFullscreen.height }, { width: 120, height: 48 });
  assert.deepEqual(patch(smallFullscreen).props, fullscreen.props);
  const themedFullscreen = applyCanvasThemeToNode(fullscreen, canvasThemePresets["steel-orange"]);
  assert.equal(themedFullscreen.props.accentColor, "#ff9f43");
  assert.equal(themedFullscreen.props.enterText, fullscreen.props.enterText);
  const fullscreenCover = renderProjectCoverSvg({ projectId: "test", width: 1920, height: 1080, revision: 1, updatedAt: null, theme: canvasThemePresets["deep-blue"], nodes: [fullscreen] });
  assert.ok(fullscreenCover.includes(fullscreen.props.enterText));
  for (const variant of Object.keys(titleVariants)) {
    const node = patch({ ...title, width: 1200, props: { ...title.props, text: 'A <img onerror="x"> & B', variant } });
    const svg = renderProjectCoverSvg({ projectId: "test", width: 1920, height: 1080, revision: 1, updatedAt: null, theme: canvasThemePresets["deep-blue"], nodes: [node, icon] });
    assert.ok(svg.includes("&lt;img"));
    assert.ok(!svg.includes("<img"));
    assert.ok(svg.includes(iconCatalog.find((entry) => entry.id === title.props.icon).body));
  }
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(join(root, "apps/api/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations.filter((name) => !name.startsWith("0012_") && !name.startsWith("0013_") && !name.startsWith("0014_"))) db.exec(readFileSync(join(root, "apps/api/migrations", migration), "utf8"));
  db.exec("INSERT INTO projects (id,name,status,created_at,updated_at) VALUES ('test','Test','draft','now','now'); INSERT INTO project_canvases (project_id,updated_at) VALUES ('test','now'); INSERT INTO canvas_nodes (id,project_id,node_type,x,y,width,height,z_index,props_json,updated_at) VALUES ('old','test','section-title',10,20,300,64,1,'{\"preserve\":true}','now');");
  const before = db.prepare("SELECT * FROM canvas_nodes WHERE id='old'").get();
  db.exec(readFileSync(join(root, "apps/api/migrations/0012_card_titles_and_icons.sql"), "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM canvas_nodes WHERE id='old'").get(), before);
  db.exec(readFileSync(join(root, "apps/api/migrations/0013_animated_decorations.sql"), "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM canvas_nodes WHERE id='old'").get(), before);
  db.exec(readFileSync(join(root, "apps/api/migrations/0014_fullscreen_toggle.sql"), "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM canvas_nodes WHERE id='old'").get(), before);
  const insert = db.prepare("INSERT INTO canvas_nodes (id,project_id,node_type,x,y,width,height,z_index,props_json,updated_at) VALUES (?,'test',?,?,?,?,?,?,?,'now')");
  for (const node of [smallTitle, smallIcon, ...animatedNodes, smallFullscreen]) {
    insert.run(node.id, node.type, node.x, node.y, node.width, node.height, node.zIndex, JSON.stringify(node.props));
    const stored = JSON.parse(db.prepare("SELECT props_json FROM canvas_nodes WHERE id=?").get(node.id).props_json);
    assert.deepEqual(patch({ ...node, props: stored }).props, node.props);
  }
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
  console.log("PASS: 36 icons, all title styles, 6 animated decorations, fullscreen toggle, frontend/API contracts, invalid inputs, resizing, themes, derived covers, migration preservation and database round-trip.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
