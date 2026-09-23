import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { build } = createRequire(web.resolve('vite'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'factory-twin-points-'));
try {
  const outfile = join(temporary, 'test.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../apps/web/tests/twin-point-stream.test.mjs', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', sourcemap: 'inline', logLevel: 'warning' });
  await import(pathToFileURL(outfile).href);
  const hookFile = join(temporary, 'hook.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../apps/web/tests/twin-drive-hook.test.mjs', import.meta.url))], outfile: hookFile, bundle: true, platform: 'node', format: 'esm', sourcemap: 'inline', define: { 'import.meta.env': '{}' }, logLevel: 'warning', plugins: [{ name: 'isolated-react-hook-lifecycle', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: fileURLToPath(new URL('../apps/web/tests/helpers/hook-lifecycle.mjs', import.meta.url)) }));
  } }] });
  await import(pathToFileURL(hookFile).href);
} finally { await rm(temporary, { recursive: true, force: true }); }
