import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { build } = createRequire(web.resolve("vite"))("esbuild");
const temporary = await mkdtemp(join(tmpdir(), "dtwin-iot-"));
try {
  const outfile = join(temporary, "test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../apps/web/tests/iot-integration.test.mjs", import.meta.url))],
    outfile, bundle: true, platform: "node", format: "esm", logLevel: "warning",
    define: { "import.meta.env": JSON.stringify({ DEV: true, BASE_URL: "/twin/", VITE_IOT_RESOURCE_ORIGINS: "https://minio.example.test" }) },
  });
  execFileSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
