import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { ApiRequestError, UserFacingError, errorMessage, errorPresentation, reportError, request } from "../src/api";

function respond(t, response) {
  return t.mock.method(globalThis, "fetch", async () => response);
}

function failure(status, error, message, options = {}) {
  return new Response(JSON.stringify({ error, message, ...options.body }), {
    status,
    headers: { "content-type": "application/json", ...options.headers },
  });
}

async function rejected(promise) {
  let result;
  await assert.rejects(promise, error => { result = error; return true; });
  return result;
}

beforeEach(t => {
  // Production diagnostics are exercised and inspected without printing error fixtures.
  t.mock.method(console, "error", () => {});
});

function assertUserSafe(error, forbidden = []) {
  const presentation = errorPresentation(error);
  const message = errorMessage(error);
  assert.equal(presentation.message, message);
  assert.ok(message.length > 0 && message.length <= 120, "User errors must be brief and actionable");
  assert.match(message, /[\u3400-\u9fff]/);
  const serialized = JSON.stringify(presentation);
  for (const value of [error.code, error.requestId, ...forbidden].filter(Boolean)) {
    assert.ok(!serialized.includes(value), "User presentation must not contain technical or sensitive diagnostics");
    assert.ok(!message.includes(value), "String-only notices must not leak technical or sensitive diagnostics");
  }
  assert.doesNotMatch(serialized, /请求编号|请求 ID|HTTP 状态|原始信息|\/api\/v1\//);
  assert.deepEqual(Object.keys(presentation), ["message"]);
  return message;
}

function shareWindow(t, token) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { location: { hash: `#/share/${token}` } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete globalThis.window;
  });
}

test("401 retains authentication codes and distinguishes login failure from missing or expired session", async t => {
  for (const [code, raw, pattern] of [
    ["invalid_credentials", "Invalid account or password.", /账号或密码/],
    ["unauthenticated", "Session expired or was revoked.", /未登录|登录状态/],
  ]) {
    await t.test(code, async t => {
      respond(t, failure(401, code, raw, { body: { requestId: "request-auth" } }));
      const error = await rejected(request("/api/v1/auth/login", { method: "POST" }));
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, code);
      assert.equal(error.context.status, 401);
      assert.equal(error.requestId, "request-auth");
      assert.equal(error.message, raw);
      assert.match(errorPresentation(error).message, pattern);
      assert.match(errorMessage(error), pattern);
      assert.ok(!errorMessage(error).includes(raw));
      assertUserSafe(error, [raw]);
      assert.equal(error.context.method, "POST");
      assert.equal(error.context.path, "/api/v1/auth/login");
    });
  }
});

test("429 does not confuse login throttling with a busy model optimizer", async t => {
  for (const [code, raw] of [
    ["login_rate_limited", "Too many login attempts; retry after 15 minutes."],
    ["model_optimization_busy", "Another model is being compressed."],
  ]) {
    await t.test(code, async t => {
      respond(t, failure(429, code, raw));
      const error = await rejected(request("/api/v1/example"));
      assert.equal(error.code, code);
      assert.equal(error.context.status, 429);
      if (code === "login_rate_limited") assert.match(errorPresentation(error).message, /登录/);
      else {
        assert.doesNotMatch(errorPresentation(error).message, /登录|15/);
        assertUserSafe(error, [raw]);
      }
    });
  }
});

test("403 distinguishes denied origin configuration from account permissions", async t => {
  for (const [code, pattern] of [["origin_denied", /访问地址/], ["forbidden", /权限/]]) {
    await t.test(code, async t => {
      respond(t, failure(403, code, "Request rejected."));
      const error = await rejected(request("/api/v1/projects", { method: "POST" }));
      assert.equal(error.code, code);
      assert.match(errorPresentation(error).message, pattern);
      assert.doesNotMatch(errorPresentation(error).message, /账号或密码不正确/);
    });
  }
});

test("known server failures preserve diagnostics on the error but keep user notices brief", async t => {
  const raw = "Operation failed. Use requestId to find the server diagnostics.";
  respond(t, failure(500, "internal_error", raw, { body: { requestId: "request-server" } }));
  const error = await rejected(request("/api/v1/projects"));
  assert.match(errorPresentation(error).message, /服务.*异常/);
  assert.equal(error.code, "internal_error");
  assert.equal(error.context.status, 500);
  assert.equal(error.requestId, "request-server");
  assert.equal(error.message, raw);
  assertUserSafe(error, [raw]);
});

test("request ID falls back to the response header only when the JSON ID is absent or invalid", async t => {
  for (const bodyId of [undefined, "", null, 42, "request-body"]) {
    await t.test(String(bodyId), async t => {
      respond(t, failure(401, "invalid_credentials", "Invalid account or password.", {
        body: { requestId: bodyId }, headers: { "X-Request-Id": "request-header" },
      }));
      const error = await rejected(request("/api/v1/auth/login"));
      assert.equal(error.requestId, bodyId === "request-body" ? bodyId : "request-header");
    });
  }
});

test("HTML gateway errors preserve HTTP status without displaying the proxy HTML", async t => {
  respond(t, new Response("<html>private-proxy-error-page</html>", {
    status: 502, headers: { "content-type": "text/html", "X-Request-Id": "request-gateway" },
  }));
  const error = await rejected(request("/api/v1/auth/login", { method: "POST" }));
  assert.ok(error instanceof ApiRequestError);
  assert.equal(error.code, "request_failed");
  assert.equal(error.context.status, 502);
  assert.equal(error.requestId, "request-gateway");
  assert.match(errorPresentation(error).message, /服务/);
  assert.doesNotMatch(JSON.stringify(errorPresentation(error)), /private-proxy-error-page/);
  assert.doesNotMatch(errorMessage(error), /账号或密码不正确/);
});

test("malformed JSON is a response error with status and request ID even for HTTP 200", async t => {
  for (const status of [200, 502]) {
    await t.test(String(status), async t => {
      respond(t, new Response("{broken-json", {
        status, headers: { "content-type": "application/json", "X-Request-Id": "request-json" },
      }));
      const error = await rejected(request("/api/v1/projects"));
      assert.equal(error.code, "invalid_response");
      assert.equal(error.context.status, status);
      assert.equal(error.requestId, "request-json");
      assert.ok(error.cause instanceof SyntaxError);
      assert.match(errorPresentation(error).message, /返回.*异常/);
    });
  }
});

test("an HTML success response cannot masquerade as successful API JSON", async t => {
  respond(t, new Response("<!doctype html><title>SPA</title>", {
    status: 200, headers: { "content-type": "text/html" },
  }));
  const error = await rejected(request("/api/v1/projects"));
  assert.equal(error.code, "invalid_response");
  assert.equal(error.context.status, 200);
});

test("empty 204, 205 and HEAD successes do not try parsing their optional JSON content type", async t => {
  for (const [status, method] of [[204, "POST"], [205, "POST"], [200, "HEAD"]]) {
    for (const contentType of [undefined, "application/json"]) {
      await t.test(`${status} ${method} ${contentType ?? "no content type"}`, async t => {
        const headers = contentType ? { "content-type": contentType } : {};
        respond(t, new Response(null, { status, headers }));
        assert.equal(await request("/api/v1/auth/logout", { method }), null);
      });
    }
  }
});

test("valid JSON succeeds and retains normal credential and request options", async t => {
  const payload = { user: { id: "test-user", role: "platform_admin" } };
  const fetch = respond(t, new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=utf-8" },
  }));
  assert.deepEqual(await request("/api/v1/auth/login", { method: "POST", body: "{}" }), payload);
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "/api/v1/auth/login");
  assert.equal(options.credentials, "include");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.get("content-type"), "application/json");
});

test("fetch connection errors retain their cause and safe path but no request secrets", async t => {
  const cause = new TypeError("Failed to fetch");
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw cause; });
  const error = await rejected(request("/api/v1/auth/login?token=fixture-query-token#fixture-fragment", {
    method: "post", body: '{"password":"fixture-body-password"}',
    headers: { authorization: "Bearer fixture-header-token" },
  }));
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(error.code, "network_error");
  assert.equal(error.cause, cause);
  assert.equal(error.context.cause, cause);
  assert.equal(error.context.status, undefined);
  assert.equal(error.requestId, undefined);
  assert.equal(error.context.method, "POST");
  assert.equal(error.context.path, "/api/v1/auth/login");
  assert.match(errorPresentation(error).message, /网络|响应/);
  assertUserSafe(error, [cause.message]);
  assert.doesNotMatch(JSON.stringify({ context: error.context, presentation: errorPresentation(error) }),
    /fixture-query-token|fixture-fragment|fixture-body-password|fixture-header-token/);
});

test("non-network runtime failures are passed through unchanged", async t => {
  const cause = new Error("Application instrumentation failed");
  t.mock.method(globalThis, "fetch", async () => { throw cause; });
  assert.equal(await rejected(request("/api/v1/projects")), cause);
  assertUserSafe(cause, [cause.message]);
});

test("a response body transport failure retains the received HTTP status and trace ID", async t => {
  const cause = new TypeError("Response stream terminated");
  const response = new Response(null, {
    status: 200, headers: { "content-type": "application/json", "X-Request-Id": "request-stream" },
  });
  t.mock.method(response, "json", async () => { throw cause; });
  respond(t, response);
  const error = await rejected(request("/api/v1/projects"));
  assert.equal(error.code, "network_error");
  assert.equal(error.context.status, 200);
  assert.equal(error.requestId, "request-stream");
  assert.equal(error.cause, cause);
});

test("intentional cancellation and custom screenshot timeout reasons are not rewritten as network errors", async t => {
  for (const custom of [false, true]) {
    for (const phase of ["fetch", "body"]) {
      await t.test(`${phase} ${custom ? "custom timeout" : "AbortError"}`, async t => {
        const controller = new AbortController();
        const abort = () => {
          if (custom) controller.abort(new TypeError("项目截图处理超时。"));
          else controller.abort();
          throw controller.signal.reason;
        };
        if (phase === "fetch") t.mock.method(globalThis, "fetch", async () => abort());
        else {
          const response = new Response(null, { headers: { "content-type": "application/json" } });
          t.mock.method(response, "json", async () => abort());
          respond(t, response);
        }
        const error = await rejected(request("/api/v1/projects", { signal: controller.signal }));
        assert.equal(error, controller.signal.reason);
        assert.ok(!(error instanceof ApiRequestError));
        assertUserSafe(error, [error.message]);
      });
    }
  }
});

test("unknown validation codes keep original field constraints only for diagnostics", async t => {
  const raw = "displayName must contain 1–100 printable characters.";
  respond(t, failure(400, "invalid_input", raw, { body: { requestId: "request-field" } }));
  const error = await rejected(request("/api/v1/users", { method: "POST" }));
  assert.equal(error.code, "invalid_input");
  assert.match(errorPresentation(error).message, /输入.*要求/);
  assert.equal(error.message, raw);
  assertUserSafe(error, [raw]);
});

test("unknown Chinese backend messages are not treated as trusted user copy", async t => {
  const raw = "部件“输送机”仍被工序引用，请先解除引用。";
  respond(t, failure(409, "future_business_constraint", raw));
  const error = await rejected(request("/api/v1/projects/example", { method: "DELETE" }));
  assert.notEqual(errorPresentation(error).message, raw);
  assert.notEqual(errorMessage(error), raw);
  assert.equal(error.code, "future_business_constraint");
  assertUserSafe(error, [raw]);
});

test("malformed error envelopes cannot inject non-string diagnostics or hide HTTP failure", async t => {
  for (const payload of [null, [], "unexpected", { error: 1, message: { secret: true }, requestId: [] }]) {
    await t.test(JSON.stringify(payload), async t => {
      respond(t, new Response(JSON.stringify(payload), {
        status: 400, headers: { "content-type": "application/json", "X-Request-Id": "request-envelope" },
      }));
      const error = await rejected(request("/api/v1/users"));
      assert.equal(error.code, "request_failed");
      assert.equal(error.context.status, 400);
      assert.equal(error.requestId, "request-envelope");
      assert.match(error.message, /HTTP 400/);
      assertUserSafe(error, [error.message]);
    });
  }
});

test("public reads use their share token only in the request, never in diagnostic paths", async t => {
  shareWindow(t, "fixture-share-token");
  const fetch = respond(t, failure(404, "publication_not_found", "Publication not found."));
  const error = await rejected(request("/api/v1/projects/example?cursor=fixture-cursor"));
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "/api/v1/publications/projects/example?cursor=fixture-cursor&share=fixture-share-token");
  assert.equal(options.credentials, "omit");
  assert.equal(error.context.method, "GET");
  assert.equal(error.context.path, "/api/v1/projects/example");
  assert.doesNotMatch(JSON.stringify(errorPresentation(error)), /fixture-share-token|fixture-cursor/);
});

test("public writes are explicitly rejected before any network request", async t => {
  shareWindow(t, "fixture-share-token");
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  const error = await rejected(request("/api/v1/projects/example", { method: "PUT", body: "{}" }));
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(error.code, "publication_read_only");
  assert.match(errorPresentation(error).message, /仅供查看/);
  assert.doesNotMatch(JSON.stringify(errorPresentation(error)), /fixture-share-token/);
});


test("explicit reviewed local errors retain actionable copy without technical details", () => {
  const message = "请先保存当前修改，再进入预览。";
  const error = new UserFacingError(message);
  assert.equal(errorPresentation(error).message, message);
  assert.equal(errorMessage(error), message);
  assert.deepEqual(errorPresentation(error), { message });
});

test("unknown string and object errors cannot expose raw browser or backend diagnostics", () => {
  for (const reason of [
    "TypeError: Cannot read properties of undefined /api/v1/projects?token=private-token",
    "数据库异常 SQLSTATE 23505：连接 postgres://private-host failed",
    { message: "private-object-message", token: "private-object-token" },
  ]) {
    const presentation = errorPresentation(reason);
    assert.match(presentation.message, /[\u3400-\u9fff]/);
    assert.ok(presentation.message.length <= 120);
    assert.doesNotMatch(JSON.stringify(presentation), /TypeError|SQLSTATE|postgres|private-|api\/v1|undefined/);
    assert.deepEqual(Object.keys(presentation), ["message"]);
  }
});

test("diagnostics retain traceable API metadata once per Error object without raw secrets", () => {
  const raw = "password=private-raw-password; SQLSTATE private-database; authorization=private-header";
  const error = new ApiRequestError("internal_error", "trace-private-fixture", raw, {
    status: 500, method: "POST", path: "/api/v1/projects",
    cause: new Error("private-cause-content"),
  });
  const before = console.error.mock.callCount();
  reportError(error);
  reportError(error);
  errorMessage(error);
  assert.equal(console.error.mock.callCount() - before, 1, "The same failure should not be logged repeatedly by different presenters");
  const [prefix, diagnostic] = console.error.mock.calls.at(-1).arguments;
  assert.equal(prefix, "[DTwin] 操作失败");
  assert.equal(diagnostic.name, "ApiRequestError");
  assert.equal(diagnostic.code, "internal_error");
  assert.equal(diagnostic.status, 500);
  assert.equal(diagnostic.method, "POST");
  assert.equal(diagnostic.path, "/api/v1/projects");
  assert.equal(diagnostic.requestId, "trace-private-fixture");
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-raw|private-database|private-header|private-cause|password|authorization|stack/);
  reportError(new ApiRequestError("internal_error", "trace-next-occurrence", raw, error.context));
  assert.equal(console.error.mock.callCount() - before, 2, "A new failure occurrence must still be diagnosable");
});

test("ordinary runtime diagnostics omit arbitrary message, stack and cause", () => {
  const error = new TypeError("private-runtime-message", { cause: new Error("private-inner-message") });
  reportError(error);
  const [prefix, diagnostic] = console.error.mock.calls.at(-1).arguments;
  assert.equal(prefix, "[DTwin] 操作失败");
  assert.equal(diagnostic.name, "TypeError");
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-|message|stack|cause/);
  assertUserSafe(error, [error.message]);
});

test("diagnostic source retains bounded file locations without messages, URL queries or local directories", () => {
  const error = new Error("private-password fixture-secret");
  error.stack = "Error: private-password fixture-secret\n"
    + "    at privateArgument (https://private-host/assets/app.js:10:20)\n"
    + "    at handler (/Users/private-user/private-directory/page.tsx:30:40)\n"
    + "    at fetcher (https://private-host/api.js?token=private-token:50:60)\n"
    + Array.from({ length: 8 }, (_, i) => `    at helper (https://private-host/chunk-${i}.mjs:${i + 1}:2)`).join("\n");
  reportError(error);
  const diagnostic = console.error.mock.calls.at(-1).arguments[1];
  assert.equal(diagnostic.source, "app.js:10:20, page.tsx:30:40, chunk-0.mjs:1:2, chunk-1.mjs:2:2, chunk-2.mjs:3:2, chunk-3.mjs:4:2");
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-|fixture-secret|privateArgument|https:|Users|token|password/);
  assert.equal(diagnostic.stack, undefined);
});

test("API diagnostic identifiers and token path segments are sanitized", () => {
  const error = new ApiRequestError("invalid private-code", "private/request-id", "private-raw", {
    status: 403, method: "POST private-method", path: "/api/v1/share/private-share/token/private-token?password=private-query#private-fragment",
  });
  reportError(error);
  const diagnostic = console.error.mock.calls.at(-1).arguments[1];
  assert.equal(diagnostic.code, "[redacted]");
  assert.equal(diagnostic.requestId, "[redacted]");
  assert.equal(diagnostic.method, "[redacted]");
  assert.equal(diagnostic.path, "/api/v1/[redacted]/[redacted]");
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-|password|fragment/);
});

test("malformed diagnostic paths cannot replace the original failure", () => {
  const error = new ApiRequestError("internal_error", "trace-malformed-path", "private-original", { status: 500, path: "http://[" });
  assert.doesNotThrow(() => reportError(error));
  const diagnostic = console.error.mock.calls.at(-1).arguments[1];
  assert.equal(diagnostic.path, "[redacted]");
  assert.equal(diagnostic.requestId, "trace-malformed-path");
  assert.equal(diagnostic.code, "internal_error");
});

test("unusable optional stacks never prevent safe error diagnostics", () => {
  for (const stack of [42, null, { private: "private-stack" }, "throw-getter"]) {
    const error = new ApiRequestError("internal_error", "trace-safe-metadata", "private-original", { status: 500 });
    Object.defineProperty(error, "stack", stack === "throw-getter"
      ? { get() { throw new Error("private-getter-failure"); } } : { value: stack });
    assert.doesNotThrow(() => reportError(error));
    const diagnostic = console.error.mock.calls.at(-1).arguments[1];
    assert.equal(diagnostic.source, undefined);
    assert.equal(diagnostic.sourceUnavailable, stack === "throw-getter" ? true : undefined);
    assert.equal(diagnostic.requestId, "trace-safe-metadata");
    assert.equal(diagnostic.code, "internal_error");
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-|stack|getter/);
  }
});

test("diagnostic context preserves reviewed identifiers and bounded values without arbitrary payloads", () => {
  reportError(new Error("private-original"), {
    operation: "twin.action", projectId: "project-123", assetRecordId: "asset-456", decorationId: "decoration-123",
    targetProjectId: "project-789", correlationId: "trace-123", revision: 2, sequence: Infinity,
    failureCount: 3, canvasNodeId: "private/value", token: "private-token", body: { password: "private-password" },
    bindingIds: Array.from({ length: 102 }, (_, i) => `binding-${i}`),
    targetProjectIds: ["project-789", "private/target"], allowedOriginProjectIds: ["project-123"],
  });
  const diagnostic = console.error.mock.calls.at(-1).arguments[1];
  assert.equal(diagnostic.operation, "twin.action");
  assert.equal(diagnostic.projectId, "project-123");
  assert.equal(diagnostic.assetRecordId, "asset-456");
  assert.equal(diagnostic.decorationId, "decoration-123");
  assert.equal(diagnostic.targetProjectId, "project-789");
  assert.equal(diagnostic.correlationId, "trace-123");
  assert.equal(diagnostic.revision, 2);
  assert.equal(diagnostic.sequence, undefined);
  assert.equal(diagnostic.failureCount, 3);
  assert.equal(diagnostic.canvasNodeId, "[redacted]");
  assert.equal(diagnostic.bindingIds.split(", ").length, 100);
  assert.equal(diagnostic.targetProjectIds, "project-789, [redacted]");
  assert.equal(diagnostic.allowedOriginProjectIds, "project-123");
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-|password|token|body|binding-10[01]/);
});

test("runtime diagnostic names use Error classes instead of arbitrary mutable name strings", () => {
  for (const ErrorClass of [Error, TypeError, RangeError, SyntaxError, ReferenceError, URIError, EvalError]) {
    const error = new ErrorClass("private-message"); error.name = "private-mutable-name";
    reportError(error);
    const diagnostic = console.error.mock.calls.at(-1).arguments[1];
    assert.equal(diagnostic.name, ErrorClass.name);
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-/);
  }
});

test("request diagnostics never copy request bodies, authentication headers or query strings", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  const error = await rejected(request("/api/v1/auth/login?token=private-query#private-fragment", {
    method: "POST", body: '{"password":"private-password"}',
    headers: { authorization: "Bearer private-token" },
  }));
  reportError(error);
  const diagnostic = console.error.mock.calls.at(-1).arguments[1];
  assert.equal(diagnostic.path, "/api/v1/auth/login");
  assert.equal(diagnostic.code, "network_error");
  assert.equal(diagnostic.status, undefined);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-|password|authorization|token|fragment/);
});
