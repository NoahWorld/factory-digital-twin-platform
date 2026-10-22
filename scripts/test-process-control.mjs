import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { build } = createRequire(web.resolve('vite'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'twin-process-control-'));
try {
  const outfile = join(temporary, 'test.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../apps/web/tests/process-control.test.mjs', import.meta.url))],
    outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' }, logLevel: 'warning',
    plugins: [{
      name: 'room-alarm-renderer-probe',
      setup(build) {
        build.onResolve({ filter: /^(react|\.\/canvas\/useIotEmbed)$/ }, args => {
          if (!args.importer.endsWith('/src/publications.tsx')) return;
          return { path: fileURLToPath(new URL('../apps/web/tests/fixtures/publication-runtime-probe.mjs', import.meta.url)) };
        });
        build.onResolve({ filter: /\/(Model3DNode|useRoomAlarmData|useIotEmbed)$/ }, args => {
          if (!args.importer.endsWith('/scene/RoomAlarmSceneNode.tsx')) return;
          return { path: fileURLToPath(new URL('../apps/web/tests/fixtures/room-alarm-renderer-probe.mjs', import.meta.url)) };
        });
      },
    }],
  });
  execFileSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
