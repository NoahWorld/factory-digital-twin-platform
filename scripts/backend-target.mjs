import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Java repository is the write/build target; apps/backend is a historical snapshot.
export function backendDirectory() {
  const platform = dirname(dirname(fileURLToPath(import.meta.url)));
  const index = process.argv.indexOf('--backend-dir');
  const configured = index < 0 ? process.env.TWIN_BACKEND_DIR : process.argv[index + 1];
  if (index >= 0 && (!configured || configured.startsWith('--'))) throw new Error('--backend-dir requires a directory.');
  const directory = resolve(platform, configured ?? '../factory-digital-twin-backend');
  if (!existsSync(join(directory, 'pom.xml'))) throw new Error(`Java backend not found at ${directory}; set TWIN_BACKEND_DIR or --backend-dir.`);
  return directory;
}
