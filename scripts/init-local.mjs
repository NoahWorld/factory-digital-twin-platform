import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const destination = new URL('../deploy/local/.env', import.meta.url);
if (existsSync(destination)) {
  console.log('deploy/local/.env already exists; preserved.');
} else {
  let contents = readFileSync(new URL('../deploy/local/.env.example', import.meta.url), 'utf8');
  contents = contents.replaceAll(/replace-with-random-(?:secret|access-key|token)/g, () => randomBytes(32).toString('hex'));
  writeFileSync(destination, contents, {mode: 0o600, flag: 'wx'});
  console.log('Created deploy/local/.env (0600). Bootstrap token is stored there, never printed.');
}
