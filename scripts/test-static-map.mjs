// Adoptable runner: defaults to this repository's installed web dependencies; never installs packages.
// For a bounded handoff package, STATIC_MAP_NODE_MODULES may point to an authorized read-only node_modules.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = process.env.STATIC_MAP_NODE_MODULES ? resolve(process.env.STATIC_MAP_NODE_MODULES) : join(root, 'apps/web/node_modules');
const requireWeb = createRequire(join(modules, '__static-map-check__.cjs'));
const ts = requireWeb('typescript');
const sources = ['shared/static-map.ts', 'apps/web/src/scene/static-map-manager.ts'].map(path => join(root, path));
const program = ts.createProgram(sources, {
  noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, types: [],
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], baseUrl: root,
  paths: { three: [join(dirname(requireWeb.resolve('@types/three/package.json')), 'index.d.ts')] },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  process.exitCode = 1;
} else {
  console.log('Static map strict TypeScript check passed (2 source files; no emit).');
  const esbuild = createRequire(requireWeb.resolve('vite'))('esbuild');
  try {
    const bundle = await esbuild.build({
      entryPoints: [join(root, 'apps/web/tests/static-map.test.mjs')], bundle: true, write: false,
      platform: 'node', format: 'esm', target: 'node22', nodePaths: [modules], logLevel: 'warning',
    });
    // In-memory bundle: no temporary file outside (or inside) the permitted output directory.
    const source = `${bundle.outputFiles[0].text}\n//# sourceURL=static-map-test-bundle.mjs\n`;
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  } finally { esbuild.stop(); }
}
