import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import { createUuid } from "../src/uuid";

const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function withCrypto(source, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: source });
  try { await run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
}

test("UUID v4 preserves random bytes, leading zeros, version and variant without randomUUID", async () => {
  for (const [fill, expected] of [
    [0, "00000000-0000-4000-8000-000000000000"],
    [255, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
  ]) {
    const source = { getRandomValues(bytes) {
      assert.equal(this, source);
      assert.ok(bytes instanceof Uint8Array);
      assert.equal(bytes.length, 16);
      return bytes.fill(fill);
    } };
    await withCrypto(source, () => assert.equal(createUuid(), expected));
  }
});

test("missing or failing secure randomness is an explicit error", async () => {
  for (const source of [undefined, {}]) {
    await withCrypto(source, () => assert.throws(createUuid, /crypto.getRandomValues is unavailable/));
  }
  const error = new Error("Random source failed");
  await withCrypto({ getRandomValues() { throw error; } }, () => {
    assert.throws(createUuid, (actual) => actual === error);
  });
});

test("HTTP capabilities support login initialization, canvas nodes and every template", async () => {
  await withCrypto({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, async () => {
    assert.equal(globalThis.crypto.randomUUID, undefined);
    // Import while randomUUID is absent: this is the previous pre-React crash path.
    const { loginShowcaseNode } = await import("../src/auth/login-showcase-scene");
    assert.equal(loginShowcaseNode.type, "model-3d");
    assert.ok(loginShowcaseNode.props.modelInstances.length > 0);
    const { createCanvasNode } = await import("../src/canvas/types");
    const { canvasTemplates, instantiateCanvasTemplate } = await import("../src/canvas/templates");
    const ids = [];
    for (const type of ["model-3d", "plain-text", "scene-3d"]) {
      ids.push(createCanvasNode(type, 0, 0, 0).id);
    }
    for (const template of canvasTemplates) {
      for (let copy = 0; copy < 2; copy++) {
        const nodes = instantiateCanvasTemplate(template.id, []);
        assert.ok(nodes.length > 0);
        ids.push(...nodes.map(node => node.id));
      }
    }
    for (const id of ids) assert.match(id, v4);
    assert.equal(new Set(ids).size, ids.length);
  });
});
