import { test, expect } from "@playwright/test";
import { ProjectRuntimeStore } from "../apps/web/src/project-runtime-store";
import { readBindingCell } from "../apps/web/src/canvas/binding-values";
import type { AssetRuntimeState } from "../apps/web/src/runtime-state";
import { validateComponentBinding } from "../shared/component-bindings";

const snapshot = (assetId: string, timestamp = new Date().toISOString()): AssetRuntimeState => ({
  asset: { id: assetId, assetId, assetType: "equipment", modelNode: null, name: assetId }, timestamp,
  values: { temperature: 0 }, metrics: [{ bindingId: "metric", metricKey: "temperature", sourcePath: "$.temperature", value: 0, valueType: "number", unit: "°C", staleAfterSeconds: 6 }],
  sources: [{ id: "source", name: "source", sourceTimestamp: timestamp, collectedAt: timestamp, durationMs: 1, staleAfterSeconds: 6 }], pollAfterSeconds: 60, staleAfterSeconds: 6,
});

test("runtime demand shares requests, preserves active cache and ignores cancelled results", async () => {
  const calls: Array<{ id: string; signal: AbortSignal; resolve: (snapshot: AssetRuntimeState) => void }> = [];
  const store = new ProjectRuntimeStore((id, signal) => new Promise((resolve) => calls.push({ id, signal, resolve })), 2);
  const a = { id: "record-a", assetId: "A" }; const b = { id: "record-b", assetId: "B" };
  try {
    store.setDemand([a, a, b]);
    await expect.poll(() => calls.length).toBe(2);
    calls[0].resolve(snapshot("A"));
    await expect.poll(() => store.getSnapshot().A?.status).toBe("live");
    const saved = store.getSnapshot().A;
    store.setDemand([b, a]);
    expect(calls).toHaveLength(2);
    expect(store.getSnapshot().A).toBe(saved);
    store.setDemand([a]);
    expect(calls[1].signal.aborted).toBeTruthy();
    calls[1].resolve(snapshot("B"));
    await Promise.resolve(); await Promise.resolve();
    expect(store.getSnapshot().B).toBeUndefined();
  } finally { store.dispose(); }
  expect(calls.every((call) => call.signal.aborted)).toBeTruthy();
  expect(store.getSnapshot()).toEqual({});
});

test("runtime limits concurrency and expires snapshots independently of polling", async () => {
  const calls: Array<{ signal: AbortSignal; resolve: (snapshot: AssetRuntimeState) => void }> = [];
  const store = new ProjectRuntimeStore((_id, signal) => new Promise((resolve) => calls.push({ signal, resolve })), 1);
  try {
    store.setDemand([{ id: "a", assetId: "A" }, { id: "b", assetId: "B" }]);
    await expect.poll(() => calls.length).toBe(1);
    calls[0].resolve(snapshot("A", new Date(Date.now() - 20_000).toISOString()));
    await expect.poll(() => calls.length).toBe(2);
    expect(store.getSnapshot().A.errorCode).toBe("data_source_stale");
    expect(store.getSnapshot().A.snapshot?.values.temperature).toBe(0);
  } finally { store.dispose(); }
});

test("binding preserves zero, null, missing and mismatched values as distinct states", () => {
  const metric = { metricKey: "temperature", valueType: "number" as const };
  const state = snapshot("A");
  const live = () => ({ status: "live" as const, snapshot: state, failureCount: 0 });
  expect(readBindingCell(live(), metric)).toMatchObject({ state: "live", value: 0, text: "0" });
  state.values.temperature = null;
  expect(readBindingCell(live(), metric).state).toBe("null");
  delete state.values.temperature;
  expect(readBindingCell(live(), metric).state).toBe("empty");
  state.values.temperature = "0";
  expect(readBindingCell(live(), metric).state).toBe("type-error");
  expect(() => validateComponentBinding({ id: "b", version: 1, target: "series", selection: "fixed", assetIds: ["A", "B"], metrics: [{ metricKey: "status", valueType: "string" }] })).toThrow("柱状图需要数值指标");
});
