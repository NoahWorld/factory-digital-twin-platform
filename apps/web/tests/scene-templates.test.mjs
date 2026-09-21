import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModels } from "../../../shared/builtin-models";
import { STANDALONE_3D_LIMITS } from "../../../shared/standalone-3d";
import { workshopInstances, workshopSettings } from "../../../shared/workshop-layout";
import { getSceneTemplate, instantiateSceneTemplate, isSceneTemplateId, sceneTemplates } from "../src/scene/scene-templates";
import { projectTemplateScenePath } from "../src/canvas/routes";

const blank = () => ({ instances: [], linked2dProjectId: null, projectId: "test-3d", revision: 0, settings: { ...workshopSettings }, updatedAt: "test" });
const apply = (overrides = {}) => instantiateSceneTemplate({ templateId: "production-workshop", currentScene: blank(), savedScene: blank(), models: builtinModels, limits: STANDALONE_3D_LIMITS, editable: true, ...overrides });
let checks = 0;
function check(name, run) { run(); checks++; console.log(`✓ ${name}`); }

check("template uses the canonical workshop instances and settings", () => {
  assert.equal(sceneTemplates[0].instances, workshopInstances);
  assert.equal(sceneTemplates[0].settings, workshopSettings);
  assert.equal(isSceneTemplateId("production-workshop"), true);
  assert.equal(isSceneTemplateId("unregistered"), false);
  assert.throws(() => getSceneTemplate("unregistered"), /未知/);
  for (const id of sceneTemplates[0].previewModelIds) assert.ok(builtinModels.some((model) => model.id === id && model.thumbnailPath));
});
check("new 3D projects instantiate independent editable local drafts", () => {
  const currentScene = blank();
  const savedScene = blank();
  const snapshot = JSON.stringify({ currentScene, savedScene, workshopInstances });
  const draft = apply({ currentScene, savedScene, requireNewProject: true });
  assert.equal(draft.projectId, "test-3d");
  assert.equal(draft.revision, 0);
  assert.equal(draft.instances.length, 98);
  assert.ok(draft.instances.every((instance) => instance.assetId === null));
  draft.instances[0].transform.position[0] = 123;
  draft.settings.cameraFov = 70;
  assert.equal(JSON.stringify({ currentScene, savedScene, workshopInstances }), snapshot);
});
check("read-only accounts and missing model resources reject before mutation", () => {
  assert.throws(() => apply({ editable: false }), /权限/);
  assert.throws(() => apply({ models: [] }), /模型未全部就绪/);
});
check("template URL cannot overwrite an existing, linked or modified draft", () => {
  const existing = { ...blank(), revision: 1 };
  assert.throws(() => apply({ savedScene: existing, currentScene: existing, requireNewProject: true }), /全新空项目/);
  const populated = { ...blank(), instances: [structuredClone(workshopInstances[0])] };
  assert.throws(() => apply({ savedScene: populated, currentScene: populated, requireNewProject: true }), /全新空项目/);
  const linked = { ...blank(), linked2dProjectId: "2d-other" };
  assert.throws(() => apply({ savedScene: linked, currentScene: linked, requireNewProject: true }), /全新空项目/);
  assert.throws(() => apply({ currentScene: { ...blank(), settings: { ...workshopSettings, cameraFov: 80 } }, requireNewProject: true }), /全新空项目/);
});
check("confirmed replacements preserve project identity and 2D association", () => {
  const existing = { ...blank(), linked2dProjectId: "2d-linked", revision: 4, instances: structuredClone(workshopInstances) };
  const draft = apply({ currentScene: existing, savedScene: existing });
  assert.equal(draft.projectId, existing.projectId);
  assert.equal(draft.revision, 4);
  assert.equal(draft.linked2dProjectId, "2d-linked");
  assert.notEqual(draft.instances, existing.instances);
});
check("all performance budgets and total patch changes are checked", () => {
  const cases = [
    ["maximumInstances", 97, /实例的预算/],
    ["maximumUniqueModelAssets", 20, /不同模型/],
    ["maximumUniqueModelBytes", 1, /资源总量/],
    ["maximumEstimatedMeshInstances", 1, /网格实例/],
    ["maximumAnimatedInstances", 1, /动画预算/],
    ["maximumPatchInstances", 97, /单次保存上限/],
  ];
  for (const [key, value, message] of cases) assert.throws(() => apply({ limits: { ...STANDALONE_3D_LIMITS, [key]: value } }), message);
  const previous = { ...blank(), revision: 1, instances: Array.from({ length: 3 }, (_, index) => ({ ...structuredClone(workshopInstances[0]), id: `old-${index}` })) };
  assert.throws(() => apply({ currentScene: previous, savedScene: previous }), /101 个实例变更/);
});
check("3D route and template UI cannot silently create a 2D canvas", () => {
  assert.equal(projectTemplateScenePath("p/1", "production-workshop"), "#/projects/p%2F1/scene?template=production-workshop");
  const app = readFileSync("apps/web/src/App.tsx", "utf8");
  assert.match(app, /projectType: templateId\?\.projectType \?\? projectType/);
  const editor = readFileSync("apps/web/src/pages/Standalone3DProjectPage.tsx", "utf8");
  assert.doesNotMatch(editor, /替换为新版示例车间|搭建示例车间|assembleWorkshop/);
  assert.match(editor, /<SceneTemplateDialog/);
  const gallery = readFileSync("apps/web/src/scene/SceneTemplateGallery.tsx", "utf8");
  assert.doesNotMatch(gallery, /Model3DNode|WebGLRenderer|GLTFLoader/);
  assert.match(gallery, /loading="lazy"/);
});
console.log(`PASS: ${checks} scene template checks.`);
