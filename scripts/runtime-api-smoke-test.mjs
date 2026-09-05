import { createHash } from "node:crypto";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const keepProject = args.includes("--keep-project");
const positionalArgs = args.filter((argument) => argument !== "--keep-project");
const apiBase = (positionalArgs[0] ?? "http://127.0.0.1:8791").replace(/\/$/, "");
const bootstrapToken = positionalArgs[1];
const mockBase = (positionalArgs[2] ?? "http://127.0.0.1:8790").replace(/\/$/, "");

if (!bootstrapToken || bootstrapToken.length < 20 || bootstrapToken.length > 200) {
  throw new Error("Pass an ephemeral bootstrap token of 20 to 200 characters as the second argument.");
}

const apiUrl = new URL(apiBase);
if (apiUrl.protocol !== "http:" || !new Set(["127.0.0.1", "localhost"]).has(apiUrl.hostname)) {
  throw new Error("The runtime smoke test only accepts a local HTTP Worker URL.");
}

const identity = createHash("sha256").update(bootstrapToken).digest("hex").slice(0, 16);
const testEmail = `runtime-smoke-${identity}@example.invalid`;
const testPassword = `Smoke-${bootstrapToken}!`;

let sessionCookie = null;
let projectId = null;

const createSmokeGltf = () => {
  const positions = new Float32Array([
    -1, -1, -1,
    1, -1, -1,
    1, 1, -1,
    -1, 1, -1,
    -1, -1, 1,
    1, -1, 1,
    1, 1, 1,
    -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
    1, 5, 6, 1, 6, 2,
    0, 3, 7, 0, 7, 4,
  ]);
  const positionBytes = Buffer.from(
    positions.buffer,
    positions.byteOffset,
    positions.byteLength,
  );
  const indexBytes = Buffer.from(
    indices.buffer,
    indices.byteOffset,
    indices.byteLength,
  );
  const binary = Buffer.concat([positionBytes, indexBytes]);
  return JSON.stringify({
    asset: { generator: "factory-runtime-smoke-test", version: "2.0" },
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        max: [1, 1, 1],
        min: [-1, -1, -1],
        type: "VEC3",
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 36,
        type: "SCALAR",
      },
    ],
    buffers: [{
      byteLength: binary.byteLength,
      uri: `data:application/octet-stream;base64,${binary.toString("base64")}`,
    }],
    bufferViews: [
      { buffer: 0, byteLength: positionBytes.byteLength, byteOffset: 0, target: 34962 },
      {
        buffer: 0,
        byteLength: indexBytes.byteLength,
        byteOffset: positionBytes.byteLength,
        target: 34963,
      },
    ],
    materials: [{
      name: "SmokeDeviceMaterial",
      pbrMetallicRoughness: {
        baseColorFactor: [0.16, 0.5, 0.68, 1],
        metallicFactor: 0.15,
        roughnessFactor: 0.58,
      },
    }],
    meshes: [{
      name: "SmokeDeviceMesh",
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
    }],
    nodes: [{ mesh: 0, name: "SmokeDeviceNode" }],
    scene: 0,
    scenes: [{ name: "RuntimeSmokeScene", nodes: [0] }],
  });
};

const call = async (path, options = {}, expectedStatus = 200) => {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (sessionCookie) headers.set("cookie", sessionCookie);
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned HTTP ${response.status}, expected ${expectedStatus}: ${text}`);
  }
  return { body, response };
};

const controlDevice = async (path, body) => {
  const response = await fetch(`${mockBase}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    method: "POST",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Mock control ${path} returned HTTP ${response.status}: ${text}`);
  }
};

try {
  const bootstrapStatus = await call("/api/v1/auth/bootstrap-status");
  const auth = bootstrapStatus.body?.setupRequired
    ? await call("/api/v1/auth/bootstrap", {
        body: JSON.stringify({
          displayName: "Runtime Smoke Admin",
          email: testEmail,
          password: testPassword,
        }),
        headers: { "x-bootstrap-token": bootstrapToken },
        method: "POST",
      }, 201)
    : await call("/api/v1/auth/login", {
        body: JSON.stringify({ email: testEmail, password: testPassword }),
        method: "POST",
      });
  const setCookie = auth.response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Authentication response did not set a session cookie.");
  sessionCookie = setCookie.split(";", 1)[0];

  const projectResponse = await call("/api/v1/projects", {
    body: JSON.stringify({ name: "Runtime smoke test" }),
    method: "POST",
  }, 201);
  projectId = projectResponse.body?.project?.id;
  if (typeof projectId !== "string") throw new Error("Project creation response omitted project.id.");

  const assetResponse = await call(`/api/v1/projects/${projectId}/assets`, {
    body: JSON.stringify({
      assetId: "DEVICE-001",
      assetType: "equipment",
      metadata: { purpose: "local-runtime-smoke-test" },
      modelNode: "SmokeDeviceNode",
      name: "模拟设备 001",
    }),
    method: "POST",
  }, 201);
  const assetRecordId = assetResponse.body?.asset?.id;
  if (typeof assetRecordId !== "string") throw new Error("Asset creation response omitted asset.id.");

  const modelResponse = await call(
    `/api/v1/projects/${projectId}/model-assets?filename=runtime-smoke-device.gltf`,
    {
      body: createSmokeGltf(),
      headers: { "content-type": "model/gltf+json" },
      method: "POST",
    },
    201,
  );
  const modelAssetId = modelResponse.body?.modelAsset?.id;
  if (typeof modelAssetId !== "string") {
    throw new Error("Model upload response omitted modelAsset.id.");
  }

  await call(`/api/v1/projects/${projectId}/canvas`, {
    body: JSON.stringify({
      deleteNodeIds: [],
      expectedRevision: 0,
      theme: {
        accentColor: "#35d07f",
        backgroundColor: "#04111e",
        borderColor: "#24506a",
        mode: "dark",
        surfaceColor: "#0a2233",
        textColor: "#e6f8ff",
      },
      upsertNodes: [{
        dataBindingRefs: [],
        height: 900,
        id: "runtime-smoke-model",
        props: {
          appearanceOverrides: {},
          autoRotate: true,
          backgroundColor: "#071525",
          backgroundOpacity: 1,
          cameraFov: 42,
          cameraView: "isometric",
          environmentLightColor: "#daf4ff",
          environmentLightIntensity: 2.1,
          keyLightColor: "#ffffff",
          keyLightIntensity: 2.4,
          rotationSpeed: 0.35,
          showGrid: true,
          transformOverrides: {},
        },
        resourceRefs: [modelAssetId],
        type: "model-3d",
        width: 1680,
        x: 120,
        y: 90,
        zIndex: 1,
      }],
    }),
    method: "PATCH",
  });

  const sourceResponse = await call(`/api/v1/projects/${projectId}/data-sources`, {
    body: JSON.stringify({
      config: {
        credentialRef: null,
        intervalSeconds: 2,
        timeoutMs: 1500,
        url: `${mockBase}/device/DEVICE-001`,
      },
      name: "Local mock device",
      sourceType: "rest_polling",
    }),
    method: "POST",
  }, 201);
  const dataSourceId = sourceResponse.body?.dataSource?.id;
  if (typeof dataSourceId !== "string") throw new Error("Data source creation response omitted dataSource.id.");

  const bindings = [
    ["status", "$.values.status", "string", null],
    ["temperature", "$.values.temperature", "number", "°C"],
    ["pressure", "$.values.pressure", "number", "kPa"],
    ["alarmLevel", "$.values.alarmLevel", "number", null],
  ];
  for (const [metricKey, sourcePath, valueType, unit] of bindings) {
    await call(`/api/v1/projects/${projectId}/assets/${assetRecordId}/data-bindings`, {
      body: JSON.stringify({
        dataSourceId,
        metricKey,
        sourcePath,
        staleAfterSeconds: 6,
        unit,
        valueType,
      }),
      method: "POST",
    }, 201);
  }

  await controlDevice("/control/state", { status: "running" });
  const running = await call(`/api/v1/projects/${projectId}/assets/${assetRecordId}/runtime-state`);
  if (
    running.body?.runtimeState?.asset?.assetId !== "DEVICE-001"
    || running.body?.runtimeState?.values?.status !== "running"
    || running.body?.runtimeState?.metrics?.length !== 4
  ) {
    throw new Error(`Running runtime state did not contain the expected mapped values: ${JSON.stringify(running.body)}`);
  }

  await controlDevice("/control/state", { status: "warning" });
  const warning = await call(`/api/v1/projects/${projectId}/assets/${assetRecordId}/runtime-state`);
  if (
    warning.body?.runtimeState?.values?.status !== "warning"
    || warning.body?.runtimeState?.values?.alarmLevel !== 1
  ) {
    throw new Error(`Warning runtime state was not mapped correctly: ${JSON.stringify(warning.body)}`);
  }

  await controlDevice("/control/outage");
  const outage = await call(
    `/api/v1/projects/${projectId}/assets/${assetRecordId}/runtime-state`,
    {},
    502,
  );
  if (outage.body?.error !== "data_source_http_error" || typeof outage.body?.requestId !== "string") {
    throw new Error(`Outage response did not expose the expected error and requestId: ${JSON.stringify(outage.body)}`);
  }

  console.log(JSON.stringify({
    checks: [
      "authenticated runtime endpoint",
      "REST response collection",
      "strict four-field mapping",
      "self-contained GLTF upload and 3D canvas binding",
      "running state",
      "warning state",
      "HTTP 503 surfaced as data_source_http_error",
    ],
    event: "runtime_api_smoke_test_passed",
    keptProject: keepProject,
    previewUrl: `${apiBase}/#/projects/${projectId}/preview`,
    projectId,
    requestId: warning.body.requestId,
  }));
} finally {
  try {
    await controlDevice("/control/recover");
    await controlDevice("/control/state", { status: "running" });
  } catch (error) {
    console.error(JSON.stringify({
      event: "runtime_smoke_device_cleanup_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  }
  if (projectId && sessionCookie && !keepProject) {
    try {
      await call(`/api/v1/projects/${projectId}`, { method: "DELETE" });
    } catch (error) {
      console.error(JSON.stringify({
        event: "runtime_smoke_project_cleanup_failed",
        message: error instanceof Error ? error.message : String(error),
        projectId,
      }));
      process.exitCode = 1;
    }
  }
}
