import { build } from "esbuild";
import { mkdir,cp,rm,readFile,readdir,writeFile } from "node:fs/promises";
import { dirname,resolve,join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../",import.meta.url));
await rm(`${root}dist`,{ recursive: true,force: true });
const built = await build({ metafile:true, entryPoints: [fileURLToPath(new URL("../src/server.ts",import.meta.url))],outfile: `${root}dist/server.mjs`,bundle: true,platform: "node",format: "esm",target: "node24",banner:{ js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },define:{ "process.env.WS_NO_BUFFER_UTIL":"true","process.env.WS_NO_UTF_8_VALIDATE":"true" },logLevel: "info" });
await mkdir(`${root}dist/migrations`,{ recursive: true });
await cp(fileURLToPath(new URL("../../api/migrations",import.meta.url)),`${root}dist/migrations`,{ recursive: true });
await cp(fileURLToPath(new URL("../../web/dist",import.meta.url)),`${root}dist/public`,{ recursive: true });
await cp(`${root}telemetry-migrations`,`${root}dist/telemetry-migrations`,{ recursive:true });

const packages = new Map();
for (const input of Object.keys(built.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    try {
      const pkg = JSON.parse(await readFile(join(directory,"package.json"),"utf8"));
      if (pkg.name && pkg.version) packages.set(pkg.name,{ directory,name:pkg.name,version:pkg.version,license:pkg.license ?? "SEE LICENSE" });
      break;
    } catch (error) { if (error.code !== "ENOENT") throw error; directory = dirname(directory); }
  }
}
for (const pkg of packages.values()) {
  const destination = join(root,"dist","licenses",`${pkg.name.replaceAll("/","_").replaceAll("@","")}-${pkg.version}`);
  const files = (await readdir(pkg.directory)).filter((name) => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name));
  if (!files.length) throw new Error(`Bundled dependency ${pkg.name} has no license file to include.`);
  await mkdir(destination,{ recursive:true });
  for (const file of files) await cp(join(pkg.directory,file),join(destination,file));
}
await writeFile(join(root,"dist","dependencies.json"),JSON.stringify([...packages.values()].map(({ name,version,license }) => ({ name,version,license })).sort((a,b) => a.name.localeCompare(b.name)),null,2)+"\n");
