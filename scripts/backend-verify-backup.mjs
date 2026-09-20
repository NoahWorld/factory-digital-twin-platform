// Restore a dump into a new disposable database; never overwrite the working database.
import {execFileSync} from 'node:child_process';
import {readFileSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
if(!process.argv[2])throw new Error('Usage: node scripts/backend-verify-backup.mjs <backup-directory>');
const directory=resolve(process.argv[2]),dump=join(directory,'postgres.dump');
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json')));
if(await hashFile(dump)!==manifest.dumpSha256)throw new Error('Backup checksum mismatch.');
const db='twin_restore_check_'+Date.now();
const command=['compose','--env-file','deploy/local/.env','-f','deploy/local/compose.yml','exec','-T','postgres'];
const sql=(database,input)=>execFileSync('docker',[...command,'psql','-U','twin','-d',database,'-v','ON_ERROR_STOP=1','-At'],{cwd:root,input,encoding:'utf8'});
sql('postgres',`CREATE DATABASE ${db};`);
try {
 const fd=openSync(dump,'r');
 try {execFileSync('docker',[...command,'pg_restore','-U','twin','-d',db,'--exit-on-error','--no-owner','--no-acl'],{cwd:root,stdio:[fd,'inherit','inherit']});} finally{closeSync(fd);}
 console.log('Restore verified in disposable database: '+sql(db,"SELECT 'tables='||count(*) FROM information_schema.tables WHERE table_schema='public'; SELECT 'users='||count(*) FROM users; SELECT 'projects='||count(*) FROM projects;").trim());
} finally {sql('postgres',`DROP DATABASE ${db};`);}
