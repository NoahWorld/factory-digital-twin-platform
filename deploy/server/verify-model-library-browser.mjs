// Node 22+. Run only against the authorized, deployed public HTTP target.
// Required: DTWIN_ORIGIN, DTWIN_ADMIN_FILE (regular 0600 JSON file).
// Optional: DTWIN_PLAYWRIGHT_MODULE, DTWIN_BROWSER_CHANNEL (default chrome).
// Creates ONE uniquely named 3D project, exercises its editor, then deletes only
// that project and revokes this isolated browser's session in finally. Existing
// projects are never edited. Evidence stays in deploy/server/.local (0700/0600).
// No credentials, cookies, response bodies, traces or raw console text are saved.
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.umask(0o077);
class AcceptanceError extends Error {}
const check = (condition, message) => { if (!condition) throw new AcceptanceError(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const equal = (actual, expected, label) => check(canonical(actual) === canonical(expected), `${label}: mismatch.`);
function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  check(stat.isDirectory() && (stat.mode & 0o077) === 0, 'Audit directory must be private and cannot be a symlink.');
}

async function main() {
  check(process.env.DTWIN_ORIGIN, 'DTWIN_ORIGIN is required.');
  let origin;
  try { origin = new URL(process.env.DTWIN_ORIGIN); }
  catch { throw new AcceptanceError('DTWIN_ORIGIN is invalid.'); }
  check(origin.origin === process.env.DTWIN_ORIGIN && origin.protocol === 'http:',
    'Use an exact ordinary HTTP origin without credentials, a path or a trailing slash.');
  check(!['localhost', '[::1]', '0.0.0.0'].includes(origin.hostname)
    && !origin.hostname.endsWith('.localhost') && !origin.hostname.startsWith('127.'),
  'Use the authorized real public HTTP target, without a browser-security override.');
  check(process.env.DTWIN_ADMIN_FILE, 'DTWIN_ADMIN_FILE is required.');
  const adminFile = resolve(process.env.DTWIN_ADMIN_FILE);
  const adminStat = lstatSync(adminFile);
  check(adminStat.isFile() && (adminStat.mode & 0o777) === 0o600, 'Administrator file must be a regular 0600 file, not a symlink.');
  let admin;
  try { admin = JSON.parse(readFileSync(adminFile, 'utf8')); }
  catch { throw new AcceptanceError('Administrator file must contain valid JSON.'); }
  const identifier = admin?.identifier ?? admin?.loginName ?? admin?.email;
  check(typeof identifier === 'string' && identifier.length > 0 && typeof admin?.password === 'string' && admin.password.length > 0,
    'Administrator file requires identifier (or loginName/email) and password.');

  const runId = `model-library-browser-${randomUUID()}`;
  const auditRoot = fileURLToPath(new URL('./.local', import.meta.url));
  privateDirectory(auditRoot);
  const output = join(auditRoot, runId);
  privateDirectory(output);
  const auditFile = join(output, 'results.json');
  const fixture = { name: runId, projectType: '3d', status: 'not-created' };
  const audit = { runId, origin: origin.origin, startedAt: new Date().toISOString(), status: 'running',
    fixture, scope: 'one temporary 3D project; no existing project writes', checks: [], screenshots: [],
    allowedWrites: [], blockedRequests: [], httpErrors: [], pageErrors: [], failures: [], sessionRevoked: false };
  writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const persist = () => writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  const passed = name => { audit.checks.push({ name, at: new Date().toISOString() }); persist(); console.log(`PASS ${name}`); };
  let phase = 'launch';
  // Playwright errors can contain credential input values or raw DOM. Export only
  // our controlled assertion messages and fingerprints of unexpected failures.
  const failure = (stage, error) => {
    const message = error instanceof AcceptanceError ? error.message
      : error?.name === 'TimeoutError' ? 'Timed out in the named acceptance phase.' : 'Execution failed in the named acceptance phase.';
    audit.failures.push({ phase: stage, message, fingerprint: sha(String(error?.message ?? error)) });
    persist(); console.error(`FAIL ${stage}: ${message}`);
  };
  const safePath = value => {
    const url = new URL(value);
    return url.origin === origin.origin && /^\/[A-Za-z0-9._:/%-]*$/.test(url.pathname) ? url.pathname : '[external-or-redacted]';
  };
  const assertClean = () => {
    check(audit.pageErrors.length === 0, 'Browser raised an uncaught error; see its private diagnostic fingerprint.');
    check(audit.blockedRequests.length === 0, 'The request guard blocked an unexpected write, external request or WebSocket.');
    check(audit.httpErrors.length === 0, 'An unexpected failing HTTP response occurred.');
  };
  const projectPath = () => { check(uuid(fixture.id), 'Temporary project ID is not established.'); return `/api/v1/projects/${fixture.id}`; };
  const scenePath = () => `${projectPath()}/scene`;
  const responseMatches = (response, path, method) => {
    const url = new URL(response.url());
    return url.origin === origin.origin && url.pathname === path && !url.search && response.request().method() === method;
  };
  let browser, context, page, writePermit = null;
  let loginAttempted = false, expectDeletedProject = false;
  const heartbeat = setInterval(() => console.log(`WAIT ${phase}`), 30000);
  async function allowWrite(method, path, action) {
    check(writePermit === null, 'Overlapping write permissions are forbidden.');
    writePermit = { method, path };
    try { return await action(); }
    finally { writePermit = null; }
  }
  async function api(target, path, { method = 'GET', body, status = 200 } = {}) {
    check(/^\/api\/v1\/[A-Za-z0-9/_-]+$/.test(path), 'Invalid acceptance API path.');
    const result = await target.evaluate(async ({ expectedOrigin, path, method, body }) => {
      if (location.origin !== expectedOrigin) throw new Error('Browser left the configured origin.');
      const response = await fetch(path, { method, credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
        signal: AbortSignal.timeout(30000),
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      return { status: response.status, value: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null,
        requestId: response.headers.get('x-request-id') };
    }, { expectedOrigin: origin.origin, path, method, body });
    const requestId = /^[A-Za-z0-9_-]{1,120}$/.test(result.requestId ?? '') ? ` requestId=${result.requestId}` : '';
    check(result.status === status, `${method} ${path}: expected HTTP ${status}, received ${result.status}.${requestId}`);
    return result.value;
  }
  function observe(target) {
    target.on('pageerror', error => { audit.pageErrors.push({ phase, name: ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(error.name) ? error.name : 'Error', fingerprint: sha(error.message) }); persist(); });
    target.on('response', response => {
      const url = new URL(response.url());
      if (response.status() < 400 || (url.origin === origin.origin && url.pathname === '/api/v1/auth/me' && response.status() === 401)
        || (expectDeletedProject && url.origin === origin.origin && url.pathname === projectPath() && response.status() === 404)) return;
      audit.httpErrors.push({ phase, status: response.status(), method: response.request().method(), path: safePath(response.url()) }); persist();
    });
  }
  try {
    const modulePath = process.env.DTWIN_PLAYWRIGHT_MODULE;
    const { chromium } = await import(modulePath ? isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath : 'playwright');
    browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome', headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    context.setDefaultTimeout(30000); context.setDefaultNavigationTimeout(45000);
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url()); const method = request.method();
      const sameOrigin = url.origin === origin.origin;
      let allowed = sameOrigin && ['GET', 'HEAD'].includes(method);
      if (sameOrigin && !url.search && writePermit?.method === method && writePermit.path === url.pathname) {
        const auth = method === 'POST' && ['/api/v1/auth/login', '/api/v1/auth/logout'].includes(url.pathname);
        const own = uuid(fixture.id) && ((method === 'PATCH' && url.pathname === scenePath())
          || (method === 'DELETE' && url.pathname === projectPath() && fixture.status === 'deleting'));
        let create = false;
        if (method === 'POST' && url.pathname === '/api/v1/projects' && fixture.status === 'creating') {
          const body = request.postDataJSON();
          create = body?.name === runId && body?.projectType === '3d' && Object.keys(body).length === 2;
        }
        allowed = auth || own || create;
        if (allowed) { audit.allowedWrites.push({ method, path: url.pathname, phase }); persist(); }
      }
      if (allowed) return route.continue();
      audit.blockedRequests.push({ method, path: safePath(request.url()), phase }); persist();
      await route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => {
      audit.blockedRequests.push({ method: 'WEBSOCKET', path: '[WebSocket blocked]', phase }); persist();
      socket.close({ code: 1008, reason: 'Temporary model library verification forbids live channels' });
    });
    page = await context.newPage(); observe(page);
    phase = 'administrator login without visiting project cover queue';
    const landing = await page.goto(`${origin.origin}/#/resources`, { waitUntil: 'domcontentloaded' });
    check(landing?.status() === 200, 'Deployment did not return HTTP 200.');
    const capabilities = await page.evaluate(() => ({ origin: location.origin, secure: isSecureContext,
      randomUUID: typeof globalThis.crypto?.randomUUID, getRandomValues: typeof globalThis.crypto?.getRandomValues }));
    audit.browser = capabilities; persist();
    check(capabilities.origin === origin.origin && !capabilities.secure && capabilities.randomUUID === 'undefined' && capabilities.getRandomValues === 'function',
      'Browser did not reach the expected ordinary public HTTP context.');
    await page.getByLabel('账号', { exact: true }).fill(identifier);
    await page.getByLabel('密码', { exact: true }).fill(admin.password);
    loginAttempted = true;
    const loginResponse = await allowWrite('POST', '/api/v1/auth/login', async () => {
      const [response] = await Promise.all([
        page.waitForResponse(response => responseMatches(response, '/api/v1/auth/login', 'POST')),
        page.getByRole('button', { name: '登录平台', exact: true }).click(),
      ]);
      return response;
    });
    check(loginResponse.status() === 200, 'Administrator login failed.');
    check((await loginResponse.json()).user?.roles?.includes('platform_admin'), 'Administrator role was not confirmed.');
    await page.locator('#resources').waitFor({ state: 'visible' });
    assertClean(); passed('isolated administrator session on real public HTTP');

    phase = 'create one uniquely identified temporary 3D project';
    fixture.status = 'creating'; persist();
    const created = await allowWrite('POST', '/api/v1/projects', () => api(page, '/api/v1/projects', {
      method: 'POST', status: 201, body: { name: runId, projectType: '3d' },
    }));
    check(uuid(created.project?.id), 'Temporary project creation returned an invalid UUID.');
    fixture.id = created.project.id; fixture.status = 'created'; persist();
    check(created.project.name === runId && created.project.projectType === '3d', 'Created project metadata differs from this run.');
    const initial = await api(page, scenePath());
    check(initial.sceneExtensionsVersion === 1 && initial.editable === true && initial.scene?.projectId === fixture.id,
      'Temporary project does not expose editable scene extensions.');
    check(initial.scene.instances.length === 0 && !(initial.scene.decorations?.length) && !(initial.scene.fluids?.length)
      && !(initial.scene.roomAlarms?.length) && !initial.scene.staticMap && !initial.scene.linked2dProjectId,
    'New temporary project must start empty and without external scene links.');
    // Fix only this fixture's view so pixel-based X-axis dragging is repeatable.
    await allowWrite('PATCH', scenePath(), () => api(page, scenePath(), { method: 'PATCH', body: {
      expectedRevision: initial.scene.revision, upsertInstances: [], deleteInstanceIds: [],
      settings: { ...initial.scene.settings, cameraView: 'front', autoRotate: false, playAnimations: false, showGrid: false },
    } }));
    const assets = (await api(page, `${projectPath()}/model-assets`)).modelAssets;
    check(Array.isArray(assets), 'Existing model catalog is invalid.');
    const legacy = assets.filter(asset => asset.source === 'system' && asset.format === 'glb' && asset.id.startsWith('builtin:')
      && Number.isSafeInteger(asset.byteSize) && asset.byteSize > 0 && asset.byteSize <= 4 * 1024 * 1024
      && asset.inspection?.meshCount > 0 && asset.inspection.externalResourceCount === 0)
      .sort((a, b) => a.byteSize - b.byteSize || a.id.localeCompare(b.id))[0];
    check(legacy, 'No existing lightweight self-contained built-in GLB is available for compatibility verification.');
    fixture.legacyModelAssetId = legacy.id; fixture.legacyModelBytes = legacy.byteSize; persist();

    phase = 'classified model library and seven UI-created objects';
    await page.goto(`${origin.origin}/#/projects/${fixture.id}/scene`, { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('.standalone-3d-stage .model-3d-renderer canvas');
    const panel = page.getByRole('region', { name: '场景扩展属性' });
    const toolbar = page.getByRole('toolbar', { name: '模型变换工具' });
    const ready = async ({ allowEmpty = false } = {}) => {
      await canvas.waitFor({ state: 'visible' });
      const states = allowEmpty ? ':is([data-cover-state="ready"], [data-cover-state="empty"])' : '[data-cover-state="ready"]';
      await page.locator(`.standalone-3d-stage .model-3d-node${states}`).waitFor({ state: 'visible', timeout: 90000 });
      check(await page.locator('.model-3d-message.is-error').count() === 0, 'Scene renderer exposes an error state.');
    };
    const rendered = async () => {
      await ready();
      await page.waitForFunction(() => {
        const raw = document.querySelector('.standalone-3d-stage [data-scene-diagnostics]')?.getAttribute('data-scene-diagnostics');
        return raw && JSON.parse(raw).activeLoads === 0 && JSON.parse(raw).drawCalls > 0;
      }, null, { timeout: 90000 });
    };
    const library = () => page.getByRole('button', { name: /^模型库/ }).click();
    const category = name => page.getByRole('group', { name: '模型分类', exact: true })
      .getByRole('button', { name: new RegExp('^' + name + '\\s*\\d+$') }).click();
    const save = async () => {
      const response = await allowWrite('PATCH', scenePath(), async () => {
        const [result] = await Promise.all([
          page.waitForResponse(response => responseMatches(response, scenePath(), 'PATCH')),
          page.getByRole('button', { name: '保存场景', exact: true }).click(),
        ]);
        return result;
      });
      check(response.status() === 200, 'UI scene save did not return HTTP 200.');
      await page.getByRole('button', { name: '已保存', exact: true }).waitFor({ state: 'visible' });
      const saved = (await api(page, scenePath())).scene;
      equal(saved, (await response.json()).scene, 'Save response and independent API readback');
      assertClean();
      return saved;
    };
    const selectDecoration = async (id, label) => {
      await page.getByRole('button', { name: /^图层/ }).click();
      await page.locator(`[data-decoration-id="${id}"] .standalone-layer-main`).click();
      await panel.getByLabel('位置 X', { exact: true }).waitFor({ state: 'visible' });
      await page.waitForFunction(expected => [...document.querySelectorAll('.scene-extras label')]
        .find(item => item.querySelector('span')?.textContent === '名称')?.querySelector('input')?.value === expected, label);
    };
    // Same real screenshot/threshold strategy as test-model-library-browser.mjs.
    // Decode in a detached canvas to avoid an additional PNG package dependency.
    const redHandle = async () => {
      await page.mouse.move(2, 2); await page.waitForTimeout(120);
      const bounds = await canvas.boundingBox(); const overlay = await toolbar.boundingBox();
      check(bounds && bounds.width > 0 && bounds.height > 0, 'Canvas bounds are unavailable.');
      const tip = await page.evaluate(async ({ encoded, bounds, overlay }) => {
        const image = new Image();
        const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Screenshot decode failed.')); });
        image.src = `data:image/png;base64,${encoded}`; await loaded;
        const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height;
        const drawing = scratch.getContext('2d'); drawing.drawImage(image, 0, 0);
        const rgba = drawing.getImageData(0, 0, image.width, image.height).data;
        const pixels = [];
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const screenX = bounds.x + x * bounds.width / image.width; const screenY = bounds.y + y * bounds.height / image.height;
          if (overlay && screenX >= overlay.x && screenX <= overlay.x + overlay.width && screenY >= overlay.y && screenY <= overlay.y + overlay.height) continue;
          const at = (y * image.width + x) * 4; const [r, g, b] = rgba.subarray(at, at + 3);
          if (r > 170 && g < 105 && b < 105 && r > g * 1.8 && r > b * 1.8) pixels.push({ x: screenX, y: screenY });
        }
        if (pixels.length < 5) return null;
        const end = pixels.reduce((max, point) => Math.max(max, point.x), -Infinity);
        const tip = pixels.filter(point => point.x >= end - 6);
        return { x: tip.reduce((sum, point) => sum + point.x, 0) / tip.length,
          y: tip.reduce((sum, point) => sum + point.y, 0) / tip.length, pixels: pixels.length };
      }, { encoded: (await canvas.screenshot()).toString('base64'), bounds, overlay });
      check(tip, 'Selected object did not render a visible red X transform handle.');
      return tip;
    };
    const dragX = async (mode, distance) => {
      await toolbar.getByRole('button', { name: mode === 'scale' ? /缩放/ : /移动/ }).click();
      const label = mode === 'scale' ? '缩放 X' : '位置 X'; const field = panel.getByLabel(label, { exact: true });
      const before = Number(await field.inputValue()); const start = await redHandle();
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x + distance, start.y, { steps: 15 }); await page.mouse.up();
      await page.waitForFunction(({ label, before }) => {
        const field = document.querySelector(`.scene-extras input[aria-label="${label}"]`)
          ?? [...document.querySelectorAll('.scene-extras label')].find(item => item.textContent.trim() === label)?.querySelector('input');
        return field && Math.abs(Number(field.value) - before) > .0001;
      }, { label, before });
      const after = Number(await field.inputValue());
      check(Number.isFinite(after) && Math.abs(after - before) > .0001, 'Real pointer drag did not change the selected transform.');
      return { before, after, start, distance };
    };
    const screenshot = async filename => {
      const bytes = await page.locator('.standalone-3d-editor').screenshot({ animations: 'disabled' });
      writeFileSync(join(output, filename), bytes, { flag: 'wx', mode: 0o600 });
      audit.screenshots.push({ filename, sha256: sha(bytes) }); persist();
    };
    await ready({ allowEmpty: true }); await library();
    const groups = [
      ['植物', [['tree', '乔木'], ['shrub', '灌木']]],
      ['水景', [['river', '河流']]],
      ['军事模型', [['military-truck', '运输车'], ['military-tent', '帐篷'], ['military-radar', '雷达'], ['military-armored', '装甲车']]],
    ];
    for (const label of ['全部', '工业模型', '植物', '水景', '军事模型', '上传模型', '背景模型']) {
      check(await page.getByRole('group', { name: '模型分类' }).getByRole('button', { name: new RegExp('^' + label + '\\s*\\d+$') }).isVisible(), 'A required model library category is missing.');
    }
    for (const [label, items] of groups) {
      await category(label);
      equal(await page.locator('[data-decoration-kind]').evaluateAll(cards => cards.map(card => card.dataset.decorationKind).sort()), items.map(([kind]) => kind).sort(), 'Filtered procedural category');
      for (const [, name] of items) check(await page.getByRole('button', { name: `加入场景 ${name}`, exact: true }).isVisible(), 'A categorized add-model action is missing.');
    }
    await category('工业模型');
    check(await page.locator(`[data-model-asset-id="${legacy.id}"]`).count() === 1, 'Existing GLB is missing from the industrial model category.');
    passed('all seven categories and their procedural/industrial model membership');
    await category('全部');
    const items = groups.flatMap(([, entries]) => entries);
    for (const [index, [kind, name]] of items.entries()) {
      await page.getByRole('button', { name: `加入场景 ${name}`, exact: true }).click();
      await panel.getByLabel('名称', { exact: true }).fill(`验收${name}`);
      // Keep the other objects away from the representative tree's red gizmo.
      await panel.getByLabel('位置 X', { exact: true }).fill(String(index === 0 ? 0 : 20 + index * 12));
      check(await toolbar.getByRole('button', { name: /移动/ }).isEnabled(), `Created ${kind} cannot enable transform controls.`);
    }
    await rendered();
    const initialSaved = await save();
    check(initialSaved.instances.length === 0 && initialSaved.decorations.length === 7, 'Seven UI additions were not persisted as independent decorations.');
    equal(initialSaved.decorations.map(item => item.kind).sort(), items.map(([kind]) => kind).sort(), 'All seven persisted kinds');
    check(initialSaved.decorations.every(item => uuid(item.id)) && new Set(initialSaved.decorations.map(item => item.id)).size === 7,
      'HTTP-created decorations must have distinct UUID v4 identities.');
    audit.decorationIds = initialSaved.decorations.map(item => ({ id: item.id, kind: item.kind })); persist();
    passed('all seven objects created through the new library and verified by real API readback');

    phase = 'real tree gizmo translation and scale';
    const tree = initialSaved.decorations.find(item => item.kind === 'tree');
    await selectDecoration(tree.id, tree.label);
    audit.treeMove = await dragX('translate', 45);
    audit.treeScale = await dragX('scale', 28);
    check(audit.treeScale.after >= .001 && audit.treeScale.after <= 100, 'Tree scale escaped its contract bounds.');
    equal((await api(page, scenePath())).scene, initialSaved, 'Dragging must leave the saved document unchanged until Save');
    const transformed = await save();
    const savedTree = transformed.decorations.find(item => item.id === tree.id);
    check(savedTree.transform.position[0] === audit.treeMove.after && savedTree.transform.scale[0] === audit.treeScale.after,
      'Tree pointer transforms did not persist exactly.');
    equal(transformed.decorations.filter(item => item.id !== tree.id), initialSaved.decorations.filter(item => item.id !== tree.id), 'Other temporary objects after tree transforms');
    await rendered(); await redHandle();
    await library(); await category('全部'); await redHandle();
    await screenshot('temporary-tree-transformed.png');
    await page.reload({ waitUntil: 'domcontentloaded' }); await rendered(); await selectDecoration(tree.id, tree.label);
    check(Number(await panel.getByLabel('位置 X', { exact: true }).inputValue()) === savedTree.transform.position[0]
      && Number(await panel.getByLabel('缩放 X', { exact: true }).inputValue()) === savedTree.transform.scale[0],
    'Reloaded tree properties differ from the saved pointer transforms.');
    equal((await api(page, scenePath())).scene, transformed, 'Reloaded persisted scene');
    passed('real canvas translation and scaling update properties, require Save, and survive refresh');

    phase = 'existing GLB add and save compatibility';
    await library(); await category('工业模型');
    await page.locator(`[data-model-asset-id="${legacy.id}"]`).getByRole('button', { name: /^加入场景 / }).click();
    await rendered();
    const withGlb = await save();
    check(withGlb.instances.length === 1, 'Existing GLB did not persist exactly one scene instance.');
    check(withGlb.instances[0].id.startsWith('scene-') && uuid(withGlb.instances[0].id.slice(6)),
      'Existing GLB instance did not retain the scene-prefixed UUID v4 contract.');
    check(withGlb.instances[0].modelAssetId === legacy.id, 'Existing GLB instance points to a different model resource.');
    equal(withGlb.decorations, transformed.decorations, 'Procedural objects after existing GLB save');
    fixture.legacyInstanceId = withGlb.instances[0].id; audit.finalRevision = withGlb.revision;
    audit.finalSceneSha256 = sha(canonical(withGlb)); persist();
    await page.reload({ waitUntil: 'domcontentloaded' }); await rendered();
    equal((await api(page, scenePath())).scene, withGlb, 'Scene after GLB refresh');
    await page.getByRole('button', { name: /^图层/ }).click();
    check(await page.locator(`[data-instance-id="${fixture.legacyInstanceId}"]`).count() === 1
      && await page.locator('[data-decoration-id]').count() === 7, 'Reloaded layer list lost persisted instances.');
    await library(); await category('全部');
    await screenshot('temporary-model-library.png');
    assertClean(); passed('existing built-in GLB adds, saves and refreshes alongside all seven objects without pageerror');
  } catch (error) {
    failure(phase, error);
  } finally {
    // Stop the mounted editor before deletion/logout, retaining only this isolated
    // context's cookie in a plain same-origin health document for cleanup.
    if (page && !page.isClosed()) {
      try { await page.close({ runBeforeUnload: false }); }
      catch (error) { failure('stop temporary editor', error); }
    }
    if (context && loginAttempted) {
      let cleanupPage;
      phase = 'precise temporary project cleanup';
      try {
        cleanupPage = await context.newPage(); observe(cleanupPage);
        await cleanupPage.goto(`${origin.origin}/health`, { waitUntil: 'domcontentloaded' });
        // If create reached the backend but its response was lost, recover only
        // the unique run name. Never guess an ID or delete an existing project.
        if (fixture.status === 'creating' && !fixture.id) {
          const projects = (await api(cleanupPage, '/api/v1/projects')).projects;
          check(Array.isArray(projects), 'Cleanup could not read project identities.');
          const matches = projects.filter(item => item.name === runId);
          check(matches.length <= 1, 'Cleanup refused ambiguous matching project names.');
          if (matches.length === 1) {
            check(uuid(matches[0].id) && matches[0].projectType === '3d', 'Recovered fixture identity or type is invalid.');
            fixture.id = matches[0].id; fixture.status = 'created'; persist();
          } else { fixture.status = 'not-created'; persist(); }
        }
        if (fixture.id) {
          const current = await api(cleanupPage, projectPath());
          check(current.project?.id === fixture.id && current.project.name === runId && current.project.projectType === '3d',
            'Cleanup refused a project whose ID, unique run name or type no longer matches.');
          fixture.status = 'deleting'; persist();
          const deleted = await allowWrite('DELETE', projectPath(), () => api(cleanupPage, projectPath(), { method: 'DELETE' }));
          check(deleted.deletedProjectId === fixture.id && !deleted.warning, 'Temporary project deletion was not confirmed.');
          expectDeletedProject = true;
          await api(cleanupPage, projectPath(), { status: 404 });
          fixture.status = 'deleted'; fixture.deletedAt = new Date().toISOString(); persist();
          passed('only this run temporary project deleted and API absence confirmed');
        }
      } catch (error) { failure(phase, error); }
      phase = 'revoke only the isolated acceptance session';
      try {
        check(cleanupPage && !cleanupPage.isClosed(), 'No same-origin cleanup page is available to revoke the session.');
        await allowWrite('POST', '/api/v1/auth/logout', () => api(cleanupPage, '/api/v1/auth/logout', { method: 'POST', status: 204 }));
        const anonymous = await api(cleanupPage, '/api/v1/auth/me', { status: 401 });
        check(anonymous?.error === 'unauthenticated', 'Session revocation did not restore anonymous access.');
        audit.sessionRevoked = true; passed('isolated session revoked and anonymous access confirmed');
      } catch (error) { failure(phase, error); }
    }
    if (browser) {
      try { await browser.close(); }
      catch (error) { failure('browser shutdown', error); }
    }
    clearInterval(heartbeat);
    audit.status = audit.failures.length || audit.pageErrors.length || audit.blockedRequests.length || audit.httpErrors.length
      || fixture.status !== 'deleted' || !audit.sessionRevoked ? 'failed' : 'passed';
    audit.finishedAt = new Date().toISOString(); persist();
    console.log(`AUDIT ${auditFile}`);
    console.log(`${audit.status.toUpperCase()} ${audit.checks.length} checks; fixture=${fixture.status}; sessionRevoked=${audit.sessionRevoked}`);
    if (audit.status !== 'passed') process.exitCode = 1;
  }
}
main().catch(error => {
  console.error(error instanceof AcceptanceError ? error.message : 'Model library acceptance could not initialize; inspect the authorized configuration and dependencies.');
  process.exitCode = 1;
});
