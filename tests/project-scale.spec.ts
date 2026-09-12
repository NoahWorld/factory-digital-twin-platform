import { test, expect } from "@playwright/test";
import { localApi } from "./demo";
import { login } from "./support";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { createEditorState, executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";

test("M2 records save, readback and browser load at 25, 100 and 500 components", async ({ page }) => {
  test.setTimeout(90_000);
  const api = await localApi();
  await login(page);
  try {
    for (const count of [25, 100, 500]) {
      const created = await api.post("/api/v1/projects", { data: { name: `M2 规模验证 ${count}（模拟）` } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).project.id;
      const path = `/api/v1/projects/${id}`;
      try {
        const initial = (await (await api.get(`${path}/definition`)).json()).definition;
        const nodes = Array.from({ length: count }, (_, index) => ({ ...createCanvasNode("plain-text", (index % 10) * 180, Math.floor(index / 10) * 60, index), id: `scale-${index}` }));
        const state = executeEditorOperation(createEditorState(initial), { type: "nodes.upsert", nodes });
        const start = performance.now();
        const saved = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) });
        const saveMs = performance.now() - start;
        expect(saved.status(), await saved.text()).toBe(200);
        const loadStart = performance.now();
        const read = await api.get(`${path}/definition`);
        const result = (await read.json()).definition;
        const readMs = performance.now() - loadStart;
        expect(result.pages[0].nodes).toHaveLength(count);
        const browserStart = performance.now();
        await page.goto(`/#/projects/${id}/canvas`);
        await expect(page.locator(".canvas-node")).toHaveCount(count);
        const browserLoadMs = performance.now() - browserStart;
        console.log(JSON.stringify({ benchmark: "M2-project-persistence", nodes: count, saveMs, readMs, browserLoadMs, scope: "local Worker + D1 and Chrome; full DOM mounted, no 3D or production capacity claim" }));
      } finally { await page.goto("/#/projects"); await api.delete(path); }
    }
  } finally { await api.dispose(); }
});
