import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { apiUrl, request } from "../src/api";
import { parseIotIdentity } from "../src/iot/identity";
import { readIotToken, IOT_SESSION_EVENT } from "../src/iot/session";
import { publicAssetUrl, resolveResourceAccess, loadResourceBytes, validateResourceAccess, invalidateResourceAccess } from "../src/iot/resources";
import { iotStreamUrl } from "../src/iot/stream";
import { TwinPointStream } from "../src/twin/point-stream";
import { builtinModels } from "../../../shared/builtin-models";

let storage;
let caseId = 0;
const response = result => new Response(JSON.stringify({ status: 200, result }), { headers: { "content-type": "application/json" } });
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
const privatePath = "/api/v1/projects/p/model-assets/m/content";
beforeEach(t => {
  storage = new Map([["x-access-token", `test-session-${++caseId}`]]);
  const previous = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    location: { origin: "https://iot.example.test", protocol: "https:" },
    localStorage: { getItem: key => storage.get(key) ?? null },
  });
  t.after(() => { globalThis.window = previous; });
  t.mock.method(console, "error", () => {});
});

test("missing or invalid IoT session never starts a business request", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("unexpected network request"));
  for (const token of [undefined, "", " ", "null", "undefined"]) {
    storage.set("x-access-token", token);
    assert.equal(readIotToken(), null);
    await assert.rejects(request("/api/v1/projects"), { code: "unauthenticated" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("one transport maps legacy domain paths to IoT and sends only the IoT header", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/cloud/twin/projects?limit=5");
    assert.equal(init.headers.get("x-access-token"), readIotToken());
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    return response({ projects: [] });
  });
  assert.deepEqual(await request("/api/v1/projects?limit=5"), { projects: [] });
  assert.equal(apiUrl("/cloud/authorize/me"), "/cloud/authorize/me");
  for (const path of ["https://other.test/api", "//other.test/cloud/x", "/api/v1/../../evil", "/cloud/twin/auth/login", "/api/v1/users"]) {
    assert.throws(() => apiUrl(path));
  }
});

test("bare legacy success JSON and a business error inside HTTP 200 cannot succeed", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"projects":[]}', { headers: { "content-type": "application/json" } }));
  await assert.rejects(request("/api/v1/projects"), { code: "invalid_response" });
  t.mock.method(globalThis, "fetch", async () => new Response('{"status":403,"message":"private"}', { headers: { "content-type": "application/json" } }));
  await assert.rejects(request("/api/v1/projects"), { code: "forbidden" });
});

test("missing IoT module and a missing project retain different errors", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  await assert.rejects(request("/api/v1/projects"), { code: "iot_twin_endpoint_unavailable" });
  t.mock.method(globalThis, "fetch", async () => new Response('{"status":404,"code":"project_not_found"}', { status: 404, headers: { "content-type": "application/json" } }));
  await assert.rejects(request("/api/v1/projects/missing"), { code: "project_not_found" });
});

test("401 expires only the session that issued the request", async t => {
  let expired = 0;
  window.addEventListener(IOT_SESSION_EVENT, () => expired++);
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 401 }));
  await assert.rejects(request("/api/v1/projects"), { code: "unauthenticated" });
  assert.equal(expired, 1);
  t.mock.method(globalThis, "fetch", async () => {
    storage.set("x-access-token", "new-session");
    return new Response("", { status: 401 });
  });
  await assert.rejects(request("/api/v1/projects"), { code: "unauthenticated" });
  assert.equal(expired, 1);
});

test("responses from a previous account are rejected", async t => {
  t.mock.method(globalThis, "fetch", async () => {
    storage.set("x-access-token", "new-session");
    return response({ projects: ["private-old-project"] });
  });
  await assert.rejects(request("/api/v1/projects"), { code: "iot_session_changed" });
});

test("identity grants only explicit IoT permissions, never account name or old platform role", () => {
  const user = { id: "admin", name: "Administrator", role: "platform_admin" };
  assert.deepEqual(parseIotIdentity({ user, permissions: [] }).modules, []);
  const reader = parseIotIdentity({ user, permissions: [{ id: "twin-project", actions: ["query"] }] });
  assert.deepEqual(reader.modules, ["3d", "2d"]);
  assert.equal(reader.capabilities.canCreateProject, false);
  assert.equal(reader.capabilities.canAccessResources, false);
  const editor = parseIotIdentity({ user, permissions: [{ id: "twin-project", actions: ["query", "save"] }, { id: "twin-resource", actions: ["query"] }] });
  assert.equal(editor.capabilities.canCreateProject, true);
  assert.equal(editor.capabilities.canAccessResources, true);
  assert.throws(() => parseIotIdentity({ user, permissions: [{ id: "twin-project", actions: "query" }] }), { code: "invalid_response" });
});

test("resource grants reject untrusted origins, tokens, mixed content and invalid lifetimes", () => {
  const now = Date.now();
  const valid = { url: "https://minio.example.test/bucket/model?X-Amz-Signature=fixture", expiresAt: now + 120_000 };
  assert.equal(validateResourceAccess(valid, now).url, valid.url);
  for (const url of ["https://other.test/model", "http://minio.example.test/model", "javascript:alert(1)", "https://u:p@minio.example.test/file", "https://minio.example.test/file?x-access-token=secret"]) {
    assert.throws(() => validateResourceAccess({ ...valid, url }, now), { code: "iot_resource_access_invalid" });
  }
  for (const expiresAt of [NaN, Infinity, now, now + 20_000, now + 301_000]) {
    assert.throws(() => validateResourceAccess({ ...valid, expiresAt }, now), { code: "iot_resource_access_invalid" });
  }
});

test("private binary downloads get permission first and never forward the IoT token to MinIO", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    if (calls === 1) {
      assert.equal(url, "/cloud/twin/projects/p/model-assets/m/content/access");
      assert.equal(init.headers.get("x-access-token"), readIotToken());
      return response({ url: "https://minio.example.test/b/model?X-Amz-Signature=fixture", expiresAt: Date.now() + 120_000 });
    }
    assert.equal(init.headers, undefined);
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.match(url, /^https:\/\/minio.example.test\//);
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.deepEqual([...new Uint8Array(await loadResourceBytes(privatePath))], [1, 2, 3]);
  assert.equal(calls, 2);
});

test("cached grants require a session, reset across accounts, and explicit retry reacquires access", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => response({ url: "/files/model", expiresAt: Date.now() + 120_000 }));
  await resolveResourceAccess(privatePath);
  await resolveResourceAccess(privatePath);
  assert.equal(fetch.mock.callCount(), 1);
  storage.delete("x-access-token");
  await assert.rejects(resolveResourceAccess(privatePath), { code: "unauthenticated" });
  storage.set("x-access-token", "next-session");
  await resolveResourceAccess(privatePath);
  assert.equal(fetch.mock.callCount(), 2);
  invalidateResourceAccess(privatePath);
  await resolveResourceAccess(privatePath);
  assert.equal(fetch.mock.callCount(), 3);
});

test("cover revision is preserved in its scoped access request; arbitrary resources are rejected", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "/cloud/twin/projects/p/cover.png/access?revision=3");
    return response({ url: "/files/cover", expiresAt: Date.now() + 120_000 });
  });
  await resolveResourceAccess("/api/v1/projects/p/cover.png?revision=3");
  for (const path of ["/api/v1/projects/p", "/api/v1/projects/p/model-assets/m/content?token=secret", "/twin/models/unknown.glb"]) {
    await assert.rejects(resolveResourceAccess(path));
  }
});

test("only exact built-in resources load without a session and retain the deployment base", async t => {
  storage.clear();
  const path = publicAssetUrl(builtinModels[0].contentPath);
  assert.match(path, /^\/twin\/models\//);
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("unexpected permission request"));
  assert.deepEqual(await resolveResourceAccess(path), { url: path, expiresAt: null });
  assert.equal(fetch.mock.callCount(), 0);
});

test("stream connection uses a short-lived ticket and never exposes the IoT session in its URL", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/cloud/twin/projects/p/twin-drive/stream-ticket");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("x-access-token"), readIotToken());
    return response({ ticket: "a".repeat(32), expiresAt: Date.now() + 30_000 });
  });
  const url = new URL(await iotStreamUrl("p"));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.searchParams.get("projectId"), "p");
  assert.equal(url.searchParams.get("ticket"), "a".repeat(32));
  assert.ok(!url.href.includes(readIotToken()));
  t.mock.method(globalThis, "fetch", async () => response({ ticket: "a".repeat(32), expiresAt: Date.now() + 3600_000 }));
  await assert.rejects(iotStreamUrl("p"), { code: "invalid_response" });
});

test("closing a scene during authorization cannot open a late WebSocket", async t => {
  const previous = globalThis.WebSocket;
  let opened = 0, resolveUrl;
  globalThis.WebSocket = class { constructor() { opened++; } };
  t.after(() => { globalThis.WebSocket = previous; });
  const source = new TwinPointStream(() => new Promise(resolve => { resolveUrl = resolve; }), "p", () => {});
  source.connect();
  source.close();
  resolveUrl("wss://iot.example.test/cloud/twin/twin-drive?ticket=fixture");
  await nextTick();
  assert.equal(opened, 0);
  assert.equal(source.getState().phase, "idle");
});
