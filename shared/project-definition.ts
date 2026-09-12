import { AppError } from "./errors";
import { DEFAULT_THEME, parseCanvasDocument, validateNode, validateCanvasTheme, requireIdentifier, type CanvasDocument, type CanvasNode, type CanvasTheme } from "./canvas-schema";
import { validateComponentBindings, validateLocalComponentReferences, type ComponentBinding } from "./component-bindings";

export const PROJECT_SCHEMA_VERSION = 2;
export type ProjectPage = { id: string; name: string; width: number; height: number; theme: CanvasTheme; nodes: CanvasNode[] };
export type PageMetadata = Omit<ProjectPage, "nodes">;
export type ProjectDefinition = {
  kind: "newpower.project";
  schemaVersion: 2;
  projectId: string;
  revision: number;
  updatedAt: string | null;
  entryPageId: string;
  pages: ProjectPage[];
  dataBindings: ComponentBinding[];
};
export type ProjectContent = Pick<ProjectDefinition, "entryPageId" | "pages" | "dataBindings">;
export type ProjectPatch = {
  expectedRevision: number;
  upsertPages: PageMetadata[];
  deletePageIds: string[];
  upsertNodes: Array<CanvasNode & { pageId: string }>;
  deleteNodeIds: string[];
  pageOrder?: string[];
  entryPageId?: string;
  dataBindings?: ComponentBinding[];
};

const invalid = (message: string): never => { throw new AppError(400, "invalid_project_definition", message); };
export const pageName = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) invalid("页面名称必须是 1–100 个字符。");
  return (value as string).trim();
};

export function emptyProjectDefinition(projectId: string): ProjectDefinition {
  return { kind: "newpower.project", schemaVersion: 2, projectId, revision: 0, updatedAt: null, entryPageId: "main", pages: [{ id: "main", name: "首页", width: 1920, height: 1080, theme: { ...DEFAULT_THEME }, nodes: [] }], dataBindings: [] };
}

export function parseProjectDefinition(value: unknown): ProjectDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("项目定义必须是对象。");
  const input = value as Record<string, unknown>;
  if (input.kind === undefined && (input.schemaVersion === undefined || input.schemaVersion === 0 || input.schemaVersion === 1) && Array.isArray(input.nodes)) {
    const legacy = parseCanvasDocument(input);
    return parseProjectDefinition({ kind: "newpower.project", schemaVersion: 2, projectId: legacy.projectId, revision: legacy.revision, updatedAt: legacy.updatedAt, entryPageId: "main", pages: [{ id: "main", name: "首页", width: legacy.width, height: legacy.height, theme: legacy.theme, nodes: legacy.nodes }], dataBindings: legacy.dataBindings ?? [] });
  }
  if (input.kind !== "newpower.project" || input.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new AppError(400, "unsupported_project_schema", "不支持的项目定义类型或版本。");
  const projectId = requireIdentifier(input.projectId, "project.projectId");
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) invalid("项目 revision 必须是非负整数。");
  if (input.updatedAt !== null && (typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt)))) invalid("项目更新时间无效。");
  if (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > 100) invalid("项目必须包含 1–100 个页面。");
  const dataBindings = validateComponentBindings(input.dataBindings ?? []);
  const pages = (input.pages as unknown[]).map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("页面必须是对象。");
    const page = value as Record<string, unknown>;
    const id = requireIdentifier(page.id, "page.id");
    if (!Number.isInteger(page.width) || !Number.isInteger(page.height)) invalid("页面尺寸必须为整数。");
    const canvas = parseCanvasDocument({ schemaVersion: 1, projectId, revision: input.revision, updatedAt: input.updatedAt, width: page.width, height: page.height, theme: page.theme, nodes: page.nodes, dataBindings });
    return { id, name: pageName(page.name), width: canvas.width, height: canvas.height, theme: canvas.theme, nodes: canvas.nodes };
  });
  if (new Set(pages.map((page) => page.id)).size !== pages.length) invalid("页面 ID 不能重复。");
  const entryPageId = requireIdentifier(input.entryPageId, "project.entryPageId");
  if (!pages.some((page) => page.id === entryPageId)) invalid("项目入口页不存在。");
  const nodes = pages.flatMap((page) => page.nodes);
  if (nodes.length > 2000 || new Set(nodes.map((node) => node.id)).size !== nodes.length) invalid("项目节点最多 2000 个，且 ID 必须在整个项目内唯一。");
  const groupPages = new Map<string, string>();
  for (const page of pages) for (const node of page.nodes) {
    if (!node.groupId) continue;
    if (groupPages.has(node.groupId) && groupPages.get(node.groupId) !== page.id) invalid("同一分组的组件必须位于同一页面。");
    groupPages.set(node.groupId, page.id);
  }
  validateLocalComponentReferences(nodes, dataBindings);
  return { kind: "newpower.project", schemaVersion: 2, projectId, revision: Number(input.revision), updatedAt: input.updatedAt as string | null, entryPageId, pages, dataBindings };
}

export function projectPageView(project: ProjectDefinition, id = project.entryPageId): CanvasDocument {
  const page = project.pages.find((page) => page.id === id);
  if (!page) throw new AppError(404, "page_not_found", `页面 ${id} 不存在。`);
  const refs = new Set(page.nodes.flatMap((node) => node.dataBindingRefs));
  return { schemaVersion: 1, projectId: project.projectId, pageId: page.id, width: page.width, height: page.height, theme: page.theme, revision: project.revision, updatedAt: project.updatedAt, nodes: page.nodes, dataBindings: project.dataBindings.filter((binding) => refs.has(binding.id)) };
}

export function projectContent(project: ProjectDefinition): ProjectContent {
  return structuredClone({ entryPageId: project.entryPageId, pages: project.pages, dataBindings: project.dataBindings });
}
export function projectContentKey(project: ProjectContent): string {
  return JSON.stringify({ entryPageId: project.entryPageId,
    pages: project.pages.map((page) => ({ ...page, nodes: [...page.nodes].sort((a, b) => a.id.localeCompare(b.id)) })),
    dataBindings: [...project.dataBindings].sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export function projectDefinitionPatch(current: ProjectDefinition, saved: ProjectContent): ProjectPatch {
  const oldPages = new Map(saved.pages.map((page) => [page.id, page]));
  const oldNodes = new Map(saved.pages.flatMap((page) => page.nodes.map((node) => [node.id, { ...node, pageId: page.id }] as const)));
  const currentNodes = current.pages.flatMap((page) => page.nodes.map((node) => ({ ...node, pageId: page.id })));
  const nodeIds = new Set(currentNodes.map((node) => node.id));
  const metadata = ({ nodes: _nodes, ...page }: ProjectPage): PageMetadata => page;
  return {
    expectedRevision: current.revision,
    upsertPages: current.pages.filter((page) => !oldPages.has(page.id) || JSON.stringify(metadata(page)) !== JSON.stringify(metadata(oldPages.get(page.id)!))).map(metadata),
    deletePageIds: saved.pages.filter((page) => !current.pages.some((item) => item.id === page.id)).map((page) => page.id),
    upsertNodes: currentNodes.filter((node) => JSON.stringify(oldNodes.get(node.id)) !== JSON.stringify(node)),
    deleteNodeIds: [...oldNodes.keys()].filter((id) => !nodeIds.has(id)),
    pageOrder: current.pages.map((page) => page.id), entryPageId: current.entryPageId, dataBindings: current.dataBindings,
  };
}

export function validateProjectPatch(value: unknown): ProjectPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("项目修改必须是对象。");
  const input = value as Record<string, unknown>;
  const fields = ["expectedRevision", "upsertPages", "deletePageIds", "upsertNodes", "deleteNodeIds", "pageOrder", "entryPageId", "dataBindings"];
  if (Object.keys(input).some((field) => !fields.includes(field))) invalid("项目修改包含未知字段。");
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) invalid("expectedRevision 必须是非负整数。");
  for (const field of ["upsertPages", "deletePageIds", "upsertNodes", "deleteNodeIds"]) if (!Array.isArray(input[field])) invalid(`${field} 必须是数组。`);
  if ((input.upsertNodes as unknown[]).length + (input.deleteNodeIds as unknown[]).length > 2000) invalid("单次最多修改 2000 个节点。");
  if ((input.upsertPages as unknown[]).length + (input.deletePageIds as unknown[]).length > 100) invalid("单次最多修改 100 个页面。");
  const ids = (value: unknown, field: string) => {
    if (!Array.isArray(value)) invalid(`${field} 必须是数组。`);
    const result = (value as unknown[]).map((id) => requireIdentifier(id, field));
    if (new Set(result).size !== result.length) invalid(`${field} 不能包含重复 ID。`);
    return result;
  };
  const upsertPages = (input.upsertPages as unknown[]).map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("页面配置必须是对象。");
    const page = value as Record<string, unknown>;
    const id = requireIdentifier(page.id, "page.id");
    if (Object.keys(page).some((key) => !["id", "name", "width", "height", "theme"].includes(key))) invalid("页面配置包含未知字段。");
    const width = page.width, height = page.height;
    if (typeof width !== "number" || !Number.isInteger(width) || width < 320 || width > 7680 || typeof height !== "number" || !Number.isInteger(height) || height < 240 || height > 4320) invalid("页面尺寸必须为 320–7680 × 240–4320 的整数。");
    return { id, name: pageName(page.name), width: width as number, height: height as number, theme: validateCanvasTheme(page.theme) };
  });
  const upsertNodes = (input.upsertNodes as unknown[]).map((value) => {
    const node = validateNode(value);
    return { ...node, pageId: requireIdentifier((value as Record<string, unknown>).pageId, "node.pageId") };
  });
  const deletePageIds = ids(input.deletePageIds, "deletePageIds"), deleteNodeIds = ids(input.deleteNodeIds, "deleteNodeIds");
  const pageIds = [...upsertPages.map((page) => page.id), ...deletePageIds];
  const nodeIds = [...upsertNodes.map((node) => node.id), ...deleteNodeIds];
  if (new Set(pageIds).size !== pageIds.length || new Set(nodeIds).size !== nodeIds.length) invalid("同一修改中的实体 ID 不能重复或同时删除和更新。");
  return { expectedRevision: Number(input.expectedRevision), upsertPages, deletePageIds, upsertNodes, deleteNodeIds,
    pageOrder: input.pageOrder === undefined ? undefined : ids(input.pageOrder, "pageOrder"),
    entryPageId: input.entryPageId === undefined ? undefined : requireIdentifier(input.entryPageId, "entryPageId"),
    dataBindings: input.dataBindings === undefined ? undefined : validateComponentBindings(input.dataBindings),
  };
}

export function applyProjectPatch(current: ProjectDefinition, patch: ProjectPatch): ProjectDefinition {
  if (current.revision !== patch.expectedRevision) throw new AppError(409, "canvas_revision_conflict", "项目已被其他操作修改，请读取最新版本后重试。");
  const pages = new Map(current.pages.filter((page) => !patch.deletePageIds.includes(page.id)).map((page) => [page.id, structuredClone(page)]));
  for (const page of patch.upsertPages) pages.set(page.id, { ...page, nodes: pages.get(page.id)?.nodes ?? [] });
  const replacing = new Set([...patch.deleteNodeIds, ...patch.upsertNodes.map((node) => node.id)]);
  for (const page of pages.values()) page.nodes = page.nodes.filter((node) => !replacing.has(node.id));
  for (const { pageId, ...node } of patch.upsertNodes) {
    const page = pages.get(pageId);
    if (!page) invalid(`目标页面 ${pageId} 不存在。`);
    page!.nodes.push(node);
  }
  const order = patch.pageOrder ?? [...pages.keys()];
  if (order.length !== pages.size || order.some((id) => !pages.has(id))) invalid("页面顺序必须恰好包含所有页面。");
  const pageList = order.map((id) => pages.get(id)!);
  const bindings = validateLocalComponentReferences(pageList.flatMap((page) => page.nodes), patch.dataBindings ?? current.dataBindings);
  return parseProjectDefinition({ ...current, pages: pageList, entryPageId: patch.entryPageId ?? current.entryPageId, dataBindings: bindings });
}
