import assert from "node:assert/strict";
import { waitForCoverContent } from "../src/covers/capture";

let checks = 0;

async function check(name, run) {
  await run();
  checks++;
  console.log(`✓ ${name}`);
}

async function bounded(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 1000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function testImage({ complete = true, naturalWidth = 960, source = "/example.png", decode = async () => {} } = {}) {
  return { complete, naturalWidth, decode, getAttribute: (name) => name === "src" ? source : null };
}

async function withSurface({ loading = false, images = [], failed = null, fontsReady = Promise.resolve(), stalledFrame = false } = {}, run) {
  const names = ["document", "requestAnimationFrame", "cancelAnimationFrame"];
  const descriptors = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const state = { loading, images, failed, frames: 0, loadingQueries: 0 };
  const root = {
    querySelector(selector) {
      if (selector === '[data-cover-state="error"], [role="alert"]') return state.failed;
      if (selector === '[data-cover-state="loading"]') {
        state.loadingQueries++;
        return state.loading ? { dataset: { coverState: "loading" } } : null;
      }
      throw new Error(`Unexpected cover selector: ${selector}`);
    },
    querySelectorAll(selector) {
      assert.equal(selector, "img");
      return state.images;
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { fonts: { ready: fontsReady } } });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback) => {
    state.frames++;
    return stalledFrame ? 0 : setImmediate(() => callback(performance.now()));
  } });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (handle) => clearImmediate(handle) });
  try {
    await run({ root, state });
  } finally {
    for (const name of names) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

await check("ready surfaces decode every image and wait for a paint before capture", async () => {
  let decoded = 0;
  await withSurface({ images: [testImage({ decode: async () => { decoded++; } }), testImage({ decode: async () => { decoded++; } })] }, async ({ root, state }) => {
    await bounded(waitForCoverContent(root, new AbortController().signal), "Ready surface did not settle.");
    assert.equal(decoded, 2);
    assert.ok(state.frames >= 2);
  });
});

await check("loading renderers must transition to ready before capture", async () => {
  await withSurface({ loading: true }, async ({ root, state }) => {
    let completed = false;
    const pending = waitForCoverContent(root, new AbortController().signal).then(() => { completed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(completed, false);
    assert.ok(state.loadingQueries > 0);
    state.loading = false;
    await bounded(pending, "Loading renderer did not settle after becoming ready.");
    assert.equal(completed, true);
  });
});

await check("incomplete images must load before their pixels are decoded", async () => {
  let decoded = 0;
  const image = testImage({ complete: false, naturalWidth: 0, decode: async () => { decoded++; } });
  await withSurface({ images: [image] }, async ({ root }) => {
    const pending = waitForCoverContent(root, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(decoded, 0);
    image.complete = true;
    image.naturalWidth = 960;
    await bounded(pending, "Loaded image did not settle.");
    assert.equal(decoded, 1);
  });
});

await check("renderer errors and alerts reject with their visible diagnostic", async () => {
  await withSurface({ failed: { textContent: "  Model resource failed: fixture.glb  " } }, async ({ root }) => {
    await assert.rejects(waitForCoverContent(root, new AbortController().signal), /Model resource failed: fixture\.glb/);
  });
});

await check("broken images reject with the failed resource URL", async () => {
  await withSurface({ images: [testImage({ naturalWidth: 0, source: "/missing-cover.png" })] }, async ({ root }) => {
    await assert.rejects(waitForCoverContent(root, new AbortController().signal), /项目图片加载失败：\/missing-cover\.png/);
  });
});

await check("image decode rejection is propagated, never replaced by a blank capture", async () => {
  const decodingError = new Error("Intentional image decode failure");
  await withSurface({ images: [testImage({ decode: async () => { throw decodingError; } })] }, async ({ root }) => {
    await assert.rejects(waitForCoverContent(root, new AbortController().signal), (error) => error === decodingError);
  });
});

await check("pre-aborted capture is rejected", async () => {
  const controller = new AbortController();
  controller.abort();
  await withSurface({}, async ({ root }) => {
    await assert.rejects(waitForCoverContent(root, controller.signal), (error) => error.name === "AbortError");
  });
});

for (const [name, options] of [
  ["loading renderer", { loading: true }],
  ["pending font readiness", { fontsReady: new Promise(() => {}) }],
  ["pending image decode", { images: [testImage({ decode: () => new Promise(() => {}) })] }],
  ["suspended animation frame", { stalledFrame: true }],
]) {
  await check(`abort interrupts ${name} without waiting for that dependency`, async () => {
    const controller = new AbortController();
    await withSurface(options, async ({ root }) => {
      const pending = waitForCoverContent(root, controller.signal);
      const rejected = assert.rejects(pending, (error) => error.name === "AbortError");
      const timer = setTimeout(() => controller.abort(), 20);
      try {
        await bounded(rejected, `Abort remained stuck on ${name}.`);
      } finally {
        clearTimeout(timer);
      }
    });
  });
}

console.log(`Project cover readiness checks passed: ${checks}.`);
