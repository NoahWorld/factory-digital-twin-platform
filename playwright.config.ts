import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 12_000 },
  outputDir: process.env.NEWPOWER_ARTIFACTS_DIR ?? "test-results",
  use: {
    baseURL: process.env.NEWPOWER_BASE_URL ?? "http://127.0.0.1:5173",
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
