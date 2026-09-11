import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const library = resolve(dirname(require.resolve("three")), "../examples/jsm/libs");
const files = new Map([
  ["LICENSE.txt", resolve(import.meta.dirname, "../../licenses/decoder-apache-2.0.txt")],
  ["basis/basis_transcoder.js", "basis/basis_transcoder.js"],
  ["basis/basis_transcoder.wasm", "basis/basis_transcoder.wasm"],
  ["basis/README.md", "basis/README.md"],
  ["draco/draco_decoder.js", "draco/gltf/draco_decoder.js"],
  ["draco/draco_wasm_wrapper.js", "draco/gltf/draco_wasm_wrapper.js"],
  ["draco/draco_decoder.wasm", "draco/gltf/draco_decoder.wasm"],
  ["draco/README.md", "draco/README.md"],
]);

export function decoderAssets(): Plugin {
  return {
    name: "local-model-decoders",
    async generateBundle() {
      for (const [target, source] of files) {
        this.emitFile({ type: "asset", fileName: `decoders/${target}`, source: await readFile(resolve(library, source)) });
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const prefix = `${server.config.base}decoders/`;
        const pathname = request.url?.split("?")[0];
        if (!pathname?.startsWith(prefix)) return next();
        const source = files.get(pathname.slice(prefix.length));
        if (!source) { response.statusCode = 404; response.end("Unknown decoder asset"); return; }
        try {
          const data = await readFile(resolve(library, source));
          response.setHeader("Content-Type", source.endsWith(".wasm") ? "application/wasm" : source.endsWith(".js") ? "text/javascript" : "text/plain");
          response.end(data);
        } catch (reason) { next(reason); }
      });
    },
  };
}
