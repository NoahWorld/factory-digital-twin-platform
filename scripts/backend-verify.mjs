import { spawnSync } from 'node:child_process';
import { backendDirectory } from './backend-target.mjs';

const result = spawnSync(process.env.MAVEN_EXECUTABLE ?? 'mvn', ['-B', '-ntp', 'clean', 'verify'], {
  cwd: backendDirectory(), stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
