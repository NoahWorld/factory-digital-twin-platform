import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { createEditorState, executeEditorOperation, travelEditorHistory } from "../shared/editor-operations";
import { emptyProjectDefinition, parseProjectDefinition, projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM, type SceneDefinition } from "../shared/scene-definition";
import { createCanvasNode, parseModel3DProps } from "../apps/web/src/canvas/types";

const sceneFixture = (): SceneDefinition => ({ id: "scene-main", name: "装配场景", settings: { ...DEFAULT_SCENE_SETTINGS }, assetBindings: [], instances: [
  { id: "instance-one", name: "设备一", modelAssetId: "model-one", transform: structuredClone(IDENTITY_TRANSFORM), visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} },
] });

test("v2 migration, shared scene references and independent scene copies retain undo identity", () => {
  const empty = emptyProjectDefinition("fixture");
  const { scenes: _, ...old } = empty;
  expect(parseProjectDefinition({ ...old, schemaVersion: 2 }).scenes).toEqual([]);
  empty.pages[0].nodes = [{ ...createCanvasNode("model-3d", 0, 0, 1), id: "view-one", resourceRefs: ["model-one"] }];
  let state = createEditorState(empty);
  state = executeEditorOperation(state, { type: "scene.extract", nodeId: "view-one", scene: sceneFixture() });
  expect(state.document.nodes[0]).toMatchObject({ id: "view-one", sceneId: "scene-main", resourceRefs: [] });
  state = executeEditorOperation(state, { type: "page.duplicate", pageId: "main" });
  expect(state.document.nodes[0].sceneId).toBe("scene-main"); expect(state.project.scenes).toHaveLength(1);
  state = executeEditorOperation(state, { type: "scene.duplicate", sceneId: "scene-main", nodeId: state.document.nodes[0].id });
  const copyId = state.document.nodes[0].sceneId;
  expect(copyId).not.toBe("scene-main"); expect(state.project.scenes[1].instances[0].id).not.toBe("instance-one");
  expect(state.project.scenes[1].instances[0].modelAssetId).toBe("model-one");
  state = travelEditorHistory(state, "undo"); expect(state.project.scenes).toHaveLength(1);
  state = travelEditorHistory(state, "redo"); expect(state.document.nodes[0].sceneId).toBe(copyId);
  expect(() => executeEditorOperation(state, { type: "scene.delete", sceneId: "scene-main" })).toThrow("仍被页面引用");
  expect(() => executeEditorOperation(state, { type: "scene.create", scene: { ...sceneFixture(), id: "bad", instances: [{ ...sceneFixture().instances[0], extra: true }] } })).toThrow("未知字段");
  const mirror = { ...state.project.scenes[0].instances[0], transform: { ...structuredClone(IDENTITY_TRANSFORM), scale: [-1,1,1] } };
  const mirrored = executeEditorOperation(state, { type: "instance.upsert", sceneId: "scene-main", instance: mirror });
  expect(mirrored.project.scenes[0].instances[0].transform.scale).toEqual([-1,1,1]);
  expect(parseModel3DProps({ ...DEFAULT_SCENE_SETTINGS, transformOverrides: { mirrored: mirror.transform }, appearanceOverrides: {} }).ok).toBe(true);
  expect(() => executeEditorOperation(state, { type: "instance.upsert", sceneId: "scene-main", instance: { ...mirror, transform: { ...mirror.transform, scale: [0,1,1] } } })).toThrow("退化几何");
});

test("scene definitions, instances and object bindings share project CAS and page-local saves", async () => {
  const api = await localApi(); const demo = await createDemo(api, true);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const model = (await (await api.get(`${path}/model-assets`)).json()).modelAssets[0];
    const definition = (await (await api.get(`${path}/definition`)).json()).definition;
    const scene = sceneFixture(); scene.instances[0].modelAssetId = model.id;
    scene.assetBindings = [{ id: "object-binding", assetId: "DEVICE-001", instanceId: "instance-one", objectId: model.inspection.objects[0].objectId }];
    let state = createEditorState(definition);
    state = executeEditorOperation(state, { type: "scene.extract", nodeId: "demo-model", scene });
    state = executeEditorOperation(state, { type: "instance.duplicate", sceneId: scene.id, instanceId: "instance-one" });
    const save = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) });
    expect(save.status(), await save.text()).toBe(200);
    let current = (await save.json()).definition;
    expect(current.scenes[0].instances).toHaveLength(2); expect(current.scenes[0].assetBindings).toHaveLength(2);
    expect(current.pages[0].nodes.find((node: { id: string }) => node.id === "demo-model").sceneId).toBe(scene.id);
    const stale = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) }); expect(stale.status()).toBe(409);
    const savedScene = structuredClone(current.scenes);
    const localSave = await api.patch(`${path}/canvas`, { data: { expectedRevision: current.revision, upsertNodes: [demo.canvas.nodes[0]], deleteNodeIds: [] } });
    expect(localSave.status(), await localSave.text()).toBe(200);
    current = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(current.scenes).toEqual(savedScene);
    const invalid = structuredClone(current.scenes[0]); invalid.assetBindings[0].objectId = "missing-object";
    const bad = await api.patch(`${path}/definition`, { data: { expectedRevision: current.revision, upsertPages: [], deletePageIds: [], upsertNodes: [], deleteNodeIds: [], upsertScenes: [invalid] } });
    expect(bad.status()).toBe(400);
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(current);
    const deletion = await api.delete(path); expect(deletion.status(), await deletion.text()).toBe(200);
  } finally { await api.delete(path); await api.dispose(); }
});
