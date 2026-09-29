// Node 22+. Read-only acceptance of an already imported business snapshot.
// Required: DTWIN_ORIGIN, DTWIN_ADMIN_FILE (0600), DTWIN_IMPORT_BUNDLE.
// Optional: DTWIN_CONNECT_ORIGIN (loopback only), DTWIN_LOCAL_ADDRESS,
// DTWIN_IMPORT_AUDIT_DIR (default deploy/server/.local).
// Only login/logout use POST. No project/resource writes, probes, collection or runtime commands.
// Checks every imported row exposed by the read APIs and every cover; downloads two small
// representative objects. The migration's separate full SQL/S3 verification remains required.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

process.umask(0o077);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const networkCode = error => /^[A-Z_0-9]+$/.test(error?.code ?? '') ? error.code : 'NETWORK_ERROR';
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const equal = (actual, expected, label) => check(canonical(actual) === canonical(expected), `${label}: content differs from source snapshot.`);
function json(bytes, label) {
  try { return JSON.parse(bytes.toString()); } catch { throw new Error(`${label}: invalid JSON.`); }
}
function originUrl(value, label) {
  check(typeof value === 'string' && value.length, `${label} is required.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}: invalid origin.`); }
  check(['http:', 'https:'].includes(url.protocol) && url.origin === value,
    `${label}: require exact HTTP(S) origin without credentials, path, query or trailing slash.`);
  return url;
}
function exactIds(actual, expected, label) {
  check(Array.isArray(actual) && actual.every(row => safeId(row?.id)), `${label}: invalid collection.`);
  const ids = actual.map(row => row.id);
  check(new Set(ids).size === ids.length, `${label}: duplicate IDs.`);
  equal(ids.sort(), expected.map(row => row.id).sort(), `${label} IDs`);
}
function bodyFields(actual, expected, label) {
  check(actual !== null && typeof actual === 'object' && !Array.isArray(actual), `${label}: expected an object.`);
  for (const [key, value] of Object.entries(expected)) equal(actual[key], value, `${label} field ${key}`);
}
function loadSnapshot(directory) {
  const manifest = json(readFileSync(join(directory, 'manifest.json')), 'Manifest');
  const bytes = readFileSync(join(directory, 'business.json'));
  check(manifest.version === 1 && manifest.businessSha256 === sha(bytes), 'Business snapshot checksum mismatch.');
  const data = json(bytes, 'Business snapshot');
  const required = ['projects', 'documents', 'document_items', 'assets', 'data_sources', 'data_bindings', 'resources', 'project_covers', 'twin_drive_documents'];
  for (const table of required) {
    check(Array.isArray(data.tables?.[table]) && data.tables[table].length === manifest.counts?.[table], `${table}: snapshot count mismatch.`);
  }
  const t = data.tables;
  check(t.projects.length > 0 && t.projects.every(p => safeId(p.id) && ['2d', '3d'].includes(p.project_type)), 'Invalid snapshot project identity/type.');
  check(new Set(t.projects.map(p => p.id)).size === t.projects.length, 'Duplicate snapshot projects.');
  check(t.documents.length === t.projects.length && t.project_covers.length === t.projects.length, 'Every snapshot project requires a document and cover.');
  for (const p of t.projects) {
    check(t.documents.filter(d => d.project_id === p.id).length === 1 && t.project_covers.filter(c => c.project_id === p.id).length === 1,
      `Project ${p.id}: missing or duplicate snapshot document/cover.`);
  }
  for (const table of required.filter(table => table !== 'projects')) {
    check(t[table].every(row => t.projects.some(p => p.id === row.project_id)), `${table}: snapshot has an unknown project reference.`);
  }
  for (const table of ['document_items', 'assets', 'data_sources', 'data_bindings', 'resources']) {
    // Document items are keyed by (project_id, id); templates may reuse node IDs across projects.
    const keys = t[table].map(row => table === 'document_items' ? JSON.stringify([row.project_id, row.id]) : row.id);
    check(t[table].every(row => safeId(row.id)) && new Set(keys).size === t[table].length,
      `${table}: invalid or duplicate snapshot IDs.`);
  }
  check(t.data_bindings.every(b => t.assets.some(a => a.id === b.asset_id && a.project_id === b.project_id)
    && t.data_sources.some(s => s.id === b.source_id && s.project_id === b.project_id)), 'Snapshot binding reference mismatch.');
  check(Array.isArray(manifest.objects) && manifest.objects.length === t.resources.length, 'Resource manifest count mismatch.');
  exactIds(manifest.objects, t.resources, 'Manifest objects');
  for (const r of t.resources) {
    const object = manifest.objects.find(o => o.id === r.id);
    check(safeId(r.id) && ['model', 'image', 'media'].includes(r.kind) && r.state === 'ready'
      && /^[a-f0-9]{64}$/.test(r.sha256) && Number.isSafeInteger(Number(r.byte_size)) && Number(r.byte_size) > 0,
    'Invalid snapshot resource metadata.');
    check(object.sha256 === r.sha256 && object.bytes === Number(r.byte_size)
      && object.key === r.object_key && object.contentType === r.content_type, `Resource ${r.id}: manifest mismatch.`);
  }
  const samples = ['model', 'image'].map(kind => t.resources.filter(r => r.kind === kind)
    .sort((a, b) => Number(a.byte_size) - Number(b.byte_size) || a.id.localeCompare(b.id))[0]);
  check(samples.every(Boolean), 'Snapshot requires a model and an image for the two representative download checks.');
  check(samples.every(r => Number(r.byte_size) <= 32 * 1024 * 1024), 'Representative download exceeds the 32 MiB safety bound.');
  return { manifest, tables: t, samples };
}

async function main() {
  const origin = originUrl(process.env.DTWIN_ORIGIN, 'DTWIN_ORIGIN');
  const connection = process.env.DTWIN_CONNECT_ORIGIN ? originUrl(process.env.DTWIN_CONNECT_ORIGIN, 'DTWIN_CONNECT_ORIGIN') : origin;
  if (process.env.DTWIN_CONNECT_ORIGIN) check(['127.0.0.1', '[::1]', 'localhost'].includes(connection.hostname)
    && connection.protocol === origin.protocol, 'Connection override must use loopback and preserve the public protocol.');
  const localAddress = process.env.DTWIN_LOCAL_ADDRESS;
  if (localAddress !== undefined) check(Object.values(networkInterfaces()).flat().some(item => item?.address === localAddress),
    'DTWIN_LOCAL_ADDRESS is not assigned to a local network interface.');
  check(process.env.DTWIN_IMPORT_BUNDLE, 'DTWIN_IMPORT_BUNDLE is required.');
  const { manifest, tables: t, samples } = loadSnapshot(resolve(process.env.DTWIN_IMPORT_BUNDLE));
  check(process.env.DTWIN_ADMIN_FILE, 'DTWIN_ADMIN_FILE is required.');
  const adminFile = resolve(process.env.DTWIN_ADMIN_FILE);
  const stat = lstatSync(adminFile);
  check(stat.isFile() && (stat.mode & 0o777) === 0o600, 'Administrator file must be a regular file with mode 0600.');
  const admin = json(readFileSync(adminFile), 'Administrator file');
  const identifier = admin.identifier ?? admin.loginName ?? admin.email;
  check(typeof identifier === 'string' && identifier.length && typeof admin.password === 'string' && admin.password.length,
    'Administrator file requires identifier (or loginName/email) and password.');
  const output = process.env.DTWIN_IMPORT_AUDIT_DIR ? resolve(process.env.DTWIN_IMPORT_AUDIT_DIR) : fileURLToPath(new URL('./.local', import.meta.url));
  mkdirSync(output, { recursive: true, mode: 0o700 });
  check(lstatSync(output).isDirectory(), 'Audit output must be a regular directory.');
  const auditFile = join(output, `import-verify-${randomUUID()}.json`);
  const audit = { status: 'running', startedAt: new Date().toISOString(), origin: origin.origin,
    connectionOrigin: connection.origin, localAddress, businessSha256: manifest.businessSha256,
    expectedCounts: manifest.counts, scope: 'authenticated GET business checks; only auth login/logout POST; two representative signed downloads',
    projects: [], downloads: [], checks: [], errors: [], sessionRevoked: false };
  writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const persist = () => writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  const passed = name => { audit.checks.push({ name, at: new Date().toISOString() }); persist(); console.log(`PASS ${name}`); };
  let cookie = '';
  let failure;
  function target(input) {
    let url;
    try { url = new URL(input, origin); } catch { throw new Error('Invalid response URL.'); }
    check(url.origin === origin.origin && !url.username && !url.password && !url.hash,
      'Response URL is outside the configured origin or contains forbidden URL credentials/fragment.');
    return url;
  }
  function request(input, { method = 'GET', headers = {}, body, label = 'HTTP request', maxBytes = 32 * 1024 * 1024 } = {}) {
    const url = target(input);
    check(method === 'GET' || (method === 'POST' && ['/api/v1/auth/login', '/api/v1/auth/logout'].includes(url.pathname) && !url.search),
      'Read-only verifier refused a non-authentication write.');
    return new Promise((resolveRequest, reject) => {
      const transport = connection.protocol === 'https:' ? httpsRequest : httpRequest;
      const requestHeaders = { ...headers, Host: url.host };
      if (body !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(body);
      const req = transport({ hostname: connection.hostname.replace(/^\[|\]$/g, ''),
        port: connection.port || (connection.protocol === 'https:' ? 443 : 80), servername: origin.hostname,
        path: url.pathname + url.search, method, headers: requestHeaders, agent: false, localAddress }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(); reject(new Error(`${label}: response exceeds size bound.`)); }
          else chunks.push(chunk);
        });
        response.on('error', error => reject(new Error(`${label}: response ${networkCode(error)}.`)));
        response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      });
      const deadline = setTimeout(() => req.destroy(new Error('request deadline')), 30000);
      req.once('close', () => clearTimeout(deadline));
      req.on('error', error => reject(new Error(`${label}: ${networkCode(error)} (30-second deadline).`)));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
  async function api(path, { method = 'GET', body, status = 200, jsonResponse = true } = {}) {
    const label = `${method} ${path.split('?')[0]}`;
    const result = await request(`/api/v1${path}`, { method, label,
      headers: { Origin: origin.origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
    // Capture an issued session before parsing/validating so a malformed login response is still logged out.
    if (method === 'POST' && path === '/auth/login') {
      const issued = result.headers['set-cookie']?.find(value => value.startsWith('factory_twin_session='));
      if (issued) cookie = issued.split(';')[0];
    }
    const value = result.bytes.length && String(result.headers['content-type']).includes('application/json') ? json(result.bytes, label) : null;
    const code = /^[a-z_0-9]{1,128}$/.test(value?.error ?? '') ? ` error=${value.error}` : '';
    const trace = /^[A-Za-z0-9_-]{1,128}$/.test(result.headers['x-request-id'] ?? '') ? ` requestId=${result.headers['x-request-id']}` : '';
    check(result.status === status, `${label}: expected ${status}, received ${result.status}.${code}${trace}`);
    check(typeof result.headers['x-request-id'] === 'string', `${label}: missing X-Request-Id.`);
    if (jsonResponse && status === 200) check(value !== null, `${label}: expected JSON.`);
    return { ...result, value };
  }
  async function collection(path, field, limit = 10000) {
    const rows = []; let offset = 0;
    for (let page = 0; page < 100; page++) {
      const value = (await api(`${path}?limit=${limit}&offset=${offset}`)).value;
      check(Array.isArray(value?.[field]), `${path}: missing collection.`);
      rows.push(...value[field]);
      if (value.nextOffset === null) return rows;
      check(Number.isSafeInteger(value.nextOffset) && value.nextOffset > offset, `${path}: invalid pagination.`);
      offset = value.nextOffset;
    }
    throw new Error(`${path}: pagination safety bound exceeded.`);
  }
  const byProject = (table, id) => t[table].filter(row => row.project_id === id);
  try {
    const login = await api('/auth/login', { method: 'POST', body: { identifier, password: admin.password,
      ...(admin.tenant === undefined ? {} : { tenant: admin.tenant }) } });
    const session = login.headers['set-cookie']?.find(value => value.startsWith('factory_twin_session='));
    check(typeof session === 'string', 'Login did not return a session cookie.');
    cookie = session.split(';')[0];
    check(/;\s*HttpOnly/i.test(session) && /;\s*SameSite=Lax/i.test(session)
      && (/;\s*Secure(?:;|$)/i.test(session)) === (origin.protocol === 'https:'), 'Session cookie attributes do not match deployment.');
    check(Array.isArray(login.value?.user?.roles) && login.value.user.roles.includes('platform_admin'), 'Import acceptance requires an existing platform administrator.');
    passed('administrator session established');
    const listed = await collection('/projects', 'projects', 1000);
    check(new Set(listed.map(p => p.id)).size === listed.length, 'Project list returned duplicate IDs.');
    for (const p of t.projects) check(listed.some(actual => actual.id === p.id), `Project ${p.id}: absent from authenticated list.`);
    passed(`all ${t.projects.length} imported projects visible`);
    for (const p of t.projects) {
      const prefix = `/projects/${p.id}`;
      const project = (await api(prefix)).value.project;
      bodyFields(project, { id: p.id, name: p.name, status: p.status, projectType: p.project_type, projectRole: 'owner' }, `Project ${p.id}`);
      const stored = byProject('documents', p.id)[0];
      check(stored.kind === (p.project_type === '2d' ? 'canvas' : 'scene'), `Project ${p.id}: snapshot document kind mismatch.`);
      const doc = (await api(`${prefix}/${stored.kind}`)).value[stored.kind];
      bodyFields(doc, { projectId: p.id, revision: stored.revision }, `Document ${p.id}`);
      const sourceItems = byProject('document_items', p.id).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map(row => row.body);
      equal(doc[stored.kind === 'canvas' ? 'nodes' : 'instances'], sourceItems, `Document ${p.id} items`);
      if (stored.kind === 'canvas') equal(doc.theme, stored.settings, `Document ${p.id} theme`);
      else {
        const settings = structuredClone(stored.settings);
        for (const field of ['fluids', 'decorations', 'roomAlarms', 'staticMap']) {
          equal(doc[field], Object.hasOwn(settings, field) ? settings[field] : field === 'staticMap' ? null : [], `Scene ${p.id} ${field}`);
          delete settings[field];
        }
        if (!Object.hasOwn(settings, 'preventBottomView')) settings.preventBottomView = true;
        equal(doc.settings, settings, `Scene ${p.id} settings`);
        equal(doc.linked2dProjectId, stored.linked_project_id, `Scene ${p.id} linked project`);
      }
      const assets = await collection(`${prefix}/assets`, 'assets');
      const expectedAssets = byProject('assets', p.id); exactIds(assets, expectedAssets, `Project ${p.id} assets`);
      for (const a of expectedAssets) {
        bodyFields(assets.find(actual => actual.id === a.id), { ...a.body, id: a.id, projectId: p.id }, `Asset ${a.id}`);
        const bindings = (await api(`${prefix}/assets/${a.id}/data-bindings`)).value.dataBindings;
        const expected = byProject('data_bindings', p.id).filter(b => b.asset_id === a.id);
        exactIds(bindings, expected, `Asset ${a.id} bindings`);
        for (const b of expected) bodyFields(bindings.find(actual => actual.id === b.id), { ...b.body, id: b.id, assetRecordId: a.id }, `Binding ${b.id}`);
      }
      const sources = await collection(`${prefix}/data-sources`, 'dataSources');
      const expectedSources = byProject('data_sources', p.id); exactIds(sources, expectedSources, `Project ${p.id} data sources`);
      for (const s of expectedSources) bodyFields(sources.find(actual => actual.id === s.id), { ...s.body, id: s.id, projectId: p.id }, `Source ${s.id}`);
      const resources = byProject('resources', p.id);
      for (const kind of ['model', 'image', 'media']) {
        const entries = (await api(`${prefix}/${kind}-assets`)).value[`${kind}Assets`];
        check(Array.isArray(entries), `Project ${p.id}: invalid ${kind} resource list.`);
        const uploads = entries.filter(r => r.source === 'upload');
        const expected = resources.filter(r => r.kind === kind); exactIds(uploads, expected, `Project ${p.id} ${kind} uploads`);
        for (const r of expected) bodyFields(uploads.find(actual => actual.id === r.id), {
          projectId: p.id, originalFilename: r.filename, byteSize: Number(r.byte_size), contentType: r.content_type,
          sha256: r.sha256, source: 'upload', state: 'ready', error: r.error,
          ...(kind !== 'model' ? {} : { inspection: r.inspection, compression: r.compression, sourceModelAssetId: r.source_model_id }),
        }, `Resource ${r.id}`);
      }
      const twin = byProject('twin_drive_documents', p.id);
      if (p.project_type === '3d') {
        const actual = (await api(`${prefix}/twin-drive`)).value;
        check(actual.projectId === p.id, `Project ${p.id}: TwinDrive identity mismatch.`);
        if (twin.length) bodyFields(actual, { revision: twin[0].revision, config: twin[0].config }, `TwinDrive ${p.id}`);
        else check(actual.revision === 0 && actual.config?.enabled === false, `Project ${p.id}: unexpected TwinDrive configuration.`);
      } else check(twin.length === 0, `Project ${p.id}: unexpected 2D TwinDrive snapshot.`);
      const cover = byProject('project_covers', p.id)[0];
      check(cover.status === 'ready' && typeof cover.png === 'string' && /^\\x(?:[a-fA-F0-9]{2})+$/.test(cover.png), `Cover ${p.id}: expected PNG in snapshot.`);
      const png = Buffer.from(cover.png.slice(2), 'hex');
      const actualCover = await api(`${prefix}/cover.png`, { jsonResponse: false });
      check(String(actualCover.headers['content-type']).startsWith('image/png')
        && actualCover.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && actualCover.bytes.length === png.length && sha(actualCover.bytes) === sha(png), `Cover ${p.id}: PNG bytes/hash mismatch.`);
      audit.projects.push({ id: p.id, type: p.project_type, documentRevision: doc.revision, items: sourceItems.length,
        assets: expectedAssets.length, sources: expectedSources.length, bindings: byProject('data_bindings', p.id).length,
        resources: resources.length, twinDrive: twin.length, coverBytes: png.length, coverSha256: sha(png) });
      passed(`project ${audit.projects.length}/${t.projects.length}: document, configuration, resources and PNG cover match`);
    }
    for (const r of samples) {
      const redirect = await api(`/projects/${r.project_id}/${r.kind}-assets/${r.id}/content`, { status: 302, jsonResponse: false });
      check(typeof redirect.headers.location === 'string', `Resource ${r.id}: signed redirect missing.`);
      const result = await request(redirect.headers.location, { headers: { Origin: origin.origin }, label: `Representative ${r.kind} download`, maxBytes: Number(r.byte_size) + 1 });
      check(result.status === 200 && result.bytes.length === Number(r.byte_size) && sha(result.bytes) === r.sha256,
        `Resource ${r.id}: representative signed download bytes/hash mismatch.`);
      audit.downloads.push({ id: r.id, kind: r.kind, byteSize: result.bytes.length, sha256: r.sha256 });
      passed(`representative ${r.kind} signed download and SHA-256 match`);
    }
    for (const [table, field] of [['document_items', 'items'], ['assets', 'assets'], ['data_sources', 'sources'], ['data_bindings', 'bindings'], ['resources', 'resources'], ['twin_drive_documents', 'twinDrive']]) {
      check(audit.projects.reduce((sum, p) => sum + p[field], 0) === t[table].length, `${table}: verified total mismatch.`);
    }
    passed('all imported API collections match snapshot totals');
  } catch (error) {
    // All network/parser/comparison errors above are constructed without response bodies or signed URLs.
    audit.errors.push({ phase: 'verification', message: error instanceof Error ? error.message : 'Non-Error verification failure.' }); failure = error;
  } finally {
    if (cookie) {
      try {
        await api('/auth/logout', { method: 'POST', status: 204 });
        check((await api('/auth/me', { status: 401 })).value?.error === 'unauthenticated', 'Logged-out session was not rejected.');
        audit.sessionRevoked = true;
      } catch (error) { audit.errors.push({ phase: 'logout', message: error.message }); failure ??= error; }
      cookie = '';
    }
    audit.status = failure ? 'failed' : 'passed'; audit.finishedAt = new Date().toISOString(); persist();
    console.log(`AUDIT ${auditFile}`);
  }
  check(!failure, 'Import verification failed; inspect the private audit for the failing phase and sanitized context.');
  console.log(`PASS imported business: ${audit.projects.length} projects, ${t.resources.length} resource records, ${audit.projects.length} PNG covers, ${audit.downloads.length} representative downloads; session revoked.`);
}
main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
