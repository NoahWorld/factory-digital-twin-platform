// Real-browser regression for public HTTP deployments. Node 22+; no server or browser-security overrides.
// DTWIN_ORIGIN=http://YOUR_SERVER:19080 DTWIN_ADMIN_FILE=/private/admin.json \
// DTWIN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node deploy/server/verify-browser.mjs
// DTWIN_BROWSER_CHANNEL defaults to chrome. Credentials, cookies, traces and screenshots are never exported.
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);

async function main() {
  requireCondition(process.env.DTWIN_ORIGIN, 'DTWIN_ORIGIN is required.');
  const origin = new URL(process.env.DTWIN_ORIGIN);
  requireCondition(origin.origin === process.env.DTWIN_ORIGIN && origin.protocol === 'http:',
    'This regression requires an exact ordinary HTTP origin, without a path, credentials or trailing slash.');
  requireCondition(!['localhost', '[::1]', '0.0.0.0'].includes(origin.hostname)
    && !origin.hostname.endsWith('.localhost') && !origin.hostname.startsWith('127.'),
  'This regression must use a non-localhost HTTP origin.');
  requireCondition(process.env.DTWIN_ADMIN_FILE, 'DTWIN_ADMIN_FILE is required.');
  const adminFile = resolve(process.env.DTWIN_ADMIN_FILE);
  const adminStat = lstatSync(adminFile);
  requireCondition(adminStat.isFile() && (adminStat.mode & 0o777) === 0o600,
    'DTWIN_ADMIN_FILE must be a regular file with mode 0600.');
  let admin;
  try { admin = JSON.parse(readFileSync(adminFile, 'utf8')); }
  catch { throw new Error('DTWIN_ADMIN_FILE must contain valid JSON.'); }
  requireCondition(admin !== null && typeof admin === 'object' && !Array.isArray(admin),
    'DTWIN_ADMIN_FILE must contain an administrator object.');
  const identifier = admin.identifier ?? admin.loginName ?? admin.email;
  requireCondition(typeof identifier === 'string' && identifier.length > 0
    && typeof admin.password === 'string' && admin.password.length > 0,
  'Administrator file requires identifier (or loginName/email) and password.');
  const redact = error => {
    let message = String(error instanceof Error ? error.message : error);
    for (const secret of [admin.password, identifier]) message = message.split(secret).join('[REDACTED]');
    return message.replace(/https?:\/\/[^\s<>"']+/gi, '[URL]').slice(0, 1600);
  };
  const runId = `dtwin-browser-${randomUUID()}`;
  const auditFile = join(dirname(adminFile), `${runId}.json`);
  const audit = { runId, origin: origin.origin, channel: process.env.DTWIN_BROWSER_CHANNEL || 'chrome',
    startedAt: new Date().toISOString(), status: 'running', browser: null,
    checks: [], projects: [], pageErrors: [], errors: [] };
  writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const persist = () => writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  const passed = name => { audit.checks.push({ name, at: new Date().toISOString() }); persist(); console.log(`PASS ${name}`); };
  const failed = (phase, error) => { const message = redact(error); audit.errors.push({ phase, message });
    persist(); console.error(`FAIL ${phase}: ${message}`); };
  let browser, context, page;
  let loginAttempted = false;

  // Runs native same-origin fetch in the browser: no injected Origin, Host, cookies, or crypto polyfills.
  async function api(targetPage, path, { method = 'GET', body, status = 200 } = {}) {
    requireCondition(/^\/api\/v1\//.test(path), 'Acceptance API path must belong to this application.');
    const result = await targetPage.evaluate(async ({ expectedOrigin, path, method, body }) => {
      if (location.origin !== expectedOrigin) throw new Error('Browser left the configured origin.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(path, { method, credentials: 'same-origin', mode: 'same-origin',
          redirect: 'error', signal: controller.signal,
          ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        return { status: response.status, value, requestId: response.headers.get('x-request-id') };
      } finally { clearTimeout(timeout); }
    }, { expectedOrigin: origin.origin, path, method, body });
    const code = /^[a-z_0-9]+$/.test(result.value?.error ?? '') ? ` error=${result.value.error}` : '';
    const requestId = /^[A-Za-z0-9_-]+$/.test(result.requestId ?? '') ? ` requestId=${result.requestId}` : '';
    requireCondition(result.status === status, `${method} ${path}: expected ${status}, received ${result.status}.${code}${requestId}`);
    return result.value;
  }
  async function ensureHttpContext(targetPage, stage) {
    const capabilities = await targetPage.evaluate(() => ({ origin: location.origin,
      isSecureContext, randomUUID: typeof globalThis.crypto?.randomUUID,
      getRandomValues: typeof globalThis.crypto?.getRandomValues }));
    audit.browser = capabilities; persist();
    requireCondition(capabilities.origin === origin.origin && capabilities.isSecureContext === false,
      `${stage}: test did not reach an ordinary insecure HTTP context.`);
    requireCondition(capabilities.randomUUID === 'undefined' && capabilities.getRandomValues === 'function',
      `${stage}: expected randomUUID to be unavailable and getRandomValues to be available.`);
    console.log(`CONTEXT ${stage}: isSecureContext=false randomUUID=${capabilities.randomUUID} getRandomValues=${capabilities.getRandomValues}`);
  }
  function noPageErrors(stage) {
    requireCondition(audit.pageErrors.length === 0, `${stage}: ${audit.pageErrors.length} browser pageerror event(s); see audit.`);
  }
  const isResponse = (response, path, method) => {
    const url = new URL(response.url());
    return url.origin === origin.origin && url.pathname === path && response.request().method() === method;
  };

  try {
    const modulePath = process.env.DTWIN_PLAYWRIGHT_MODULE;
    const { chromium } = await import(modulePath ? isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath : 'playwright');
    browser = await chromium.launch({ channel: audit.channel, headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(30000);
    context.setDefaultNavigationTimeout(45000);
    page = await context.newPage();
    page.on('pageerror', error => {
      audit.pageErrors.push({ message: redact(error), at: new Date().toISOString() }); persist();
      console.error(`PAGEERROR ${redact(error)}`);
    });
    const landing = await page.goto(`${origin.origin}/`, { waitUntil: 'domcontentloaded' });
    requireCondition(landing?.status() === 200, 'Public homepage did not return HTTP 200.');
    await page.getByRole('heading', { level: 1, name: /把工业现场/ }).waitFor({ state: 'visible' });
    const platformLink = page.getByRole('banner').getByRole('link', { name: '进入平台', exact: true });
    await platformLink.waitFor({ state: 'visible' });
    await ensureHttpContext(page, 'homepage');
    noPageErrors('Homepage rendering');
    passed('public HTTP homepage renders without pageerror');

    await platformLink.click();
    await page.waitForURL(`${origin.origin}/#/projects`);
    await page.getByLabel('账号', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '登录平台', exact: true }).waitFor({ state: 'visible' });
    await ensureHttpContext(page, 'login');
    noPageErrors('Login page rendering');
    passed('projects route renders the login form in the same insecure context');
    await page.getByLabel('账号', { exact: true }).fill(identifier);
    await page.getByLabel('密码', { exact: true }).fill(`invalid-browser-${randomUUID()}`);
    loginAttempted = true;
    const [rejectedLogin] = await Promise.all([
      page.waitForResponse(response => isResponse(response, '/api/v1/auth/login', 'POST')),
      page.getByRole('button', { name: '登录平台', exact: true }).click(),
    ]);
    requireCondition(rejectedLogin.status() === 401, 'An incorrect password must return HTTP 401.');
    const rejection = await rejectedLogin.json();
    requireCondition(rejection.error === 'invalid_credentials' && safeId(rejection.requestId),
      'Incorrect login must retain the authentication error code and a request ID.');
    audit.loginFailure = { code: rejection.error, status: rejectedLogin.status(), requestId: rejection.requestId };
    persist();
    const notice = page.locator('.error-notice');
    await notice.getByRole('alert').waitFor({ state: 'visible' });
    const userMessage = await notice.getByRole('alert').innerText();
    requireCondition(userMessage.includes('账号或密码不正确') && userMessage.includes('重试'),
      'Incorrect login must explain the cause and next action in Chinese.');
    requireCondition(!userMessage.includes(rejection.requestId) && !userMessage.includes(rejection.message),
      'Technical diagnostics must not be mixed into the main login message.');
    const details = notice.locator('details');
    requireCondition(await details.getAttribute('open') === null, 'Login diagnostics must be collapsed initially.');
    await notice.locator('summary').click();
    const diagnostics = await details.innerText();
    for (const value of [rejection.error, rejection.requestId, rejection.message, '401', 'POST /api/v1/auth/login']) {
      requireCondition(diagnostics.includes(value), `Login diagnostics are missing a required field.`);
    }
    requireCondition(!diagnostics.includes(admin.password), 'Login diagnostics must not contain the administrator password.');
    noPageErrors('Incorrect login rendering');
    passed('real rejected login shows Chinese guidance with expandable diagnostic details');
    await page.getByLabel('密码', { exact: true }).fill(admin.password);
    const [login] = await Promise.all([
      page.waitForResponse(response => isResponse(response, '/api/v1/auth/login', 'POST')),
      page.getByRole('button', { name: '登录平台', exact: true }).click(),
    ]);
    requireCondition(login.status() === 200, `Browser login expected 200, received ${login.status()}.`);
    const loginResult = await login.json();
    requireCondition(Array.isArray(loginResult.user?.roles) && loginResult.user.roles.includes('platform_admin'),
      'Browser acceptance requires the existing platform administrator.');
    await page.getByRole('heading', { level: 1, name: '项目', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '新建项目', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '退出', exact: true }).waitFor({ state: 'visible' });
    noPageErrors('Authenticated workspace');
    passed('administrator login reaches the project workspace');

    const fixture = { name: runId, type: '2d', status: 'creating' };
    audit.projects.push(fixture); persist();
    const created = await api(page, '/api/v1/projects', { method: 'POST', status: 201,
      body: { name: fixture.name, projectType: fixture.type } });
    requireCondition(safeId(created.project?.id), 'Temporary project creation returned an invalid ID.');
    fixture.id = created.project.id; fixture.status = 'created'; persist();
    requireCondition(created.project.name === fixture.name && created.project.projectType === fixture.type,
      'Temporary project metadata does not match this run.');
    await page.goto(`${origin.origin}/#/projects/${fixture.id}/canvas`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: '返回项目列表', exact: true }).waitFor({ state: 'visible' });
    const palette = page.getByRole('complementary', { name: '组件库', exact: true });
    await palette.getByRole('searchbox', { name: '搜索组件', exact: true }).fill('纯文本');
    const surface = page.locator('.canvas-surface.is-editable');
    await surface.waitFor({ state: 'visible' });
    await palette.getByRole('button', { name: '纯文本，静态与滚动文字', exact: true }).dragTo(surface);
    const node = page.getByRole('group', { name: 'plain-text 组件', exact: true });
    await node.waitFor({ state: 'visible' });
    fixture.nodeId = await node.getAttribute('data-node-id'); persist();
    requireCondition(uuidV4.test(fixture.nodeId ?? ''), 'Dragging a component did not create a valid UUID v4.');
    const canvasPath = `/api/v1/projects/${fixture.id}/canvas`;
    const [saved] = await Promise.all([
      page.waitForResponse(response => isResponse(response, canvasPath, 'PATCH')),
      page.getByRole('button', { name: '保存画布', exact: true }).click(),
    ]);
    requireCondition(saved.status() === 200, `Canvas save expected 200, received ${saved.status()}.`);
    const persisted = await api(page, canvasPath);
    requireCondition(persisted.canvas?.nodes?.some(item => item.id === fixture.nodeId && item.type === 'plain-text'),
      'The UI-created node did not persist in the backend canvas document.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('group', { name: 'plain-text 组件', exact: true }).waitFor({ state: 'visible' });
    requireCondition(await page.getByRole('group', { name: 'plain-text 组件', exact: true }).getAttribute('data-node-id') === fixture.nodeId,
      'Reloaded canvas changed the persisted node UUID.');
    await ensureHttpContext(page, 'canvas');
    noPageErrors('Canvas creation/save/reload');
    passed('real palette drag creates a UUID v4 node and saves/reloads it over public HTTP');
  } catch (error) {
    failed('verification', error);
  } finally {
    let cleanupPage;
    if (context && loginAttempted) {
      try {
        // A same-origin JSON page keeps cleanup independent of a broken React page.
        cleanupPage = await context.newPage();
        await cleanupPage.goto(`${origin.origin}/health`, { waitUntil: 'domcontentloaded' });
        for (const fixture of audit.projects) {
          requireCondition(fixture.id && safeId(fixture.id) && fixture.name === runId && fixture.type === '2d',
            'Refusing cleanup without an identified fixture belonging to this run; inspect the audit.');
          const path = `/api/v1/projects/${fixture.id}`;
          const current = await api(cleanupPage, path);
          requireCondition(current.project?.name === fixture.name && current.project.projectType === fixture.type,
            'Refusing cleanup because temporary project metadata changed.');
          const deleted = await api(cleanupPage, path, { method: 'DELETE' });
          requireCondition(deleted.deletedProjectId === fixture.id && !deleted.warning, 'Project cleanup was not confirmed.');
          await api(cleanupPage, path, { status: 404 });
          fixture.status = 'deleted'; fixture.deletedAt = new Date().toISOString(); persist();
        }
        passed('only this run temporary project is deleted');
      } catch (error) { failed('fixture cleanup', error); }
      try {
        requireCondition(cleanupPage && !cleanupPage.isClosed(), 'No same-origin browser page is available to revoke the session.');
        await api(cleanupPage, '/api/v1/auth/logout', { method: 'POST', status: 204 });
        const anonymous = await api(cleanupPage, '/api/v1/auth/me', { status: 401 });
        requireCondition(anonymous?.error === 'unauthenticated', 'Session logout did not restore anonymous access.');
        audit.sessionRevoked = true; persist();
        if (page && !page.isClosed()) {
          await page.goto(`${origin.origin}/#/projects`, { waitUntil: 'domcontentloaded' });
          // Logout was issued on the cleanup tab; reload to re-check server auth instead of retaining this tab's React user state.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.getByLabel('账号', { exact: true }).waitFor({ state: 'visible' });
        }
        passed('current browser session logged out and login page restored');
      } catch (error) { failed('logout', error); }
    }
    if (audit.pageErrors.length && !audit.errors.some(item => item.phase === 'verification'))
      failed('browser pageerror', new Error(`${audit.pageErrors.length} uncaught browser error(s); see audit.`));
    if (context) { try { await context.close(); } catch (error) { failed('browser context close', error); } }
    if (browser) { try { await browser.close(); } catch (error) { failed('browser close', error); } }
    audit.status = audit.errors.length ? 'failed' : 'passed';
    audit.finishedAt = new Date().toISOString(); persist();
    console.log(`AUDIT ${auditFile}`);
  }
  requireCondition(audit.status === 'passed', 'Browser acceptance failed; see the private audit for sanitized diagnostics.');
  console.log(`PASS browser acceptance: ${audit.checks.length} checks, no pageerror, fixture deleted, session revoked.`);
}

main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
