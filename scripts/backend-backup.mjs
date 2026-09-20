// Consistent local backup: pause only this stack's writers and object store, then resume them.
import {execFileSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync,copyFileSync,chmodSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const compose=['compose','--env-file','deploy/local/.env','-f','deploy/local/compose.yml'];
const run=(args,options={})=>execFileSync('docker',[...compose,...args],{cwd:root,stdio:'inherit',...options});
const destination=resolve(root,'deploy/local/.local/backups',new Date().toISOString().replaceAll(':','-'));
mkdirSync(destination,{recursive:true,mode:0o700});
const running=run(['ps','--services','--status','running'],{encoding:'utf8',stdio:'pipe'}).trim().split('\n');
const pause=['api','collector','worker','storage'].filter(s=>running.includes(s));
if(!running.includes('postgres')||!running.includes('storage'))throw new Error('PostgreSQL and storage must be running before backup.');
let complete=false;
try {
  run(['stop',...pause]);
  const fd=openSync(join(destination,'postgres.dump'),'wx',0o600);
  try {run(['exec','-T','postgres','pg_dump','-U','twin','-d','factory_twin','--format=custom','--no-owner','--no-acl'],{stdio:['ignore',fd,'inherit']});} finally {closeSync(fd);}
  mkdirSync(join(destination,'objects'),{mode:0o700});
  run(['cp','storage:/data/.',join(destination,'objects')]);
  copyFileSync(join(root,'deploy/local/.env'),join(destination,'config.env'));chmodSync(join(destination,'config.env'),0o600);
  const credentials=join(root,'deploy/local/.local/admin.json');
  if(existsSync(credentials)){copyFileSync(credentials,join(destination,'admin.json'));chmodSync(join(destination,'admin.json'),0o600);}
  writeFileSync(join(destination,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),postgres:'17',objectStore:'seaweedfs:4.47',dumpSha256:await hashFile(join(destination,'postgres.dump')),objects:'objects',valkey:'Rebuildable latest-state cache; excluded. Streams require a new snapshot after restore.'},null,2),{mode:0o600});
  complete=true;
} finally {
  if(pause.length)run(['start',...pause]);
}
if(complete)console.log('Backup completed (contains credentials; keep private): '+destination);
