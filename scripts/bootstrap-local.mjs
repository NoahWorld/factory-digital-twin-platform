import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const root=new URL('../',import.meta.url),dir=new URL('deploy/local/.local/',root),file=new URL('admin.json',dir);
const env=Object.fromEntries(readFileSync(new URL('deploy/local/.env',root),'utf8').split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const base=process.env.BACKEND_URL??'http://127.0.0.1:18080';
const status=await fetch(base+'/api/v1/auth/bootstrap-status');if(!status.ok)throw new Error('Bootstrap status HTTP '+status.status);
if(!(await status.json()).setupRequired){console.log('Already initialized; existing administrator preserved.');process.exit(0);}
mkdirSync(dir,{recursive:true,mode:0o700});
const admin=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{identifier:'admin',email:'admin@local.test',displayName:'本地管理员',password:randomBytes(24).toString('base64url')};
if(!existsSync(file))writeFileSync(file,JSON.stringify(admin,null,2)+'\n',{mode:0o600,flag:'wx'});
const response=await fetch(base+'/api/v1/auth/bootstrap',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'X-Bootstrap-Token':env.BOOTSTRAP_TOKEN},body:JSON.stringify(admin)});
if(!response.ok)throw new Error('Bootstrap HTTP '+response.status+': '+await response.text());
console.log('Local admin initialized. Random password saved only in deploy/local/.local/admin.json (0600).');
