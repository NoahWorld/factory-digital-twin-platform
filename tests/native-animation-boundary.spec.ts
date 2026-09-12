import { test,expect } from "@playwright/test";
import { createDemo,localApi } from "./demo";
import { createAnimatedMockGltf } from "../scripts/mock-model.mjs";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS,IDENTITY_TRANSFORM } from "../shared/scene-definition";
import { validateSceneMotions } from "../shared/scene-motion";

test("native clip ownership, source time limits and internal pose conflicts are rejected without changing saved scenes", async () => {
  const api = await localApi(); const demo = await createDemo(api,false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const models = [];
    for (const name of ["one","two"]) { const result = await api.post(`${path}/model-assets?filename=${name}.gltf`,{ data: createAnimatedMockGltf(),headers: { "content-type": "model/gltf+json" } }); expect(result.status()).toBe(201); models.push((await result.json()).modelAsset); }
    const [one,two] = models;
    const motion = { id: "lift",name: "Lift",version: 1,durationMs: 1000,repeat: 1,fill: "hold",tracks: [{ id: "clip",type: "clip",target: { instanceId: "instance",objectId: null },property: "clip",clipId: one.inspection.clips[0].clipId,easing: "linear",keyframes: [{ timeMs: 0,value: 0 },{ timeMs: 1000,value: 1 }] }] };
    const state = executeEditorOperation(createEditorState((await (await api.get(`${path}/definition`)).json()).definition),{ type: "scene.create",scene: { id: "scene",name: "Native",settings: DEFAULT_SCENE_SETTINGS,assetBindings: [],instances: [{ id: "instance",name: "One",modelAssetId: one.id,transform: IDENTITY_TRANSFORM,visible: true,appearance: null,objectTransforms: {},objectAppearances: {} }],motions: [motion] } });
    const saved = await api.patch(`${path}/definition`,{ data: projectDefinitionPatch(state.project,state.savedProject) }); expect(saved.status(),await saved.text()).toBe(200); const definition = (await saved.json()).definition;
    const invalids = [
      { ...motion,tracks: [{ ...motion.tracks[0],clipId: two.inspection.clips[0].clipId }] },
      { ...motion,tracks: [{ ...motion.tracks[0],keyframes: [{ timeMs: 0,value: 0 },{ timeMs: 1000,value: 3 }] }] },
    ];
    for (const [index,invalid] of invalids.entries()) {
      const response = await api.patch(`${path}/definition`,{ data: { expectedRevision: definition.revision,upsertPages: [],deletePageIds: [],upsertNodes: [],deleteNodeIds: [],upsertScenes: [{ ...definition.scenes[0],motions: [invalid] }] } });
      expect(response.status()).toBe(400); expect((await response.json()).error).toBe(index === 0 ? "invalid_motion_clip" : "invalid_motion_clip_time");
    }
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(definition);
    const object = { id: "move",type: "object",target: { instanceId: "instance",objectId: one.inspection.objects[0].objectId },property: "position",easing: "linear",keyframes: [{ timeMs: 0,value: [0,0,0] },{ timeMs: 1000,value: [0,1,0] }] };
    expect(() => validateSceneMotions([{ ...motion,tracks: [...motion.tracks,object] }])).toThrow("不能同时占用姿态");
    expect(() => validateSceneMotions([{ ...motion,tracks: [...motion.tracks,{ ...object,target: { ...object.target,objectId: null } }] }])).not.toThrow();
    const copy = executeEditorOperation(createEditorState(definition),{ type: "scene.duplicate",sceneId: "scene" });
    expect(copy.project.scenes[1].motions![0].tracks[0]).toMatchObject({ clipId: one.inspection.clips[0].clipId,target: { instanceId: copy.project.scenes[1].instances[0].id } });
  } finally { await api.delete(path); await api.dispose(); }
});
