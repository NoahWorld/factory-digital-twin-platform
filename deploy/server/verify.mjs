// Deployment acceptance, separate from the existing local-only integration tests.
// Node 22+: DTWIN_ORIGIN=http://YOUR_SERVER:19080 DTWIN_ADMIN_FILE=/private/admin.json node verify.mjs
// Optional DTWIN_CONNECT_ORIGIN=http://127.0.0.1:19080 connects locally while preserving public Host/Origin.
// Optional DTWIN_LOCAL_ADDRESS binds requests to an IP assigned to this computer (for direct-network acceptance).
// Creates two temporary projects, records every fixture locally, then deletes only those projects.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { networkInterfaces } from 'node:os';

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
function exactOrigin(value, label) {
  requireCondition(typeof value === 'string' && value.length > 0, `${label} is required.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTP(S) origin.`); }
  requireCondition(['http:', 'https:'].includes(url.protocol) && url.origin === value,
    `${label} must contain only scheme, hostname and optional port, with no trailing slash or credentials.`);
  return url;
}
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString()); } catch { throw new Error(`${label}: invalid JSON response/file.`); }
}
const idIsSafe = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const networkCode = error => /^[A-Z_0-9]+$/.test(error?.code ?? '') ? error.code : 'NETWORK_ERROR';

async function main() {
  const origin = exactOrigin(process.env.DTWIN_ORIGIN, 'DTWIN_ORIGIN');
  const connection = process.env.DTWIN_CONNECT_ORIGIN
    ? exactOrigin(process.env.DTWIN_CONNECT_ORIGIN, 'DTWIN_CONNECT_ORIGIN') : origin;
  const localAddress = process.env.DTWIN_LOCAL_ADDRESS;
  if (localAddress !== undefined) {
    requireCondition(Object.values(networkInterfaces()).flat().some(address => address?.address === localAddress),
      'DTWIN_LOCAL_ADDRESS must be an IP assigned to a local network interface.');
  }
  if (process.env.DTWIN_CONNECT_ORIGIN) {
    requireCondition(['127.0.0.1', '[::1]', 'localhost'].includes(connection.hostname),
      'DTWIN_CONNECT_ORIGIN may only override the connection to loopback.');
    requireCondition(connection.protocol === origin.protocol, 'Connection override must preserve the public protocol.');
  }
  requireCondition(process.env.DTWIN_ADMIN_FILE, 'DTWIN_ADMIN_FILE is required.');
  const adminFile = resolve(process.env.DTWIN_ADMIN_FILE);
  const adminStat = lstatSync(adminFile);
  requireCondition(adminStat.isFile() && (adminStat.mode & 0o777) === 0o600,
    'DTWIN_ADMIN_FILE must be a regular file with permissions 0600.');
  const admin = parseJson(readFileSync(adminFile), 'Administrator file');
  const identifier = admin.identifier ?? admin.loginName ?? admin.email;
  requireCondition(typeof identifier === 'string' && identifier.length > 0 && typeof admin.password === 'string',
    'Administrator file requires identifier (or loginName/email) and password.');
  const runId = `dtwin-verify-${randomUUID()}`;
  const auditFile = join(dirname(adminFile), `${runId}.json`);
  const audit = { runId, origin: origin.origin, connectionOrigin: connection.origin, localAddress,
    startedAt: new Date().toISOString(), status: 'running', projects: [], checks: [], resources: [], errors: [] };
  writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const persist = () => writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  const passed = name => { audit.checks.push({ name, at: new Date().toISOString() }); persist(); console.log(`PASS ${name}`); };
  let cookie = '';
  let failure;

  // Neither URLs with query strings nor response bodies are included in error messages.
  function target(input) {
    let url;
    try { url = new URL(input, origin); } catch { throw new Error('Server returned an invalid URL.'); }
    requireCondition(url.origin === origin.origin && !url.username && !url.password && !url.hash,
      'Response URL is outside the configured public origin; check S3_PUBLIC_ENDPOINT.');
    return url;
  }
  function request(input, { method = 'GET', headers = {}, body, label = 'HTTP request', maxBytes = 32 * 1024 * 1024 } = {}) {
    const url = target(input);
    return new Promise((resolveRequest, reject) => {
      const transport = connection.protocol === 'https:' ? httpsRequest : httpRequest;
      const requestHeaders = { ...headers, Host: url.host };
      if (body !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(body);
      const req = transport({ hostname: connection.hostname.replace(/^\[|\]$/g, ''),
        port: connection.port || (connection.protocol === 'https:' ? 443 : 80),
        servername: origin.hostname, path: url.pathname + url.search, method, headers: requestHeaders,
        agent: false, localAddress }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(); reject(new Error(`${label}: response exceeds configured size bound.`)); }
          else chunks.push(chunk);
        });
        response.on('error', error => reject(new Error(`${label}: response ${networkCode(error)}.`)));
        response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      });
      const timeout = setTimeout(() => req.destroy(new Error('request deadline')), 30000);
      req.once('close', () => clearTimeout(timeout));
      req.on('error', error => reject(new Error(`${label}: ${networkCode(error)} (30-second request deadline).`)));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
  async function api(path, { method = 'GET', body, raw = false, status = 200, as = cookie, headers = {} } = {}) {
    const label = `${method} ${path.split('?')[0]}`;
    const result = await request(`/api/v1${path}`, { method, label,
      headers: { Origin: origin.origin, ...(as ? { Cookie: as } : {}),
        ...(body === undefined || raw ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : raw ? body : Buffer.from(JSON.stringify(body)) });
    const value = result.bytes.length && String(result.headers['content-type']).includes('application/json')
      ? parseJson(result.bytes, label) : null;
    const code = /^[a-z_0-9]+$/.test(value?.error ?? '') ? ` error=${value.error}` : '';
    const requestId = /^[A-Za-z0-9_-]+$/.test(result.headers['x-request-id'] ?? '')
      ? ` requestId=${result.headers['x-request-id']}` : '';
    requireCondition(result.status === status, `${label}: expected ${status}, received ${result.status}.${code}${requestId}`);
    requireCondition(typeof result.headers['x-request-id'] === 'string', `${label}: missing X-Request-Id.`);
    return { ...result, value };
  }
  async function createProject(type) {
    const name = `${runId} ${type}`;
    const entry = { name, type, status: 'creating' };
    audit.projects.push(entry); persist();
    const project = (await api('/projects', { method: 'POST', status: 201, body: { name, projectType: type } })).value.project;
    requireCondition(idIsSafe(project?.id), 'Project creation did not return a valid ID.');
    entry.id = project.id; entry.status = 'created'; persist();
    requireCondition(project.name === name && project.projectType === type, 'Created project metadata differs from request.');
    return entry.id;
  }
  async function signedBytes(url, { method = 'GET', headers = {}, body, status = 200, label = 'Signed object request' } = {}) {
    const result = await request(url, { method, headers: { Origin: origin.origin, ...headers }, body, label });
    requireCondition(result.status === status, `${label}: expected ${status}, received ${result.status}.`);
    return result;
  }
  function websocket(path) {
    const url = target(path);
    return new Promise((resolveSocket, reject) => {
      const key = randomBytes(16).toString('base64');
      const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      const transport = connection.protocol === 'https:' ? httpsRequest : httpRequest;
      let settled = false;
      const req = transport({ hostname: connection.hostname.replace(/^\[|\]$/g, ''),
        port: connection.port || (connection.protocol === 'https:' ? 443 : 80), servername: origin.hostname,
        path: url.pathname + url.search, agent: false, localAddress, headers: { Host: origin.host, Origin: origin.origin,
          Cookie: cookie, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key } });
      const timeout = setTimeout(() => { if (!settled) { settled = true; req.destroy(); reject(new Error(`WebSocket ${url.pathname}: handshake timeout.`)); } }, 10000);
      req.on('error', error => { clearTimeout(timeout); if (!settled) { settled = true; reject(new Error(`WebSocket ${url.pathname}: ${networkCode(error)}.`)); } });
      req.on('response', response => {
        clearTimeout(timeout); response.resume();
        if (!settled) { settled = true; reject(new Error(`WebSocket ${url.pathname}: expected 101, received ${response.statusCode}.`)); }
      });
      req.on('upgrade', (response, socket) => {
        clearTimeout(timeout); settled = true;
        const valid = response.statusCode === 101 && response.headers['sec-websocket-accept'] === expected
          && String(response.headers.upgrade).toLowerCase() === 'websocket';
        // This probe verifies the upgrade only; terminate its socket immediately.
        socket.destroy();
        valid ? resolveSocket() : reject(new Error(`WebSocket ${url.pathname}: invalid upgrade acceptance.`));
      });
      req.end();
    });
  }

  try {
    const healthResponse = await request('/health', { label: 'Health' });
    requireCondition(healthResponse.status === 200, `Health: expected 200, received ${healthResponse.status}.`);
    const health = parseJson(healthResponse.bytes, 'Health');
    requireCondition(health.status === 'ok' && ['database', 'state', 'objectStorage'].every(key => health.checks?.[key] === 'up'),
      'Health: database, state and object storage must all be up.');
    passed('health confirms PostgreSQL, Valkey and object storage');
    requireCondition((await api('/projects', { as: '', status: 401 })).value?.error === 'unauthenticated', 'Anonymous access did not return unauthenticated.');
    passed('anonymous project access returns 401');
    const login = await api('/auth/login', { method: 'POST', body: { identifier, password: admin.password,
      ...(admin.tenant === undefined ? {} : { tenant: admin.tenant }) } });
    const setCookie = login.headers['set-cookie']?.find(value => value.startsWith('factory_twin_session='));
    requireCondition(typeof setCookie === 'string', 'Login did not return the session cookie.');
    cookie = setCookie.split(';')[0];
    requireCondition(/;\s*HttpOnly/i.test(setCookie) && /;\s*SameSite=Lax/i.test(setCookie), 'Session cookie is missing required attributes.');
    requireCondition((/;\s*Secure(?:;|$)/i.test(setCookie)) === (origin.protocol === 'https:'), 'SECURE_COOKIE does not match the public protocol.');
    requireCondition(Array.isArray(login.value?.user?.roles) && login.value.user.roles.includes('platform_admin'),
      'Acceptance requires an existing platform administrator.');
    passed('administrator login and cookie attributes');

    const canvasId = await createProject('2d');
    const sceneId = await createProject('3d');
    const denied = await api(`/projects/${canvasId}`, { method: 'PATCH', status: 403,
      body: { name: `${runId} 2d` }, headers: { Origin: 'https://untrusted.invalid' } });
    requireCondition(denied.value?.error === 'origin_denied', 'Untrusted Origin was not rejected by Origin validation.');
    passed('untrusted Origin write returns 403');

    const initialCanvas = (await api(`/projects/${canvasId}/canvas`)).value.canvas;
    const node = { id: 'deployment-label', type: 'plain-text', x: 80, y: 80, width: 600, height: 100, zIndex: 1,
      resourceRefs: [], dataBindingRefs: [], props: { textColor: '#ffffff', accentColor: '#55d8ff', fillColor: '#071525',
        borderColor: '#276f8d', borderRadius: 0, text: runId, align: 'left', fontSize: 28, fontWeight: 400,
        scrollMode: 'none', scrollDuration: 15 } };
    const savedCanvas = (await api(`/projects/${canvasId}/canvas`, { method: 'PATCH',
      body: { expectedRevision: initialCanvas.revision, upsertNodes: [node], deleteNodeIds: [] } })).value.canvas;
    const canvas = (await api(`/projects/${canvasId}/canvas`)).value.canvas;
    requireCondition(canvas.revision === savedCanvas.revision && canvas.revision > initialCanvas.revision
      && canvas.nodes.find(item => item.id === node.id)?.props?.text === runId, '2D document did not round-trip.');
    passed('2D project creation, node save and read');

    const models = (await api(`/projects/${sceneId}/model-assets`)).value.modelAssets;
    const model = models.filter(item => item.source === 'system' && item.format === 'glb')
      .sort((a, b) => a.byteSize - b.byteSize)[0];
    requireCondition(model && typeof model.id === 'string', 'No built-in GLB model is available.');
    const initialScene = (await api(`/projects/${sceneId}/scene`)).value.scene;
    const instance = { id: 'deployment-model', assetId: null, label: 'Deployment check', modelAssetId: model.id,
      renderMode: 'interactive', sortOrder: 0, visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } };
    const savedScene = (await api(`/projects/${sceneId}/scene`, { method: 'PATCH', body: {
      expectedRevision: initialScene.revision, upsertInstances: [instance], deleteInstanceIds: [], linked2dProjectId: canvasId } })).value.scene;
    const scene = (await api(`/projects/${sceneId}/scene`)).value.scene;
    requireCondition(scene.revision === savedScene.revision && scene.revision > initialScene.revision
      && scene.instances.find(item => item.id === instance.id)?.modelAssetId === model.id
      && scene.linked2dProjectId === canvasId, '3D instance and linked project did not round-trip.');
    passed('3D project creation, model instance save and read');

    const html = await request('/', { label: 'Frontend index' });
    requireCondition(html.status === 200 && String(html.headers['content-type']).includes('text/html'), 'Frontend index is not served as HTML.');
    const references = [...html.bytes.toString().matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
    requireCondition(references.length > 0, 'Frontend index has no built JS/CSS references.');
    for (const path of references) {
      const asset = await request(path, { label: 'Frontend entry asset' });
      requireCondition(asset.status === 200 && asset.bytes.length > 0 && !String(asset.headers['content-type']).includes('text/html'), 'A frontend entry asset is missing.');
    }
    const builtin = await api(`/projects/${sceneId}/model-assets/${encodeURIComponent(model.id)}/content`, { status: 302 });
    const glb = await request(builtin.headers.location, { label: 'Built-in GLB' });
    requireCondition(glb.status === 200 && glb.bytes.subarray(0, 4).toString() === 'glTF'
      && glb.bytes.length === model.byteSize && createHash('sha256').update(glb.bytes).digest('hex') === model.sha256,
      'Built-in GLB bytes/hash differ from the backend contract.');
    for (const path of ['/decoders/basis/basis_transcoder.wasm', '/decoders/draco/draco_decoder.wasm']) {
      const wasm = await request(path, { label: 'WASM decoder' });
      requireCondition(wasm.status === 200 && String(wasm.headers['content-type']).includes('application/wasm')
        && wasm.bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM decoder bytes or MIME type are invalid.');
    }
    passed('frontend JS/CSS, built-in GLB hash and local WASM decoders');

    const png = tinyPng();
    const image = (await api(`/projects/${canvasId}/image-assets?filename=deployment.png`, {
      method: 'POST', body: png, raw: true, status: 201, headers: { 'Content-Type': 'image/png' } })).value.imageAsset;
    requireCondition(idIsSafe(image?.id), 'Image upload did not return a valid resource ID.');
    audit.resources.push({ projectId: canvasId, id: image.id, kind: 'image', upload: 'raw' }); persist();
    const redirect = await api(`/projects/${canvasId}/image-assets/${image.id}/content`, { status: 302 });
    const download = await signedBytes(redirect.headers.location);
    requireCondition(download.bytes.equals(png), 'Signed image download byte integrity failed.');
    const range = await signedBytes(redirect.headers.location, { headers: { Range: 'bytes=0-7' }, status: 206, label: 'Signed object Range' });
    requireCondition(range.bytes.equals(png.subarray(0, 8)) && range.headers['content-range'] === `bytes 0-7/${png.length}`, 'Signed object Range result is incorrect.');
    passed('PNG upload, same-origin signed download and byte Range');

    const upload = (await api(`/projects/${canvasId}/uploads`, { method: 'POST', status: 201,
      body: { kind: 'image', filename: 'deployment-multipart.png', byteSize: png.length } })).value;
    requireCondition(idIsSafe(upload?.resourceId), 'Multipart reservation did not return a valid resource ID.');
    audit.resources.push({ projectId: canvasId, id: upload.resourceId, kind: 'image', upload: 'multipart' }); persist();
    const part = (await api(`/projects/${canvasId}/uploads/${upload.resourceId}/parts/1`, { method: 'POST' })).value;
    await signedBytes(part.url, { method: 'PUT', body: png, label: 'Signed multipart PUT' });
    await api(`/projects/${canvasId}/uploads/${upload.resourceId}/complete`, { method: 'POST', status: 202 });
    let state;
    for (let attempt = 0; attempt < 45; attempt++) {
      state = (await api(`/projects/${canvasId}/uploads/${upload.resourceId}`)).value.resource;
      if (['ready', 'failed'].includes(state?.state)) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 1000));
    }
    requireCondition(state?.state === 'ready', `Multipart worker validation did not reach ready; state=${['uploading', 'processing', 'failed'].includes(state?.state) ? state.state : 'unknown'}.`);
    const multipartRedirect = await api(`/projects/${canvasId}/image-assets/${upload.resourceId}/content`, { status: 302 });
    requireCondition((await signedBytes(multipartRedirect.headers.location)).bytes.equals(png), 'Validated multipart image differs from source bytes.');
    passed('multipart upload, durable worker ready state and downloaded bytes');

    await websocket('/api/v1/realtime');
    await websocket(`/api/v1/twin-drive?projectId=${encodeURIComponent(sceneId)}`);
    passed('both authenticated WebSocket endpoints complete valid 101 upgrades');
  } catch (error) {
    failure = error;
    audit.errors.push({ phase: 'verification', message: error.message });
  } finally {
    for (const project of [...audit.projects].reverse()) {
      if (!project.id || project.status === 'deleted') continue;
      try {
        requireCondition(cookie && idIsSafe(project.id) && project.name === `${runId} ${project.type}`,
          'Refusing fixture cleanup without authenticated, run-specific identity.');
        const current = (await api(`/projects/${project.id}`)).value.project;
        requireCondition(current?.name === project.name && current.projectType === project.type,
          'Refusing cleanup: fixture project was renamed or changed type.');
        const deleted = (await api(`/projects/${project.id}`, { method: 'DELETE' })).value;
        requireCondition(deleted.deletedProjectId === project.id && !deleted.warning, 'Project cleanup returned an unexpected ID or object-storage warning.');
        project.status = 'deleted'; project.deletedAt = new Date().toISOString(); persist();
        console.log(`CLEANUP ${project.type} fixture deleted`);
      } catch (error) {
        audit.errors.push({ phase: 'cleanup', projectId: project.id, message: error.message });
        failure ??= error;
      }
    }
    if (cookie) {
      try {
        await api('/auth/logout', { method: 'POST', status: 204 });
        await api('/projects', { status: 401 });
        audit.sessionRevoked = true;
      } catch (error) { audit.errors.push({ phase: 'logout', message: error.message }); failure ??= error; }
      cookie = '';
    }
    audit.status = failure ? 'failed' : 'passed';
    audit.finishedAt = new Date().toISOString(); persist();
    console.log(`AUDIT ${auditFile}`);
  }
  if (failure) throw failure;
  console.log(`PASS deployment acceptance: ${audit.checks.length} checks; all test projects deleted; session revoked.`);
}

function tinyPng() {
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const chunk = (kind, bytes) => {
    const name = Buffer.from(kind), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([header, name, bytes, checksum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 32, 160, 224]))), chunk('IEND', Buffer.alloc(0))]);
}

main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
