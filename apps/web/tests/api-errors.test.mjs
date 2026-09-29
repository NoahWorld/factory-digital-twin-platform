import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiRequestError, errorMessage, errorPresentation, request } from "../src/api";

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

function detail(error, label) {
  return errorPresentation(error).details.find(item => item.label === label)?.value;
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
      assert.equal(detail(error, "原始信息"), raw);
      assert.equal(detail(error, "请求接口"), "POST /api/v1/auth/login");
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
        assert.ok(errorMessage(error).includes(raw));
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

test("known server failures expose diagnostic code, status, request ID and original message", async t => {
  const raw = "Operation failed. Use requestId to find the server diagnostics.";
  respond(t, failure(500, "internal_error", raw, { body: { requestId: "request-server" } }));
  const error = await rejected(request("/api/v1/projects"));
  assert.match(errorPresentation(error).message, /服务器.*异常/);
  assert.equal(detail(error, "错误码"), "internal_error");
  assert.equal(detail(error, "HTTP 状态"), "500");
  assert.equal(detail(error, "请求编号"), "request-server");
  assert.equal(detail(error, "原始信息"), raw);
  assert.match(errorMessage(error), /request-server/);
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
  assert.match(errorPresentation(error).message, /服务器/);
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
      assert.match(errorPresentation(error).message, /格式异常/);
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
  assert.equal(detail(error, "请求接口"), "POST /api/v1/auth/login");
  assert.match(errorPresentation(error).message, /网络|响应/);
  assert.equal(detail(error, "请求编号"), "未收到");
  assert.doesNotMatch(JSON.stringify({ context: error.context, presentation: errorPresentation(error) }),
    /fixture-query-token|fixture-fragment|fixture-body-password|fixture-header-token/);
});

test("non-network runtime failures are passed through unchanged", async t => {
  const cause = new Error("Application instrumentation failed");
  t.mock.method(globalThis, "fetch", async () => { throw cause; });
  assert.equal(await rejected(request("/api/v1/projects")), cause);
  assert.equal(errorMessage(cause), cause.message);
  assert.deepEqual(errorPresentation(cause), { message: cause.message, details: [] });
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
        assert.equal(errorMessage(error), error.message);
      });
    }
  }
});

test("unknown validation codes keep the actionable original field constraint in both presentations", async t => {
  const raw = "displayName must contain 1–100 printable characters.";
  respond(t, failure(400, "invalid_input", raw, { body: { requestId: "request-field" } }));
  const error = await rejected(request("/api/v1/users", { method: "POST" }));
  assert.equal(error.code, "invalid_input");
  assert.match(errorPresentation(error).message, /校验/);
  assert.equal(detail(error, "原始信息"), raw);
  assert.ok(errorMessage(error).includes(raw));
  assert.match(errorMessage(error), /invalid_input/);
  assert.match(errorMessage(error), /request-field/);
});

test("actionable Chinese business errors are preserved verbatim", async t => {
  const raw = "部件“输送机”仍被工序引用，请先解除引用。";
  respond(t, failure(409, "future_business_constraint", raw));
  const error = await rejected(request("/api/v1/projects/example", { method: "DELETE" }));
  assert.equal(errorPresentation(error).message, raw);
  assert.equal(errorMessage(error), raw);
  assert.equal(detail(error, "错误码"), "future_business_constraint");
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
      assert.ok(errorPresentation(error).details.every(item => typeof item.value === "string"));
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
  assert.equal(detail(error, "请求接口"), "GET /api/v1/projects/example");
  assert.doesNotMatch(JSON.stringify(errorPresentation(error)), /fixture-share-token|fixture-cursor/);
});

test("public writes are explicitly rejected before any network request", async t => {
  shareWindow(t, "fixture-share-token");
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  const error = await rejected(request("/api/v1/projects/example", { method: "PUT", body: "{}" }));
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(error.code, "publication_read_only");
  assert.match(errorPresentation(error).message, /只允许查看/);
  assert.doesNotMatch(JSON.stringify(errorPresentation(error)), /fixture-share-token/);
});
