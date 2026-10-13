// Node 22+: real deployed IFC/DXF -> GLB acceptance. No Docker/service changes.
// Required: DTWIN_ORIGIN and DTWIN_ADMIN_FILE (regular 0600 JSON file).
// Optional: DTWIN_BACKEND_DIR (TWIN_BACKEND_DIR alias), DTWIN_LOCAL_ADDRESS,
// DTWIN_CONNECT_ORIGIN (loopback only).
// Local script testing only: DTWIN_OBJECT_ORIGIN may name a separate loopback
// object-store origin. Public-server acceptance always requires same-origin objects.
// Uses the original synthetic fixtures in the sibling backend repository. Creates
// one uniquely named project, deletes only that exact project, revokes its session,
// and writes a private audit beside the administrator file. Never logs credentials.
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const safeCode = value => /^[A-Za-z0-9_-]{1,120}$/.test(value ?? '') ? value : 'unavailable';
const pause = ms => new Promise(done => setTimeout(done, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function exactOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTP(S) origin.`); }
  check(['http:', 'https:'].includes(url.protocol) && url.origin === value,
    `${label} must contain only scheme, hostname and optional port.`);
  return url;
}
function json(bytes, label) {
  try { return JSON.parse(bytes.toString()); } catch { throw new Error(`${label}: invalid JSON.`); }
}
function close(actual, expected, label, tolerance = 0.00001) {
  check(actual.length === expected.length && actual.every((value, index) => Number.isFinite(value)
    && Math.abs(value - expected[index]) <= tolerance), `${label}: expected ${expected}, received ${actual}.`);
}

// Read actual float32 geometry, applying every scene node transform. Do not trust
// result bounds or accessor min/max as substitutes for the downloaded GLB geometry.
function readGeometry(bytes) {
  check(bytes.length >= 28 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2
    && bytes.readUInt32LE(8) === bytes.length, 'Invalid GLB header/version/length.');
  const chunks = []; let offset = 12;
  while (offset < bytes.length) {
    check(offset + 8 <= bytes.length, 'Truncated GLB chunk header.');
    const size = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    check(size % 4 === 0 && offset + 8 + size <= bytes.length, 'Invalid GLB chunk length.');
    chunks.push({ type, bytes: bytes.subarray(offset + 8, offset + 8 + size) }); offset += 8 + size;
  }
  check(chunks.length === 2 && chunks[0].type === 0x4e4f534a && chunks[1].type === 0x004e4942,
    'Expected one JSON and one BIN GLB chunk.');
  const gltf = json(chunks[0].bytes, 'GLB JSON'), binary = chunks[1].bytes;
  check(gltf.asset?.version === '2.0' && gltf.buffers?.length === 1 && !gltf.buffers[0].uri,
    'GLB must embed a single glTF 2.0 buffer.');
  check(gltf.buffers[0].byteLength <= binary.length && binary.length - gltf.buffers[0].byteLength < 4,
    'GLB buffer length does not match BIN data.');
  check(!gltf.extensionsRequired?.length && !gltf.animations?.length && !gltf.skins?.length,
    'Unexpected geometry extension, animation or skin in engineering fixture.');
  const sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
  function accessor(index, expectedType) {
    const a = gltf.accessors?.[index], view = gltf.bufferViews?.[a?.bufferView];
    check(a && a.type === expectedType && !a.sparse && !a.normalized && view?.buffer === 0,
      'Unsupported/missing geometry accessor.');
    const components = expectedType === 'VEC3' ? 3 : 1, width = sizes[a.componentType];
    check(width && (expectedType !== 'VEC3' || a.componentType === 5126)
      && Number.isInteger(a.count) && a.count > 0 && a.count <= 6_000_000, 'Invalid accessor type/count.');
    const stride = view.byteStride ?? width * components, base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    check(stride >= width * components && base >= 0 && base + (a.count - 1) * stride + width * components
      <= Math.min(binary.length, (view.byteOffset ?? 0) + view.byteLength), 'Accessor exceeds buffer bounds.');
    const read = a.componentType === 5126 ? 'readFloatLE' : a.componentType === 5125 ? 'readUInt32LE'
      : a.componentType === 5123 ? 'readUInt16LE' : 'readUInt8';
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: components }, (_, c) => binary[read](base + i * stride + c * width)));
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const multiply = (a, b) => Array.from({ length: 16 }, (_, i) => {
    const row = i % 4, col = Math.floor(i / 4); let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
    return sum;
  });
  function matrix(node) {
    if (node.matrix) { check(node.matrix.length === 16 && node.matrix.every(Number.isFinite), 'Invalid node matrix.'); return node.matrix; }
    const t = node.translation ?? [0, 0, 0], s = node.scale ?? [1, 1, 1], q = node.rotation ?? [0, 0, 0, 1];
    check(t.length === 3 && s.length === 3 && q.length === 4 && [...t, ...s, ...q].every(Number.isFinite), 'Invalid node TRS.');
    const [x, y, z, w] = q;
    return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
      2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
      2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, ...t, 1];
  }
  const geometries = [], visited = new Set(), names = new Set();
  function visit(index, parent) {
    check(!visited.has(index) && gltf.nodes?.[index], 'Repeated/cyclic/missing GLB scene node.'); visited.add(index);
    const node = gltf.nodes[index], world = multiply(parent, matrix(node));
    check(typeof node.name === 'string' && node.name.length > 0 && !names.has(node.name), 'GLB node names must be unique and nonempty.'); names.add(node.name);
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh]; check(mesh?.primitives?.length > 0, 'Scene references missing mesh.');
      for (const primitive of mesh.primitives) {
        check((primitive.mode ?? 4) === 4 && !primitive.targets, 'Expected static triangle mesh.');
        const positions = accessor(primitive.attributes?.POSITION, 'VEC3').map(p => [0, 1, 2].map(i =>
          world[i] * p[0] + world[4 + i] * p[1] + world[8 + i] * p[2] + world[12 + i]));
        check(positions.every(p => p.every(Number.isFinite)), 'Non-finite GLB vertex.');
        const indices = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(primitive.indices, 'SCALAR').flat();
        check(indices.length % 3 === 0 && indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.length), 'Invalid triangle indices.');
        const triangles = Array.from({ length: indices.length / 3 }, (_, i) => indices.slice(i * 3, i * 3 + 3).map(n => positions[n]));
        geometries.push({ name: node.name, extras: { ...mesh.extras, ...node.extras }, positions, triangles });
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0]; check(scene?.nodes?.length > 0, 'Missing GLB scene.');
  for (const root of scene.nodes) visit(root, identity);
  check(geometries.length > 0, 'No GLB geometry.');
  return { geometries, nodeCount: visited.size };
}
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], point[i]); max[i] = Math.max(max[i], point[i]); }
  return { min, max, size: subtract(max, min) };
}
function rayHits(triangles, origin) {
  const direction = [0, 0, 1];
  return triangles.filter(([a, b, c]) => {
    const e1 = subtract(b, a), e2 = subtract(c, a), p = cross(direction, e2), determinant = dot(e1, p);
    if (Math.abs(determinant) < 1e-10) return false;
    const delta = subtract(origin, a), u = dot(delta, p) / determinant, q = cross(delta, e1), v = dot(direction, q) / determinant;
    return u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8 && dot(e2, q) / determinant > 0;
  }).length;
}
function verifyGeometry(format, bytes, result) {
  const { geometries, nodeCount } = readGeometry(bytes), measured = bounds(geometries.flatMap(g => g.positions));
  close(measured.min, format === 'dxf' ? [-10, 0, -6] : [-2, 0, -0.1], `${format} minimum`);
  close(measured.max, format === 'dxf' ? [10, 4.2, 6] : [2, 3, 0.1], `${format} maximum`);
  close(result.bounds.min, measured.min, `${format} reported minimum`);
  close(result.bounds.max, measured.max, `${format} reported maximum`);
  close(result.sourceOrigin, format === 'dxf' ? [10, 6, -0.2] : [100, 200, 0], `${format} source origin`);
  const count = format === 'dxf' ? 12 : 1;
  check(geometries.length === count && result.objectCount === count, `${format}: wrong object count.`);
  const triangleCount = geometries.reduce((sum, g) => sum + g.triangles.length, 0);
  check(triangleCount === result.triangleCount, `${format}: triangle count differs from server report.`);
  let openingProbes, volume;
  if (format === 'ifc') {
    check(geometries[0].extras.ifcGuid === '0vAyb7Jjf8FQuyGnKdLTT1', 'IFC source GUID was not retained.');
    const triangles = geometries[0].triangles;
    volume = Math.abs(triangles.reduce((sum, [a, b, c]) => sum + dot(a, cross(b, c)) / 6, 0));
    close([volume], [2], 'IFC wall minus doorway volume');
    openingProbes = 0;
    for (const x of [-0.4, 0, 0.4]) for (const y of [0.2, 1, 1.8]) {
      check(rayHits(triangles, [x, y, -1]) === 0, 'IFC doorway incorrectly filled.'); openingProbes++;
    }
    for (const [x, y] of [[-1, 1], [1, 1], [0, 2.5]]) check(rayHits(triangles, [x, y, -1]) > 0, 'IFC control wall incorrectly missing.');
  } else {
    const roles = geometries.map(g => g.extras.role);
    for (const [role, expected] of [['floor', 1], ['wall', 5], ['column', 4], ['equipment', 2]])
      check(roles.filter(v => v === role).length === expected, `DXF ${role}: wrong count.`);
    const equipment = geometries.filter(g => g.extras.role === 'equipment');
    check(equipment.every(g => typeof g.extras.sourceHandle === 'string' && g.extras.sourceHandle.includes('/')),
      'DXF nested INSERT source trace was not retained.');
    const equipmentSizes = equipment.map(g => bounds(g.positions).size).sort((a, b) => a[0] - b[0]);
    close(equipmentSizes[0], [1, 1.5, 2], 'DXF rotated equipment');
    close(equipmentSizes[1], [2, 1.5, 1], 'DXF equipment');
  }
  return { byteSize: bytes.length, sha256: sha256(bytes), bounds: measured, objectCount: geometries.length,
    nodeCount, triangleCount, openingProbes, volume };
}

async function main() {
  const origin = exactOrigin(process.env.DTWIN_ORIGIN, 'DTWIN_ORIGIN');
  const connection = process.env.DTWIN_CONNECT_ORIGIN ? exactOrigin(process.env.DTWIN_CONNECT_ORIGIN, 'DTWIN_CONNECT_ORIGIN') : origin;
  check(connection.origin === origin.origin || (['127.0.0.1', '[::1]', 'localhost'].includes(connection.hostname)
    && connection.protocol === origin.protocol), 'Connection override may only use same-protocol loopback.');
  const objectOrigin = process.env.DTWIN_OBJECT_ORIGIN ? exactOrigin(process.env.DTWIN_OBJECT_ORIGIN, 'DTWIN_OBJECT_ORIGIN') : origin;
  if (process.env.DTWIN_OBJECT_ORIGIN) check([origin, objectOrigin].every(url => ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
    && objectOrigin.protocol === origin.protocol, 'Separate object origin is allowed only for explicit local loopback script testing.');
  const localAddress = process.env.DTWIN_LOCAL_ADDRESS;
  if (localAddress !== undefined) check(Object.values(networkInterfaces()).flat().some(item => item?.address === localAddress),
    'DTWIN_LOCAL_ADDRESS is not assigned to a local interface.');
  check(process.env.DTWIN_ADMIN_FILE, 'DTWIN_ADMIN_FILE is required.');
  const adminFile = resolve(process.env.DTWIN_ADMIN_FILE), stat = lstatSync(adminFile);
  check(stat.isFile() && (stat.mode & 0o777) === 0o600, 'Administrator file must be a regular 0600 file.');
  const admin = json(readFileSync(adminFile), 'Administrator file'), identifier = admin.identifier ?? admin.loginName ?? admin.email;
  check(typeof identifier === 'string' && identifier.length > 0 && typeof admin.password === 'string' && admin.password.length > 0,
    'Administrator file requires identifier/loginName/email and password.');
  const backend = resolve(process.env.DTWIN_BACKEND_DIR || process.env.TWIN_BACKEND_DIR
    || fileURLToPath(new URL('../../../factory-digital-twin-backend', import.meta.url)));
  const fixture = join(backend, 'engineering', 'fixtures');
  const sources = [['dxf', 'engineering-layout.dxf'], ['ifc', 'sample.ifc']].map(([format, filename]) =>
    ({ format, filename, bytes: readFileSync(join(fixture, filename)) }));
  const options = json(readFileSync(join(fixture, 'options.json')), 'DXF options');
  const runId = `dtwin-engineering-${randomUUID()}`, auditFile = join(dirname(adminFile), `${runId}.json`);
  const audit = { runId, origin: origin.origin, connectionOrigin: connection.origin, objectOrigin: objectOrigin.origin, localAddress,
    scope: 'real deployed geometry conversion in one run-owned temporary project', startedAt: new Date().toISOString(),
    status: 'running', project: { name: runId, projectType: '3d', status: 'not_created' }, imports: [], checks: [], errors: [] };
  writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const persist = () => writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  const passed = name => { audit.checks.push({ name, at: new Date().toISOString() }); persist(); console.log(`PASS ${name}`); };
  let cookie = '', failure;
  function request(input, { method = 'GET', headers = {}, body, label = 'HTTP request', maxBytes = 26 * 1024 * 1024 } = {}) {
    const url = new URL(input, origin);
    check([origin.origin, objectOrigin.origin].includes(url.origin) && !url.username && !url.password && !url.hash,
      'Refusing request outside configured public origin.');
    check(url.origin === origin.origin || (method === 'GET' && !headers.Cookie), 'Separate loopback object requests must be GET without session credentials.');
    const destination = url.origin === origin.origin ? connection : objectOrigin;
    return new Promise((resolveRequest, reject) => {
      const req = (destination.protocol === 'https:' ? httpsRequest : httpRequest)({
        hostname: destination.hostname.replace(/^\[|\]$/g, ''), port: destination.port || (destination.protocol === 'https:' ? 443 : 80),
        servername: url.hostname, path: url.pathname + url.search, method, agent: false, localAddress,
        headers: { ...headers, Host: url.host, ...(body === undefined ? {} : { 'Content-Length': body.length }) },
      }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(); reject(new Error(`${label}: response exceeds size limit.`)); }
          else chunks.push(chunk);
        });
        response.on('error', error => reject(new Error(`${label}: response ${safeCode(error.code)}.`)));
        response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      });
      const timeout = setTimeout(() => req.destroy(new Error('request deadline')), 30000);
      req.once('close', () => clearTimeout(timeout));
      req.on('error', error => reject(new Error(`${label}: ${safeCode(error.code)} (30-second deadline).`)));
      req.end(body);
    });
  }
  async function api(path, { method = 'GET', body, status = 200, as = cookie } = {}) {
    const label = `${method} ${path}`, headers = { Origin: origin.origin, ...(as ? { Cookie: as } : {}) };
    if (method !== 'GET' && !['/auth/login', '/auth/logout', '/projects'].includes(path)) {
      check(safeId(audit.project.id) && (path === `/projects/${audit.project.id}` || path.startsWith(`/projects/${audit.project.id}/`)),
        'Refusing mutation outside this run-owned project.');
    }
    let bytes;
    if (body instanceof FormData) {
      const encoded = new Request(origin.origin, { method: 'POST', body });
      headers['Content-Type'] = encoded.headers.get('content-type'); bytes = Buffer.from(await encoded.arrayBuffer());
    } else if (body !== undefined) { headers['Content-Type'] = 'application/json'; bytes = Buffer.from(JSON.stringify(body)); }
    const response = await request(`/api/v1${path}`, { method, headers, body: bytes, label });
    const value = response.bytes.length && String(response.headers['content-type']).includes('application/json') ? json(response.bytes, label) : null;
    check(response.status === status, `${label}: expected ${status}, received ${response.status}; error=${safeCode(value?.error)}; requestId=${safeCode(response.headers['x-request-id'])}.`);
    return { ...response, value };
  }
  async function waitJob(entry, expected, timeoutMs = 600000) {
    const deadline = Date.now() + timeoutMs; let previous, reportedAt = 0;
    while (Date.now() < deadline) {
      const job = (await api(`/projects/${audit.project.id}/engineering-imports/${entry.id}`)).value.import;
      check(job?.id === entry.id && job.projectId === audit.project.id, 'Import read returned a different identity.');
      entry.status = job.status; entry.stage = job.stage; persist();
      if (`${job.status}/${job.stage}` !== previous || Date.now() - reportedAt > 15000) {
        console.log(`STAGE ${entry.format}: ${safeCode(job.status)}/${safeCode(job.stage)} (${Math.round((Date.now() - entry.startedAtMs) / 1000)}s)`);
        previous = `${job.status}/${job.stage}`; reportedAt = Date.now();
      }
      if (job.status === 'failed') throw new Error(`${entry.format} conversion failed: ${safeCode(job.error?.code)}; importId=${entry.id}.`);
      if (job.status === expected) return job;
      await pause(1000);
    }
    throw new Error(`${entry.format}: timed out waiting for ${expected}; importId=${entry.id}, stage=${safeCode(entry.stage)}.`);
  }
  try {
    await api('/engineering-imports/capabilities', { as: '', status: 401 });
    const login = await api('/auth/login', { method: 'POST', body: { identifier, password: admin.password,
      ...(admin.tenant === undefined ? {} : { tenant: admin.tenant }) } });
    const setCookie = login.headers['set-cookie']?.find(value => value.startsWith('factory_twin_session='));
    check(setCookie, 'Login did not return session cookie.'); cookie = setCookie.split(';')[0];
    check(login.value?.user?.roles?.includes('platform_admin'), 'Existing administrator role is required.');
    const caps = (await api('/engineering-imports/capabilities')).value;
    check(caps.available === true, 'Engineering conversion is unavailable on deployed API.');
    assert.deepEqual(caps.formats, ['ifc', 'dxf']);
    check(caps.maxSourceBytes === 100 * 1024 * 1024 && caps.maxOutputBytes === 25 * 1024 * 1024, 'Unexpected source/output limits.');
    audit.capabilities = caps; passed('authenticated capabilities and bundled converter are available');
    audit.project.status = 'creating'; persist();
    const project = (await api('/projects', { method: 'POST', status: 201, body: { name: runId, projectType: '3d' } })).value.project;
    check(safeId(project?.id), 'Project response lacks safe ID.'); audit.project.id = project.id; audit.project.status = 'created'; persist();
    check(project.name === runId && project.projectType === '3d', 'Project identity differs from creation request.');
    for (const source of sources) {
      const form = new FormData(); form.append('name', `${runId} ${source.format}`); form.append('file', new Blob([source.bytes]), source.filename);
      const job = (await api(`/projects/${project.id}/engineering-imports`, { method: 'POST', body: form, status: 202 })).value.import;
      check(safeId(job?.id) && job.projectId === project.id && job.format === source.format, 'Upload returned invalid import identity.');
      const entry = { id: job.id, format: source.format, sourceSha256: sha256(source.bytes), sourceBytes: source.bytes.length, startedAtMs: Date.now() };
      audit.imports.push(entry); persist();
      const inspected = await waitJob(entry, 'needs_configuration');
      check(inspected.inspection?.objectCount > 0, 'Inspection contains no objects.');
      entry.inspection = inspected.inspection; persist();
      const config = source.format === 'dxf' ? { ...options, name: `${runId} dxf` }
        : { schemaVersion: 1, name: `${runId} ifc`, center: true, layers: [] };
      await api(`/projects/${project.id}/engineering-imports/${job.id}/convert`, { method: 'POST', body: config, status: 202 });
      const done = await waitJob(entry, 'completed');
      check(done.progress === 100 && safeId(done.resourceId), 'Completed import lacks resource/progress.');
      entry.resourceId = done.resourceId;
      const assets = (await api(`/projects/${project.id}/model-assets`)).value.modelAssets;
      const asset = assets.find(item => item.id === done.resourceId);
      check(asset?.format === 'glb' && asset.byteSize > 0 && asset.inspection?.nodeCount > 0, 'Converted resource missing from model library.');
      const redirect = await api(`/projects/${project.id}/model-assets/${done.resourceId}/content`, { status: 302 });
      check(redirect.headers.location, 'Model content lacks signed download redirect.');
      const downloaded = await request(redirect.headers.location, { headers: { Origin: origin.origin }, label: `${source.format} signed GLB download` });
      check(downloaded.status === 200 && downloaded.bytes.length === asset.byteSize, 'Signed GLB download status/size mismatch.');
      entry.geometry = verifyGeometry(source.format, downloaded.bytes, done.result); entry.result = done.result; persist();
      passed(`${source.format.toUpperCase()} upload/inspect/configure/convert/library/download and actual geometry match source design`);
    }
  } catch (error) {
    failure = error; audit.errors.push({ phase: 'verification', message: error.message });
  } finally {
    if (audit.project.id && cookie) {
      try {
        const current = (await api(`/projects/${audit.project.id}`)).value.project;
        check(current?.name === runId && current.projectType === '3d', 'Refusing cleanup: temporary project identity changed.');
        // No cancellation API exists. An in-flight job must finish or fail before
        // project deletion; never change server state to force cleanup past a lease.
        const deadline = Date.now() + 600000; let lastReport = 0;
        while (true) {
          const jobs = (await api(`/projects/${audit.project.id}/engineering-imports`)).value.imports;
          check(Array.isArray(jobs), 'Cleanup import list is invalid.');
          const active = jobs.filter(j => ['queued', 'inspecting', 'converting'].includes(j.status));
          if (!active.length) break;
          check(Date.now() < deadline, 'Cleanup blocked by active imports; project ID retained in audit for explicit follow-up.');
          if (Date.now() - lastReport > 15000) { console.log(`CLEANUP waiting for ${active.length} active import(s) in own project`); lastReport = Date.now(); }
          await pause(1000);
        }
        const deleted = (await api(`/projects/${audit.project.id}`, { method: 'DELETE' })).value;
        check(deleted.deletedProjectId === audit.project.id && !deleted.warning, 'Cleanup returned unexpected project ID or storage warning.');
        audit.project.status = 'deleted'; audit.project.deletedAt = new Date().toISOString(); persist();
        passed('only this run-owned temporary project and its resources were deleted');
      } catch (error) { failure ??= error; audit.errors.push({ phase: 'cleanup', message: error.message }); }
    }
    if (cookie) {
      try {
        await api('/auth/logout', { method: 'POST', status: 204 });
        check((await api('/engineering-imports/capabilities', { status: 401 })).value?.error === 'unauthenticated', 'Acceptance session remained valid after logout.');
        audit.sessionRevoked = true; passed('acceptance session revoked');
      } catch (error) { failure ??= error; audit.errors.push({ phase: 'logout', message: error.message }); }
      cookie = '';
    }
    audit.status = failure ? 'failed' : 'passed'; audit.finishedAt = new Date().toISOString(); persist();
    console.log(`AUDIT ${auditFile}`);
  }
  if (failure) throw failure;
  console.log(`PASS engineering acceptance: ${audit.checks.length} checks; fixture project removed; session revoked.`);
}

main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
