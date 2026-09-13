import { test,expect } from "@playwright/test";
import { createDemo,localApi } from "./demo";

test("model and image conditional responses retain their content and release unused bodies", async () => {
  const api = await localApi(); const demo = await createDemo(api,true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const modelId = demo.canvas.nodes.find((node: { type: string }) => node.type === "model-3d").resourceRefs[0];
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64");
    const upload = await api.post(`${path}/image-assets?filename=conditional.png`,{ data: png,headers: { "content-type": "image/png" } }); expect(upload.status(),await upload.text()).toBe(201);
    const imageId = (await upload.json()).imageAsset.id;
    for (const content of [`${path}/model-assets/${modelId}/content`,`${path}/image-assets/${imageId}/content`]) {
      const first = await api.get(content); expect(first.status()).toBe(200); const bytes = await first.body(),etag = first.headers().etag; expect(etag).toBeTruthy();
      for (let index = 0; index < 3; index++) expect((await api.get(content,{ headers: { "if-none-match": etag } })).status()).toBe(304);
      const again = await api.get(content); expect(again.status()).toBe(200); expect(await again.body()).toEqual(bytes);
    }
  } finally { await api.delete(path); await api.dispose(); }
});
