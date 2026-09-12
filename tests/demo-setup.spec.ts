import { test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createDemo, localApi } from "./demo";

test("prepare two reusable NewPower demonstration projects", async () => {
  test.skip(process.env.NEWPOWER_SEED_DEMOS !== "true", "Set NEWPOWER_SEED_DEMOS=true only when preparing demonstration projects.");
  const api = await localApi();
  try {
    const pure = await createDemo(api);
    const combined = await createDemo(api, true);
    const path = process.env.NEWPOWER_SESSION_FILE!;
    const existing = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...existing, demos: { pure, combined } }), { mode: 0o600 });
    console.log(JSON.stringify({ event: "newpower_demos_created", pure: pure.projectId, combined: combined.projectId }));
  } finally { await api.dispose(); }
});
