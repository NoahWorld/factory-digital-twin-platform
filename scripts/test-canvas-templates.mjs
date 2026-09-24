import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { build } = createRequire(web.resolve("vite"))("esbuild");
const temporary = await mkdtemp(join(tmpdir(), "kingdom-canvas-templates-"));
try {
  const outfile = join(temporary, "templates.mjs");
  await build({
    stdin: {
      contents: 'export * from "./apps/web/src/canvas/templates.ts"; export { validateCanvasPatch } from "./apps/api/src/canvas.ts"; export * from "./shared/builtin-images.ts";',
      resolveDir: root,
    },
    outfile, bundle: true, platform: "node", format: "esm", logLevel: "warning",
  });
  const { canvasTemplates, instantiateCanvasTemplate, validateCanvasPatch, builtinImages, findBuiltinImage } = await import(pathToFileURL(outfile).href);
  for (const asset of builtinImages) {
    const bytes = await readFile(join(root, "apps/web/public", asset.contentPath));
    assert.equal(bytes.length, asset.byteSize);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, `${asset.id}: versioned bytes must match the registry`);
  }
  assert.equal(findBuiltinImage("builtin:unlisted-image"), undefined);
  assert.equal(canvasTemplates.length, 8);
  const allowedPreviewTypes = new Set([
    "rectangle", "screen-title", "datetime", "panel-frame", "card-background", "card-title", "vector-icon", "image",
    "metric-card", "radial-gauge", "progress-list", "status-grid", "ranking-list", "alarm-list", "data-table", "event-timeline",
    "line-chart", "bar-chart", "area-chart", "pie-chart", "donut-chart", "radar-chart",
  ]);
  for (const template of canvasTemplates) {
    const nodes = instantiateCanvasTemplate(template.id, []);
    const patch = { expectedRevision: 0, theme: template.canvasTheme, deleteNodeIds: [], upsertNodes: nodes };
    let validated;
    try {
      validated = validateCanvasPatch(JSON.parse(JSON.stringify(patch)));
    } catch (error) {
      throw new Error(`${template.id} fails the canvas save contract: ${error.message}`, { cause: error });
    }
    assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length, `${template.id}: IDs must be unique`);
    for (const node of nodes) {
      assert.ok(allowedPreviewTypes.has(node.type), `${template.id}: ${node.type} requires an explicit public preview renderer`);
      assert.equal(node.dataBindingRefs.length, 0, `${template.id}: public previews cannot request business data`);
      assert.ok(node.resourceRefs.every(id => node.type === "image" && findBuiltinImage(id)), `${template.id}: only allowlisted public images are allowed`);
      assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.width <= 1920 && node.y + node.height <= 1080, `${template.id}: ${node.type} exceeds the canvas`);
      if ("sample" in node.props) assert.equal(node.props.sample, true, `${template.id}: demo data must be labelled`);
    }
    assert.deepEqual(validateCanvasPatch(JSON.parse(JSON.stringify(validated))), validated, `${template.id}: save/read normalization must be stable`);
    const secondIds = new Set(instantiateCanvasTemplate(template.id, []).map(node => node.id));
    assert.ok(nodes.every(node => !secondIds.has(node.id)), `${template.id}: creating another project must issue new node IDs`);
    console.log(`✓ ${template.code}: ${nodes.length} editable nodes pass save/read validation, public-resource isolation and canvas bounds`);
  }

  const originalModel = {
    id: "preserved-model", type: "model-3d", x: 0, y: 0, width: 600, height: 400, zIndex: 4,
    props: { backgroundColor: "#102030", animationEnabled: false, nodeTransforms: { spindle: { position: [1, 2, 3] } } },
    resourceRefs: ["existing-project-model"], dataBindingRefs: ["existing-binding"],
  };
  for (const templateId of ["equipment-support", "industrial-park-operations"]) {
    const model = instantiateCanvasTemplate(templateId, [originalModel]).find(node => node.type === "model-3d");
    assert.ok(model, `${templateId}: keep an explicitly configured model`);
    assert.deepEqual(model.props, originalModel.props);
    assert.deepEqual(model.resourceRefs, originalModel.resourceRefs);
    assert.deepEqual(model.dataBindingRefs, originalModel.dataBindingRefs);
  }
  console.log("✓ Applying a layout preserves existing model configuration and resource bindings.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
