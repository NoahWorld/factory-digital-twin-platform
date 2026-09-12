import { test, expect } from "@playwright/test";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { DEFAULT_THEME, parseCanvasDocument, type CanvasDocument } from "../shared/canvas-schema";
import { applyEditorOperation, createEditorState, executeEditorOperation, travelEditorHistory, markEditorSaved, editorPatch, contentKey, editableContent } from "../shared/editor-operations";

function fixture(count = 1): CanvasDocument {
  const nodes = Array.from({ length: count }, (_, index) => ({ ...createCanvasNode("metric-card", 20, 20, index + 1), id: `node-${index}` }));
  nodes[0].dataBindingRefs = ["binding-1"];
  return { projectId: "project-1", width: 1920, height: 1080, revision: 7, updatedAt: null, theme: DEFAULT_THEME, nodes,
    dataBindings: [{ id: "binding-1", version: 1, target: "value", selection: "fixed", assetIds: ["DEVICE-001"], metrics: [{ metricKey: "temperature", valueType: "number" }] }],
  };
}

test("legacy parsing preserves IDs and rejects a future schema or invalid node", () => {
  const old = fixture(); const parsed = parseCanvasDocument(old);
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.nodes.map((node) => node.id)).toEqual(old.nodes.map((node) => node.id));
  expect(parseCanvasDocument(parsed)).toEqual(parsed);
  expect(() => parseCanvasDocument({ ...old, schemaVersion: 999 })).toThrow("schema version");
  expect(() => parseCanvasDocument({ ...old, nodes: [{ ...old.nodes[0], width: -5 }] })).toThrow();
});

test("unknown operations and malformed binding references fail at the common boundary", () => {
  const input = fixture();
  for (const operation of [null, { type: "nodes.upsert", nodes: null }, { type: "nodes.upsert", nodes: [null] }, { type: "nodes.upsert", nodes: [input.nodes[0], input.nodes[0]] }]) {
    try { applyEditorOperation(input, operation); throw new Error("Expected validation failure"); }
    catch (error) { expect(error).toMatchObject({ status: 400, code: expect.any(String) }); }
  }
  expect(() => createEditorState({ ...input, nodes: [{ ...input.nodes[0], dataBindingRefs: ["missing"] }] })).toThrow("missing");
  expect(() => createEditorState({ ...input, nodes: [{ ...input.nodes[0], dataBindingRefs: ["binding-1", "binding-2"] }], dataBindings: [...input.dataBindings!, { ...input.dataBindings![0], id: "binding-2" }] })).toThrow("只支持一个");
  expect(input.nodes).toHaveLength(1);
});

test("copy bindings independently and preserve identities through delete and history", () => {
  const original = fixture(); let state = createEditorState(original);
  state = executeEditorOperation(state, { type: "nodes.duplicate", nodeIds: ["node-0"] });
  const copy = state.document.nodes.find((node) => node.id !== "node-0")!;
  expect(copy.resourceRefs).toEqual(original.nodes[0].resourceRefs);
  expect(copy.dataBindingRefs[0]).not.toBe("binding-1");
  expect(state.document.dataBindings).toHaveLength(2);
  expect(original.nodes).toHaveLength(1);
  state = executeEditorOperation(state, { type: "nodes.delete", nodeIds: [copy.id] });
  expect(state.document.dataBindings).toHaveLength(1);
  state = travelEditorHistory(state, "undo");
  expect(state.document.nodes.find((node) => node.id === copy.id)).toEqual(copy);
  expect(state.document.dataBindings).toHaveLength(2);
  state = travelEditorHistory(state, "redo");
  expect(state.document.nodes).toHaveLength(1);
  expect(contentKey(editableContent(state.document))).toBe(contentKey(state.saved));
});

test("undo after saving retains server revision and produces the correct delete patch", () => {
  let state = createEditorState(fixture());
  state = executeEditorOperation(state, { type: "nodes.duplicate", nodeIds: ["node-0"] });
  const copyId = state.document.nodes.find((node) => node.id !== "node-0")!.id;
  state = markEditorSaved(state, { ...state.document, revision: 8 });
  state = travelEditorHistory(state, "undo");
  expect(editorPatch(state)).toMatchObject({ expectedRevision: 8, deleteNodeIds: [copyId] });
  state = travelEditorHistory(state, "redo");
  expect(contentKey(editableContent(state.document))).toBe(contentKey(state.saved));
  expect(() => applyEditorOperation(state.document, { type: "nodes.delete", nodeIds: ["missing"] })).toThrow("不存在");
});

test("M2 operation baseline records representative document sizes", () => {
  for (const count of [25, 100, 500]) {
    const input = fixture(count); const timings: number[] = []; const assertionOverhead: number[] = [];
    for (let index = 0; index < 15; index++) {
      const start = performance.now();
      const state = executeEditorOperation(createEditorState(input), { type: "nodes.duplicate", nodeIds: ["node-0"] });
      const operationFinished = performance.now();
      expect(state.document.nodes).toHaveLength(count + 1);
      timings.push(operationFinished - start);
      assertionOverhead.push(performance.now() - operationFinished);
    }
    const p95 = timings.sort((a, b) => a - b)[Math.ceil(timings.length * .95) - 1];
    console.log(JSON.stringify({ benchmark: "parse-and-copy-binding", nodes: count, iterations: timings.length, p95Ms: p95, maxAssertionOverheadMs: Math.max(...assertionOverhead), scope: "CPU document operation; assertion instrumentation excluded; not a rendered scene capacity claim" }));
    expect(p95).toBeLessThan(100);
  }
});
