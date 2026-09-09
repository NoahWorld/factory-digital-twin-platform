// Run only against an isolated, migrated local Worker. No customer project is accessed.
import assert from 'node:assert/strict';
import { builtinModels } from '../shared/builtin-models.ts';
const [base, token] = process.argv.slice(2);
if (!base || !token || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Usage: node scripts/smoke-builtin-models.mjs http://127.0.0.1:PORT EPHEMERAL_BOOTSTRAP_TOKEN');
const identity = { email: 'aqua-qa@example.invalid', password: `Local-${token}!`, displayName: '模型集成验收' };
let cookie = '';
async function call(path, { body, method = 'GET', auth = true, expected = 200, headers = {}, redirect = 'follow' } = {}) {
  const response = await fetch(base + path, { method, redirect,
    headers: { 'content-type': 'application/json', ...(auth && cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 600)}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return { data: text ? JSON.parse(text) : null, response };
}
const status = await call('/api/v1/auth/bootstrap-status');
await call(`/api/v1/auth/${status.data.setupRequired ? 'bootstrap' : 'login'}`, { method: 'POST', body: identity,
  headers: { 'x-bootstrap-token': token }, expected: status.data.setupRequired ? 201 : 200 });
const { data: { project } } = await call('/api/v1/projects', { method: 'POST', body: { name: 'AQUA HELIX · 内置样例验收' }, expected: 201 });
const prefix = `/api/v1/projects/${project.id}`;
await call(prefix + '/model-assets', { auth: false, expected: 401 });
const sample = builtinModels[0];
const listed = await call(prefix + '/model-assets');
assert.ok(listed.data.modelAssets.some((m) => m.id === sample.id));
const node = { id: crypto.randomUUID(), type: 'model-3d', x: 120, y: 90, width: 1680, height: 900, zIndex: 1,
  resourceRefs: [sample.id], dataBindingRefs: [], props: { showControlPanel: false, rotationSpeed: 0.35, showGrid: true, transformOverrides: {}, appearanceOverrides: {}, ...sample.defaults } };
const saveBody = { expectedRevision: 0, upsertNodes: [node], deleteNodeIds: [] };
await call(prefix + '/canvas', { method: 'PATCH', body: { ...saveBody, upsertNodes: [{ ...node, resourceRefs: ['builtin:missing'] }] }, expected: 400 });
await call(prefix + '/canvas', { method: 'PATCH', body: { ...saveBody, upsertNodes: [{ ...node, props: { ...node.props, presentation: { ...node.props.presentation, explosion: 2 } } }] }, expected: 400 });
await call(prefix + '/canvas', { method: 'PATCH', body: { ...saveBody, upsertNodes: [{ ...node, props: { ...node.props, showControlPanel: 'true' } }] }, expected: 400 });
const changed = { ...node, props: { ...node.props, showControlPanel: true, presentation: { lighting: 'studio', shellMode: 'solid', explosion: 0.65, showFlow: false }, animationSpeed: 0.5, playAnimations: false } };
await call(prefix + '/canvas', { method: 'PATCH', body: { ...saveBody, upsertNodes: [changed] } });
const restored = (await call(prefix + '/canvas')).data.canvas.nodes[0];
assert.deepEqual(restored.props, changed.props);
assert.deepEqual(restored.resourceRefs, [sample.id]);
await call(prefix + '/canvas', { method: 'PATCH', body: { ...saveBody, expectedRevision: 1 } });
const modelResponse = await fetch(base + `${prefix}/model-assets/${encodeURIComponent(sample.id)}/content`, { headers: { cookie } });
assert.equal(modelResponse.status, 200);
assert.equal((await modelResponse.arrayBuffer()).byteLength, sample.byteSize);
// Missing R2 still fails for uploads; a bundled model never pretends an upload succeeded.
await call(prefix + '/model-assets?filename=custom.glb', { method: 'POST', body: {}, expected: 503 });
console.log('PASS: authenticated model catalog, anonymous denial, unknown IDs/invalid settings rejected, saved settings round-trip, bundled binary load without R2, uploaded storage errors preserved.');
console.log(`QA editor: ${base}/#/projects/${project.id}/3d-editor/${node.id}`);
