import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "factory-resource-test-"));
const require = createRequire(import.meta.url);

const statement = ({ all = async () => ({ results: [] }), first = async () => null, run = async () => ({ meta: { changes: 1 } }) } = {}) => ({
  all,
  bind() { return this; },
  first,
  run,
});

try {
  execFileSync(process.execPath, [
    join(root, "apps/web/node_modules/typescript/bin/tsc"),
    "--target", "ES2022",
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--strict",
    "--skipLibCheck",
    "--rootDir", root,
    "--outDir", temporary,
    ...[
      "apps/api/src/resource-usage.ts",
      "apps/api/src/media-assets.ts",
      "apps/api/src/model-assets.ts",
      "shared/builtin-models.ts",
    ].map((file) => join(root, file)),
  ], { cwd: root, stdio: "inherit" });

  const {
    listProjectResourceUsage,
    requireResourceDeletionConfirmation,
  } = require(join(temporary, "apps/api/src/resource-usage.js"));
  const {
    deleteMediaAsset,
    uploadMediaAsset,
  } = require(join(temporary, "apps/api/src/media-assets.js"));
  const { deleteModelAsset } = require(join(temporary, "apps/api/src/model-assets.js"));

  const usageDatabase = {
    prepare(query) {
      assert.match(query, /FROM canvas_nodes/);
      return statement({
        all: async () => ({
          results: [
            { id: "node-a", node_type: "model-3d", resource_refs_json: '["resource-a","resource-a"]' },
            { id: "node-b", node_type: "image", resource_refs_json: '["resource-a","resource-b"]' },
          ],
        }),
      });
    },
  };
  const usage = await listProjectResourceUsage({ DB: usageDatabase }, "project-a");
  assert.equal(usage.get("resource-a").count, 2, "a canvas node must count once even if its reference list contains duplicates");
  assert.deepEqual(usage.get("resource-a").nodes.map((node) => node.id), ["node-a", "node-b"]);
  assert.equal(usage.get("resource-b").count, 1);
  assert.throws(
    () => requireResourceDeletionConfirmation("used.glb", usage.get("resource-a"), false),
    (error) => error.code === "resource_in_use" && error.status === 409,
  );
  assert.doesNotThrow(() => requireResourceDeletionConfirmation("used.glb", usage.get("resource-a"), true));

  await assert.rejects(
    () => deleteModelAsset({ DB: usageDatabase }, "project-a", "builtin:aqua-helix-hd-v1", true),
    (error) => error.code === "system_resource_immutable" && error.status === 403,
  );

  let storedObject = null;
  const storage = {
    async put(key, value, options) { storedObject = { key, value, options }; },
    async get() { return null; },
    async delete() {},
  };
  const insertDatabase = {
    prepare(query) {
      assert.match(query, /INSERT INTO media_assets/);
      return statement();
    },
  };
  await assert.rejects(
    () => uploadMediaAsset(
      new Request("https://local.test/upload", { method: "POST", body: new Uint8Array([1, 2, 3, 4, 5]) }),
      { DB: insertDatabase, PROJECT_FILES: storage },
      "project-a",
      "user-a",
      "fake.mp4",
    ),
    (error) => error.code === "media_extension_mismatch" && error.status === 415,
  );
  assert.equal(storedObject, null, "invalid media must not reach object storage");

  const minimalMp4 = new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const uploaded = await uploadMediaAsset(
    new Request("https://local.test/upload", { method: "POST", body: minimalMp4 }),
    { DB: insertDatabase, PROJECT_FILES: storage },
    "project-a",
    "user-a",
    "demo.mp4",
  );
  assert.equal(uploaded.mediaType, "video");
  assert.equal(uploaded.source, "upload");
  assert.equal(uploaded.usage.count, 0);
  assert.match(storedObject.key, /^media\/project-a\/.+\/original\.mp4$/);
  assert.equal(storedObject.options.httpMetadata.contentType, "video/mp4");

  let metadataDeleted = false;
  let objectDeleted = false;
  const mediaRow = {
    id: "media-used",
    project_id: "project-a",
    original_filename: "used.mp4",
    media_type: "video",
    format: "mp4",
    content_type: "video/mp4",
    byte_size: 16,
    sha256: "hash",
    object_key: "media/project-a/media-used/original.mp4",
    created_at: "2026-09-08T00:00:00.000Z",
  };
  const deleteDatabase = {
    prepare(query) {
      if (query.startsWith("DELETE FROM media_assets")) return statement({
        run: async () => { metadataDeleted = true; return { meta: { changes: 1 } }; },
      });
      if (query.includes("FROM media_assets")) return statement({ first: async () => mediaRow });
      if (query.includes("FROM canvas_nodes")) return statement({
        all: async () => ({ results: [{ id: "node-used", node_type: "model-3d", resource_refs_json: '["media-used"]' }] }),
      });
      throw new Error(`Unexpected query: ${query}`);
    },
  };
  const deleteStorage = { ...storage, async delete(key) { assert.equal(key, mediaRow.object_key); objectDeleted = true; } };
  await assert.rejects(
    () => deleteMediaAsset({ DB: deleteDatabase, PROJECT_FILES: deleteStorage }, "project-a", "media-used", false),
    (error) => error.code === "resource_in_use" && error.status === 409,
  );
  assert.equal(metadataDeleted, false);
  assert.equal(objectDeleted, false);
  const deletion = await deleteMediaAsset(
    { DB: deleteDatabase, PROJECT_FILES: deleteStorage },
    "project-a",
    "media-used",
    true,
  );
  assert.equal(deletion.usage.count, 1);
  assert.equal(metadataDeleted, true);
  assert.equal(objectDeleted, true);

  const migration = readFileSync(join(root, "apps/api/migrations/0015_resource_library_media.sql"), "utf8");
  assert.match(migration, /CREATE TABLE media_assets/);
  assert.match(migration, /media_type IN \('video', 'audio'\)/);
  assert.match(migration, /object_key TEXT NOT NULL UNIQUE/);

  console.log("PASS: resource usage counts, immutable system models, media validation, confirmed referenced deletion and media migration.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
