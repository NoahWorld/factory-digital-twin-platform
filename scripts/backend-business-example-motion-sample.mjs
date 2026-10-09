// Samples the existing independent, real-backend example. No generated feedback or pose writes.
// --baseline loads the explicitly captured baseline Vite module; normal mode loads current code.
// PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/backend-business-example-motion-sample.mjs [--baseline]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = "http://127.0.0.1:5173";
const directory = join(root, "deploy/local/.local/business-api-example");
const output = join(directory, "motion-performance");
const baseline = process.argv.includes("--baseline");
const phase = baseline ? "baseline" : "smoothed";
const geometry = JSON.parse(await readFile(join(root, "shared/handling-cell-geometry.json"), "utf8"));
const cycleDurationMs = geometry.phases.reduce((sum, phase) => sum + phase.durationMs, 0);
const durationMs = cycleDurationMs + 2000;
const receipt = JSON.parse(await readFile(join(directory, "project.json"), "utf8"));
assert.equal(receipt.owner, "backend-business-example-smoke/v1");
assert.equal(receipt.state, "verified", "Only the independently created, verified example can be tested.");
const projectId = receipt.projectId;
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
await mkdir(output, { recursive: true, mode: 0o700 });
const sourceSha256 = createHash("sha256").update(await readFile(join(root, "apps/web/src/scene/twin-drive-runtime.ts"))).digest("hex");
let runtimeModule;
if (baseline) runtimeModule=await readFile(join(output,"baseline-runtime.mjs"),"utf8");
else {
  const response=await fetch(origin+"/src/scene/twin-drive-runtime.ts");
  assert.equal(response.status,200,"The final production runtime module must be available.");
  runtimeModule=await response.text();
  assert.ok(runtimeModule.includes("class TwinDriveRuntime"),"Expected the actual Vite runtime module.");
  await writeFile(join(output,`${phase}-runtime.mjs`),runtimeModule,{mode:0o600});
}
const runtimeModuleSha256=createHash("sha256").update(runtimeModule).digest("hex");

// After the unmodified production tick, read the actual model matrices every render frame.
const observer = `
const performanceOriginalTick = TwinDriveRuntime.prototype.tick;
TwinDriveRuntime.prototype.tick = function (...args) {
  const result = performanceOriginalTick.apply(this, args);
  if (this.attachment.config.source !== 'api' || !this.bindings.some(b => b.record.id === 'handling-cell')) return result;
  const state = this.attachment.source.getState(), snapshot = state.snapshot;
  const samples = window.__motionFrames || (window.__motionFrames = []);
  const at = performance.now();
  window.__motionDiagnostics = {...this.diagnostics};
  if (window.__collectMotion && samples.length < 12000) samples.push({at, frameAt:args[2] ?? null, wall: args[0], connected: state.connected,
    status: this.diagnostics.status, sequence: snapshot?.sequence ?? null,
    timestamp: snapshot?.timestamp ?? null, source: snapshot?.source ?? null,
    displayedPoints:this.displayValues ? Object.fromEntries(this.displayValues) : null,
    transition:this.transition ? {from:Object.fromEntries(this.transition.from),to:Object.fromEntries(this.transition.to),
      startedAt:this.transition.startedAt,durationMs:this.transition.durationMs} : null,
    points: snapshot ? Object.fromEntries(Object.entries(snapshot.points).map(([id,p]) => [id,p.value])) : null,
    nodes: this.bindings.map(b => {
      const expected = b.object.parent.matrixWorld.clone().invert().multiply(b.record.model.matrixWorld).multiply(b.desired);
      const definition = b.definition;
      const parent = definition.parentBindingId ? this.bindings.find(candidate => candidate.definition.id === definition.parentBindingId) : null;
      const own = parent ? parent.motion.clone().invert().multiply(b.motion) : b.motion;
      // Read each binding's scalar and independently rebuild its own motion, with the
      // logical FK parent removed. Joint angles/wheels cannot be read as world Euler Y.
      const displayed = this.displayValues ? this.displayValues.get(definition.pointId) : snapshot?.points[definition.pointId]?.value;
      const value = displayed * definition.valueScale + definition.valueOffset;
      const axis = new Vector3(...definition.axis), pivot = new Vector3(...definition.pivot);
      const expectedOwn = definition.kind === 'translation'
        ? new Matrix4().makeTranslation(axis.multiplyScalar(value))
        : new Matrix4().makeTranslation(pivot).multiply(new Matrix4().makeRotationAxis(axis,value*Math.PI/180))
          .multiply(new Matrix4().makeTranslation(pivot.clone().negate()));
      return {id:definition.id, pointId:definition.pointId, node:b.object.name,
        matrix:[...b.object.matrix.elements], expected:[...expected.elements],
        own:[...own.elements], expectedOwn:[...expectedOwn.elements], displayed};
    })});
  return result;
};
`;
const quantile = (values, p) => {
  assert.ok(values.length, "Sampling produced no frame intervals.");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const changed = (left, right) => left.matrix.some((value, index) => Math.abs(value - right.matrix[index]) > 1e-8);
const summarize = (frames, definitions) => {
  const live = frames.filter(frame => frame.status === "live" && frame.source === "api");
  assert.ok(live.length >= 50, "Not enough real render frames for the measurement.");
  const elapsed = live.at(-1).at - live[0].at;
  const gaps = live.slice(1).map((frame, index) => frame.at - live[index].at);
  const observations = live.filter((frame, index) => !index || frame.sequence !== live[index - 1].sequence);
  assert.ok(Date.parse(observations.at(-1).timestamp) - Date.parse(observations[0].timestamp) >= cycleDurationMs,
    "The measurement must cover a complete real business cycle, including stationary phases.");
  assert.equal(new Set(observations.map(frame => frame.points["business-phase"])).size, geometry.phases.length,
    "Every actual business phase must be observed.");
  const observationGaps = observations.slice(1).map((frame, index) => frame.at - observations[index].at);
  assert.equal(definitions.rest.bindings.length, 15, "The combined model must retain all 15 actual motion bindings.");
  const nodeMetrics = definitions.rest.bindings.map(binding => {
    const node = binding.target.nodeName;
    const values = live.map(frame => frame.nodes.find(value => value.id === binding.id));
    assert.ok(values.every(Boolean));
    let changes = 0, intermediateFrames = 0;
    const point = binding.pointId;
    const range = definitions.rest.points.find(value => value.id === point);
    assert.ok(range);
    for (let i = 0; i < live.length; i++) {
      const value = values[i];
      assert.ok(value.matrix.every((v, index) => Math.abs(v - value.expected[index]) < 1e-8), "The actual GLB transform must equal the production displayed pose.");
      assert.ok(value.own.every((v, index) => Math.abs(v - value.expectedOwn[index]) < 1e-8),
        `${node}: the actual own motion must match the displayed scalar and declared axis/pivot, independently of parent FK.`);
      assert.ok(Number.isFinite(value.displayed) && value.displayed >= range.min - 1e-6 && value.displayed <= range.max + 1e-6,
        `${node}: the displayed scalar must stay inside the real feedback range.`);
      if (i && changed(value, values[i - 1])) changes++;
      const target = live[i].points[point];
      if (live[i].transition) {
        const transition=live[i].transition;
        assert.ok(transition.durationMs>0 && transition.durationMs<=1000,"Display interpolation must have a finite duration.");
        assert.equal(transition.to[point],target,"The endpoint must be the latest real observation.");
        const lower=Math.min(transition.from[point],target), upper=Math.max(transition.from[point],target);
        assert.ok(value.displayed >= lower - 1e-6 && value.displayed <= upper + 1e-6,
          `${node}: displayed pose cannot overshoot the current displayed-to-received endpoint interval.`);
        if (value.displayed > lower + 1e-6 && value.displayed < upper - 1e-6) intermediateFrames++;
      } else {
        assert.ok(Math.abs(value.displayed - target) < 1e-6, `${node}: with no transition the model must display the actual received endpoint.`);
      }
      if (live[i].displayedPoints) assert.ok(Math.abs(value.displayed-live[i].displayedPoints[point])<1e-6,
        `${node}: the actual model motion must agree with the runtime's current interpolated scalar.`);
    }
    assert.ok(changes > 0, `${node}: must actually move during the complete business cycle.`);
    return {node, changes, motionHz: changes * 1000 / elapsed,
      heldFramePercent: 100 * (live.length - 1 - changes) / (live.length - 1), intermediateFrames};
  });
  return {frames: live.length, durationMs: elapsed, renderedHz: (live.length - 1) * 1000 / elapsed,
    medianFrameMs: quantile(gaps, .5), p95FrameMs: quantile(gaps, .95), framesOver50Ms: gaps.filter(gap => gap > 50).length,
    observations: observations.length, observationHz: (observations.length - 1) * 1000 / elapsed,
    medianObservationMs: quantile(observationGaps, .5), nodes: nodeMetrics};
};

let browser, context, page, authenticated = false, failure, originalConfig, protocolWritten;
const errors = [], writes = [], reports = {};
let call;
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {})});
  context = await browser.newContext({viewport: {width: 1440, height: 950}});
  context.on("request", request => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push({method:request.method(),path:new URL(request.url()).pathname});
  });
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__testGatewaySockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        if (new URL(String(args[0]),location.href).pathname === "/api/v1/twin-drive") {
          window.__testGatewaySockets.push(this);
          this.addEventListener("message", event => {
            // Explicit packet-loss injection for a finite endpoint test. No fake message is delivered.
            if (window.__holdGatewayFeedback && JSON.parse(String(event.data)).type === "snapshot") event.stopImmediatePropagation();
          });
        }
      }
    };
  });
  await context.route(/\/src\/scene\/twin-drive-runtime\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    // Pin the exact production module captured at start so all protocol rounds share one version.
    await route.fulfill({response,body:runtimeModule + observer});
  });
  call = async (path, {method="GET",data}={}) => {
    const url = origin + "/api/v1" + path;
    if (method !== "GET") writes.push({method,path:new URL(url).pathname});
    const response = await context.request.fetch(url,{method,data,headers:{Origin:origin}});
    assert.equal(response.status(), 200, `${method} ${path} returned HTTP ${response.status()}.`);
    return response.json();
  };
  await call("/auth/login",{method:"POST",data:JSON.parse(await readFile(join(root,"deploy/local/.local/admin.json"),"utf8"))});
  authenticated=true;
  const projectsBefore=(await call("/projects?limit=100")).projects.map(project=>project.id).sort();
  const {project}=await call(`/projects/${projectId}`);
  assert.equal(project.name,receipt.name,"Refuse a renamed example.");
  const initialScene=(await call(`/projects/${projectId}/scene`)).scene;
  page=await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(origin+"/#/projects");
  const definitions=await page.evaluate(async()=>{
    const example=await import("/src/twin/business-api-example.ts");
    return {instances:example.businessApiExampleInstances,settings:example.businessApiExampleSettings,
      rest:example.businessApiExampleConfig(),websocket:example.businessApiExampleConfig("websocket")};
  });
  assert.deepEqual(initialScene.instances,definitions.instances,"Refuse an edited example scene.");
  assert.deepEqual(initialScene.settings,definitions.settings);
  let drive=await call(`/projects/${projectId}/twin-drive`);
  originalConfig=drive.config;
  assert.deepEqual(originalConfig,definitions.rest,"Expected the retained REST default; do not overwrite a user change.");
  await page.goto(origin+`/#/projects/${projectId}/scene-preview`);
  for (const protocol of ["rest","websocket"]) {
    if (protocol !== "rest") {
      drive=await call(`/projects/${projectId}/twin-drive`);
      assert.deepEqual(drive.config,definitions.rest);
      drive=await call(`/projects/${projectId}/twin-drive`,{method:"PUT",data:{expectedRevision:drive.revision,config:definitions.websocket}});
      protocolWritten=definitions.websocket;
      await page.reload();
    }
    await page.waitForFunction(()=>window.__motionDiagnostics?.status==="live");
    await page.waitForTimeout(1000);
    await page.evaluate(()=>{window.__motionFrames=[];window.__collectMotion=true;});
    await page.waitForTimeout(durationMs);
    const frames=await page.evaluate(()=>{window.__collectMotion=false;return window.__motionFrames;});
    await writeFile(join(output,`${phase}-${protocol}-frames.json`),JSON.stringify(frames,null,2)+"\n",{mode:0o600});
    const report=summarize(frames,definitions);
    reports[protocol]=report;
    console.log(`${phase} ${protocol}: render=${report.renderedHz.toFixed(1)}Hz, frame p50/p95=${report.medianFrameMs.toFixed(1)}/${report.p95FrameMs.toFixed(1)}ms, source=${report.observationHz.toFixed(2)}Hz/${report.medianObservationMs.toFixed(1)}ms; `+report.nodes.map(n=>`${n.node}=${n.motionHz.toFixed(2)}Hz held=${n.heldFramePercent.toFixed(1)}% middle=${n.intermediateFrames}`).join(", "));
    await page.screenshot({path:join(output,`${phase}-${protocol}.png`)});
    if (!baseline) {
      for (const node of report.nodes) assert.ok(node.intermediateFrames>=20,`${node.node}: must show intermediate rendered poses, rather than hold and jump at source frequency.`);
      await page.evaluate(()=>{window.__holdGatewayFeedback=true;window.__motionFrames=[];window.__collectMotion=true;});
      await page.waitForTimeout(1250);
      const endpointFrames=await page.evaluate(()=>{window.__collectMotion=false;return window.__motionFrames;});
      await writeFile(join(output,`${phase}-${protocol}-endpoint.json`),JSON.stringify(endpointFrames,null,2)+"\n",{mode:0o600});
      assert.ok(endpointFrames.length>=30);
      assert.ok(endpointFrames.every(frame=>frame.connected && frame.status==="live"),"The endpoint test must finish before the real snapshot becomes stale.");
      assert.equal(new Set(endpointFrames.map(frame=>frame.sequence)).size,1,"The finite endpoint test must receive no additional snapshots.");
      const endpoint=endpointFrames.at(-1);
      for (const node of endpoint.nodes) {
        const point=node.pointId;
        assert.ok(Math.abs(node.displayed-endpoint.points[point])<1e-6,`${node.node}: must reach the actual received endpoint within the bounded interpolation duration.`);
        assert.ok(endpointFrames.filter(frame=>frame.at>=endpointFrames[0].at+1050).every(frame=>!changed(node,frame.nodes.find(n=>n.node===node.node))),`${node.node}: must hold the received endpoint, never extrapolate.`);
      }
      await page.evaluate(()=>{window.__holdGatewayFeedback=false;window.__motionFrames=[];window.__collectMotion=true;});
      await page.waitForFunction(()=>window.__motionFrames.some(frame=>frame.nodes.some(node=>Math.abs(node.displayed-frame.points[node.pointId])>1e-3)),undefined,{timeout:cycleDurationMs+5000});
      await context.setOffline(true);
      await page.evaluate(()=>{for (const socket of window.__testGatewaySockets)socket.close(1000,"local freeze verification");window.__motionFrames=[];window.__collectMotion=true;});
      await page.waitForFunction(()=>window.__motionDiagnostics?.status==="disconnected");
      await page.waitForTimeout(1500);
      const frozen=await page.evaluate(()=>{window.__collectMotion=false;return window.__motionFrames.filter(frame=>frame.status==="disconnected");});
      await writeFile(join(output,`${phase}-${protocol}-disconnect.json`),JSON.stringify(frozen,null,2)+"\n",{mode:0o600});
      assert.ok(frozen.length>=10);
      for (const node of frozen[0].nodes) assert.ok(frozen.every(frame=>!changed(node,frame.nodes.find(n=>n.node===node.node))),`${node.node}: disconnected matrices must freeze immediately.`);
      await context.setOffline(false);
      await page.reload();
      console.log(`PASS: ${protocol} interpolation stays inside received endpoints, reaches and holds the target, and freezes immediately on a real transport disconnect.`);
    }
  }
  assert.deepEqual((await call(`/projects/${projectId}/scene`)).scene,initialScene,"Performance sampling cannot change the scene.");
  assert.deepEqual((await call("/projects?limit=100")).projects.map(project=>project.id).sort(),projectsBefore,"No projects created or removed.");
  assert.ok(writes.filter(r=>r.path.startsWith("/api/v1/projects/")).every(r=>r.path===`/api/v1/projects/${projectId}/twin-drive`),"Only this independent example's protocol can be written.");
  assert.deepEqual(errors,[],"No uncaught browser errors.");
  await page.locator("canvas").waitFor();
  const environment=await page.evaluate(()=>{
    const canvas=document.querySelector("canvas"),gl=canvas?.getContext("webgl2");
    if (!gl)throw new Error("The actual WebGL2 scene is not loaded.");
    const debug=gl.getExtension("WEBGL_debug_renderer_info");
    return {userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
  });
  const finalSourceSha256=createHash("sha256").update(await readFile(join(root,"apps/web/src/scene/twin-drive-runtime.ts"))).digest("hex");
  assert.equal(finalSourceSha256,sourceSha256,"Runtime source changed during the final verification; repeat with the intended final version.");
  await writeFile(join(output,`${phase}-report.json`),JSON.stringify({phase,projectId,at:new Date().toISOString(),durationMs,
    runtimeModuleSha256,sourceSha256,sourcePath:"apps/web/src/scene/twin-drive-runtime.ts",environment,reports},null,2)+"\n",{mode:0o600});
  console.log(`Verified runtime source SHA-256: ${sourceSha256}; actual loaded Vite module SHA-256: ${runtimeModuleSha256}.`);
  console.log(`PASS: ${phase} measurements saved; no existing project or scene changes.`);
} catch(error) {
  failure=error;
  if (page && !page.isClosed()) {
    try {
      const diagnostic=await page.evaluate(()=>({runtime:window.__motionDiagnostics,frames:window.__motionFrames,
        notice:document.querySelector(".embedded-twin-status")?.textContent}));
      await writeFile(join(output,`${phase}-failure.json`),JSON.stringify({message:error.message,errors,writes,diagnostic},null,2)+"\n",{mode:0o600});
      await page.screenshot({path:join(output,`${phase}-failure.png`)});
    } catch(diagnosticError) {throw new AggregateError([error,diagnosticError],"Performance sampling failed and its diagnostic capture also failed.");}
  }
  throw error;
} finally {
  const cleanupErrors=[];
  if (context) {
    try {await context.setOffline(false);} catch(error){cleanupErrors.push(error);}
    if (protocolWritten) {
      try {
        const drive=await call(`/projects/${projectId}/twin-drive`);
        assert.deepEqual(drive.config,protocolWritten,"Refuse to overwrite an intervening configuration edit during restoration.");
        await call(`/projects/${projectId}/twin-drive`,{method:"PUT",data:{expectedRevision:drive.revision,config:originalConfig}});
        console.log("PASS: The independent example's original REST configuration was restored.");
      } catch(error) {cleanupErrors.push(error);}
    }
    if (authenticated) {
      try {const response=await context.request.post(origin+"/api/v1/auth/logout",{headers:{Origin:origin}});assert.equal(response.status(),204);console.log("PASS: This performance test's temporary login session was revoked (204).");}
      catch(error){cleanupErrors.push(error);}
    }
  }
  await browser?.close();
  if (cleanupErrors.length)throw new AggregateError([...(failure?[failure]:[]),...cleanupErrors],"Performance sampling cleanup failed.");
}
