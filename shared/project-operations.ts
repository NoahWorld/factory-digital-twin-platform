import { validateInteractions, type InteractionDefinition } from "./interactions";
import { cloneInteractionScope } from "./interaction-operations";
import { AppError } from "./errors";
import { applySceneOperation, type SceneOperation } from "./scene-operations";
import { requireIdentifier } from "./canvas-schema";
import { applyEditorOperation, cloneCanvasEntities, validateEditorOperation, type EditorOperation } from "./canvas-operations";
import { parseProjectDefinition, projectPageView, pageName, type ProjectDefinition, type ProjectContent } from "./project-definition";
import { validateLocalComponentReferences } from "./component-bindings";

export type ProjectOperation = SceneOperation | (EditorOperation & { pageId?: string })
  | { type: "interactions.set"; interactions: InteractionDefinition }
  | { type: "page.add"; id?: string; name: string }
  | { type: "page.rename"; pageId: string; name: string }
  | { type: "page.configure"; pageId: string; width: number; height: number }
  | { type: "page.duplicate"; pageId: string; name?: string }
  | { type: "page.delete"; pageId: string }
  | { type: "page.entry"; pageId: string }
  | { type: "page.order"; pageIds: string[] }
  | { type: "nodes.move-page"; pageId?: string; targetPageId: string; nodeIds: string[] }
  | { type: "nodes.group" | "nodes.ungroup"; pageId?: string; nodeIds: string[] }
  | { type: "project.restore"; content: ProjectContent };

const invalid = (message: string): never => { throw new AppError(400, "invalid_project_operation", message); };
const pageOperations = new Set(["nodes.upsert", "nodes.delete", "nodes.duplicate", "binding.set", "canvas.replace"]);

export function applyProjectOperation(input: ProjectDefinition, value: unknown, activePageId = input.entryPageId): ProjectDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("项目操作必须是对象。");
  const operation = value as Record<string, unknown>;
  if (typeof operation.type !== "string") invalid("操作类型不能为空。");
  const project = parseProjectDefinition(input);
  const pageId = requireIdentifier(operation.pageId ?? activePageId, "operation.pageId");
  const page = project.pages.find((page) => page.id === pageId);
  if (!page) throw new AppError(404, "page_not_found", "操作页面不存在。");
  if ((operation.type as string).startsWith("scene.") || (operation.type as string).startsWith("instance.")) {
    applySceneOperation(project, operation, activePageId);
  } else if (pageOperations.has(operation.type as string)) {
    const { pageId: _page, ...base } = operation;
    const next = applyEditorOperation(projectPageView(project, pageId), validateEditorOperation(base), (ids) => cloneInteractionScope(project.interactions, ids, pageId));
    page.nodes = next.nodes; page.theme = next.theme;
    const definitions = new Map(project.dataBindings.map((binding) => [binding.id, binding]));
    (next.dataBindings ?? []).forEach((binding) => definitions.set(binding.id, binding));
    project.dataBindings = [...definitions.values()];
  } else {
    const fields: Record<string, string[]> = {
      "interactions.set": ["type", "interactions"],
      "page.add": ["type", "id", "name"], "page.rename": ["type", "pageId", "name"],
      "page.configure": ["type", "pageId", "width", "height"], "page.duplicate": ["type", "pageId", "name"],
      "page.delete": ["type", "pageId"], "page.entry": ["type", "pageId"], "page.order": ["type", "pageIds"],
      "nodes.move-page": ["type", "pageId", "targetPageId", "nodeIds"],
      "nodes.group": ["type", "pageId", "nodeIds"], "nodes.ungroup": ["type", "pageId", "nodeIds"],
      "project.restore": ["type", "content"],
    };
    const allowed = fields[operation.type as string];
    if (!Array.isArray(allowed) || Object.keys(operation).some((field) => !allowed.includes(field))) invalid("操作类型或字段不支持。");
    const selected = () => {
      if (!Array.isArray(operation.nodeIds) || !operation.nodeIds.length) invalid("请选择组件。");
      const ids = (operation.nodeIds as unknown[]).map((id) => requireIdentifier(id, "operation.nodeIds"));
      if (new Set(ids).size !== ids.length || ids.some((id) => !page.nodes.some((node) => node.id === id))) invalid("组件 ID 重复或不属于当前页面。");
      return ids;
    };
    switch (operation.type) {
      case "interactions.set": project.interactions = validateInteractions(operation.interactions); break;
      case "page.add": {
        const id = operation.id === undefined ? crypto.randomUUID() : requireIdentifier(operation.id, "page.id");
        if (project.pages.some((page) => page.id === id)) invalid("页面 ID 已存在。");
        project.pages.push({ id, name: pageName(operation.name), width: page.width, height: page.height, theme: structuredClone(page.theme), nodes: [] }); break;
      }
      case "page.rename": page.name = pageName(operation.name); break;
      case "page.configure": {
        if (typeof operation.width !== "number" || !Number.isInteger(operation.width) || typeof operation.height !== "number" || !Number.isInteger(operation.height)) invalid("页面尺寸必须为整数。");
        page.width = operation.width as number; page.height = operation.height as number; break;
      }
      case "page.duplicate": {
        const copy = cloneCanvasEntities(page.nodes, project.dataBindings);
        const newPageId = crypto.randomUUID();
        project.pages.push({ ...structuredClone(page), id: newPageId, name: pageName(operation.name ?? `${page.name} 副本`), nodes: copy.nodes });
        cloneInteractionScope(project.interactions, copy.nodeIds, page.id, newPageId);
        project.dataBindings.push(...copy.bindings); break;
      }
      case "page.delete": {
        if (project.pages.length === 1) invalid("不能删除最后一个页面。");
        project.interactions.rules = project.interactions.rules.filter((rule) => rule.pageId !== pageId);
        project.interactions.states = project.interactions.states.filter((state) => state.pageId !== pageId);
        project.pages = project.pages.filter((page) => page.id !== pageId);
        if (project.entryPageId === pageId) project.entryPageId = project.pages[0].id; break;
      }
      case "page.entry": project.entryPageId = pageId; break;
      case "page.order": {
        if (!Array.isArray(operation.pageIds)) invalid("页面顺序必须是数组。");
        const ids = (operation.pageIds as unknown[]).map((id) => requireIdentifier(id, "pageIds"));
        if (ids.length !== project.pages.length || new Set(ids).size !== ids.length || ids.some((id) => !project.pages.some((page) => page.id === id))) invalid("页面顺序应完整包含所有页面。");
        project.pages = ids.map((id) => project.pages.find((page) => page.id === id)!); break;
      }
      case "nodes.move-page": {
        const ids = selected(); const target = project.pages.find((page) => page.id === operation.targetPageId);
        if (!target) invalid("目标页面不存在。");
        if (target!.id === pageId) return project;
        target!.nodes.push(...page.nodes.filter((node) => ids.includes(node.id))); page.nodes = page.nodes.filter((node) => !ids.includes(node.id)); break;
      }
      case "nodes.group": {
        const ids = selected(); if (ids.length < 2) invalid("至少选择两个组件才能分组。");
        const groupId = crypto.randomUUID(); page.nodes = page.nodes.map((node) => ids.includes(node.id) ? { ...node, groupId } : node); break;
      }
      case "nodes.ungroup": {
        const ids = selected(); const groups = new Set(page.nodes.filter((node) => ids.includes(node.id)).map((node) => node.groupId));
        page.nodes = page.nodes.map((node) => { if (!node.groupId || !groups.has(node.groupId)) return node; const { groupId: _group, ...rest } = node; return rest; }); break;
      }
      case "project.restore": {
        const content = operation.content as ProjectContent;
        if (!content || typeof content !== "object" || Array.isArray(content) || Object.keys(content).some((key) => !["pages", "entryPageId", "dataBindings", "scenes", "interactions"].includes(key))) invalid("草稿内容不支持。");
        const restored = parseProjectDefinition({ ...project, pages: content.pages, entryPageId: content.entryPageId, dataBindings: content.dataBindings, scenes: content.scenes, interactions: content.interactions ?? { states: [], rules: [] } });
        project.pages = restored.pages; project.entryPageId = restored.entryPageId; project.dataBindings = restored.dataBindings; project.scenes = restored.scenes; project.interactions = restored.interactions; break;
      }
      default: invalid("不支持的项目操作。");
    }
  }
  project.dataBindings = validateLocalComponentReferences(project.pages.flatMap((page) => page.nodes), project.dataBindings);
  return parseProjectDefinition(project);
}
