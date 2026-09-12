import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { createMockGltf } from "../scripts/mock-model.mjs";
import { createEditorState, executeEditorOperation, markEditorSaved, travelEditorHistory } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM, type SceneDefinition } from "../shared/scene-definition";
import { planModelReplacement, validateReplacementTargets } from "../shared/model-replacement";

test("replacement requires complete unambiguous repairs and preserves binding IDs through saved undo", async () => {
  const api = await localApi(); const demo = await createDemo(api, true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const firstResponse = await api.post(`${path}/model-assets?filename=original.gltf`, { data: createMockGltf([{ mesh: 0, name: "Pump", extras: { newpowerObjectId: "pump" } }, { mesh: 0, name: "Sensor" }]), headers: { "content-type": "model/gltf+json" } });
    expect(firstResponse.status()).toBe(201); const first = (await firstResponse.json()).modelAsset;
    const nextResponse = await api.post(`${path}/model-assets/${first.id}/versions?filename=updated.gltf`, { data: createMockGltf([{ mesh: 0, name: "PumpRenamed", extras: { newpowerObjectId: "pump" } }, { mesh: 0, name: "SensorRenamed" }]), headers: { "content-type": "model/gltf+json" } });
    expect(nextResponse.status()).toBe(201); const next = (await nextResponse.json()).modelAsset;
    const [pump, sensor] = first.inspection.objects; const [nextPump, nextSensor] = next.inspection.objects;
    const instance = { id: "replace-me", name: "泵组", modelAssetId: first.id, transform: structuredClone(IDENTITY_TRANSFORM), visible: true, appearance: null,
      objectTransforms: { [sensor.objectId]: { ...structuredClone(IDENTITY_TRANSFORM), position: [0,2,0] } }, objectAppearances: { [pump.objectId]: { color: "#ffcc00", opacity: .7, visible: true } } };
    const scene: SceneDefinition = { id: "scene", name: "Replacement fixture", settings: DEFAULT_SCENE_SETTINGS, instances: [instance, { ...structuredClone(instance), id: "unchanged-instance", name: "保持旧版" }], assetBindings: [
      { id: "pump-binding", instanceId: instance.id, objectId: pump.objectId, assetId: "DEVICE-001" }, { id: "sensor-binding", instanceId: instance.id, objectId: sensor.objectId, assetId: "DEVICE-002" },
    ] };
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    state = executeEditorOperation(state, { type: "scene.extract", nodeId: "demo-model", scene });
    let response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) }); expect(response.status(), await response.text()).toBe(200);
    state = createEditorState((await response.json()).definition);
    const plan = planModelReplacement(scene, instance.id, first, next);
    expect(plan.references.find((ref) => ref.objectId === pump.objectId)?.match).toBe("identity");
    expect(plan.references.find((ref) => ref.objectId === sensor.objectId)?.match).toBe("unresolved");
    const operation = { type: "instance.replace-resource", sceneId: scene.id, instanceId: instance.id, expectedAssetId: first.id, newAssetId: next.id };
    expect(() => executeEditorOperation(state, { ...operation, objectMap: { [pump.objectId]: nextPump.objectId } })).toThrow("每个受影响对象");
    expect(() => executeEditorOperation(state, { ...operation, objectMap: { [pump.objectId]: nextPump.objectId, [sensor.objectId]: nextPump.objectId } })).toThrow("同一个新对象");
    expect(() => validateReplacementTargets(plan, { [pump.objectId]: "missing" })).toThrow("不在候选模型");
    const repaired = executeEditorOperation(state, { ...operation, objectMap: { [pump.objectId]: nextPump.objectId, [sensor.objectId]: nextSensor.objectId } });
    expect(repaired.project.scenes[0].assetBindings.find((binding) => binding.id === "sensor-binding")).toMatchObject({ assetId: "DEVICE-002", objectId: nextSensor.objectId });
    expect(repaired.project.scenes[0].instances[0].objectTransforms[nextSensor.objectId].position).toEqual([0,2,0]);
    expect(repaired.project.scenes[0].instances[1].modelAssetId).toBe(first.id);
    response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(repaired.project, repaired.savedProject) }); expect(response.status()).toBe(200);
    state = markEditorSaved(repaired, (await response.json()).definition);
    state = travelEditorHistory(state, "undo");
    response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) }); expect(response.status()).toBe(200);
    const restored = (await response.json()).definition;
    expect(restored.scenes[0].instances[0].modelAssetId).toBe(first.id);
    expect(restored.scenes[0].assetBindings.find((binding: { id: string }) => binding.id === "sensor-binding").objectId).toBe(sensor.objectId);
    const removal = executeEditorOperation(createEditorState(restored), { ...operation, objectMap: { [pump.objectId]: nextPump.objectId, [sensor.objectId]: null } });
    expect(removal.project.scenes[0].assetBindings).toHaveLength(1); expect(removal.project.scenes[0].instances[0].objectTransforms).toEqual({});
    expect((await (await api.get(`${path}/assets`)).json()).assets).toHaveLength(2);
    expect((await api.get(`${path}/model-assets/${first.id}/content`)).status()).toBe(200);
  } finally { await api.delete(path); await api.dispose(); }
});
