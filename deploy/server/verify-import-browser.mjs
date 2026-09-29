// Node 22+. Run only after migration completion against the real public deployment.
// Required: DTWIN_ORIGIN, DTWIN_ADMIN_FILE (0600), DTWIN_IMPORT_BUNDLE,
// DTWIN_IMPORT_2D_PROJECT_ID, DTWIN_IMPORT_3D_PROJECT_ID.
// Optional: DTWIN_IMPORT_RESOURCE_PROJECT_ID (defaults to the 2D project),
// DTWIN_IMPORT_BROWSER_AUDIT_DIR, DTWIN_PLAYWRIGHT_MODULE, DTWIN_BROWSER_CHANNEL.
// Only login/logout POSTs are permitted. All business writes, external requests and
// WebSockets are blocked and fail the run. Never open an editor or trigger collection.
// Private screenshots contain business views only; no credentials, cookies, response
// bodies, traces, console text or signed URLs are exported.
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.umask(0o077);
class AcceptanceError extends Error {}
const check = (condition, message) => { if (!condition) throw new AcceptanceError(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const equal = (actual, expected, label) => check(canonical(actual) === canonical(expected), `${label}: mismatch.`);
function jsonFile(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new AcceptanceError(`${label}: could not read valid JSON.`); }
}
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
  check(origin.origin === process.env.DTWIN_ORIGIN && ['http:', 'https:'].includes(origin.protocol),
    'DTWIN_ORIGIN must be an exact HTTP(S) origin without credentials, path or trailing slash.');
  check(!['localhost', '[::1]', '0.0.0.0'].includes(origin.hostname)
    && !origin.hostname.endsWith('.localhost') && !origin.hostname.startsWith('127.'),
  'Acceptance must use the real public origin, without a localhost or browser-security override.');
  check(process.env.DTWIN_IMPORT_BUNDLE, 'DTWIN_IMPORT_BUNDLE is required.');
  const bundle = resolve(process.env.DTWIN_IMPORT_BUNDLE);
  const manifest = jsonFile(join(bundle, 'manifest.json'), 'Manifest');
  const business = readFileSync(join(bundle, 'business.json'));
  check(manifest.version === 1 && manifest.businessSha256 === sha(business), 'Source snapshot checksum mismatch.');
  let tables;
  try { tables = JSON.parse(business).tables; }
  catch { throw new AcceptanceError('Source business snapshot is invalid.'); }
  for (const name of ['projects', 'documents', 'document_items', 'project_covers', 'resources', 'assets', 'data_bindings', 'twin_drive_documents']) {
    check(Array.isArray(tables?.[name]) && tables[name].length === manifest.counts?.[name], 'Source snapshot table count mismatch.');
  }
  check(tables.projects.length === 18 && tables.resources.length === 70, 'Expected the reviewed 18-project, 70-resource import snapshot.');
  check(tables.projects.every(p => uuid(p.id)) && new Set(tables.projects.map(p => p.id)).size === tables.projects.length,
    'Source project identities are invalid or duplicated.');
  const forProject = (table, id) => tables[table].filter(row => row.project_id === id);
  function sampleProject(env, type) {
    const id = process.env[env];
    check(uuid(id), `${env} must identify a reviewed snapshot project.`);
    const project = tables.projects.find(p => p.id === id);
    check(project?.project_type === type, `${env}: project type does not match.`);
    check(['assets', 'data_bindings', 'twin_drive_documents'].every(table => forProject(table, id).length === 0),
      `${env}: choose a visual sample without live assets, bindings or TwinDrive.`);
    return project;
  }
  const project2d = sampleProject('DTWIN_IMPORT_2D_PROJECT_ID', '2d');
  const project3d = sampleProject('DTWIN_IMPORT_3D_PROJECT_ID', '3d');
  const nodes = forProject('document_items', project2d.id).map(row => row.body);
  check(nodes.length >= 10 && nodes.every(node => Array.isArray(node.resourceRefs) && node.resourceRefs.length === 0
    && !['scene-3d', 'model-3d'].includes(node.type)), '2D sample must be a populated, self-contained dashboard.');
  const instances = forProject('document_items', project3d.id).map(row => row.body);
  check(instances.length > 0 && instances.length <= 4 && instances.every(item => item.modelAssetId?.startsWith('builtin:')),
    '3D sample must contain one to four reviewed small built-in model instances.');
  const sceneDocument = forProject('documents', project3d.id)[0];
  check(sceneDocument && ['fluids', 'decorations', 'roomAlarms'].every(key => !sceneDocument.settings[key]?.length)
    && !sceneDocument.settings.staticMap, '3D sample must not require additional scene extensions.');
  if (sceneDocument.linked_project_id) {
    const linked = sceneDocument.linked_project_id;
    check(['assets', 'data_bindings', 'twin_drive_documents'].every(table => forProject(table, linked).length === 0)
      && forProject('document_items', linked).every(item => !item.body.resourceRefs?.length && !['scene-3d', 'model-3d'].includes(item.body.type)),
    'Linked dashboard must not load live data or additional models.');
  }
  const resourceProjectId = process.env.DTWIN_IMPORT_RESOURCE_PROJECT_ID || project2d.id;
  const resourceProject = tables.projects.find(p => p.id === resourceProjectId);
  const resourceRows = forProject('resources', resourceProjectId);
  check(resourceProject && resourceRows.length > 0 && resourceRows.every(r => r.state === 'ready'),
    'Resource sample must contain ready imported resources.');

  check(process.env.DTWIN_ADMIN_FILE, 'DTWIN_ADMIN_FILE is required.');
  const adminFile = resolve(process.env.DTWIN_ADMIN_FILE);
  const stat = lstatSync(adminFile);
  check(stat.isFile() && (stat.mode & 0o777) === 0o600, 'Administrator file must be a regular 0600 file, not a symlink.');
  const admin = jsonFile(adminFile, 'Administrator file');
  const identifier = admin?.identifier ?? admin?.loginName ?? admin?.email;
  check(typeof identifier === 'string' && identifier.length > 0 && typeof admin.password === 'string' && admin.password.length > 0,
    'Administrator file requires identifier and password.');

  const auditRoot = resolve(process.env.DTWIN_IMPORT_BROWSER_AUDIT_DIR || fileURLToPath(new URL('./.local', import.meta.url)));
  privateDirectory(auditRoot);
  const runId = `import-browser-${randomUUID()}`;
  const output = join(auditRoot, runId);
  privateDirectory(output);
  const auditFile = join(output, 'results.json');
  const audit = { runId, origin: origin.origin, startedAt: new Date().toISOString(), status: 'running',
    sourceSha256: manifest.businessSha256, samples: { canvas: project2d.id, scene: project3d.id, resources: resourceProjectId },
    checks: [], screenshots: [], blockedRequests: [], httpErrors: [], pageErrors: [], consoleErrorCount: 0, failures: [] };
  writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const persist = () => writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  const passed = name => { audit.checks.push(name); persist(); console.log(`PASS ${name}`); };
  let phase = 'launch';
  // Only controlled assertion text is exported. Playwright errors may include DOM,
  // credential input values, response bodies or signed URLs in their call logs.
  const failure = (stage, error) => {
    const message = error instanceof AcceptanceError ? error.message : error?.name === 'TimeoutError'
      ? 'Timed out in the named acceptance phase.' : 'Execution failed in the named acceptance phase.';
    audit.failures.push({ phase: stage, message }); persist(); console.error(`FAIL ${stage}: ${message}`);
  };
  const safePath = value => {
    const url = new URL(value);
    return url.origin === origin.origin && /^\/[A-Za-z0-9._:/%-]*$/.test(url.pathname) ? url.pathname : '[external-or-redacted]';
  };
  const assertClean = () => {
    check(audit.pageErrors.length === 0, 'Browser raised a pageerror; see the private diagnostic fingerprint.');
    check(audit.blockedRequests.length === 0, 'Read-only guard blocked an unexpected write, WebSocket or external request.');
    check(audit.httpErrors.length === 0, 'Browser received an unexpected failing HTTP response.');
  };
  let browser, context, page;
  let loginAttempted = false;
  let allowAuthenticationPost = null;
  const heartbeat = setInterval(() => console.log(`WAIT ${phase}`), 30000);
  async function api(path, expectedStatus = 200, method = 'GET') {
    check(/^\/api\/v1\/[a-zA-Z0-9/_-]+$/.test(path), 'Invalid acceptance API path.');
    check(method === 'GET' || (method === 'POST' && path === '/api/v1/auth/logout'), 'Acceptance helper forbids business writes.');
    const result = await page.evaluate(async ({ path, method }) => {
      const response = await fetch(path, { method, mode: 'same-origin', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(30000) });
      return { status: response.status, value: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null };
    }, { path, method });
    check(result.status === expectedStatus, `API check expected HTTP ${expectedStatus}, received ${result.status}.`);
    return result.value;
  }
  async function navigate(hash, selector) {
    await page.evaluate(value => { location.hash = value; }, hash);
    await page.locator(selector).waitFor({ state: 'visible' });
  }
  async function screenshot(name, locator, requirePicture = false) {
    const bytes = await locator.screenshot({ animations: 'disabled', timeout: 30000 });
    const pixels = await page.evaluate(async encoded => {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Screenshot decode failed.')); });
      image.src = `data:image/png;base64,${encoded}`;
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Map();
      for (let i = 0; i < rgba.length; i += 16) {
        const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
        colors.set(key, (colors.get(key) || 0) + 1);
      }
      return { width: image.width, height: image.height, colors: colors.size,
        variedRatio: 1 - Math.max(...colors.values()) / Math.ceil(rgba.length / 16) };
    }, bytes.toString('base64'));
    check(pixels.width >= 200 && pixels.height >= 100, 'Screenshot target has no meaningful dimensions.');
    if (requirePicture) check(pixels.colors >= 16 && pixels.variedRatio >= 0.03, 'Rendered scene screenshot is blank or nearly uniform.');
    const filename = `${name}.png`;
    writeFileSync(join(output, filename), bytes, { flag: 'wx', mode: 0o600 });
    audit.screenshots.push({ filename, sha256: sha(bytes), ...pixels }); persist();
  }
  const revisions = projects => projects.map(p => ({ id: p.id, documentRevision: p.documentRevision,
    coverRevision: p.coverRevision, coverSourceRevision: p.coverSourceRevision, coverStatus: p.coverStatus })).sort((a, b) => a.id.localeCompare(b.id));
  let before;
  try {
    const module = process.env.DTWIN_PLAYWRIGHT_MODULE
      || '/Users/doudou/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
    const { chromium } = await import(isAbsolute(module) ? pathToFileURL(module).href : module);
    browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome', headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    context.setDefaultTimeout(30000);
    context.setDefaultNavigationTimeout(45000);
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const auth = request.method() === 'POST' && url.pathname === allowAuthenticationPost && !url.search;
      if (url.origin === origin.origin && (['GET', 'HEAD'].includes(request.method()) || auth)) return route.continue();
      audit.blockedRequests.push({ method: request.method(), path: safePath(request.url()) }); persist();
      await route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', async socket => {
      audit.blockedRequests.push({ method: 'WEBSOCKET', path: '[WebSocket blocked]' }); persist();
      await socket.close({ code: 1008, reason: 'Read-only acceptance forbids live channels' });
    });
    page = await context.newPage();
    page.on('pageerror', error => { audit.pageErrors.push({ phase, fingerprint: sha(String(error.message)),
      name: ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(error.name) ? error.name : 'Error' }); persist(); });
    page.on('console', message => { if (message.type() === 'error') audit.consoleErrorCount += 1; });
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.status() < 400 || (url.pathname === '/api/v1/auth/me' && response.status() === 401)) return;
      audit.httpErrors.push({ phase, status: response.status(), method: response.request().method(), path: safePath(response.url()) }); persist();
    });
    phase = 'administrator login through resources route';
    const landing = await page.goto(`${origin.origin}/#/resources`, { waitUntil: 'domcontentloaded' });
    check(landing?.status() === 200, 'Deployment homepage did not return HTTP 200.');
    await page.getByLabel('账号', { exact: true }).fill(identifier);
    await page.getByLabel('密码', { exact: true }).fill(admin.password);
    loginAttempted = true;
    allowAuthenticationPost = '/api/v1/auth/login';
    const [loginResponse] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/auth/login' && r.request().method() === 'POST'),
      page.getByRole('button', { name: '登录平台', exact: true }).click(),
    ]);
    allowAuthenticationPost = null;
    check(loginResponse.status() === 200, 'Administrator login failed.');
    const identity = await loginResponse.json();
    check(identity.user?.roles?.includes('platform_admin'), 'Administrator identity was not confirmed.');
    await page.locator('#resources').waitFor({ state: 'visible' });
    assertClean(); passed('administrator login succeeds without visiting the automatic cover queue');

    phase = 'project and cover preflight';
    const projects = (await api('/api/v1/projects')).projects;
    check(Array.isArray(projects), 'Project list response is invalid.');
    equal(projects.map(p => p.id).sort(), tables.projects.map(p => p.id).sort(), 'All 18 project identities');
    for (const project of projects) {
      const source = tables.projects.find(p => p.id === project.id);
      const doc = forProject('documents', project.id)[0];
      check(project.name === source.name && project.projectType === source.project_type, 'Imported project identity or type differs.');
      check(project.coverStatus === 'ready' && project.coverSourceRevision === doc.revision && project.documentRevision === doc.revision,
        'A cover is pending or stale; project list navigation is unsafe for read-only acceptance.');
      check(typeof project.coverUrl === 'string' && project.coverUrl.length > 0, 'Imported cover URL is missing.');
    }
    before = revisions(projects);
    passed('18 project identities and ready current covers pass the read-only preflight');

    phase = 'project list and 18 rendered covers';
    await navigate('/projects', '#project-list-panel');
    for (const type of ['2d', '3d']) {
      await page.locator(`#project-type-tab-${type}`).click();
      const expected = tables.projects.filter(p => p.project_type === type);
      await page.waitForFunction(count => document.querySelectorAll('#project-list-panel .project-card').length === count, expected.length);
      for (const project of expected) {
        const card = page.locator('#project-list-panel .project-card').filter({ has: page.locator(`a[href="#/projects/${project.id}/${type === '2d' ? 'preview' : 'scene-preview'}"]`) });
        check(await card.count() === 1, 'Imported project is missing or duplicated in the displayed tab.');
        const cover = card.locator('.project-card-cover img');
        await cover.scrollIntoViewIfNeeded();
        await cover.evaluate(image => image.decode());
        check(await cover.evaluate(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), 'Project cover failed to render.');
      }
      await screenshot(`projects-${type}`, page.locator('#project-list-panel'));
      assertClean(); passed(`${expected.length} ${type.toUpperCase()} project cards and covers render`);
    }

    phase = 'template gallery and read-only case preview';
    await navigate('/templates', '#templates');
    await page.locator('#template-kind-2d').click();
    check(await page.locator('#template-panel-2d .template-card').count() > 0, '2D template gallery is empty.');
    await page.locator('#template-panel-2d .template-card-visual').first().click();
    const dialog = page.locator('dialog.template-detail-dialog');
    await dialog.waitFor({ state: 'visible' });
    await screenshot('template-case', dialog, true);
    await dialog.getByRole('button', { name: '关闭案例预览', exact: true }).click();
    await page.locator('#template-kind-3d').click();
    check(await page.locator('#template-panel-3d .scene-template-card').count() > 0, '3D template gallery is empty.');
    await screenshot('templates-3d', page.locator('#template-panel-3d'));
    assertClean(); passed('2D case preview and 3D template gallery render without creating projects');

    phase = 'imported resource cards';
    await navigate('/resources', '#resources');
    const select = page.locator('.resource-project-select [role="combobox"]');
    await select.click();
    const options = page.getByRole('option');
    check(await options.count() === tables.projects.length, 'Resource project selector does not list all imported projects.');
    await options.filter({ has: page.getByText(resourceProject.name, { exact: true }) }).click();
    const grid = page.locator('[aria-label="资源列表"]');
    await grid.waitFor({ state: 'visible' });
    for (const row of resourceRows) {
      check(typeof row.filename === 'string' && row.filename.length > 0, 'Source resource filename is missing.');
      await grid.getByRole('heading', { name: row.filename, exact: true }).first().waitFor({ state: 'visible' });
    }
    const uploadedNames = await grid.locator('.resource-card').evaluateAll(cards => cards
      .filter(card => Array.from(card.querySelectorAll('.resource-card-tags span')).some(tag => tag.textContent === '项目上传'))
      .map(card => card.querySelector('h2')?.getAttribute('title')).sort());
    equal(uploadedNames, resourceRows.map(row => row.filename).sort(), 'Imported resource filename multiset');
    await screenshot('resources', grid);
    assertClean(); passed(`${resourceRows.length} imported resource cards visible in the selected project`);

    phase = 'representative 2D dashboard render';
    const canvasBefore = (await api(`/api/v1/projects/${project2d.id}/canvas`)).canvas;
    equal(canvasBefore.nodes.map(n => n.id).sort(), nodes.map(n => n.id).sort(), '2D node identities');
    await navigate(`/projects/${project2d.id}/preview`, '.canvas-page-preview .canvas-surface.is-preview');
    const canvas2d = page.locator('.canvas-page-preview .canvas-surface.is-preview');
    const actualNodes = await canvas2d.locator('.canvas-node[data-node-id]').evaluateAll(elements => elements.map(e => e.dataset.nodeId));
    equal(actualNodes.sort(), nodes.filter(node => !node.interaction?.hiddenInPreview).map(node => node.id).sort(), '2D visible dashboard nodes');
    check(actualNodes.length >= 10, '2D preview did not render a populated dashboard.');
    await screenshot('canvas-2d', canvas2d, true);
    assertClean(); passed(`2D saved dashboard renders ${actualNodes.length} nodes and a nonblank picture`);

    phase = 'representative lightweight 3D scene render';
    const sceneBefore = (await api(`/api/v1/projects/${project3d.id}/scene`)).scene;
    equal([...sceneBefore.instances].sort((a, b) => a.id.localeCompare(b.id)), [...instances].sort((a, b) => a.id.localeCompare(b.id)), '3D saved instances');
    const models = (await api(`/api/v1/projects/${project3d.id}/model-assets`)).modelAssets;
    check(Array.isArray(models), 'Built-in model catalog response is invalid.');
    let modelBytes = 0;
    for (const id of new Set(instances.map(instance => instance.modelAssetId))) {
      const model = models.find(item => item.id === id);
      check(model?.source === 'system' && Number.isSafeInteger(model.byteSize) && model.byteSize > 0,
        'Reviewed built-in model metadata is missing.');
      modelBytes += model.byteSize;
    }
    check(modelBytes <= 4 * 1024 * 1024, 'The 3D sample exceeds the 4 MiB unique-model budget.');
    audit.modelBytes = modelBytes; persist();
    await navigate(`/projects/${project3d.id}/scene-preview`, '.standalone-3d-preview-stage');
    const renderer = page.locator('.standalone-3d-preview-stage .model-3d-node[data-cover-state="ready"]');
    await renderer.waitFor({ state: 'visible', timeout: 120000 });
    const canvas3d = renderer.locator('.model-3d-renderer canvas');
    await canvas3d.waitFor({ state: 'visible' });
    check(await canvas3d.evaluate(canvas => canvas.width >= 200 && canvas.height >= 100), 'WebGL canvas has no usable drawing buffer.');
    check(await page.locator('.model-3d-message.is-error').count() === 0, '3D renderer exposes an error state.');
    await screenshot('scene-3d', canvas3d, true);
    assertClean(); passed(`${instances.length} built-in 3D instances reach ready state and a nonblank WebGL picture`);

    phase = 'final read-only invariants';
    equal(revisions((await api('/api/v1/projects')).projects), before, 'Project and cover revisions after browsing');
    equal((await api(`/api/v1/projects/${project2d.id}/canvas`)).canvas, canvasBefore, '2D saved document after browsing');
    equal((await api(`/api/v1/projects/${project3d.id}/scene`)).scene, sceneBefore, '3D saved document after browsing');
    assertClean(); passed('all project/cover revisions and both sampled documents remain unchanged; zero pageerrors or business writes');
  } catch (error) {
    failure(phase, error);
  } finally {
    if (page && loginAttempted) {
      phase = 'logout';
      try {
        // Stop mounted runtime readers before revoking their session. A plain health
        // document has the same origin and does not mount the project cover queue.
        await page.goto(`${origin.origin}/health`, { waitUntil: 'domcontentloaded' });
        allowAuthenticationPost = '/api/v1/auth/logout';
        await api('/api/v1/auth/logout', 204, 'POST');
        allowAuthenticationPost = null;
        const anonymous = await api('/api/v1/auth/me', 401);
        check(anonymous?.error === 'unauthenticated', 'Logout did not restore anonymous access.');
        audit.sessionRevoked = true;
        passed('logout invalidates the acceptance session');
      } catch (error) { failure(phase, error); }
    }
    if (browser) {
      try { await browser.close(); }
      catch (error) { failure('browser shutdown', error); }
    }
    clearInterval(heartbeat);
    audit.status = audit.failures.length || audit.pageErrors.length || audit.blockedRequests.length || audit.httpErrors.length ? 'failed' : 'passed';
    audit.finishedAt = new Date().toISOString(); persist();
    console.log(`AUDIT ${auditFile}`);
    console.log(`${audit.status.toUpperCase()} ${audit.checks.length} acceptance checks; screenshots=${audit.screenshots.length}`);
    if (audit.status !== 'passed') process.exitCode = 1;
  }
}
main().catch(error => {
  console.error(error instanceof AcceptanceError ? error.message : 'Acceptance setup failed; check file paths, permissions and environment.');
  process.exitCode = 1;
});
