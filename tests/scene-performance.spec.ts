import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createEditorState, executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM, type SceneDefinition } from "../shared/scene-definition";

test("scene baseline measures 1, 10 and 100 shared-resource instances while the camera rotates", async ({ page }) => {
  test.setTimeout(90_000);
  const api = await localApi(); await login(page);
  try {
    for (const count of [1,10,100]) {
      const demo = await createDemo(api, true); const path = `/api/v1/projects/${demo.projectId}`;
      try {
        const model = demo.canvas.nodes.find((node: { type: string }) => node.type === "model-3d").resourceRefs[0];
        const scene: SceneDefinition = { id: "scale-scene", name: `${count} 个模拟模型实例`, settings: { ...DEFAULT_SCENE_SETTINGS, autoRotate: true }, assetBindings: [], instances: Array.from({ length: count }, (_, index) => ({
          id: `instance-${index}`, name: `实例 ${index}`, modelAssetId: model, transform: { ...structuredClone(IDENTITY_TRANSFORM), position: [(index % 10) * 8,0,Math.floor(index / 10) * 8] }, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {},
        })) };
        let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
        state = executeEditorOperation(state, { type: "scene.extract", nodeId: "demo-model", scene });
        const saved = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) });
        expect(saved.status(), await saved.text()).toBe(200);
        const requests: string[] = []; const observe = (request: import("@playwright/test").Request) => { if (request.url().includes(`/model-assets/${model}`)) requests.push(request.url()); };
        page.on("request", observe); const started = performance.now(); await page.goto(`/#/projects/${demo.projectId}/preview`);
        await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
        const loadMs = performance.now() - started;
        const result = await page.evaluate(async () => {
          const url = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/src/canvas/scene-viewport-runtime.ts")).at(-1)!;
          const { sceneViewportDiagnostics } = await import(/* @vite-ignore */ url);
          const before = sceneViewportDiagnostics()[0]; const durations: number[] = [];
          await new Promise<void>((resolve) => {
            let previous = 0;
            const next = (now: number) => { if (previous) durations.push(now - previous); previous = now; durations.length >= 120 ? resolve() : requestAnimationFrame(next); };
            requestAnimationFrame(next);
          });
          const after = sceneViewportDiagnostics()[0];
          const context = document.querySelector<HTMLCanvasElement>(".model-3d-renderer canvas")!.getContext("webgl2")!;
          const extension = context.getExtension("WEBGL_debug_renderer_info");
          return { before, after, durations, renderer: extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "unavailable" };
        });
        page.off("request", observe);
        const p95 = result.durations.sort((a: number,b: number) => a-b)[113];
        const fps = 1000 / (result.durations.reduce((sum: number, value: number) => sum+value, 0) / result.durations.length);
        console.log(JSON.stringify({ benchmark: "rotating-shared-scene", instances: count, triangles: result.after.triangles, loadMs, p95FrameMs: p95, meanFps: fps, renderedFrames: result.after.frame - result.before.frame, requests: requests.length, renderer: result.renderer, ownedResources: result.after.ownedResources }));
        expect(result.after.instances).toBe(count); expect(result.after.triangles).toBe(count * 24);
        expect(result.after.ownedResources.geometries).toBe(1); expect(result.after.manifests.loads).toBe(1);
        expect(requests).toHaveLength(2); expect(result.after.frame - result.before.frame).toBeGreaterThanOrEqual(110);
        expect(p95).toBeLessThanOrEqual(1000 / 30 + .1);
      } finally { await page.goto("/#/projects"); await api.delete(path); }
    }
  } finally { await api.dispose(); }
});
