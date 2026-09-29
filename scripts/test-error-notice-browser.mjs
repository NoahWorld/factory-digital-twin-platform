// Frontend-only regression: every API request is mocked; no credentials or backend writes.
// DTWIN_ERROR_TEST_ORIGIN=http://127.0.0.1:4179 node scripts/test-error-notice-browser.mjs
// Optional: DTWIN_PLAYWRIGHT_MODULE, DTWIN_BROWSER_CHANNEL, DTWIN_ERROR_TEST_OUTPUT_DIR.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultPlaywright = "/Users/doudou/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const fakeIdentifier = "error-notice-test@example.invalid";
const fakePassword = "Browser-fixture-only-2026!";
const correctedPassword = "Corrected-fixture-only-2026!";
const bodyMarker = "PRIVATE_REQUEST_BODY_MUST_NOT_RENDER";
const htmlMarker = "PRIVATE_PROXY_HTML_MUST_NOT_RENDER";
const loginPath = "/api/v1/auth/login";
const fakeUser = {
  id: "error-notice-browser-fixture", loginName: "error-notice-test",
  email: fakeIdentifier, displayName: "错误提示测试账号", roles: ["viewer"], modules: ["2d", "3d"],
  capabilities: { canCreateProject: false, canManageUsers: false, canAccess2D: true, canAccess3D: true },
};

const scenarios = [
  {
    name: "invalid-credentials", status: 401, code: "invalid_credentials",
    raw: "Invalid login identifier or password.",
    pattern: /账号.*密码/,
  },
  {
    name: "login-rate-limited", status: 429, code: "login_rate_limited",
    raw: "Too many login attempts.",
    pattern: /登录.*频繁/,
  },
  {
    name: "origin-denied", status: 403, code: "origin_denied",
    raw: "Request origin is not allowed.",
    pattern: /访问地址/,
  },
  {
    name: "internal-error", status: 500, code: "internal_error",
    raw: "Unexpected internal processing failure.",
    pattern: /服务.*异常|服务.*失败|服务.*完成/,
  },
  {
    name: "unknown-validation", status: 400, code: "test_identifier_field_invalid",
    raw: `Field identifier: account name must start with a letter; rejected rule: ${"account_name_validation_rule_".repeat(8)}.`,
    pattern: /输入|校验|提交内容/,
  },
  {
    name: "network-failure", code: "network_error", raw: "Failed to fetch",
    pattern: /网络|服务器响应/,
  },
  {
    name: "html-bad-gateway", status: 502, code: "request_failed",
    raw: "API request failed with HTTP 502.",
    pattern: /服务/,
  },
];

function requireCondition(value, message) {
  if (!value) throw new Error(message);
}

function redact(error) {
  let text = String(error instanceof Error ? error.message : error);
  for (const secret of [fakeIdentifier, fakePassword, correctedPassword, bodyMarker, htmlMarker]) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/https?:\/\/[^\s<>"']+/gi, "[URL]").slice(0, 2500);
}

async function main() {
  requireCondition(process.env.DTWIN_ERROR_TEST_ORIGIN, "DTWIN_ERROR_TEST_ORIGIN is required.");
  const origin = new URL(process.env.DTWIN_ERROR_TEST_ORIGIN);
  requireCondition(["http:", "https:"].includes(origin.protocol)
    && origin.origin === process.env.DTWIN_ERROR_TEST_ORIGIN,
  "DTWIN_ERROR_TEST_ORIGIN must be an exact HTTP(S) origin without credentials, path, query or trailing slash.");
  const outputParent = process.env.DTWIN_ERROR_TEST_OUTPUT_DIR
    ? resolve(process.env.DTWIN_ERROR_TEST_OUTPUT_DIR) : tmpdir();
  await mkdir(outputParent, { recursive: true });
  const output = await mkdtemp(join(outputParent, "dtwin-error-notice-"));
  await chmod(output, 0o700);
  const auditFile = join(output, "results.json");
  const audit = {
    scope: "frontend-only; all API calls mocked; no backend authorization or connectivity claims",
    origin: origin.origin, startedAt: new Date().toISOString(), status: "running",
    checks: [], screenshots: [], pageErrors: [], unexpectedRequests: [], routeErrors: [], errors: [],
  };
  const persist = () => writeFile(auditFile, JSON.stringify(audit, null, 2) + "\n", { mode: 0o600 });
  await persist();
  console.log(`OUTPUT ${output}`);
  let browser;

  async function assertNoOverflow(page, stage) {
    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const notice = document.querySelector('.notification[data-kind="error"]');
      const bounds = notice?.getBoundingClientRect();
      return {
        viewport: innerWidth, rootWidth: root.clientWidth,
        documentWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
        noticeWidth: notice?.clientWidth, noticeScrollWidth: notice?.scrollWidth,
        noticeLeft: bounds?.left, noticeRight: bounds?.right,
      };
    });
    assert.equal(layout.viewport, 360, `${stage}: expected a 360px viewport`);
    requireCondition(layout.documentWidth <= layout.rootWidth + 1, `${stage}: document overflows horizontally (${layout.documentWidth}/${layout.rootWidth}px).`);
    requireCondition(layout.noticeScrollWidth <= layout.noticeWidth + 1, `${stage}: error notice has horizontal overflow.`);
    requireCondition(layout.noticeLeft >= -1 && layout.noticeRight <= layout.viewport + 1,
      `${stage}: error notice extends outside the viewport.`);
    return layout;
  }

  async function screenshot(page, name) {
    const path = join(output, `${name}.png`);
    // Even fictional input values are masked in exported evidence.
    await page.screenshot({ path, fullPage: true, animations: "disabled",
      mask: [page.getByLabel("账号", { exact: true }), page.getByLabel("密码", { exact: true })] });
    await chmod(path, 0o600);
    audit.screenshots.push(path);
  }

  try {
    const modulePath = process.env.DTWIN_PLAYWRIGHT_MODULE
      || process.env.PLAYWRIGHT_MODULE_PATH || defaultPlaywright;
    const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
    browser = await chromium.launch({ channel: process.env.DTWIN_BROWSER_CHANNEL || "chrome", headless: true });
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width: 360, height: 900 },
        colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
      context.setDefaultTimeout(15000);
      context.setDefaultNavigationTimeout(30000);
      await context.addInitScript((value) => {
        localStorage.setItem("kingdom.ui-theme", value);
        window.__DTWIN_TEST_DIAGNOSTICS__ = [];
        const original = console.error;
        console.error = (...args) => {
          if (args[0] === "[DTwin] 操作失败") window.__DTWIN_TEST_DIAGNOSTICS__.push(args[1]);
          original.apply(console, args);
        };
      }, theme);
      let scenario;
      let loginAttempts = 0;
      let corrected = false;
      const apiCalls = [];

      // One handler owns every request. API calls never fall through to a real server,
      // including calls caused by unexpected page behavior or a wrong API base URL.
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const isApi = /^\/api\/v1(?:\/|$)/.test(url.pathname);
        const reference = `${request.method()} ${url.pathname}`;
        try {
          if (url.origin !== origin.origin) {
            audit.unexpectedRequests.push({ theme, kind: "external", request: reference });
            await route.abort("blockedbyclient");
            return;
          }
          if (!isApi) {
            if (request.method() !== "GET" && request.method() !== "HEAD") {
              audit.unexpectedRequests.push({ theme, kind: "non-api-write", request: reference });
              await route.abort("blockedbyclient");
            } else await route.continue();
            return;
          }
          apiCalls.push({ method: request.method(), path: url.pathname });
          const json = (status, body, headers = {}) => route.fulfill({ status,
            contentType: "application/json", headers, body: JSON.stringify(body) });
          if (request.method() === "GET" && url.pathname === "/api/v1/auth/bootstrap-status") {
            await json(200, { setupRequired: false });
          } else if (request.method() === "GET" && url.pathname === "/api/v1/auth/me") {
            await json(401, { error: "unauthenticated", message: "No test session." });
          } else if (request.method() === "GET" && url.pathname === "/api/v1/projects" && corrected) {
            await json(200, { projects: [] });
          } else if (request.method() === "POST" && url.pathname === loginPath && scenario) {
            loginAttempts += 1;
            const submitted = request.postDataJSON();
            requireCondition(submitted?.identifier === fakeIdentifier
              && submitted?.password === (corrected ? correctedPassword : fakePassword),
            "Login mock received unexpected fixture values; request body was not logged.");
            if (corrected) {
              await json(200, { user: fakeUser });
            } else if (scenario.name === "network-failure") {
              await route.abort("failed");
            } else if (scenario.name === "html-bad-gateway") {
              await route.fulfill({ status: 502, contentType: "text/html",
                headers: { "x-request-id": scenario.requestId },
                body: `<!doctype html><h1>Bad gateway</h1><p>${htmlMarker}</p>` });
            } else {
              await json(scenario.status, {
                error: scenario.code, message: scenario.raw, requestId: scenario.requestId,
                // Extra response properties must not leak into the notice or exported evidence.
                password: fakePassword, requestBody: { identifier: fakeIdentifier, password: correctedPassword, marker: bodyMarker },
              }, { "x-request-id": scenario.requestId });
            }
          } else {
            audit.unexpectedRequests.push({ theme, kind: "unmocked-api", request: reference });
            await route.abort("blockedbyclient");
          }
        } catch (error) {
          audit.routeErrors.push({ theme, request: reference, message: redact(error) });
          await route.abort("failed");
        }
      });

      const page = await context.newPage();
      page.on("pageerror", error => audit.pageErrors.push({ theme, message: redact(error) }));
      try {
        for (const item of scenarios) {
          scenario = { ...item, requestId: `error-notice-${theme}-${item.name}-${"a1".repeat(24)}` };
          corrected = false;
          loginAttempts = 0;
          const apiStart = apiCalls.length;
          const stage = `${theme}/${scenario.name}`;
          const target = `${origin.origin}/#/projects`;
          // The successful retry leaves the same hash route open. Reload it to reset
          // React auth state; goto(same URL) can be a document-free hash navigation.
          const navigation = page.url() === target
            ? await page.reload({ waitUntil: "domcontentloaded" })
            : await page.goto(target, { waitUntil: "domcontentloaded" });
          requireCondition(navigation?.status() === 200, `${stage}: frontend did not return HTTP 200.`);
          const account = page.getByLabel("账号", { exact: true });
          const password = page.getByLabel("密码", { exact: true });
          const submit = page.getByRole("button", { name: "登录平台", exact: true });
          await account.waitFor({ state: "visible" });
          assert.equal(await page.locator("html").getAttribute("data-ui-theme"), theme, `${stage}: theme was not applied`);
          await account.fill(fakeIdentifier);
          await password.fill(fakePassword);
          await submit.click();
          const region = page.getByRole("region", { name: "通知", exact: true });
          const notice = region.locator('.notification[data-kind="error"]');
          const message = notice.locator(".notification-message");
          await message.waitFor({ state: "visible" });
          const userText = await message.innerText();
          assert.match(userText, scenario.pattern, `${stage}: incorrect main error message`);
          assert.match(userText, /[\u3400-\u9fff]/, `${stage}: missing Chinese guidance`);
          assert.match(userText, /请|重试|检查|等待|稍后/, `${stage}: missing next action`);
          requireCondition(userText.length <= 120, `${stage}: user message is not brief.`);
          assert.equal(loginAttempts, 1, `${stage}: unexpected duplicate login attempt`);
          requireCondition(await submit.isEnabled() && await account.isEnabled() && await password.isEnabled(),
            `${stage}: form remains disabled after failure.`);
          assert.equal(await page.getByRole("alert").count(), 1, `${stage}: duplicate user errors`);
          assert.equal(await notice.getAttribute("role"), "alert", `${stage}: errors must be announced`);
          assert.equal(await notice.getAttribute("aria-atomic"), "true", `${stage}: errors must be announced together`);
          assert.equal(await notice.getByRole("button", { name: "关闭通知", exact: true }).count(), 1,
            `${stage}: missing accessible dismiss control`);
          assert.equal(await notice.locator("details, summary, dl").count(), 0, `${stage}: technical details must not exist in the DOM`);
          const noticeText = await notice.textContent();
          for (const forbidden of [scenario.code, scenario.requestId, scenario.raw, fakeIdentifier, fakePassword,
            correctedPassword, bodyMarker, htmlMarker, "requestBody", "查看错误详情", "请求编号", "原始信息", loginPath])
            requireCondition(!noticeText.includes(forbidden), `${stage}: technical or sensitive fixture data leaked into the notice.`);
          if (scenario.status) requireCondition(!noticeText.includes(String(scenario.status)), `${stage}: HTTP status leaked into the notice.`);
          const layout = await assertNoOverflow(page, stage);
          if (["invalid-credentials", "unknown-validation", "internal-error"].includes(scenario.name))
            await screenshot(page, `${theme}-${scenario.name}-simple`);

          await page.waitForFunction(path => window.__DTWIN_TEST_DIAGNOSTICS__
            .some(entry => entry.path === path), loginPath);
          const diagnostics = await page.evaluate(path => window.__DTWIN_TEST_DIAGNOSTICS__
            .filter(entry => entry.path === path), loginPath);
          assert.equal(diagnostics.length, 1, `${stage}: one failure produced duplicate console diagnostics`);
          const diagnostic = diagnostics[0];
          assert.equal(diagnostic.code, scenario.code, `${stage}: diagnostic error code missing`);
          assert.equal(diagnostic.status, scenario.status, `${stage}: diagnostic HTTP status incorrect`);
          assert.equal(diagnostic.method, "POST", `${stage}: diagnostic method missing`);
          assert.equal(diagnostic.requestId, scenario.status === undefined ? undefined : scenario.requestId,
            `${stage}: diagnostic request ID missing or invented`);
          const diagnosticText = JSON.stringify(diagnostic);
          for (const forbidden of [scenario.raw, fakeIdentifier, fakePassword, correctedPassword, bodyMarker, htmlMarker])
            requireCondition(!diagnosticText.includes(forbidden), `${stage}: console diagnostics exposed raw request/response material.`);
          for (const key of ["message", "body", "headers", "cause", "stack"])
            requireCondition(!(key in diagnostic), `${stage}: console diagnostic retained unreviewed ${key}.`);

          // Correct the input in the same live form, submit again and enter the mocked workspace.
          corrected = true;
          await password.fill(correctedPassword);
          await submit.click();
          await page.getByRole("heading", { level: 1, name: "项目", exact: true }).waitFor({ state: "visible" });
          assert.equal(loginAttempts, 2, `${stage}: corrected input was not resubmitted exactly once`);
          assert.equal(await region.locator('.notification[data-kind="error"]').count(), 0, `${stage}: stale login error survived success`);
          assert.equal(await region.locator(".notification").count(), 1, `${stage}: auth outcome should replace the previous notification`);
          assert.match(await region.locator('.notification[data-kind="success"]').innerText(), /登录成功/);
          requireCondition(apiCalls.slice(apiStart).some(call => call.path === "/api/v1/projects"),
            `${stage}: corrected login did not request the mocked workspace.`);
          requireCondition(audit.pageErrors.length === 0, `${stage}: uncaught browser error; see results.json.`);
          requireCondition(audit.unexpectedRequests.length === 0 && audit.routeErrors.length === 0,
            `${stage}: unexpected or failed mock route; see results.json.`);
          audit.checks.push({ scenario: item.name, theme, viewport: 360, technicalDetailsAbsent: true,
            safeConsoleDiagnostic: diagnostic, correctedSubmissionSucceeded: true, horizontalOverflow: false,
            layout, mockedApiCalls: apiCalls.slice(apiStart) });
          await persist();
          console.log(`PASS ${stage}: brief Chinese guidance, no technical details, safe console diagnostic, 360px layout, corrected retry`);
        }
      } finally {
        await context.close();
      }
    }
    assert.equal(audit.checks.length, scenarios.length * 2, "Scenario/theme matrix was incomplete");
    audit.status = "passed";
  } catch (error) {
    audit.status = "failed";
    audit.errors.push(redact(error));
    console.error(`FAIL ${redact(error)}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      try { await browser.close(); }
      catch (error) {
        audit.status = "failed";
        audit.errors.push(`Browser cleanup: ${redact(error)}`);
        process.exitCode = 1;
      }
    }
    audit.finishedAt = new Date().toISOString();
    await persist();
    console.log(`AUDIT ${auditFile}`);
    console.log(`${audit.status === "passed" ? "PASS" : "FAIL"} frontend-only error notice: ${audit.checks.length}/${scenarios.length * 2} cases; ${audit.screenshots.length} masked screenshots`);
  }
}

main().catch(error => { console.error(`FAIL ${redact(error)}`); process.exitCode = 1; });
