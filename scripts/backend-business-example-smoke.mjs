// Real local integration. Retains one independent example project; never changes other projects.
// Requires the running local Vite/Compose stack and optional externally supplied browser tooling.
// PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/backend-business-example-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = process.env.DTWIN_LOCAL_WEB_ORIGIN || "http://127.0.0.1:5173";
assert.equal(origin, "http://127.0.0.1:5173", "This integration is restricted to the local platform.");
const output = join(root, "deploy/local/.local/business-api-example");
const receiptFile = join(output, "project.json");
const owner = "backend-business-example-smoke/v1";
const geometry = JSON.parse(await readFile(join(root, "shared/handling-cell-geometry.json"), "utf8"));
const cycleDurationMs = geometry.phases.reduce((sum, phase) => sum + phase.durationMs, 0);
const bindingCount = 15;
const boundNodeNames = [geometry.agv.node, ...geometry.agv.wheelNodes,
  ...["turret", "shoulder", "elbow", "wrist", "fingerLeft", "fingerRight"].map(key => geometry.robot.nodes[key]),
  ...["nodeX", "nodeY", "nodeZ", "nodeYaw"].map(key => geometry.cargo[key])];
assert.equal(boundNodeNames.length, bindingCount);
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const failures = [];
const writes = [];
let browser;
let context;
let authenticated = false;
let integrationError;
let receipt;
let restoreExampleConfiguration;
try {
  receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  assert.equal(receipt.owner, owner, "The saved project receipt belongs to a different operation.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(output, { recursive: true, mode: 0o700 });
const saveReceipt = async (patch) => {
  receipt = { ...receipt, ...patch, owner, updatedAt: new Date().toISOString() };
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  await chmod(receiptFile, 0o600);
};

// Append only a read-only observer to the actual Vite module. No API, model or feedback is mocked.
// It records the matrix that the production render loop applies, alongside the same real snapshot.
const matrixObserver = `
const businessExampleOriginalTick = TwinDriveRuntime.prototype.tick;
TwinDriveRuntime.prototype.tick = function (...args) {
  const result = businessExampleOriginalTick.apply(this, args);
  if (this.attachment.config.source !== 'api' || !this.bindings.some(binding => binding.record.id === 'handling-cell')) return result;
  window.__businessExampleDiagnostics = { ...this.diagnostics };
  if (this.diagnostics.status !== 'live') return result;
  const snapshot = this.attachment.source.getState().snapshot;
  if (!snapshot) return result;
  const samples = window.__businessExampleMotion || (window.__businessExampleMotion = []);
  const protocol = this.attachment.config.connection.protocol;
  if (samples.at(-1)?.sequence === snapshot.sequence && samples.at(-1)?.protocol === protocol) return result;
  samples.push({ sequence: snapshot.sequence, timestamp: snapshot.timestamp, source: snapshot.source, protocol,
    points: Object.fromEntries(Object.entries(snapshot.points).map(([id, point]) => [id, point.value])),
    nodes: this.bindings.map(binding => {
      const expected = binding.object.parent.matrixWorld.clone().invert()
        .multiply(binding.record.model.matrixWorld).multiply(binding.desired);
      return { id: binding.definition.id, pointId: binding.definition.pointId, node: binding.object.name, matrix: [...binding.object.matrix.elements],
        expected: [...expected.elements], motion: [...binding.motion.elements] };
    }) });
  if (samples.length > 600) samples.shift();
  return result;
};
`;

function sourceState(state) {
  assert.equal(state.scenario, "handling-cell");
  assert.equal(state.geometryVersion, geometry.version);
  assert.ok(Number.isSafeInteger(state.sequence));
  assert.ok(Number.isFinite(Date.parse(state.timestamp)));
  const distance = geometry.agv.dockZM - geometry.agv.startZM;
  assert.ok(Number.isFinite(state.agv.positionM) && state.agv.positionM >= 0 && state.agv.positionM <= distance);
  assert.ok(Math.abs(state.agv.wheelAngleDeg - state.agv.positionM / geometry.agv.wheelRadiusM * 180 / Math.PI * geometry.agv.wheelAngleSign) < 1e-8);
  for (const key of ["baseYawDeg", "shoulderDeg", "elbowDeg", "wristDeg"]) assert.ok(Number.isFinite(state.robot[key]), `Missing actual robot feedback: ${key}`);
  assert.ok(state.robot.baseYawDeg >= 0 && state.robot.baseYawDeg <= 90);
  assert.ok(Math.abs(state.robot.wristDeg + state.robot.shoulderDeg + state.robot.elbowDeg) < 1e-8);
  assert.ok(state.gripper.openingM >= geometry.robot.closedGapM && state.gripper.openingM <= geometry.robot.openGapM);
  for (const key of ["xM", "yM", "zM", "yawDeg"]) assert.ok(Number.isFinite(state.cargo[key]), `Missing actual cargo feedback: ${key}`);
  assert.ok(["agv", "gripper", "inspection"].includes(state.cargo.attachment));
  const phase = geometry.phases[state.cycle.phaseCode];
  assert.ok(phase, "Business phase must be part of the geometry contract.");
  assert.equal(state.cycle.phase, phase.label);
  assert.equal(state.cycle.durationMs, cycleDurationMs);
  assert.ok(state.cycle.elapsedMs >= 0 && state.cycle.elapsedMs < cycleDurationMs);
}

try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  context.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push({ method: request.method(), path: new URL(request.url()).pathname });
  });
  context.on("page", (page) => page.on("pageerror", (error) => failures.push(error.message)));
  await context.route(/\/src\/scene\/twin-drive-runtime\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200, "The real model runtime module must load.");
    await route.fulfill({ response, body: await response.text() + matrixObserver });
  });
  const call = async (path, { method = "GET", data, status = 200 } = {}) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) writes.push({ method, path: new URL("/api/v1" + path, origin).pathname });
    const response = await context.request.fetch(origin + "/api/v1" + path, {
      method, data, headers: { Origin: origin },
    });
    if (response.status() !== status) {
      const body = await response.json();
      assert.fail(`${method} ${path} returned HTTP ${response.status()}; error=${body.error}, requestId=${body.requestId || response.headers()["x-request-id"]}.`);
    }
    return response.json();
  };
  // Read credentials directly into the authenticated request; never print them or persist a browser profile.
  const admin = JSON.parse(await readFile(join(root, "deploy/local/.local/admin.json"), "utf8"));
  await call("/auth/login", { method: "POST", data: admin });
  authenticated = true;
  const first = await call("/test-business/handling-cell/state");
  sourceState(first);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(origin + "/#/templates");
  await page.getByRole("tab", { name: /3D 场景模板/ }).click();
  const definitions = await page.evaluate(async () => {
    const example = await import("/src/twin/business-api-example.ts");
    return { instances: example.businessApiExampleInstances, settings: example.businessApiExampleSettings,
      rest: example.businessApiExampleConfig(), websocket: example.businessApiExampleConfig("websocket") };
  });
  const projectsBefore = (await call("/projects?limit=100")).projects;

  if (!receipt) {
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "接口驱动搬运单元 · 送检与回收" }) });
    await card.getByRole("button", { name: "用模板创建 3D 项目" }).click();
    const name = "接口驱动搬运单元 · 后端测试接口";
    await page.getByRole("dialog").getByRole("textbox").fill(name);
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/projects" && response.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "创建并进入编辑器" }).click();
    const response = await created;
    assert.equal(response.status(), 201, "The template must create a new project successfully.");
    const { project } = await response.json();
    await saveReceipt({ projectId: project.id, name, state: "created", protocol: "rest", testSource: "/api/v1/test-business/handling-cell/state" });
    await page.waitForURL(origin + `/#/projects/${project.id}/scene`);
  } else {
    const { project } = await call(`/projects/${receipt.projectId}`);
    assert.equal(project.name, receipt.name, "The previously created example was renamed; refuse to change it.");
    assert.equal(project.projectType, "3d");
    const currentScene = (await call(`/projects/${receipt.projectId}/scene`)).scene;
    if (currentScene.revision !== 0) {
      assert.deepEqual(currentScene.instances, definitions.instances, "The saved scene was edited; refuse to change its configuration.");
      assert.deepEqual(currentScene.settings, definitions.settings);
      assert.equal(currentScene.linked2dProjectId, null);
    }
    const drive = await call(`/projects/${receipt.projectId}/twin-drive`);
    if (drive.config.connection?.protocol === "websocket") {
      assert.deepEqual(drive.config, definitions.websocket, "The saved example configuration was edited; refuse to replace it.");
      await call(`/projects/${receipt.projectId}/twin-drive`, { method: "PUT", data: { expectedRevision: drive.revision, config: definitions.rest } });
    }
    await page.evaluate(async (projectId) => {
      const helper = await import("/src/twin/create-business-example.ts");
      await helper.prepareBusinessApiExample();
      await helper.populateBusinessApiExample(projectId, () => {});
      location.hash = `/projects/${projectId}/scene`;
    }, receipt.projectId);
    await page.waitForURL(origin + `/#/projects/${receipt.projectId}/scene`);
  }
  const projectId = receipt.projectId;
  const scene = (await call(`/projects/${projectId}/scene`)).scene;
  assert.deepEqual(scene.instances, definitions.instances);
  assert.deepEqual(scene.settings, definitions.settings);
  let drive = await call(`/projects/${projectId}/twin-drive`);
  assert.deepEqual(drive.config, definitions.rest);
  restoreExampleConfiguration = async () => {
    const current = await call(`/projects/${projectId}/twin-drive`);
    if (current.config.connection?.protocol === "websocket") {
      assert.deepEqual(current.config, definitions.websocket, "The example was edited; refuse to replace its configuration during cleanup.");
      await call(`/projects/${projectId}/twin-drive`, {
        method: "PUT", data: { expectedRevision: current.revision, config: definitions.rest },
      });
    } else {
      assert.deepEqual(current.config, definitions.rest, "The example was edited; refuse to replace its configuration during cleanup.");
    }
    assert.deepEqual((await call(`/projects/${projectId}/twin-drive`)).config, definitions.rest, "The retained example must use its original REST configuration.");
    await saveReceipt({ protocol: "rest" });
    console.log("PASS: This integration's retained example REST configuration was verified/restored.");
  };
  await saveReceipt({ state: "configured", protocol: "rest", previewUrl: origin + `/#/projects/${projectId}/scene-preview` });
  assert.equal(drive.config.bindings.length, bindingCount);
  console.log(`PASS: Complete template created/resumed independent project ${projectId}; combined scene and ${bindingCount} bindings saved.`);

  const restBefore = await call("/test-business/handling-cell/state");
  sourceState(restBefore);
  const rawWebSocket = await page.evaluate(() => new Promise((resolve, reject) => {
    const url = new URL("/api/v1/test-business/handling-cell/live", location.href);
    url.protocol = "ws:";
    const socket = new WebSocket(url);
    const samples = [];
    const startedAt = performance.now();
    const events = [];
    const longTasks = [];
    const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()
      .map(({ startTime, duration }) => ({ startTime, duration }))));
    observer.observe({ type: "longtask" });
    let complete = false;
    const record = (event) => events.push({ ...event, elapsedMs: Math.round(performance.now() - startedAt) });
    const fail = (message) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      observer.disconnect();
      const diagnostic = { url: url.href, readyState: socket.readyState, samples: samples.length, events, longTasks };
      socket.close();
      reject(new Error(`${message}; diagnostic=${JSON.stringify(diagnostic)}`));
    };
    const timer = setTimeout(() => fail("Actual business WebSocket source timed out"), 8000);
    socket.onopen = () => record({ type: "open" });
    socket.onerror = () => fail("Actual business WebSocket source failed");
    socket.onclose = ({ code, reason, wasClean }) => {
      record({ type: "close", code, reason, wasClean });
      if (!complete) fail("Actual business WebSocket source closed before six observations");
    };
    socket.onmessage = ({ data }) => {
      try {
        samples.push(JSON.parse(data));
        record({ type: "message", sequence: samples.at(-1).sequence });
        if (samples.length >= 6) {
          complete = true;
          clearTimeout(timer);
          observer.disconnect();
          socket.close();
          resolve({ samples, events, longTasks });
        }
      } catch (error) { fail(`Actual business WebSocket returned invalid JSON: ${error.message}`); }
    };
  }));
  await writeFile(join(output, "public-websocket-observations.json"), JSON.stringify(rawWebSocket, null, 2) + "\n", { mode: 0o600 });
  const rawWebSocketSamples = rawWebSocket.samples;
  rawWebSocketSamples.forEach(sourceState);
  assert.ok(rawWebSocketSamples.at(-1).sequence > rawWebSocketSamples[0].sequence);
  const second = await call("/test-business/handling-cell/state");
  sourceState(second);
  assert.ok(second.sequence > first.sequence);
  assert.ok(second.sequence > restBefore.sequence);
  console.log("PASS: Actual REST and WebSocket observations advance and include phase, cargo, joints and gripper feedback; stationary business phases are permitted.");

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "预览", exact: true }).click();
  const preview = await popupPromise;
  preview.setDefaultTimeout(20000);
  await preview.waitForURL(receipt.previewUrl);
  assert.equal(page.url(), origin + `/#/projects/${projectId}/scene`, "Preview must preserve the original editor tab.");

  const verifyMotion = async (protocol) => {
    console.log(`Verifying ${protocol} observations through the real gateway and real GLB matrices…`);
    try {
      await preview.waitForFunction(({ protocol, cycleDurationMs, phaseCount, nodeNames }) => {
        const samples = (window.__businessExampleMotion || []).filter((sample) => sample.protocol === protocol);
        return samples.length >= 10 && Date.parse(samples.at(-1).timestamp) - Date.parse(samples[0].timestamp) >= cycleDurationMs
          && new Set(samples.map((sample) => sample.points["business-phase"])).size === phaseCount
          && nodeNames.every((nodeName) => new Set(samples
            .map((sample) => JSON.stringify(sample.nodes.find((node) => node.node === nodeName)?.matrix))).size > 1);
      }, { protocol, cycleDurationMs, phaseCount: geometry.phases.length, nodeNames: boundNodeNames }, { timeout: cycleDurationMs + 20000 });
    } catch (cause) {
      const diagnostic = await preview.evaluate(() => ({
        runtime: window.__businessExampleDiagnostics,
        samples: window.__businessExampleMotion,
        interfaceMessage: document.querySelector(".embedded-twin-status")?.textContent,
      }));
      await writeFile(join(output, `${protocol}-failure.json`), JSON.stringify(diagnostic, null, 2) + "\n", { mode: 0o600 });
      await preview.screenshot({ path: join(output, `${protocol}-failure.png`) });
      throw new Error(`${protocol} model motion verification failed; runtime=${JSON.stringify(diagnostic.runtime)}, interface=${diagnostic.interfaceMessage}, observedSamples=${diagnostic.samples?.length || 0}.`, { cause });
    }
    const samples = await preview.evaluate(() => window.__businessExampleMotion);
    assert.ok(samples.length >= 10);
    for (const sample of samples) {
      assert.equal(sample.source, "api");
      assert.equal(sample.protocol, protocol);
      assert.equal(sample.nodes.length, bindingCount);
      for (const point of definitions.rest.points) assert.ok(Number.isFinite(sample.points[point.id])
        && sample.points[point.id] >= point.min && sample.points[point.id] <= point.max, `${point.sourcePath}: actual observation must remain inside its configured range.`);
      for (const node of sample.nodes) assert.ok(node.matrix.every((value, index) => Math.abs(value - node.expected[index]) < 1e-8), `${node.node}: actual model matrix must equal the production displayed pose.`);
      const agv = sample.nodes.find((node) => node.node === "agv_motion");
      assert.ok(agv);
      // Display interpolation may still be approaching the latest received value. It cannot
      // invent an out-of-range pose; per-frame endpoint/boundary/freeze checks live in
      // backend-business-example-motion-sample.mjs rather than requiring an immediate jump.
      assert.ok(agv.motion[14] >= geometry.agv.startZM - 1e-8 && agv.motion[14] <= geometry.agv.dockZM + 1e-8);
      assert.ok(Math.abs(agv.motion[12]) < 1e-8 && Math.abs(agv.motion[13]) < 1e-8, "The actual vehicle must follow the declared wheel rolling direction.");
    }
    assert.equal(new Set(samples.map(sample => sample.points["business-phase"])).size, geometry.phases.length, "Observe every actual business phase, including stationary inspection and waiting.");
    for (const nodeName of boundNodeNames) assert.ok(new Set(samples.map((sample) => JSON.stringify(sample.nodes.find((node) => node.node === nodeName).matrix))).size > 1, `${nodeName}: real model must visibly move during the complete cycle.`);
    await preview.locator(".twin-source-badge").waitFor();
    assert.match(await preview.locator(".twin-source-badge").innerText(), /测试业务接口/);
    assert.equal(await preview.locator(".standalone-3d-toolbar").count(), 0);
    assert.equal(await preview.getByRole("button", { name: "保存场景", exact: true }).count(), 0);
    assert.equal(await preview.locator("canvas").count(), 1);
    await preview.screenshot({ path: join(output, `${protocol}-preview.png`) });
    await writeFile(join(output, `${protocol}-motion.json`), JSON.stringify(samples, null, 2) + "\n", { mode: 0o600 });
    console.log(`PASS: ${protocol}: ${samples.length} coherent observations cover the ${cycleDurationMs / 1000}s cycle, ${geometry.phases.length} phases and ${bindingCount} actual model nodes; read-only preview identifies test source.`);
    return samples.length;
  };
  const restSamples = await verifyMotion("rest");
  drive = await call(`/projects/${projectId}/twin-drive`);
  assert.deepEqual(drive.config, definitions.rest, "Refuse to replace an example that has been edited during verification.");
  drive = await call(`/projects/${projectId}/twin-drive`, { method: "PUT", data: { expectedRevision: drive.revision, config: definitions.websocket } });
  assert.deepEqual(drive.config, definitions.websocket);
  await saveReceipt({ protocol: "websocket" });
  await preview.reload();
  const websocketSamples = await verifyMotion("websocket");
  drive = await call(`/projects/${projectId}/twin-drive`);
  assert.deepEqual(drive.config, definitions.websocket);
  await call(`/projects/${projectId}/twin-drive`, { method: "PUT", data: { expectedRevision: drive.revision, config: definitions.rest } });
  await preview.reload();
  await preview.waitForFunction(() => (window.__businessExampleMotion || []).some((sample) => sample.protocol === "rest"), undefined, { timeout: 15000 });
  assert.deepEqual((await call(`/projects/${projectId}/scene`)).scene, scene, "Preview and source switching must not modify the scene document.");
  const projectsAfter = (await call("/projects?limit=100")).projects;
  assert.deepEqual(projectsAfter.filter((project) => project.id !== projectId).map((project) => project.id).sort(), projectsBefore.filter((project) => project.id !== projectId).map((project) => project.id).sort());
  assert.ok(writes.filter((request) => request.path.startsWith("/api/v1/projects/")).every((request) => request.path.startsWith(`/api/v1/projects/${projectId}/`)), "No existing project may be written during this integration.");
  assert.deepEqual(failures, [], "The actual application must have no uncaught browser errors.");
  await saveReceipt({ state: "verified", protocol: "rest", sceneRevision: scene.revision, restSamples, websocketSamples });
  console.log(`PASS: Existing projects preserved; example retained at ${receipt.previewUrl}`);
  console.log(`Local receipt and visual/matrix evidence: ${output}`);
} catch (error) {
  integrationError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  if (authenticated && restoreExampleConfiguration) {
    try { await restoreExampleConfiguration(); }
    catch (error) { cleanupErrors.push(error); }
  }
  if (authenticated) {
    try {
      const response = await context.request.post(origin + "/api/v1/auth/logout", { headers: { Origin: origin } });
      assert.equal(response.status(), 204, "The smoke session must be revoked.");
      console.log("PASS: This integration's temporary login session was revoked.");
    }
    catch (error) { cleanupErrors.push(error); }
  }
  try { await browser?.close(); }
  catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) throw new AggregateError([
    ...(integrationError ? [integrationError] : []), ...cleanupErrors,
  ], "Business integration cleanup failed; configuration, session and browser failures are retained.");
}
