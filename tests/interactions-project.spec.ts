import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { createEditorState, executeEditorOperation, markEditorSaved, travelEditorHistory } from "../shared/editor-operations";
import { parseProjectDefinition, projectDefinitionPatch } from "../shared/project-definition";
import type { InteractionDefinition } from "../shared/interactions";

test("interaction configuration shares project CAS, clones explicit references, saves undo and rejects foreign assets or dangling targets", async () => {
  const api = await localApi(); const demo = await createDemo(api, false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    expect(state.project.schemaVersion).toBe(4);
    const target = state.document.nodes[0].id;
    const config: InteractionDefinition = { states: [{ id: "mode", name: "页面状态", pageId: "main", valueType: "string", initial: "idle" }], rules: [{
      id: "click", name: "设备选择", pageId: "main", enabled: true, reentry: "restart", trigger: { type: "node.click", sourceId: target },
      condition: { op: "eq", left: { kind: "state", stateId: "mode" }, right: { kind: "literal", value: "idle" } },
      actions: [{ type: "state.set", stateId: "mode", value: { kind: "literal", value: target } }, { type: "node.visible", nodeId: target, visible: false }, { type: "asset.select", value: { kind: "literal", value: "DEVICE-001" }, details: true }],
    }] };
    state = executeEditorOperation(state, { type: "interactions.set", interactions: config });
    let response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) }); expect(response.status(), await response.text()).toBe(200);
    state = markEditorSaved(state, (await response.json()).definition); expect(state.project.interactions).toEqual(config);
    expect(() => executeEditorOperation(state, { type: "nodes.delete", nodeIds: [target] })).toThrow("请先修复引用");
    let copy = executeEditorOperation(state, { type: "nodes.duplicate", nodeIds: [target] });
    const copiedNode = copy.document.nodes.find((node) => !state.document.nodes.some((item) => item.id === node.id))!;
    expect(copy.project.interactions.rules[1].trigger.sourceId).toBe(copiedNode.id);
    expect(copy.project.interactions.rules[1].actions[1]).toMatchObject({ nodeId: copiedNode.id });
    expect(copy.project.interactions.rules[1].actions[0]).toMatchObject({ value: { kind: "literal", value: target } });
    copy = executeEditorOperation(state, { type: "page.duplicate", pageId: "main" });
    const pageId = copy.pageId, copiedState = copy.project.interactions.states.find((item) => item.pageId === pageId)!;
    const copiedRule = copy.project.interactions.rules.find((item) => item.pageId === pageId)!;
    expect(copiedRule.actions[0]).toMatchObject({ stateId: copiedState.id });
    expect(copiedRule.condition).toMatchObject({ left: { stateId: copiedState.id } });
    expect(copiedRule.trigger.sourceId).toBe(copy.document.nodes[0].id);
    response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(copy.project, copy.savedProject) }); expect(response.status(), await response.text()).toBe(200);
    copy = markEditorSaved(copy, (await response.json()).definition);
    const undone = travelEditorHistory(copy, "undo");
    response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(undone.project, undone.savedProject) }); expect(response.status(), await response.text()).toBe(200);
    const restored = (await response.json()).definition; expect(restored.interactions).toEqual(config);
    const invalid = structuredClone(config); invalid.rules[0].actions = [{ type: "asset.select", value: { kind: "literal", value: "foreign-asset" }, details: true }];
    response = await api.patch(`${path}/definition`, { data: { expectedRevision: restored.revision, upsertPages: [], deletePageIds: [], upsertNodes: [], deleteNodeIds: [], interactions: invalid } });
    expect(response.status()).toBe(400); expect((await response.json()).error).toBe("invalid_interaction_asset");
    expect((await (await api.get(`${path}/definition`)).json()).definition.interactions).toEqual(config);
    expect((await api.patch(`${path}/definition`, { data: { expectedRevision: 0, upsertPages: [], deletePageIds: [], upsertNodes: [], deleteNodeIds: [], interactions: config } })).status()).toBe(409);
    const legacy = parseProjectDefinition({ ...restored, schemaVersion: 3 }); expect(legacy.schemaVersion).toBe(4); expect(legacy.interactions.rules).toEqual([]);
  } finally { await api.delete(path); await api.dispose(); }
});
