import { AppError } from "./errors";
import { parseCanvasDocument, validateNode, validateCanvasTheme, requireIdentifier, type CanvasDocument, type CanvasNode, type CanvasTheme } from "./canvas-schema";
import { validateComponentBinding, validateComponentBindings, validateLocalComponentReferences, type ComponentBinding } from "./component-bindings";

export type EditorOperation =
  | { type: "nodes.upsert"; nodes: CanvasNode[] }
  | { type: "nodes.delete"; nodeIds: string[] }
  | { type: "nodes.duplicate"; nodeIds: string[]; offset?: number }
  | { type: "binding.set"; nodeId: string; binding: ComponentBinding | null }
  | { type: "canvas.replace"; nodes: CanvasNode[]; theme: CanvasTheme; dataBindings?: ComponentBinding[] };

export type EditableContent = Pick<CanvasDocument, "width" | "height" | "nodes" | "theme" | "dataBindings">;
export const editableContent = (document: CanvasDocument): EditableContent => structuredClone({
  width: document.width, height: document.height, nodes: document.nodes,
  theme: document.theme, dataBindings: document.dataBindings ?? [],
});

export const contentKey = (document: EditableContent) => JSON.stringify({ ...document,
  nodes: [...document.nodes].sort((a, b) => a.id.localeCompare(b.id)),
  dataBindings: [...(document.dataBindings ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
});

export function validateEditorOperation(value: unknown): EditorOperation {
  const invalid = (message: string): never => { throw new AppError(400, "invalid_editor_operation", message); };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("编辑操作必须是对象。");
  const input = value as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    "nodes.upsert": ["type", "nodes"], "nodes.delete": ["type", "nodeIds"],
    "nodes.duplicate": ["type", "nodeIds", "offset"], "binding.set": ["type", "nodeId", "binding"],
    "canvas.replace": ["type", "nodes", "theme", "dataBindings"],
  };
  const allowed = typeof input.type === "string" ? fields[input.type] : undefined;
  if (!Array.isArray(allowed)) invalid("不支持的编辑操作类型。");
  if (Object.keys(input).some((key) => !allowed!.includes(key))) invalid("编辑操作包含不支持的字段。");
  const nodes = () => {
    if (!Array.isArray(input.nodes)) invalid("操作 nodes 必须是数组。");
    const result = (input.nodes as unknown[]).map(validateNode);
    if (new Set(result.map((node) => node.id)).size !== result.length) invalid("操作中的组件 ID 不能重复。");
    return result;
  };
  const nodeIds = () => {
    if (!Array.isArray(input.nodeIds) || input.nodeIds.length === 0) invalid("操作 nodeIds 必须是非空数组。");
    const result = (input.nodeIds as unknown[]).map((id) => requireIdentifier(id, "operation.nodeIds"));
    if (new Set(result).size !== result.length) invalid("操作中的组件 ID 不能重复。");
    return result;
  };
  switch (input.type) {
    case "nodes.upsert": return { type: input.type, nodes: nodes() };
    case "nodes.delete": return { type: input.type, nodeIds: nodeIds() };
    case "nodes.duplicate":
      if (input.offset !== undefined && (typeof input.offset !== "number" || !Number.isFinite(input.offset))) invalid("复制偏移必须是有限数值。");
      return { type: input.type, nodeIds: nodeIds(), offset: input.offset as number | undefined };
    case "binding.set": return { type: input.type, nodeId: requireIdentifier(input.nodeId, "operation.nodeId"), binding: input.binding === null ? null : validateComponentBinding(input.binding) };
    case "canvas.replace": return { type: input.type, nodes: nodes(), theme: validateCanvasTheme(input.theme), dataBindings: input.dataBindings === undefined ? undefined : validateComponentBindings(input.dataBindings) };
    default: return invalid("不支持的编辑操作。");
  }
}

/** This is also the operation boundary for AI: serializable input, no I/O. */
export function applyEditorOperation(input: CanvasDocument, value: unknown): CanvasDocument {
  const operation = validateEditorOperation(value);
  const document = parseCanvasDocument(input);
  let nodes = structuredClone(document.nodes);
  let bindings = structuredClone(document.dataBindings ?? []);
  let theme = document.theme;
  const requireNodes = (ids: string[]) => {
    if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) throw new AppError(400, "invalid_operation_targets", "请选择不重复的组件。");
    for (const id of ids) if (!nodes.some((node) => node.id === id)) throw new AppError(400, "operation_node_not_found", `组件 ${id} 不存在。`);
  };
  switch (operation.type) {
    case "nodes.upsert": {
      const byId = new Map(nodes.map((node) => [node.id, node]));
      operation.nodes.forEach((node) => byId.set(node.id, structuredClone(node)));
      nodes = [...byId.values()]; break;
    }
    case "nodes.delete": requireNodes(operation.nodeIds); nodes = nodes.filter((node) => !operation.nodeIds.includes(node.id)); break;
    case "nodes.duplicate": {
      requireNodes(operation.nodeIds);
      const offset = operation.offset ?? 24;
      if (!Number.isFinite(offset)) throw new AppError(400, "invalid_operation_offset", "复制偏移必须是有限数值。");
      const ids = new Map<string, string>();
      let z = Math.max(0, ...nodes.map((node) => node.zIndex));
      const copies = nodes.filter((node) => operation.nodeIds.includes(node.id)).map((node) => ({
        ...structuredClone(node), id: crypto.randomUUID(), zIndex: ++z,
        x: Math.max(0, Math.min(node.x + offset, document.width - node.width)),
        y: Math.max(0, Math.min(node.y + offset, document.height - node.height)),
        dataBindingRefs: node.dataBindingRefs.map((ref) => {
          if (ids.has(ref)) return ids.get(ref)!;
          const binding = bindings.find((item) => item.id === ref);
          if (!binding) throw new AppError(400, "invalid_component_binding_reference", `绑定 ${ref} 不存在，无法复制。`);
          const copy = { ...structuredClone(binding), id: crypto.randomUUID() };
          bindings.push(copy); ids.set(ref, copy.id); return copy.id;
        }),
      }));
      nodes.push(...copies); break;
    }
    case "binding.set": {
      requireNodes([operation.nodeId]);
      if (operation.binding) {
        bindings = bindings.filter((item) => item.id !== operation.binding!.id);
        bindings.push(structuredClone(operation.binding));
      }
      nodes = nodes.map((node) => node.id === operation.nodeId ? { ...node, dataBindingRefs: operation.binding ? [operation.binding.id] : [] } : node); break;
    }
    case "canvas.replace": nodes = structuredClone(operation.nodes); theme = operation.theme; bindings = structuredClone(operation.dataBindings ?? bindings); break;
    default: throw new AppError(400, "unknown_editor_operation", "不支持的编辑操作。");
  }
  bindings = validateLocalComponentReferences(nodes, bindings);
  return parseCanvasDocument({ ...document, nodes, theme, dataBindings: bindings });
}

export type EditorState = {
  document: CanvasDocument;
  saved: EditableContent;
  past: EditableContent[];
  future: EditableContent[];
};
export function createEditorState(input: unknown): EditorState {
  const document = parseCanvasDocument(input);
  return { document, saved: editableContent(document), past: [], future: [] };
}
export function executeEditorOperation(state: EditorState, operation: EditorOperation): EditorState {
  const next = applyEditorOperation(state.document, operation);
  if (contentKey(editableContent(next)) === contentKey(editableContent(state.document))) return state;
  return { ...state, document: next, past: [...state.past.slice(-99), editableContent(state.document)], future: [] };
}
export function travelEditorHistory(state: EditorState, direction: "undo" | "redo"): EditorState {
  const source = direction === "undo" ? state.past : state.future;
  if (!source.length) return state;
  const document = parseCanvasDocument({ ...state.document, ...source.at(-1) });
  return { ...state, document,
    past: direction === "undo" ? state.past.slice(0, -1) : [...state.past, editableContent(state.document)],
    future: direction === "undo" ? [...state.future, editableContent(state.document)] : state.future.slice(0, -1),
  };
}
export function markEditorSaved(state: EditorState, input: unknown): EditorState {
  const document = parseCanvasDocument(input);
  return { ...state, document, saved: editableContent(document) };
}
export function editorPatch(state: EditorState) {
  const saved = new Map(state.saved.nodes.map((node) => [node.id, node]));
  const current = new Set(state.document.nodes.map((node) => node.id));
  return {
    expectedRevision: state.document.revision, theme: state.document.theme, dataBindings: state.document.dataBindings ?? [],
    upsertNodes: state.document.nodes.filter((node) => JSON.stringify(saved.get(node.id)) !== JSON.stringify(node)),
    deleteNodeIds: state.saved.nodes.filter((node) => !current.has(node.id)).map((node) => node.id),
  };
}
