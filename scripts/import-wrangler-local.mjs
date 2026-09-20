import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const apply = process.argv.includes("--apply");
const verifyOnly = process.argv.includes("--verify-only");
const tenant = "local";
const compose = [
  "compose",
  "--env-file",
  "deploy/local/.env",
  "-f",
  "deploy/local/compose.yml",
];

const fail = (message) => {
  throw new Error(message);
};
if (apply && verifyOnly) fail("Use either --apply or --verify-only, not both");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlJson = (value) => `${sqlString(JSON.stringify(value))}::jsonb`;
const sqlNullable = (value) => (value === null || value === undefined ? "NULL" : sqlString(value));
const asBoolean = (value) => value === 1 || value === true;

function parseEnv(path) {
  const result = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail(`Invalid environment line in ${path}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function sqliteFiles(directory) {
  if (!existsSync(directory)) fail(`Wrangler state directory is missing: ${directory}`);
  return readdirSync(directory, { recursive: true })
    .filter((entry) => String(entry).endsWith(".sqlite"))
    .map((entry) => join(directory, String(entry)));
}

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table),
  );
}

function selectSourceDatabase(directory, requiredTable) {
  const candidates = [];
  for (const path of sqliteFiles(directory)) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (!tableExists(db, requiredTable)) continue;
      const count = Number(db.prepare(`SELECT count(*) AS count FROM ${requiredTable}`).get().count);
      candidates.push({ path, count });
    } finally {
      db.close();
    }
  }
  if (candidates.length === 0) fail(`No Wrangler database contains ${requiredTable}`);
  candidates.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  if (candidates.length > 1 && candidates[0].count === candidates[1].count) {
    fail(`More than one Wrangler database has ${candidates[0].count} ${requiredTable} rows`);
  }
  return candidates[0].path;
}

function snapshotDatabase(source, destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  execFileSync("sqlite3", ["-cmd", ".timeout 10000", source, `.backup '${destination}'`], {
    cwd: root,
    stdio: "inherit",
  });
}

function rows(db, table, order = "rowid") {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
}

function queryPostgres(sql, { input } = {}) {
  const output = execFileSync(
    "docker",
    [...compose, "exec", "-T", "postgres", "psql", "-X", "-U", "twin", "-d", "factory_twin", ...(input ? [] : ["-Atc", sql])],
    {
      cwd: root,
      encoding: "utf8",
      input,
      stdio: input ? ["pipe", "inherit", "inherit"] : ["ignore", "pipe", "inherit"],
    },
  );
  return typeof output === "string" ? output.trim() : "";
}

function encodePathPart(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function signingKey(secret, date, region) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

async function signedS3Request({ env, key, method, body, contentType }) {
  const endpoint = new URL(env.S3_PUBLIC_ENDPOINT ?? "http://127.0.0.1:18333");
  const bucket = env.S3_BUCKET ?? "factory-twin";
  const region = env.S3_REGION ?? "us-east-1";
  const access = env.S3_ACCESS_KEY;
  const secret = env.S3_SECRET_KEY;
  if (!access || !secret) fail("S3 credentials are missing from deploy/local/.env");

  const canonicalUri = `/${encodePathPart(bucket)}/${key.split("/").map(encodePathPart).join("/")}`;
  const url = new URL(canonicalUri, endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = hash(body ?? Buffer.alloc(0));
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hash(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(secret, date, region))
    .update(stringToSign)
    .digest("hex");
  const requestHeaders = {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
  };
  delete requestHeaders.host;
  return fetch(url, { method, headers: requestHeaders, body });
}

async function readStoredObject(env, resource) {
  const response = await signedS3Request({ env, key: resource.object_key, method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) fail(`S3 GET failed for ${resource.object_key}: ${response.status} ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function uploadObjects(env, resources) {
  for (const resource of resources) {
    const source = readFileSync(resource.snapshotPath);
    const existing = await readStoredObject(env, resource);
    if (existing !== null) {
      if (existing.length !== resource.byte_size || hash(existing) !== resource.sha256) {
        fail(`S3 object collision has different content: ${resource.object_key}`);
      }
      console.log(`Object already verified: ${resource.object_key}`);
      continue;
    }
    const response = await signedS3Request({
      env,
      key: resource.object_key,
      method: "PUT",
      body: source,
      contentType: resource.content_type,
    });
    if (!response.ok) {
      fail(`S3 PUT failed for ${resource.object_key}: ${response.status} ${await response.text()}`);
    }
    const stored = await readStoredObject(env, resource);
    if (stored === null || stored.length !== resource.byte_size || hash(stored) !== resource.sha256) {
      fail(`S3 verification failed after upload: ${resource.object_key}`);
    }
    console.log(`Uploaded and verified: ${resource.object_key}`);
  }
}

function canvasTheme(row) {
  return {
    mode: row.theme_mode,
    presetId: row.theme_preset_id,
    backgroundPattern: row.theme_background_pattern,
    fontFamily: row.theme_font_family,
    glowIntensity: row.theme_glow_intensity,
    panelRadius: row.theme_panel_radius,
    backgroundColor: row.background_color,
    surfaceColor: row.theme_surface_color,
    textColor: row.theme_text_color,
    accentColor: row.theme_accent_color,
    borderColor: row.theme_border_color,
  };
}

function canvasNode(row) {
  return {
    id: row.id,
    type: row.node_type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    zIndex: row.z_index,
    props: JSON.parse(row.props_json),
    resourceRefs: JSON.parse(row.resource_refs_json),
    dataBindingRefs: JSON.parse(row.data_binding_refs_json),
  };
}

function sceneSettings(row) {
  return {
    animationSpeed: row.animation_speed,
    autoRotate: asBoolean(row.auto_rotate),
    backgroundColor: row.background_color,
    backgroundOpacity: row.background_opacity,
    cameraFov: row.camera_fov,
    cameraView: row.camera_view,
    environmentLightColor: row.environment_light_color,
    environmentLightIntensity: row.environment_light_intensity,
    keyLightColor: row.key_light_color,
    keyLightIntensity: row.key_light_intensity,
    modelScale: row.model_scale,
    playAnimations: asBoolean(row.play_animations),
    rotationSpeed: row.rotation_speed,
    showGrid: asBoolean(row.show_grid),
  };
}

function sceneInstance(row) {
  return {
    id: row.id,
    label: row.label,
    modelAssetId: row.model_asset_id,
    assetId: row.business_asset_key,
    renderMode: row.render_mode,
    visible: asBoolean(row.visible),
    transform: {
      position: [row.position_x, row.position_y, row.position_z],
      rotation: [row.rotation_x, row.rotation_y, row.rotation_z],
      scale: [row.scale_x, row.scale_y, row.scale_z],
    },
    sortOrder: row.sort_order,
    animation: {
      enabled: asBoolean(row.animation_enabled),
      speed: row.animation_speed,
    },
    appearance: {
      color: row.color_override,
      opacity: row.opacity,
    },
  };
}

function resourceInspection(row) {
  const inspection = row.inspection_json ? JSON.parse(row.inspection_json) : null;
  if (row.source && row.source !== "upload" && inspection) {
    inspection.migratedProvenance = {
      source: row.source,
      sourceImageAssetId: row.source_image_asset_id,
      generation: row.generation_json ? JSON.parse(row.generation_json) : null,
    };
  }
  return inspection;
}

function generateSql(data, ownerId, migrationId) {
  const lines = ["\\set ON_ERROR_STOP on", "", "BEGIN;", "", "DO $migration$", "BEGIN"];
  lines.push(
    `  IF NOT EXISTS (SELECT 1 FROM users WHERE id=${sqlString(ownerId)} AND tenant_id=${sqlString(tenant)} AND active=true) THEN`,
    "    RAISE EXCEPTION 'Local migration owner is missing or inactive';",
    "  END IF;",
    `  IF EXISTS (SELECT 1 FROM projects WHERE id IN (${data.projects.map((row) => sqlString(row.id)).join(",")})) THEN`,
    "    RAISE EXCEPTION 'One or more Wrangler project ids already exist';",
    "  END IF;",
    "END",
    "$migration$;",
    "",
  );

  for (const row of data.projects) {
    lines.push(
      `INSERT INTO projects(id,tenant_id,name,project_type,status,created_at,updated_at) VALUES(${[
        row.id,
        tenant,
        row.name,
        row.project_type,
        row.status,
        row.created_at,
        row.updated_at,
      ].map(sqlString).join(",")});`,
      `INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES(${sqlString(tenant)},${sqlString(row.id)},${sqlString(ownerId)},'owner');`,
    );
  }

  for (const row of data.canvases) {
    lines.push(
      `INSERT INTO documents(tenant_id,project_id,kind,revision,settings,updated_at) VALUES(${sqlString(tenant)},${sqlString(row.project_id)},'canvas',${row.revision},${sqlJson(canvasTheme(row))},${sqlString(row.updated_at)}::timestamptz);`,
    );
  }
  for (const row of data.scenes) {
    lines.push(
      `INSERT INTO documents(tenant_id,project_id,kind,revision,settings,linked_project_id,updated_at) VALUES(${sqlString(tenant)},${sqlString(row.project_id)},'scene',${row.revision},${sqlJson(sceneSettings(row))},${sqlNullable(row.linked_2d_project_id)},${sqlString(row.updated_at)}::timestamptz);`,
    );
  }
  for (const row of data.nodes) {
    lines.push(
      `INSERT INTO document_items(tenant_id,project_id,id,sort_order,body) VALUES(${sqlString(tenant)},${sqlString(row.project_id)},${sqlString(row.id)},${row.z_index},${sqlJson(canvasNode(row))});`,
    );
  }
  for (const row of data.instances) {
    lines.push(
      `INSERT INTO document_items(tenant_id,project_id,id,sort_order,body) VALUES(${sqlString(tenant)},${sqlString(row.project_id)},${sqlString(row.id)},${row.sort_order},${sqlJson(sceneInstance(row))});`,
    );
  }
  for (const row of data.resources) {
    lines.push(
      `INSERT INTO resources(id,tenant_id,project_id,kind,object_key,filename,content_type,byte_size,sha256,state,inspection,created_at) VALUES(${sqlString(row.id)},${sqlString(tenant)},${sqlString(row.project_id)},${sqlString(row.kind)},${sqlString(row.object_key)},${sqlString(row.original_filename)},${sqlString(row.content_type)},${row.byte_size},${sqlString(row.sha256)},'ready',${row.inspection === null ? "NULL" : sqlJson(row.inspection)},${sqlString(row.created_at)}::timestamptz);`,
    );
  }
  for (const row of data.assets) {
    const body = {
      assetId: row.asset_key,
      name: row.name,
      assetType: row.asset_type,
      modelNode: row.model_node,
      metadata: JSON.parse(row.metadata_json),
    };
    lines.push(
      `INSERT INTO assets(id,tenant_id,project_id,asset_key,body,created_at,updated_at) VALUES(${sqlString(row.id)},${sqlString(tenant)},${sqlString(row.project_id)},${sqlString(row.asset_key)},${sqlJson(body)},${sqlString(row.created_at)}::timestamptz,${sqlString(row.updated_at)}::timestamptz);`,
    );
  }
  for (const row of data.sources) {
    const body = {
      sourceType: row.source_type,
      name: row.name,
      config: JSON.parse(row.config_json),
    };
    lines.push(
      `INSERT INTO data_sources(id,tenant_id,project_id,body,next_poll_at,created_at,updated_at) VALUES(${sqlString(row.id)},${sqlString(tenant)},${sqlString(row.project_id)},${sqlJson(body)},now(),${sqlString(row.created_at)}::timestamptz,${sqlString(row.updated_at)}::timestamptz);`,
    );
  }
  const assetById = new Map(data.assets.map((row) => [row.id, row]));
  for (const row of data.bindings) {
    const asset = assetById.get(row.asset_id);
    if (!asset) fail(`Binding ${row.id} references a missing asset`);
    const body = {
      dataSourceId: row.data_source_id,
      metricKey: row.metric_key,
      sourcePath: row.source_path,
      valueType: row.value_type,
      unit: row.unit,
      staleAfterSeconds: row.stale_after_seconds,
    };
    lines.push(
      `INSERT INTO data_bindings(id,tenant_id,project_id,asset_id,source_id,metric_key,body,created_at,updated_at) VALUES(${sqlString(row.id)},${sqlString(tenant)},${sqlString(asset.project_id)},${sqlString(row.asset_id)},${sqlString(row.data_source_id)},${sqlString(row.metric_key)},${sqlJson(body)},${sqlString(row.created_at)}::timestamptz,${sqlString(row.updated_at)}::timestamptz);`,
    );
  }
  for (const project of data.projects) {
    const details = {
      source: "local-wrangler-d1-r2",
      projectType: project.project_type,
      nodes: data.nodes.filter((row) => row.project_id === project.id).length,
      instances: data.instances.filter((row) => row.project_id === project.id).length,
      resources: data.resources.filter((row) => row.project_id === project.id).length,
    };
    lines.push(
      `INSERT INTO audit_events(tenant_id,user_id,project_id,action,request_id,details) VALUES(${sqlString(tenant)},${sqlString(ownerId)},${sqlString(project.id)},'migration.wrangler-local.import',${sqlString(migrationId)},${sqlJson(details)});`,
    );
  }
  lines.push("", "COMMIT;", "");
  return lines.join("\n");
}

function expectedCounts(data) {
  return {
    projects: data.projects.length,
    documents: data.canvases.length + data.scenes.length,
    documentItems: data.nodes.length + data.instances.length,
    canvasNodes: data.nodes.length,
    sceneInstances: data.instances.length,
    resources: data.resources.length,
    assets: data.assets.length,
    dataSources: data.sources.length,
    dataBindings: data.bindings.length,
  };
}

function verifyImported(data) {
  const ids = data.projects.map((row) => sqlString(row.id)).join(",");
  const result = queryPostgres(`
    SELECT json_build_object(
      'projects',(SELECT count(*) FROM projects WHERE id IN (${ids})),
      'documents',(SELECT count(*) FROM documents WHERE project_id IN (${ids})),
      'documentItems',(SELECT count(*) FROM document_items WHERE project_id IN (${ids})),
      'canvasNodes',(SELECT count(*) FROM document_items i JOIN documents d ON d.project_id=i.project_id WHERE i.project_id IN (${ids}) AND d.kind='canvas'),
      'sceneInstances',(SELECT count(*) FROM document_items i JOIN documents d ON d.project_id=i.project_id WHERE i.project_id IN (${ids}) AND d.kind='scene'),
      'resources',(SELECT count(*) FROM resources WHERE project_id IN (${ids})),
      'assets',(SELECT count(*) FROM assets WHERE project_id IN (${ids})),
      'dataSources',(SELECT count(*) FROM data_sources WHERE project_id IN (${ids})),
      'dataBindings',(SELECT count(*) FROM data_bindings WHERE project_id IN (${ids}))
    );
  `);
  const actual = JSON.parse(result);
  const expected = expectedCounts(data);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`PostgreSQL reconciliation failed. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
  return actual;
}

const d1Root = resolve(root, "apps/api/.wrangler/state/v3/d1");
const r2Root = resolve(root, "apps/api/.wrangler/state/v3/r2");
const d1Source = selectSourceDatabase(d1Root, "projects");
const r2Source = selectSourceDatabase(r2Root, "_mf_objects");
const timestamp = new Date().toISOString().replaceAll(":", "-");
const migrationId = `wrangler-local-${timestamp}`;
const destination = resolve(root, "deploy/local/.local/migrations", migrationId);
mkdirSync(destination, { recursive: true, mode: 0o700 });
const d1Snapshot = join(destination, "wrangler-d1.sqlite");
const r2Snapshot = join(destination, "wrangler-r2.sqlite");
snapshotDatabase(d1Source, d1Snapshot);
snapshotDatabase(r2Source, r2Snapshot);

const d1 = new DatabaseSync(d1Snapshot, { readOnly: true });
const r2 = new DatabaseSync(r2Snapshot, { readOnly: true });
const data = {
  projects: rows(d1, "projects", "created_at,id"),
  canvases: rows(d1, "project_canvases", "project_id"),
  nodes: rows(d1, "canvas_nodes", "project_id,z_index,id"),
  scenes: rows(d1, "standalone_3d_scenes", "project_id"),
  instances: rows(d1, "standalone_3d_instances", "project_id,sort_order,id"),
  assets: rows(d1, "assets", "project_id,asset_key"),
  sources: rows(d1, "data_sources", "project_id,id"),
  bindings: rows(d1, "asset_data_bindings", "asset_id,metric_key"),
};
const rawResources = [
  ...rows(d1, "model_assets", "created_at,id").map((row) => ({ ...row, kind: "model" })),
  ...rows(d1, "image_assets", "created_at,id").map((row) => ({ ...row, kind: "image", inspection_json: null })),
  ...rows(d1, "media_assets", "created_at,id").map((row) => ({ ...row, kind: "media", inspection_json: null })),
];
const r2Rows = new Map(rows(r2, "_mf_objects", "key").map((row) => [row.key, row]));
const blobRoot = join(dirname(r2Source), basename(r2Source, ".sqlite"), "blobs");
const fallbackBlobRoot = resolve(root, "apps/api/.wrangler/state/v3/r2/factory-digital-twin-project-files/blobs");
const objectSnapshotRoot = join(destination, "objects");
mkdirSync(objectSnapshotRoot, { recursive: true, mode: 0o700 });

data.resources = rawResources.map((row) => {
  const metadata = r2Rows.get(row.object_key);
  if (!metadata) fail(`R2 metadata is missing for ${row.object_key}`);
  const primary = join(blobRoot, metadata.blob_id);
  const fallback = join(fallbackBlobRoot, metadata.blob_id);
  const sourcePath = existsSync(primary) ? primary : fallback;
  if (!existsSync(sourcePath)) fail(`R2 blob is missing for ${row.object_key}`);
  const bytes = readFileSync(sourcePath);
  if (bytes.length !== row.byte_size || bytes.length !== metadata.size) {
    fail(`R2 byte-size mismatch for ${row.object_key}`);
  }
  if (hash(bytes) !== row.sha256) fail(`R2 SHA-256 mismatch for ${row.object_key}`);
  const snapshotPath = join(objectSnapshotRoot, row.object_key);
  mkdirSync(dirname(snapshotPath), { recursive: true, mode: 0o700 });
  copyFileSync(sourcePath, snapshotPath);
  return { ...row, inspection: resourceInspection(row), snapshotPath };
});
d1.close();
r2.close();

if (data.projects.length === 0) fail("The local Wrangler database contains no projects");
if (data.canvases.length + data.scenes.length !== data.projects.length) {
  fail("Every Wrangler project must have exactly one canvas or scene document");
}
if (data.resources.length !== r2Rows.size) {
  fail(`D1/R2 resource count mismatch: ${data.resources.length} metadata rows vs ${r2Rows.size} objects`);
}

const ownerId = queryPostgres(
  `SELECT id FROM users WHERE tenant_id=${sqlString(tenant)} AND active=true AND role='platform_admin' ORDER BY created_at LIMIT 1`,
);
if (!ownerId || ownerId.includes("\n")) fail("Exactly one local migration owner could not be selected");
const sql = generateSql(data, ownerId, migrationId);
const sqlPath = join(destination, "import.sql");
writeFileSync(sqlPath, sql, { mode: 0o600 });
const manifest = {
  version: 1,
  migrationId,
  createdAt: new Date().toISOString(),
  source: {
    d1: d1Source.replace(`${root}/`, ""),
    r2: r2Source.replace(`${root}/`, ""),
  },
  snapshots: {
    d1Sha256: hash(readFileSync(d1Snapshot)),
    r2Sha256: hash(readFileSync(r2Snapshot)),
    importSqlSha256: hash(sql),
  },
  counts: expectedCounts(data),
  objects: data.resources.map((row) => ({
    key: row.object_key,
    byteSize: row.byte_size,
    sha256: row.sha256,
  })),
};
writeFileSync(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

console.log(`Prepared Wrangler recovery: ${destination}`);
console.log(JSON.stringify(manifest.counts));
if (verifyOnly) {
  const verified = verifyImported(data);
  console.log(`Wrangler recovery reconciled: ${JSON.stringify(verified)}`);
  process.exit(0);
}
if (!apply) {
  console.log("Dry run complete. Re-run with --apply after creating a current backend backup.");
  process.exit(0);
}

const env = parseEnv(resolve(root, "deploy/local/.env"));
await uploadObjects(env, data.resources);
queryPostgres("", { input: sql });
const verified = verifyImported(data);
console.log(`Wrangler recovery applied and reconciled: ${JSON.stringify(verified)}`);
