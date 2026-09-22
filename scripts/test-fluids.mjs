import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { build } = createRequire(web.resolve('vite'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'factory-fluids-'));
try {
  const outfile = join(temporary, 'test.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('../apps/web/tests/fluid-manager.test.mjs', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
  execFileSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
  await build({ entryPoints: [fileURLToPath(new URL('../apps/web/tests/fluid-path-editor.test.mjs', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
  execFileSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
  execFileSync(process.execPath, [fileURLToPath(new URL('./test-fluid-contracts.mjs', import.meta.url))], { stdio: 'inherit' });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
