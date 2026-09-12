import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createAnimatedMockGltf } from "../scripts/mock-model.mjs";

test("cloned native clips target their own instance and preserve interpolation and pose through material updates", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page);
    for (const interpolation of ["LINEAR", "STEP", "CUBICSPLINE"]) {
      const upload = await api.post(`${path}/model-assets?filename=animated.gltf`, { data: createAnimatedMockGltf({ interpolation }), headers: { "content-type": "model/gltf+json" } });
      expect(upload.status(), await upload.text()).toBe(201); const model = (await upload.json()).modelAsset;
      const result = await page.evaluate(async ({ model, projectId }) => {
        const cachePath = "/src/canvas/model-resource-cache.ts", instancePath = "/src/canvas/model-instance.ts", threePath = "/node_modules/.vite/deps/three.js";
        const { acquireModelResource, modelResourceDiagnostics } = await import(/* @vite-ignore */ cachePath);
        const { createModelInstance } = await import(/* @vite-ignore */ instancePath);
        const THREE = await import(/* @vite-ignore */ threePath);
        const url = `/api/v1/projects/${projectId}/model-assets/${model.id}/content`;
        const a = acquireModelResource(url), b = acquireModelResource(url); const [first, second] = await Promise.all([a.ready,b.ready]);
        const definition = { id: "a", name: "First", modelAssetId: model.id, transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} };
        const controller = createModelInstance(definition, first, model.inspection.objects);
        const other = createModelInstance({ ...definition, id: "b" }, second, model.inspection.objects);
        controller.apply(definition); other.apply({ ...definition, id: "b" });
        const mixer = new THREE.AnimationMixer(first.scene); const clip = first.animationClip(0); const action = mixer.clipAction(clip); action.play();
        try {
          mixer.update(.5);
          const before = first.nodesByIndex.get(0).position.y;
          const animated = model.inspection.objects.find((object: { nodeIndex: number }) => object.nodeIndex === 0).objectId;
          controller.apply(definition, { [animated]: { color: "#ff0000", opacity: 1, visible: true } });
          const afterColor = first.nodesByIndex.get(0).position.y;
          const sourceTrack = first.animations[0].tracks[0];
          const interpolationPreserved = clip.tracks[0].createInterpolant === sourceTrack.createInterpolant;
          const targetOwnUuid = clip.tracks[0].name.startsWith(`${first.nodesByIndex.get(0).uuid}.`);
          const sourceUnchanged = sourceTrack.name !== clip.tracks[0].name;
          const next = structuredClone(definition); next.objectTransforms = { [animated]: { position: [0,3,0], rotation: [0,0,0], scale: [1,1,1] } };
          controller.apply(next); mixer.update(.25); action.stop(); mixer.uncacheRoot(first.scene); controller.restorePose();
          return { before, afterColor, other: second.nodesByIndex.get(0).position.y, restored: first.nodesByIndex.get(0).position.y,
            targetOwnUuid, sourceUnchanged, interpolationPreserved, sharedClips: first.animations === second.animations, shared: modelResourceDiagnostics() };
        } finally { mixer.stopAllAction(); mixer.uncacheRoot(first.scene); controller.dispose(); other.dispose(); a.release(); b.release(); }
      }, { model, projectId: demo.projectId });
      expect(result.targetOwnUuid).toBe(true); expect(result.sourceUnchanged).toBe(true); expect(result.interpolationPreserved).toBe(true); expect(result.sharedClips).toBe(true);
      expect(result.before).toBe(interpolation === "STEP" ? 0 : 1); expect(result.afterColor).toBe(result.before); expect(result.other).toBe(0); expect(result.restored).toBe(3);
    }
  } finally { await api.delete(path); await api.dispose(); }
});
