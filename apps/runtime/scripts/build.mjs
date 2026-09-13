import { build } from "esbuild";
import { mkdir,cp,rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../",import.meta.url));
await rm(`${root}dist`,{ recursive: true,force: true });
await build({ entryPoints: [fileURLToPath(new URL("../src/server.ts",import.meta.url))],outfile: `${root}dist/server.mjs`,bundle: true,platform: "node",format: "esm",target: "node24",logLevel: "info" });
await mkdir(`${root}dist/migrations`,{ recursive: true });
await cp(fileURLToPath(new URL("../../api/migrations",import.meta.url)),`${root}dist/migrations`,{ recursive: true });
await cp(fileURLToPath(new URL("../../web/dist",import.meta.url)),`${root}dist/public`,{ recursive: true });
