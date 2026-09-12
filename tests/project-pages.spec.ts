import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { createEditorState, executeEditorOperation, travelEditorHistory } from "../shared/editor-operations";
import { emptyProjectDefinition, parseProjectDefinition, projectContent, projectDefinitionPatch } from "../shared/project-definition";
import { createCanvasNode } from "../apps/web/src/canvas/types";

test("project operations keep page/group identities and undo page deletion", () => {
  const project = emptyProjectDefinition("test-project");
  project.pages[0].nodes = [createCanvasNode("metric-card", -20, 20, 9), createCanvasNode("metric-card", 450, 20, 2)];
  const originalIds = project.pages[0].nodes.map((node) => node.id);
  let state = createEditorState(project);
  state = executeEditorOperation(state, { type: "nodes.group", nodeIds: originalIds });
  const groupId = state.document.nodes[0].groupId;
  expect(groupId).toBeTruthy(); expect(state.document.nodes[1].groupId).toBe(groupId);
  state = executeEditorOperation(state, { type: "page.duplicate", pageId: "main" });
  const secondId = state.pageId;
  expect(state.project.pages).toHaveLength(2);
  expect(state.document.nodes.every((node) => !originalIds.includes(node.id))).toBeTruthy();
  expect(state.document.nodes[0].groupId).not.toBe(groupId);
  expect(state.document.nodes.map(({ x, y, zIndex }) => ({ x, y, zIndex }))).toEqual(project.pages[0].nodes.map(({ x, y, zIndex }) => ({ x, y, zIndex })));
  const duplicated = executeEditorOperation(state, { type: "nodes.duplicate", nodeIds: state.document.nodes.map((node) => node.id) });
  expect(duplicated.document.nodes.slice(-2).map((node) => node.x)).toEqual([474, 4]);
  state = executeEditorOperation(state, { type: "page.delete", pageId: secondId });
  expect(state.project.pages).toHaveLength(1);
  state = travelEditorHistory(state, "undo"); expect(state.pageId).toBe(secondId);
  expect(state.project.pages[0].nodes.map((node) => node.id)).toEqual(originalIds);
  expect(() => executeEditorOperation(state, { type: "project.restore", content: { projectId: "another-project" } })).toThrow();
  expect(() => parseProjectDefinition({ ...state.project, schemaVersion: 300 })).toThrow();
});

test("page-local saves preserve other-page bindings, project CAS and entry-page cover", async () => {
  const api = await localApi(); const demo = await createDemo(api, true);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const before = (await (await api.get(`${path}/definition`)).json()).definition;
    let state = createEditorState(before);
    state = executeEditorOperation(state, { type: "page.duplicate", pageId: "main", name: "第二页" });
    const secondId = state.pageId;
    const response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) });
    expect(response.status(), await response.text()).toBe(200);
    let current = (await response.json()).definition;
    const second = (await (await api.get(`${path}/canvas?page=${secondId}`)).json()).canvas;
    const secondBindings = structuredClone(second.dataBindings);
    const main = (await (await api.get(`${path}/canvas`)).json()).canvas;
    const changed = { ...main.nodes.find((node: { type: string }) => node.type === "metric-card"), props: { ...main.nodes.find((node: { type: string }) => node.type === "metric-card").props, title: "首页保存修改" } };
    const savedMain = await api.patch(`${path}/canvas`, { data: { expectedRevision: current.revision, upsertNodes: [changed], deleteNodeIds: [], dataBindings: main.dataBindings } });
    expect(savedMain.status(), await savedMain.text()).toBe(200);
    const secondAfter = (await (await api.get(`${path}/canvas?page=${secondId}`)).json()).canvas;
    expect(secondAfter.nodes).toEqual(second.nodes); expect(secondAfter.dataBindings).toEqual(secondBindings);
    const stale = await api.patch(`${path}/canvas?page=${secondId}`, { data: { expectedRevision: current.revision, upsertNodes: [second.nodes[0]], deleteNodeIds: [] } });
    expect(stale.status()).toBe(409);
    current = (await (await api.get(`${path}/definition`)).json()).definition;
    const model = second.nodes.find((node: { type: string }) => node.type === "model-3d");
    const saved3d = await api.patch(`${path}/canvas?page=${secondId}`, { data: { expectedRevision: current.revision, upsertNodes: [{ ...model, props: { ...model.props, showGrid: false } }], deleteNodeIds: [] } });
    expect(saved3d.status(), await saved3d.text()).toBe(200);
    const mismatch = await api.patch(`${path}/canvas`, { data: { expectedRevision: current.revision + 1, upsertNodes: [model], deleteNodeIds: [] } });
    expect(mismatch.status()).toBe(400);
    const coverBefore = await api.get(`${path}/cover.svg`);
    expect(coverBefore.status()).toBe(200);
    current = (await (await api.get(`${path}/definition`)).json()).definition;
    state = createEditorState(current); state = executeEditorOperation(state, { type: "page.entry", pageId: secondId });
    const savedEntry = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, projectContent(current)) });
    expect(savedEntry.status()).toBe(200);
    expect((await (await api.get(`${path}/canvas`)).json()).canvas.pageId).toBe(secondId);
    const coverAfter = await api.get(`${path}/cover.svg`);
    expect(coverAfter.status()).toBe(200); expect(coverAfter.headers().etag).not.toBe(coverBefore.headers().etag);
    expect((await api.get(`${path}/canvas?page=missing`)).status()).toBe(404);
  } finally { await api.delete(path); await api.dispose(); }
});

test("partial page patches persist order without requiring explicit pageOrder", async () => {
  const api = await localApi(); const demo = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const initial = (await (await api.get(`${path}/definition`)).json()).definition;
    let state = createEditorState(initial);
    state = executeEditorOperation(state, { type: "page.add", id: "z-last", name: "第二" });
    state = executeEditorOperation(state, { type: "page.add", id: "a-first", name: "第三" });
    const saved = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) });
    expect(saved.status()).toBe(200);
    const current = (await saved.json()).definition;
    const { nodes: _, ...metadata } = current.pages[2];
    const response = await api.patch(`${path}/definition`, { data: { expectedRevision: current.revision, upsertPages: [{ ...metadata, name: "末页改名" }], deletePageIds: ["main"], entryPageId: "z-last", upsertNodes: [], deleteNodeIds: [] } });
    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json()).definition.pages.map((page: { id: string }) => page.id)).toEqual(["z-last", "a-first"]);
  } finally { await api.delete(path); await api.dispose(); }
});
