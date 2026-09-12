import { test, expect } from "@playwright/test";
import { createDemo,localApi } from "./demo";
import { createMockGltf } from "../scripts/mock-model.mjs";
import { createEditorState,executeEditorOperation,travelEditorHistory,markEditorSaved } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS,IDENTITY_TRANSFORM } from "../shared/scene-definition";
import { planModelReplacement } from "../shared/model-replacement";

test("motion-only references participate in model repair and scene duplication, undo and persistence", async () => {
  const api = await localApi(); const demo = await createDemo(api,true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const original = await api.post(`${path}/model-assets?filename=rotor.gltf`,{ data: createMockGltf([{ mesh: 0,name: "Rotor" }]),headers: { "content-type": "model/gltf+json" } }); expect(original.status()).toBe(201);
    const before = (await original.json()).modelAsset;
    const version = await api.post(`${path}/model-assets/${before.id}/versions?filename=rotor-v2.gltf`,{ data: createMockGltf([{ mesh: 0,name: "RotorRenamed" }]),headers: { "content-type": "model/gltf+json" } }); expect(version.status()).toBe(201);
    const after = (await version.json()).modelAsset; const oldId = before.inspection.objects[0].objectId,newId = after.inspection.objects[0].objectId;
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    state = executeEditorOperation(state,{ type: "scene.extract",nodeId: "demo-model",scene: { id: "motion-scene",name: "Motion repair",settings: DEFAULT_SCENE_SETTINGS,assetBindings: [],instances: [{ id: "rotor",name: "Rotor",modelAssetId: before.id,transform: IDENTITY_TRANSFORM,visible: true,appearance: null,objectTransforms: {},objectAppearances: {} }],motions: [{ id: "spin",name: "Rotation",version: 1,durationMs: 1000,repeat: 1,fill: "restore",tracks: [{ id: "rotation",type: "object",target: { instanceId: "rotor",objectId: oldId },property: "rotation",easing: "linear",keyframes: [{ timeMs: 0,value: [0,0,0] },{ timeMs: 1000,value: [0,360,0] }] }] }] } });
    state = executeEditorOperation(state,{ type: "interactions.set",interactions: { states: [],rules: [{ id: "play",name: "Play",pageId: "main",enabled: true,reentry: "restart",trigger: { type: "node.click",sourceId: "demo-model" },condition: null,actions: [{ type: "motion.play",nodeId: "demo-model",motionId: "spin" }] }] } });
    let saved = await api.patch(`${path}/definition`,{ data: projectDefinitionPatch(state.project,state.savedProject) }); expect(saved.status(),await saved.text()).toBe(200); state = markEditorSaved(state,(await saved.json()).definition);
    const plan = planModelReplacement(state.project.scenes[0],"rotor",before,after);
    expect(plan.references).toHaveLength(1); expect(plan.references[0]).toMatchObject({ objectId: oldId,motionTracks: 1,bindings: 0,transform: false,appearance: false,match: "unresolved" });
    const replace = { type: "instance.replace-resource",sceneId: "motion-scene",instanceId: "rotor",expectedAssetId: before.id,newAssetId: after.id };
    expect(() => executeEditorOperation(state,{ ...replace,objectMap: {} })).toThrow("每个受影响对象");
    expect(() => executeEditorOperation(state,{ ...replace,objectMap: { [oldId]: null } })).toThrow("关联动作");
    expect(() => executeEditorOperation(state,{ type: "instance.delete",sceneId: "motion-scene",instanceId: "rotor" })).toThrow("实例不存在");
    const replaced = executeEditorOperation(state,{ ...replace,objectMap: { [oldId]: newId } });
    expect(replaced.project.scenes[0].motions![0].tracks[0]).toMatchObject({ target: { objectId: newId } });
    saved = await api.patch(`${path}/definition`,{ data: projectDefinitionPatch(replaced.project,replaced.savedProject) }); expect(saved.status(),await saved.text()).toBe(200);
    const undo = travelEditorHistory(markEditorSaved(replaced,(await saved.json()).definition),"undo");
    saved = await api.patch(`${path}/definition`,{ data: projectDefinitionPatch(undo.project,undo.savedProject) }); expect(saved.status()).toBe(200); state = markEditorSaved(undo,(await saved.json()).definition);
    expect(state.project.scenes[0].motions![0].tracks[0]).toMatchObject({ target: { objectId: oldId } });
    const copy = executeEditorOperation(state,{ type: "scene.duplicate",sceneId: "motion-scene",nodeId: "demo-model" });
    const duplicated = copy.project.scenes[1];
    expect(duplicated.motions![0].id).not.toBe("spin"); expect(duplicated.motions![0].tracks[0]).toMatchObject({ target: { instanceId: duplicated.instances[0].id,objectId: oldId } });
    expect(copy.project.interactions.rules[0].actions[0]).toMatchObject({ motionId: duplicated.motions![0].id,nodeId: "demo-model" });
    saved = await api.patch(`${path}/definition`,{ data: projectDefinitionPatch(copy.project,copy.savedProject) }); expect(saved.status(),await saved.text()).toBe(200);
    const persisted = (await saved.json()).definition; expect(persisted.interactions.rules[0].actions[0].motionId).toBe(persisted.scenes[1].motions[0].id);
  } finally { await api.delete(path); await api.dispose(); }
});
