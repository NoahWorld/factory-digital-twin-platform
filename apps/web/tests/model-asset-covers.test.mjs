import assert from "node:assert/strict";
import { createModelAssetCoverQueue, ModelAssetCoverError } from "../src/canvas/model-asset-cover-queue";

const tick = () => new Promise(resolve => setImmediate(resolve));
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`✓ ${name}`); }
function fixture(overrides = {}) {
  let token = "account-a";
  const tasks = [];
  const errors = [];
  let concurrent = 0;
  let maximumConcurrent = 0;
  const queue = createModelAssetCoverQueue({
    key: value => `${value.project}/${value.id}/${value.hash}`,
    session: () => token,
    render: (input, signal) => new Promise((resolve, reject) => {
      concurrent++;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      const task = { input, signal, resolve, reject };
      tasks.push(task);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }).finally(() => { concurrent--; }),
    report: (input, error) => errors.push({ input, error }),
    ...overrides,
  });
  return { queue, tasks, errors, setToken: value => { token = value; }, maximumConcurrent: () => maximumConcurrent };
}
const asset = (id = "one", hash = "sha-a", project = "project-a") => ({ id, hash, project });

await check("duplicate subscriptions share a render and all models are processed serially", async () => {
  const f = fixture();
  const first = [], duplicate = [], second = [];
  const cleanups = [f.queue.subscribe(asset(), value => first.push(value)), f.queue.subscribe(asset(), value => duplicate.push(value)), f.queue.subscribe(asset("two"), value => second.push(value))];
  assert.equal(f.tasks.length, 1);
  f.tasks[0].resolve("data:image/png;base64,first");
  await tick();
  assert.equal(f.tasks.length, 2);
  assert.equal(first.at(-1).url, duplicate.at(-1).url);
  f.tasks[1].resolve("data:image/png;base64,second");
  await tick();
  assert.equal(second.at(-1).status, "ready");
  assert.equal(f.maximumConcurrent(), 1);
  cleanups.forEach(fn => fn());
});

await check("removing the last subscriber cancels active work and skips queued work", async () => {
  const f = fixture();
  const cancelFirst = f.queue.subscribe(asset(), () => {});
  const cancelQueued = f.queue.subscribe(asset("two"), () => {});
  const cancelThird = f.queue.subscribe(asset("three"), () => {});
  cancelQueued(); cancelFirst();
  await tick();
  assert.equal(f.tasks[0].signal.aborted, true);
  assert.equal(f.tasks.length, 2);
  assert.equal(f.tasks[1].input.id, "three");
  cancelThird(); await tick();
  assert.equal(f.errors.length, 0);
});

await check("a shared model stays active until all subscribers leave", async () => {
  const f = fixture();
  const cancelFirst = f.queue.subscribe(asset(), () => {});
  const cancelSecond = f.queue.subscribe(asset(), () => {});
  cancelFirst();
  assert.equal(f.tasks[0].signal.aborted, false);
  cancelSecond(); await tick();
  assert.equal(f.tasks[0].signal.aborted, true);
});

await check("cache identity includes project and content hash, with bounded LRU eviction", async () => {
  const f = fixture({ maximumEntries: 1 });
  const stop = f.queue.subscribe(asset(), () => {});
  f.tasks[0].resolve("png-one"); await tick(); stop();
  const cached = [];
  const stopCached = f.queue.subscribe(asset(), value => cached.push(value));
  assert.deepEqual(cached, [{ status: "ready", url: "png-one" }]);
  stopCached();
  const stopNew = f.queue.subscribe(asset("one", "sha-b"), () => {});
  assert.equal(f.tasks.length, 2);
  f.tasks[1].resolve("png-two"); await tick(); stopNew();
  const stopEvicted = f.queue.subscribe(asset(), () => {});
  assert.equal(f.tasks.length, 3);
  stopEvicted(); await tick();
  const stopOther = f.queue.subscribe(asset("one", "sha-b", "project-b"), () => {});
  assert.equal(f.tasks.length, 4);
  stopOther(); await tick();
});

await check("byte limits prevent large images from being retained in cache", async () => {
  const f = fixture({ maximumBytes: 4 });
  const stop = f.queue.subscribe(asset(), () => {});
  f.tasks[0].resolve("large-image"); await tick(); stop();
  const again = f.queue.subscribe(asset(), () => {});
  assert.equal(f.tasks.length, 2);
  again(); await tick();
});

await check("errors stay explicit and retry invalidation notifies existing subscribers", async () => {
  const f = fixture();
  const states = [];
  const stop = f.queue.subscribe(asset(), value => states.push(value));
  f.tasks[0].reject(new ModelAssetCoverError("model_cover_model_unavailable", "模型无法加载。"));
  await tick();
  assert.equal(states.at(-1).errorCode, "model_cover_model_unavailable");
  assert.equal(f.errors.length, 1);
  f.queue.invalidate(asset());
  assert.equal(states.at(-1).status, "loading");
  assert.equal(f.tasks.length, 2);
  f.tasks[1].resolve("retried-image"); await tick();
  assert.equal(states.at(-1).url, "retried-image");
  stop();
});

await check("timeouts release work and expose a diagnostic error code", async () => {
  const f = fixture({ timeoutMs: 5 });
  const states = [];
  const stop = f.queue.subscribe(asset(), value => states.push(value));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.tasks[0].signal.aborted, true);
  assert.equal(states.at(-1).errorCode, "model_cover_timeout");
  stop();
});

await check("retrying an active request aborts its old renderer before starting its replacement", async () => {
  const f = fixture();
  const states = [];
  const stop = f.queue.subscribe(asset(), value => states.push(value));
  f.queue.invalidate(asset());
  assert.equal(f.tasks[0].signal.aborted, true);
  await tick();
  assert.equal(f.tasks.length, 2);
  assert.equal(f.maximumConcurrent(), 1);
  assert.equal(states.some(value => value.status === "error"), false);
  f.tasks[1].resolve("replacement-image"); await tick();
  assert.equal(states.at(-1).url, "replacement-image");
  stop();
});

await check("session changes clear caches and reject stale results even if a renderer ignores abort", async () => {
  const delayed = [];
  const f = fixture({ render: (input, signal) => new Promise(resolve => delayed.push({ input, signal, resolve })) });
  const oldStates = [], newStates = [];
  f.queue.subscribe(asset(), value => oldStates.push(value));
  f.setToken("account-b");
  const stopNew = f.queue.subscribe(asset(), value => newStates.push(value));
  assert.equal(oldStates.at(-1).errorCode, "model_cover_session_changed");
  assert.equal(delayed[0].signal.aborted, true);
  delayed[0].resolve("old-private-image"); await tick();
  assert.equal(delayed.length, 2);
  assert.equal(newStates.some(value => value.url === "old-private-image"), false);
  delayed[1].resolve("new-private-image"); await tick();
  assert.equal(newStates.at(-1).url, "new-private-image");
  stopNew();
});

await check("an expired session event clears images even when storage retains the same token", async () => {
  const f = fixture();
  const states = [];
  f.queue.subscribe(asset(), value => states.push(value));
  f.tasks[0].resolve("private-image"); await tick();
  f.queue.invalidateSession();
  assert.equal(states.at(-1).errorCode, "model_cover_session_changed");
  const stop = f.queue.subscribe(asset(), () => {});
  assert.equal(f.tasks.length, 2);
  stop(); await tick();
});

await check("missing authentication performs no rendering and unknown errors do not leak details", async () => {
  const f = fixture();
  f.setToken(null);
  const states = [];
  f.queue.subscribe(asset(), value => states.push(value));
  assert.equal(states.at(-1).errorCode, "unauthenticated");
  assert.equal(f.tasks.length, 0);
  f.setToken("account-a");
  const stop = f.queue.subscribe(asset(), value => states.push(value));
  f.tasks[0].reject(new Error("https://private.invalid/model?token=secret")); await tick();
  assert.equal(states.at(-1).errorCode, "model_cover_render_failed");
  assert.equal(JSON.stringify(f.errors).includes("secret"), false);
  assert.equal(JSON.stringify(states).includes("secret"), false);
  stop();
});

console.log(`Model asset covers: ${checks} checks passed.`);
