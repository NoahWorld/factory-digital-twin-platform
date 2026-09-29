// Business-only PostgreSQL/S3 migration. Credentials and sessions never enter the bundle.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { resolve, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const tables = ['projects','documents','document_items','assets','data_sources','data_bindings',
  'resources','project_covers','twin_drive_documents','publication_versions','publication_resources',
  'publication_current','project_publications','project_publication_scopes'];
const sha = value => createHash('sha256').update(value).digest('hex');
const hmac = (key,value) => createHmac('sha256',key).update(value).digest();
const check = (condition,message) => { if (!condition) throw new Error(message); };
const quote = value => `'${String(value).replaceAll("'","''")}'`;
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const jsonFile = (path,value) => writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
function envFile(path) {
  const env={};
  for (const raw of readFileSync(path,'utf8').split(/\r?\n/)) {
    const line=raw.trim(); if (!line || line.startsWith('#')) continue;
    const i=line.indexOf('='); check(i>0,'Invalid environment entry');
    let value=line.slice(i+1).trim();
    if ((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    env[line.slice(0,i).trim()]=value;
  }
  return env;
}
const encoded = value => encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export async function objectRequest(env,endpoint,key,method='GET',body,contentType,expectedBytes=0) {
  check(env.S3_ACCESS_KEY && env.S3_SECRET_KEY && env.S3_BUCKET,'Missing S3 settings');
  const base=new URL(endpoint);
  check(base.protocol==='http:' && ['127.0.0.1','localhost'].includes(base.hostname),'Object transfers must use loopback or the SSH tunnel');
  const uri=`/${encoded(env.S3_BUCKET)}/${key.split('/').map(encoded).join('/')}`;
  const url=new URL(uri,base); const region=env.S3_REGION || 'us-east-1';
  const dateTime=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''); const date=dateTime.slice(0,8);
  const payloadHash=sha(body || Buffer.alloc(0));
  const headers={host:url.host,'x-amz-date':dateTime,'x-amz-content-sha256':payloadHash};
  if (contentType) headers['content-type']=contentType;
  if (method==='PUT') headers['if-none-match']='*';
  const names=Object.keys(headers).sort();
  const canonical=[method,uri,'',names.map(k=>`${k}:${headers[k]}\n`).join(''),names.join(';'),payloadHash].join('\n');
  const scope=`${date}/${region}/s3/aws4_request`;
  const signing=hmac(hmac(hmac(hmac('AWS4'+env.S3_SECRET_KEY,date),region),'s3'),'aws4_request');
  headers.authorization=`AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',dateTime,scope,sha(canonical)].join('\n')).digest('hex')}`;
  delete headers.host;
  // Large model uploads over the SSH tunnel need a size-based deadline. No automatic retries:
  // a failed transfer remains an explicit failure and a resumed run re-verifies destination bytes.
  const timeoutMs=Math.max(180000,60000+Math.ceil(Math.max(body?.length || 0,expectedBytes)/65536)*1000);
  try {
    // Each transfer owns its socket. Synchronous SSH hashing between transfers must not leave
    // a reusable idle socket, and large uploads must not inherit fetch's shorter header timeout.
    return await new Promise((resolveRequest,reject)=>{
      const req=httpRequest(url,{method,headers,agent:false},response=>{
        const chunks=[];let size=0;
        const limit=method==='GET'?Math.max(expectedBytes,1024*1024):1024*1024;
        response.on('data',chunk=>{
          size+=chunk.length;
          if (size>limit) req.destroy(Object.assign(new Error('S3 response exceeds expected size'),{code:'ERR_RESPONSE_TOO_LARGE'}));
          else chunks.push(chunk);
        });
        response.on('error',reject);
        response.on('end',()=>{
          const bytes=Buffer.concat(chunks);
          resolveRequest({status:response.statusCode,arrayBuffer:async()=>bytes});
        });
      });
      const timer=setTimeout(()=>req.destroy(Object.assign(new Error('S3 transfer deadline exceeded'),{code:'ERR_TRANSFER_TIMEOUT'})),timeoutMs);
      req.on('close',()=>clearTimeout(timer));
      req.on('error',reject);
      req.end(body);
    });
  }
  catch(error) {
    const code=error.code || error.cause?.code;
    const causeCode=/^[A-Z_0-9]+$/.test(code || '') ? code : 'no_transport_code';
    throw new Error(`S3 ${method} transport failed for resource key hash ${sha(key).slice(0,12)} (${error.name}, ${causeCode})`);
  }
}
function sourceQuery(root,sql) {
  return execFileSync('docker',['compose','--env-file','deploy/local/.env','-f','deploy/local/compose.yml',
    'exec','-T','postgres','psql','-X','-U','twin','-d','factory_twin','-Atq','-v','ON_ERROR_STOP=1'],
    {cwd:root,input:sql,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}
const makeSnapshotSql=(includeMembers=false)=>`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(${includeMembers ? "'projectMembers',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb) FROM project_members x)," : ''}'version',1,'exportedAt',now(),'tables',jsonb_build_object(
${tables.map(t=>`${quote(t)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb) FROM ${t} x)`).join(',\n')}),
'migrations',(SELECT jsonb_agg(jsonb_build_object('version',version,'checksum',checksum,'success',success) ORDER BY version) FROM flyway_schema_history WHERE version IS NOT NULL),
'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,'type',udt_name) ORDER BY table_name,ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${tables.map(quote).join(',')})));
COMMIT;`;
const snapshotSql=makeSnapshotSql();
const targetSnapshotSql=makeSnapshotSql(true);
function stableTables(data) {
  const copy=structuredClone(data.tables);
  for (const row of copy.data_sources) for (const key of ['next_poll_at','lease_owner','lease_until','generation']) delete row[key];
  return JSON.stringify(copy);
}
async function finishExport(root,destination) {
  const data=JSON.parse(readFileSync(join(destination,'business.json')));
  const objects=data.tables.resources.map(resource=>{
    const file=`objects/${resource.id}`; const bytes=readFileSync(join(destination,file));
    check(bytes.length===Number(resource.byte_size) && sha(bytes)===resource.sha256,`Export bytes mismatch: ${resource.id}`);
    return {id:resource.id,key:resource.object_key,file,bytes:bytes.length,sha256:sha(bytes),contentType:resource.content_type};
  });
  const after=JSON.parse(sourceQuery(root,snapshotSql));
  check(stableTables(data)===stableTables(after),'Source business data changed during export; repeat the export');
  const manifest={version:1,exportedAt:data.exportedAt,businessSha256:sha(readFileSync(join(destination,'business.json'))),
    counts:Object.fromEntries(tables.map(t=>[t,data.tables[t].length])),objects,totalBytes:objects.reduce((sum,o)=>sum+o.bytes,0),
    excluded:['users','sessions','login_attempts','passwords','jobs','audit_events'],sourceUnchanged:true,
    ignoredTransientSchedulerFields:['next_poll_at','lease_owner','lease_until','generation']};
  jsonFile(join(destination,'manifest.json'),manifest);
  console.log(JSON.stringify({status:'exported',directory:destination,counts:manifest.counts,totalBytes:manifest.totalBytes}));
}
async function exportBundle(root,destination) {
  check(!existsSync(destination),'Destination already exists; use a new snapshot directory');
  mkdirSync(join(destination,'objects'),{recursive:true,mode:0o700}); chmodSync(destination,0o700);
  const data=JSON.parse(sourceQuery(root,snapshotSql));
  check(data.tables.projects.length>0,'Source has no projects');
  check(data.tables.resources.every(r=>r.state==='ready' && /^[a-f0-9]{64}$/.test(r.sha256)),'Every source resource must be ready and have a SHA-256; resolve incomplete resources first');
  check(data.migrations.every(m=>m.success),'Source contains failed database migrations');
  jsonFile(join(destination,'business.json'),data);
  const env=envFile(join(root,'deploy/local/.env'));
  const endpoint=env.S3_PUBLIC_ENDPOINT || 'http://127.0.0.1:18333';
  const objects=[];
  for (const resource of data.tables.resources) {
    check(/^[a-zA-Z0-9_-]+$/.test(resource.id),'Unsafe resource ID');
    const response=await objectRequest(env,endpoint,resource.object_key,'GET',undefined,undefined,Number(resource.byte_size));
    check(response.status===200,`Source S3 GET failed: resource ${resource.id}, status ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    check(bytes.length===Number(resource.byte_size) && sha(bytes)===resource.sha256,`Source bytes mismatch: ${resource.id}`);
    const file=`objects/${resource.id}`;
    writeFileSync(join(destination,file),bytes,{flag:'wx',mode:0o600});
    objects.push({id:resource.id,key:resource.object_key,file,bytes:bytes.length,sha256:sha(bytes),contentType:resource.content_type});
    console.log(`Verified source object ${objects.length}/${data.tables.resources.length} (${bytes.length} bytes)`);
  }
  // A repeatable-read DB snapshot is paired with immutable ready objects. Refuse concurrent source edits.
  await finishExport(root,destination);
}

function loadBundle(directory) {
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json')));
  const bytes=readFileSync(join(directory,'business.json'));
  check(manifest.version===1 && sha(bytes)===manifest.businessSha256,'Business snapshot checksum mismatch');
  const data=JSON.parse(bytes);
  check(tables.every(t=>Array.isArray(data.tables[t])&&data.tables[t].length===manifest.counts[t]),'Snapshot table counts mismatch');
  const tenants=[...new Set(data.tables.projects.map(p=>p.tenant_id))];
  check(tenants.length===1,'This migration requires one explicitly mapped source tenant');
  check(tables.every(t=>data.tables[t].every(row=>row.tenant_id===tenants[0])),'Unexpected cross-tenant rows');
  check(manifest.objects.length===data.tables.resources.length,'Incomplete resource manifest');
  for (const resource of data.tables.resources) {
    const object=manifest.objects.find(o=>o.id===resource.id);
    check(object && object.file===`objects/${resource.id}` && object.key===resource.object_key && object.sha256===resource.sha256 && object.bytes===Number(resource.byte_size),'Resource manifest mismatch');
  }
  return {data,manifest};
}
function targetSettings(path) {
  const config=JSON.parse(readFileSync(path));
  for (const key of ['sshHost','sshSocket','knownHosts','tenant','ownerId','s3Endpoint']) check(typeof config[key]==='string'&&config[key].length>0,`Target setting ${key} required`);
  check(/^[a-zA-Z0-9_.@-]+$/.test(config.sshHost),'Invalid SSH host');
  return config;
}
function remote(config,command,input) {
  try {
    return execFileSync('ssh',['-S',config.sshSocket,'-o',`UserKnownHostsFile=${config.knownHosts}`,config.sshHost,command],
      {input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
  } catch(error) {
    // SQL diagnostics may contain business rows; keep them in the private bundle, never terminal output.
    const diagnostic=join(config.bundleDirectory,`failure-${Date.now()}.log`);
    writeFileSync(diagnostic,error.stderr || String(error.code || 'remote command failed'),{mode:0o600});
    throw new Error(`Remote operation failed; private diagnostics: ${diagnostic}`);
  }
}
function targetQuery(config,sql) {
  const database=config.database || 'factory_twin';
  check(database==='factory_twin'||/^dtwin_import_check_[0-9]+$/.test(database),'Invalid target database');
  // Full SQL is retained in the private bundle. Terse errors preserve the explicit phase/table
  // message without echoing multi-megabyte PNG/JSON literals from a PL/pgSQL context.
  return remote(config,`/data/dtwin/bin/docker-dtwin exec -i dtwin-postgres-1 psql -p 15432 -X -U twin -d ${shellQuote(database)} -Atq -v ON_ERROR_STOP=1 -v VERBOSITY=terse`,sql);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value==='object') return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`;
  return JSON.stringify(value);
}
function tableDigest(rows) { return sha(JSON.stringify(rows.map(canonical).sort())); }
function transformedTables(data,config) {
  const result=structuredClone(data.tables);
  for (const table of tables) for (const row of result[table]) {
    row.tenant_id=config.tenant;
    if ('created_by' in row) row.created_by=config.ownerId;
    if ('updated_by' in row && row.updated_by!==null) row.updated_by=config.ownerId;
    if (table==='data_sources') Object.assign(row,{next_poll_at:'infinity',lease_owner:null,lease_until:null,generation:0});
  }
  return result;
}
function assertionBlock(body) {
  // Business JSON may itself contain dollar quotes; never use a fixed DO delimiter around it.
  const delimiter=`$dtwin_${sha(body)}$`;
  check(!body.includes(delimiter),'SQL assertion delimiter collision');
  return `DO ${delimiter} BEGIN ${body} END ${delimiter};`;
}
export function tableAssertionSql(table,rows,stage) {
  check([...tables,'project_members'].includes(table),'Unexpected assertion table');
  check(Array.isArray(rows),'Missing assertion rows');
  check(['baseline','before-commit'].includes(stage),'Unexpected assertion stage');
  // Cast both sides through the database row type before JSON comparison. This normalizes
  // timestamptz/bytea representations while preserving nested JSON arrays and duplicate rows.
  return assertionBlock(`IF EXISTS (
    WITH expected AS (SELECT to_jsonb(s) AS value FROM jsonb_populate_recordset(NULL::${table},${quote(JSON.stringify(rows))}::jsonb) s),
         actual AS (SELECT to_jsonb(t) AS value FROM ${table} t)
    SELECT 1 FROM ((SELECT value FROM actual EXCEPT ALL SELECT value FROM expected)
      UNION ALL (SELECT value FROM expected EXCEPT ALL SELECT value FROM actual)) differences
    ) THEN RAISE EXCEPTION '${stage} ${table} differs from the migration plan'; END IF;`);
}
export function validatePlanBaseline(plan) {
  check(plan.targetTables && Array.isArray(plan.targetMembers),'Plan lacks a locked baseline; run refresh-plan before applying');
  for (const table of tables) {
    check(Array.isArray(plan.targetTables[table]) && plan.targetTables[table].length===plan.targetCounts[table],`Plan ${table} baseline count mismatch`);
    check(tableDigest(plan.targetTables[table])===plan.targetDigests[table],`Plan ${table} baseline digest mismatch`);
  }
  check(tableDigest(plan.targetMembers)===plan.targetMembersDigest,'Plan project_members baseline digest mismatch');
}
export function importSql(data,manifest,config,runId,baseline) {
  validatePlanBaseline(baseline);
  const values=transformedTables(data,config);
  const projectIds=values.projects.map(p=>p.id);
  const statements=[`BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'; SET LOCAL standard_conforming_strings=on;`,
    `LOCK TABLE ${[...tables,'project_members'].join(',')} IN SHARE ROW EXCLUSIVE MODE;`,
    ...tables.map(table=>tableAssertionSql(table,baseline.targetTables[table],'baseline')),
    tableAssertionSql('project_members',baseline.targetMembers,'baseline'),
    assertionBlock(`PERFORM 1 FROM users WHERE id=${quote(config.ownerId)} AND tenant_id=${quote(config.tenant)} AND role='platform_admin' AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target administrator is unavailable'; END IF;
    IF EXISTS (SELECT 1 FROM projects WHERE id IN (${projectIds.map(quote).join(',')})) THEN RAISE EXCEPTION 'Project ID collision; migration refuses overwrite'; END IF;`)];
  for (const table of tables) {
    if (!values[table].length) continue;
    const records=`jsonb_populate_recordset(NULL::${table},${quote(JSON.stringify(values[table]))}::jsonb)`;
    if (table==='project_covers') {
      const columns=data.columns.filter(c=>c.table===table&& !['project_id','tenant_id'].includes(c.name)).map(c=>c.name);
      statements.push(`UPDATE project_covers AS t SET ${columns.map(c=>`${c}=s.${c}`).join(',')} FROM ${records} AS s WHERE t.project_id=s.project_id AND t.tenant_id=s.tenant_id;`);
    } else statements.push(`INSERT INTO ${table} SELECT * FROM ${records};`);
  }
  statements.push(`INSERT INTO project_members(tenant_id,project_id,user_id,role) SELECT ${quote(config.tenant)},id,${quote(config.ownerId)},'owner' FROM projects WHERE id IN (${projectIds.map(quote).join(',')});`);
  statements.push(`INSERT INTO audit_events(tenant_id,user_id,project_id,action,request_id,details)
    SELECT ${quote(config.tenant)},${quote(config.ownerId)},id,'migration.local_to_production.import',${quote(runId)},
    ${quote(JSON.stringify({businessSha256:manifest.businessSha256,sourceExportedAt:manifest.exportedAt,sourceTenant:data.tables.projects[0].tenant_id,identityPolicy:'existing target admin owns imported projects; no accounts or sessions imported',pollingPolicy:'paused with next_poll_at=infinity; source configurations retained'}))}::jsonb
    FROM projects WHERE id IN (${projectIds.map(quote).join(',')});`);
  // These assertions run under the same write-blocking locks as the INSERTs. Any mismatch
  // aborts this transaction, rather than first discovering a partial import after COMMIT.
  for (const table of tables) statements.push(tableAssertionSql(table,[...baseline.targetTables[table],...values[table]],'before-commit'));
  const newMembers=projectIds.map(projectId=>({tenant_id:config.tenant,project_id:projectId,user_id:config.ownerId,role:'owner'}));
  statements.push(tableAssertionSql('project_members',[...baseline.targetMembers,...newMembers],'before-commit'));
  statements.push('COMMIT;'); return statements.join('\n');
}
function preparePlan(directory,config) {
  const {data,manifest}=loadBundle(directory);
  const target=JSON.parse(targetQuery(config,targetSnapshotSql));
  check(canonical(data.columns)===canonical(target.columns),'Source/target business schema columns differ');
  check(canonical(data.migrations)===canonical(target.migrations),'Source/target Flyway versions or checksums differ');
  for (const table of tables) {
    const source=data.tables[table]; const existing=target.tables[table];
    const conflict=source.some(s=>existing.some(t=>('id' in s && s.id===t.id)||('object_key' in s&&s.object_key===t.object_key)||(!('id' in s)&&s.project_id&&s.project_id===t.project_id)));
    check(!conflict,`Target ${table} conflicts with source; refusing overwrite`);
  }
  const owner=targetQuery(config,`SELECT count(*) FROM users WHERE id=${quote(config.ownerId)} AND tenant_id=${quote(config.tenant)} AND active AND role='platform_admin';`);
  check(owner==='1','Explicit target owner must be an active platform administrator');
  const runId=`local-import-${randomUUID()}`;
  const plan={version:1,runId,createdAt:new Date().toISOString(),businessSha256:manifest.businessSha256,
    target:{sshHost:config.sshHost,tenant:config.tenant,ownerId:config.ownerId},
    sourceCounts:manifest.counts,targetCounts:Object.fromEntries(tables.map(t=>[t,target.tables[t].length])),
    targetDigests:Object.fromEntries(tables.map(t=>[t,tableDigest(target.tables[t])])),
    targetTables:target.tables,targetMembers:target.projectMembers,targetMembersDigest:tableDigest(target.projectMembers),
    pausedDataSourceIds:data.tables.data_sources.map(s=>s.id),totalBytes:manifest.totalBytes};
  const sql=importSql(data,manifest,config,runId,plan);
  plan.sqlSha256=sha(sql);
  writeFileSync(join(directory,'import.sql'),sql,{mode:0o600,flag:'wx'});
  jsonFile(join(directory,'plan.json'),plan);
  console.log(JSON.stringify({status:'planned',runId,sourceCounts:plan.sourceCounts,targetCounts:plan.targetCounts,pausedDataSources:plan.pausedDataSourceIds.length}));
}
function loadPlan(directory,config) {
  const bundle=loadBundle(directory); const plan=JSON.parse(readFileSync(join(directory,'plan.json')));
  check(plan.businessSha256===bundle.manifest.businessSha256,'Plan snapshot changed');
  check(plan.target.sshHost===config.sshHost&&plan.target.tenant===config.tenant&&plan.target.ownerId===config.ownerId,'Plan target changed');
  const sql=readFileSync(join(directory,'import.sql'),'utf8');
  check(sha(sql)===plan.sqlSha256 && sql===importSql(bundle.data,bundle.manifest,config,plan.runId,plan),'Import SQL differs from reviewed plan');
  return {...bundle,plan,sql};
}
function refreshPlan(directory,config) {
  check(!config.database || config.database==='factory_twin','Refresh the baseline only against the planned production database');
  const {data,manifest}=loadBundle(directory);
  const plan=JSON.parse(readFileSync(join(directory,'plan.json')));
  check(plan.version===1 && plan.businessSha256===manifest.businessSha256,'Plan snapshot changed');
  check(plan.target.sshHost===config.sshHost && plan.target.tenant===config.tenant && plan.target.ownerId===config.ownerId,'Plan target changed');
  const previousSql=readFileSync(join(directory,'import.sql'),'utf8');
  check(sha(previousSql)===plan.sqlSha256,'Existing import SQL checksum mismatch');
  const target=JSON.parse(targetQuery(config,targetSnapshotSql));
  check(canonical(data.columns)===canonical(target.columns),'Source/target business schema columns differ');
  check(canonical(data.migrations)===canonical(target.migrations),'Source/target Flyway versions or checksums differ');
  for (const table of tables) {
    check(target.tables[table].length===plan.targetCounts[table] && tableDigest(target.tables[table])===plan.targetDigests[table],`Target ${table} changed after planning; refresh refuses to replace the baseline`);
  }
  if (plan.targetMembersDigest) check(tableDigest(target.projectMembers)===plan.targetMembersDigest,'Target project_members changed after planning');
  if (plan.targetTables) validatePlanBaseline(plan);
  const updated={...plan,refreshedAt:new Date().toISOString(),targetTables:target.tables,
    targetMembers:target.projectMembers,targetMembersDigest:tableDigest(target.projectMembers)};
  const sql=importSql(data,manifest,config,plan.runId,updated);
  updated.sqlSha256=sha(sql);
  const stamp=`${Date.now()}-${randomUUID()}`;
  // Preserve the old reviewable artifacts. A partial rename fails closed via the SQL checksum.
  jsonFile(join(directory,`plan-before-refresh-${stamp}.json`),{plan,sql:previousSql});
  const sqlTemporary=join(directory,`import-${stamp}.sql.tmp`);
  const planTemporary=join(directory,`plan-${stamp}.json.tmp`);
  writeFileSync(sqlTemporary,sql,{mode:0o600,flag:'wx'}); jsonFile(planTemporary,updated);
  renameSync(sqlTemporary,join(directory,'import.sql')); renameSync(planTemporary,join(directory,'plan.json'));
  console.log(JSON.stringify({status:'plan-refreshed',runId:updated.runId,sqlSha256:updated.sqlSha256,targetCounts:updated.targetCounts,targetMembers:updated.targetMembers.length}));
}
export function validateObjectReceipt(receipt,manifest,plan) {
  check(receipt.runId===plan.runId && receipt.status==='verified','Object receipt does not belong to the verified plan');
  check(Array.isArray(receipt.objects) && receipt.objects.length===manifest.objects.length,'Object receipt is incomplete');
  const ids=new Set(receipt.objects.map(object=>object.id));
  check(ids.size===manifest.objects.length,'Object receipt contains duplicate IDs');
  for (const object of manifest.objects) {
    const verified=receipt.objects.find(item=>item.id===object.id);
    check(verified && verified.sha256===object.sha256 && verified.bytes===object.bytes,`Object receipt mismatch: ${object.id}`);
  }
}
const backupDirectory='/data/dtwin/audit/local-import-20260929/backup';
const insideBackupDirectory=path=>typeof path==='string' && posix.resolve(path)===path && path.startsWith(backupDirectory+'/');
export function validateBackupReceipt(backup,config,plan,now=Date.now()) {
  check(backup.version===1 && backup.status==='verified' && backup.database==='factory_twin' && backup.restoreVerified===true,'Target backup has not passed restore verification');
  check(backup.runId===plan.runId && backup.sshHost===config.sshHost && backup.sshHost===plan.target.sshHost,'Target backup belongs to a different plan or host');
  const createdAt=Date.parse(backup.createdAt);
  check(Number.isFinite(createdAt) && createdAt<=now+60000 && now-createdAt<24*60*60*1000,'Target backup timestamp is invalid or older than 24 hours');
  const files=[backup.postgresDump,backup.objectsArchive];
  check(files.every(file=>file && insideBackupDirectory(file.path) && /^[a-f0-9]{64}$/.test(file.sha256)),'Target backup files must have checksums and remain inside the approved backup directory');
  check(files[0].path!==files[1].path,'Database and object backups must be distinct files');
  return files;
}
function verifyBackupFiles(config,files) {
  // Resolve paths again on the server so a symlink cannot escape the approved backup directory.
  const verification=JSON.parse(remote(config,'python3 -',`import hashlib,json,os,stat
root=os.path.realpath(${JSON.stringify(backupDirectory)})
if root!=${JSON.stringify(backupDirectory)}: raise RuntimeError('Backup directory must not resolve outside its approved path')
files=json.loads(${JSON.stringify(JSON.stringify(files))})
results=[]
for entry in files:
 path=os.path.realpath(entry['path'])
 if not path.startswith(root+os.sep): raise RuntimeError('Backup path escapes approved directory')
 if not stat.S_ISREG(os.stat(path).st_mode): raise RuntimeError('Backup is not a regular file')
 digest=hashlib.sha256()
 with open(path,'rb') as source:
  while True:
   chunk=source.read(1024*1024)
   if not chunk: break
   digest.update(chunk)
 results.append(digest.hexdigest()==entry['sha256'])
print(json.dumps(results))
`));
  check(Array.isArray(verification) && verification.length===files.length && verification.every(value=>value===true),'Target backup file checksum mismatch');
}
export function targetObjectDigest(config,object) {
  // Read the entire destination object on the destination host. Only hashes and sizes cross SSH;
  // neither S3 credentials nor model contents are printed or returned by this verifier.
  return JSON.parse(remote(config,'python3 -',`import datetime,hashlib,hmac,json,urllib.request,urllib.error,urllib.parse
o=json.loads(${JSON.stringify(JSON.stringify({key:object.key,bytes:object.bytes}))})
env={}
for line in open('/data/dtwin/config/.env'):
 key,sep,value=line.strip().partition('=')
 if sep and key in ['S3_ACCESS_KEY','S3_SECRET_KEY','S3_BUCKET','S3_REGION']: env[key]=value
def hm(key,value): return hmac.new(key,value.encode(),hashlib.sha256).digest()
now=datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ');date=now[:8];region=env.get('S3_REGION','us-east-1')
host='127.0.0.1:18333';uri='/'+urllib.parse.quote(env['S3_BUCKET'],safe='')+'/'+urllib.parse.quote(o['key'],safe='/')
payload=hashlib.sha256(b'').hexdigest();scope=date+'/'+region+'/s3/aws4_request'
headers={'host':host,'x-amz-content-sha256':payload,'x-amz-date':now};names=sorted(headers)
canonical='\\n'.join(['GET',uri,'',''.join(k+':'+headers[k]+'\\n' for k in names),';'.join(names),payload])
signing=hm(hm(hm(hm(('AWS4'+env['S3_SECRET_KEY']).encode(),date),region),'s3'),'aws4_request')
signature=hmac.new(signing,'\\n'.join(['AWS4-HMAC-SHA256',now,scope,hashlib.sha256(canonical.encode()).hexdigest()]).encode(),hashlib.sha256).hexdigest()
headers['Authorization']='AWS4-HMAC-SHA256 Credential='+env['S3_ACCESS_KEY']+'/'+scope+', SignedHeaders='+';'.join(names)+', Signature='+signature
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None
opener=urllib.request.build_opener(NoRedirect,urllib.request.ProxyHandler({}))
try:
 response=opener.open(urllib.request.Request('http://'+host+uri,headers=headers),timeout=120)
except urllib.error.HTTPError as error:
 if error.code!=404: raise RuntimeError('Destination S3 returned HTTP '+str(error.code)) from None
 print(json.dumps({'status':404}));raise SystemExit(0)
with response:
 if response.status!=200: raise RuntimeError('Unexpected destination S3 status')
 digest=hashlib.sha256();size=0
 while True:
  chunk=response.read(1024*1024)
  if not chunk: break
  size+=len(chunk)
  if size>o['bytes']: raise RuntimeError('Destination object exceeds expected size')
  digest.update(chunk)
print(json.dumps({'status':200,'bytes':size,'sha256':digest.hexdigest()}))
`));
}
async function transferObjects(directory,config,{verifyOnly=false}={}) {
  const {manifest,plan}=loadPlan(directory,config);
  const env=JSON.parse(remote(config,"python3 -c 'import json; p={};\nfor l in open(\"/data/dtwin/config/.env\"):\n k,s,v=l.strip().partition(\"=\");\n if s and k in [\"S3_ACCESS_KEY\",\"S3_SECRET_KEY\",\"S3_BUCKET\",\"S3_REGION\"]: p[k]=v\nprint(json.dumps(p))'"));
  const receipt={runId:plan.runId,startedAt:new Date().toISOString(),objects:[]};
  for (const object of manifest.objects) {
    const startedAt=Date.now();
    console.log(`Checking target object ${receipt.objects.length+1}/${manifest.objects.length} (${object.bytes} bytes)`);
    const body=readFileSync(join(directory,object.file));
    check(body.length===object.bytes&&sha(body)===object.sha256,`Bundle object checksum mismatch: ${object.id}`);
    let response=targetObjectDigest(config,object);
    let uploaded=false;
    if (response.status===404&&!verifyOnly) {
      console.log(`Uploading target object ${receipt.objects.length+1}/${manifest.objects.length} (${object.bytes} bytes)`);
      const put=await objectRequest(env,config.s3Endpoint,object.key,'PUT',body,object.contentType);
      check(put.status===200,`Target S3 PUT failed: ${object.id}, HTTP ${put.status}`);
      await put.arrayBuffer();
      uploaded=true; response=targetObjectDigest(config,object);
    }
    check(response.status===200,`Target S3 GET failed: ${object.id}, HTTP ${response.status}`);
    check(response.bytes===object.bytes&&response.sha256===object.sha256,`Target object collision or corruption: ${object.id}`);
    receipt.objects.push({id:object.id,sha256:object.sha256,bytes:object.bytes,uploaded});
    console.log(`Verified target object ${receipt.objects.length}/${manifest.objects.length} (${Math.round((Date.now()-startedAt)/1000)} seconds, ${uploaded?'uploaded':'already present'})`);
  }
  receipt.completedAt=new Date().toISOString(); receipt.status='verified';
  validateObjectReceipt(receipt,manifest,plan);
  jsonFile(join(directory,`${verifyOnly?'object-verification':'object-transfer'}-${Date.now()}.json`),receipt);
  return receipt;
}
async function applyPlan(directory,config) {
  const {manifest,plan,sql}=loadPlan(directory,config);
  const dryRun=config.database && config.database!=='factory_twin';
  check(dryRun || config.backupReceipt,'A verified target backup receipt is required before production writes');
  if (!dryRun) {
    check(insideBackupDirectory(config.backupReceipt),'Backup receipt must remain inside the approved backup directory');
    const backup=JSON.parse(remote(config,`cat ${shellQuote(config.backupReceipt)}`));
    const files=validateBackupReceipt(backup,config,plan);
    verifyBackupFiles(config,files);
    const receipts=readdirSync(directory).filter(name=>/^object-(transfer|verification)-[0-9]+\.json$/.test(name))
      .map(name=>JSON.parse(readFileSync(join(directory,name)))).filter(receipt=>receipt.runId===plan.runId);
    check(receipts.length>0,'Production apply requires a complete object verification receipt for this plan');
    for (const receipt of receipts) validateObjectReceipt(receipt,manifest,plan);
    // A recorded upload is insufficient: re-read every destination object immediately before DB writes.
    validateObjectReceipt(await transferObjects(directory,config,{verifyOnly:true}),manifest,plan);
  }
  const before=JSON.parse(targetQuery(config,targetSnapshotSql));
  for (const table of tables) check(tableDigest(before.tables[table])===plan.targetDigests[table],`Target ${table} changed after planning; replan before import`);
  check(tableDigest(before.projectMembers)===plan.targetMembersDigest,'Target project_members changed after planning');
  targetQuery(config,sql);
  jsonFile(join(directory,`${dryRun?'dry-run':'applied'}-committed-${Date.now()}.json`),{runId:plan.runId,status:'committed-pending-post-verification',at:new Date().toISOString(),database:config.database||'factory_twin',sqlSha256:plan.sqlSha256});
  const result=verifyDatabase(directory,config);
  jsonFile(join(directory,`${dryRun?'dry-run':'applied'}-${Date.now()}.json`),{runId:plan.runId,status:'verified',at:new Date().toISOString(),database:config.database||'factory_twin',...result});
  console.log(JSON.stringify({status:dryRun?'dry-run-verified':'imported',...result}));
}
function verifyDatabase(directory,config) {
  const {data,plan}=loadPlan(directory,config); const expected=transformedTables(data,config);
  const after=JSON.parse(targetQuery(config,targetSnapshotSql));
  const projectIds=new Set(expected.projects.map(p=>p.id));
  const versionIds=new Set(expected.publication_versions.map(p=>p.id));
  for (const table of tables) {
    const selected=after.tables[table].filter(row=>table==='projects'?projectIds.has(row.id):table==='publication_resources'?versionIds.has(row.version_id):projectIds.has(row.project_id));
    check(tableDigest(selected)===tableDigest(expected[table]),`Imported ${table} does not match snapshot`);
    const untouched=after.tables[table].filter(row=>!selected.includes(row));
    check(tableDigest(untouched)===plan.targetDigests[table],`Existing target ${table} changed`);
  }
  const members=after.projectMembers.filter(m=>projectIds.has(m.project_id));
  check(tableDigest(after.projectMembers.filter(m=>!projectIds.has(m.project_id)))===plan.targetMembersDigest,'Existing target project_members changed');
  check(members.length===projectIds.size && members.every(m=>m.tenant_id===config.tenant&&m.user_id===config.ownerId&&m.role==='owner'),'Imported project ownership mismatch');
  return {projects:projectIds.size,resources:expected.resources.length,counts:Object.fromEntries(tables.map(t=>[t,expected[t].length])),existingBusinessPreserved:true};
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const [mode,...args]=process.argv.slice(2);
  if (mode==='export'||mode==='finish-export') {
    check(args.length===2,'Usage: migrate-local-to-server.mjs export <source-repo> <private-bundle-directory>');
    await (mode==='export'?exportBundle:finishExport)(resolve(args[0]),resolve(args[1]));
  } else if (['plan','refresh-plan','objects','verify-objects','apply','verify'].includes(mode)) {
    check(args.length===2,'Usage: migrate-local-to-server.mjs <mode> <bundle-directory> <private-target-config>');
    const directory=resolve(args[0]); const config={...targetSettings(resolve(args[1])),bundleDirectory:directory};
    if (mode==='plan') preparePlan(directory,config);
    if (mode==='refresh-plan') refreshPlan(directory,config);
    if (mode==='objects'||mode==='verify-objects') await transferObjects(directory,config,{verifyOnly:mode==='verify-objects'});
    if (mode==='apply') await applyPlan(directory,config);
    if (mode==='verify') console.log(JSON.stringify(verifyDatabase(directory,config)));
  } else throw new Error('Supported modes: export, finish-export, plan, refresh-plan, objects, verify-objects, apply, verify');
}
