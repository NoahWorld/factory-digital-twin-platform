import { test, expect } from "@playwright/test";
import { InteractionRuntime, evaluateInteractionCondition } from "../shared/interaction-runtime";
import { validateInteractions, validateInteractionReferences, type InteractionAction, type InteractionDefinition, type InteractionRule } from "../shared/interactions";

const rule = (id: string, actions: InteractionAction[], extra: Partial<InteractionRule> = {}): InteractionRule => ({ id, name: id, pageId: "main", enabled: true, reentry: "restart", trigger: { type: "node.click", sourceId: "button" }, condition: null, actions, ...extra });
const state: InteractionDefinition["states"][number] = { id: "mode", name: "运行模式", pageId: null, valueType: "string", initial: "initial" };
const value = (value: string) => ({ kind: "literal" as const, value });

test("interactions reject unknown fields, invalid types, deep conditions and dangling or cross-page references", () => {
  const definition = { states: [state], rules: [rule("click", [{ type: "state.set", stateId: "mode", value: value("selected") }])] };
  expect(validateInteractions(definition)).toEqual(definition);
  expect(() => validateInteractions({ ...definition, code: "alert(1)" })).toThrow("不支持的字段");
  expect(() => validateInteractions({ states: [state], rules: [rule("bad", [{ type: "state.set", stateId: "mode", value: { kind: "literal", value: 2 } }])] })).not.toThrow();
  expect(() => validateInteractionReferences({ states: [state], rules: [rule("bad", [{ type: "state.set", stateId: "mode", value: { kind: "literal", value: 2 } }])] }, [{ id: "main", nodes: [{ id: "button" }] }])).toThrow("类型不匹配");
  expect(() => validateInteractionReferences(definition, [{ id: "main", nodes: [] }])).toThrow("组件");
  expect(() => validateInteractionReferences({ ...definition, states: [{ ...state, pageId: "other" }] }, [{ id: "main", nodes: [{ id: "button" }] }, { id: "other", nodes: [] }])).toThrow("其他页面的状态");
  let condition: unknown = { op: "exists", value: value("x") };
  for (let index = 0; index < 10; index++) condition = { op: "not", condition };
  expect(() => validateInteractions({ states: [], rules: [{ ...rule("deep", []), condition }] })).toThrow("最多 8 层");
});

test("state changes execute once, missing/stale values stay unknown under negation and failures stop the sequence", async () => {
  const effects: string[] = [];
  const runtime = new InteractionRuntime({ states: [state], rules: [
    rule("set", [{ type: "state.set", stateId: "mode", value: value("selected") }]),
    rule("observe", [{ type: "node.visible", nodeId: "target", visible: true }], { trigger: { type: "state.change", sourceId: "mode" } }),
    rule("failure", [{ type: "asset.select", value: value("fail"), details: true }, { type: "node.visible", nodeId: "must-not-run", visible: true }], { trigger: { type: "custom", sourceId: "fail" } }),
  ] }, { metric: () => undefined, perform: (action) => { if (action.type === "asset.select") throw new Error("目标设备不存在"); effects.push(action.type); } });
  runtime.setPage("main"); runtime.emit({ type: "node.click", sourceId: "button" });
  await expect.poll(() => effects.length).toBe(1);
  runtime.emit({ type: "node.click", sourceId: "button" });
  await expect.poll(() => runtime.getSnapshot().active).toBe(0);
  expect(effects).toEqual(["node.visible"]); expect(runtime.getSnapshot().states.mode).toBe("selected");
  expect(evaluateInteractionCondition({ op: "not", condition: { op: "gt", left: { kind: "metric", assetId: "a", metricKey: "temperature" }, right: { kind: "literal", value: 10 } } }, (v) => v.kind === "literal" ? v.value : undefined)).toBeUndefined();
  runtime.emit({ type: "custom", sourceId: "fail" });
  await expect.poll(() => runtime.getSnapshot().traces.some((trace) => trace.status === "failed" && trace.message.includes("不存在"))).toBe(true);
  expect(effects).toHaveLength(1); runtime.dispose();
});

test("derived events and asynchronous navigation share a bounded chain instead of resetting loop protection", async () => {
  const runtime = new InteractionRuntime({ states: [], rules: [
    rule("loop", [{ type: "event.emit", name: "loop", value: value("again") }], { trigger: { type: "custom", sourceId: "loop" } }),
  ] }, { metric: () => undefined, perform: () => undefined });
  runtime.setPage("main"); runtime.emit({ type: "custom", sourceId: "loop" });
  await expect.poll(() => runtime.getSnapshot().traces.some((trace) => trace.status === "limited")).toBe(true);
  await expect.poll(() => runtime.getSnapshot().active).toBe(0);
  const loopRoots = new Set(runtime.getSnapshot().traces.filter((trace) => trace.ruleId === "loop").map((trace) => trace.rootId));
  expect(loopRoots.size).toBe(1); expect(runtime.getSnapshot().traces.length).toBeLessThanOrEqual(256); runtime.dispose();
  const navigation = new InteractionRuntime({ states: [], rules: [
    rule("to-other", [{ type: "page.navigate", pageId: "other" }], { trigger: { type: "page.enter", sourceId: "main" } }),
    rule("to-main", [{ type: "page.navigate", pageId: "main" }], { pageId: "other", trigger: { type: "page.enter", sourceId: "other" } }),
  ] }, { metric: () => undefined, perform: async () => undefined });
  navigation.setPage("main");
  await expect.poll(() => navigation.getSnapshot().traces.some((trace) => trace.status === "limited")).toBe(true);
  await expect.poll(() => navigation.getSnapshot().active).toBe(0); navigation.dispose();
});

test("leaving a page cancels delays and pending host effects, preserves project state and resets page state", async () => {
  let effects = 0, hostSignal: AbortSignal | undefined;
  let resolveHost: ((value: void) => void) | undefined;
  const runtime = new InteractionRuntime({ states: [state, { ...state, id: "local", pageId: "main" }], rules: [
    rule("delay", [{ type: "state.set", stateId: "mode", value: value("retained") }, { type: "state.set", stateId: "local", value: value("modified") }, { type: "delay", milliseconds: 5000 }, { type: "node.visible", nodeId: "target", visible: true }]),
    rule("host", [{ type: "asset.select", value: value("asset"), details: true }, { type: "node.visible", nodeId: "target", visible: true }]),
  ] }, { metric: () => undefined, perform: (action, _, signal) => { if (action.type !== "asset.select") { effects++; return; } hostSignal = signal; return new Promise<void>((resolve) => { resolveHost = resolve; }); } });
  runtime.setPage("main"); runtime.emit({ type: "node.click", sourceId: "button" });
  await expect.poll(() => !!hostSignal).toBe(true);
  runtime.setPage("other");
  await expect.poll(() => runtime.getSnapshot().active).toBe(0);
  expect(hostSignal!.aborted).toBe(true); resolveHost?.();
  expect(runtime.getSnapshot().states).toEqual({ mode: "retained" });
  runtime.setPage("main"); expect(runtime.getSnapshot().states.local).toBe("initial");
  expect(effects).toBe(0); expect(runtime.getSnapshot().traces.some((trace) => trace.status === "cancelled")).toBe(true); runtime.dispose();
});

test("restart and ignore reentry policies do not duplicate delayed effects", async () => {
  let effects = 0;
  for (const reentry of ["restart", "ignore"] as const) {
    const runtime = new InteractionRuntime({ states: [], rules: [rule(reentry, [{ type: "delay", milliseconds: 30 }, { type: "node.visible", nodeId: "target", visible: true }], { reentry })] }, { metric: () => undefined, perform: () => { effects++; } });
    runtime.setPage("main"); runtime.emit({ type: "node.click", sourceId: "button" }); runtime.emit({ type: "node.click", sourceId: "button" });
    runtime.emit({ type: "node.click", sourceId: "button" });
    await expect.poll(() => runtime.getSnapshot().active).toBe(0);
    expect(runtime.getSnapshot().traces.some((trace) => trace.status === (reentry === "restart" ? "cancelled" : "skipped"))).toBe(true); runtime.dispose();
  }
  expect(effects).toBe(2);
});

test("returning to the same page does not resurrect an event from its previous activation", async () => {
  let effects = 0;
  const runtime = new InteractionRuntime({ states: [], rules: [rule("old-click", [{ type: "node.visible", nodeId: "target", visible: false }])] }, { metric: () => undefined, perform: () => { effects++; } });
  runtime.setPage("main"); runtime.emit({ type: "node.click", sourceId: "button" }); runtime.setPage("other"); runtime.setPage("main");
  await Promise.resolve(); await Promise.resolve();
  expect(effects).toBe(0); runtime.dispose();
});
