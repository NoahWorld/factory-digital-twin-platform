import { test,expect } from "@playwright/test";
import { createMockGltf,createAnimatedMockGltf } from "../scripts/mock-model.mjs";
import { inspectModelBytes } from "../apps/api/src/model-assets";
import { inspectLegacyModelNames } from "../apps/api/src/legacy-model-names";
import { verifyPackagedModel } from "../apps/api/src/package-resource-validation";
import { createHash } from "node:crypto";

test("package inspection verifies persisted reports while preserving opaque object and clip IDs",async () => {
  for (const raw of [createMockGltf([{ mesh:0,name:"First" },{ mesh:0,name:"Second" }]),createAnimatedMockGltf()]) {
    const bytes = new TextEncoder().encode(raw),id = crypto.randomUUID(),report = JSON.parse(JSON.stringify(await inspectModelBytes(bytes,"gltf",id)));
    const model = { id,projectId:"project",originalFilename:"model.gltf",format:"gltf" as const,contentType:"model/gltf+json",byteSize:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),inspection:report,createdAt:new Date().toISOString(),familyId:id,versionNumber:1,previousVersionId:null };
    const withOffset = Buffer.concat([Buffer.from("prefix"),Buffer.from(bytes),Buffer.from("suffix")]).subarray(6,6+bytes.length);
    await verifyPackagedModel(withOffset,model,await inspectLegacyModelNames(bytes));
    model.inspection.nodeCount++; await expect(verifyPackagedModel(bytes,model)).rejects.toThrow("inspection report");
  }
});
