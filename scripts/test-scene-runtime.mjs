import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { build } = createRequire(web.resolve('vite'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'factory-scene-runtime-'));
try {
  const outfile = join(temporary, 'test.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../apps/web/tests/scene-runtime.test.mjs', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning' });
  await import(pathToFileURL(outfile).href);
} finally { await rm(temporary, { recursive: true, force: true }); }
