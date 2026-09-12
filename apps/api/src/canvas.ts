import { AppError, type AppEnv } from "./auth";
import type { CanvasDocument, CanvasPatch } from "../../../shared/canvas-schema";
import { projectPageView, type PageMetadata } from "../../../shared/project-definition";
import { validateLocalComponentReferences } from "../../../shared/component-bindings";
import { getProjectDefinition, persistProjectPatch } from "./project-definitions";
export * from "../../../shared/canvas-schema";

export async function getCanvas(env: AppEnv, projectId: string, pageId?: string): Promise<CanvasDocument> {
  return projectPageView(await getProjectDefinition(env, projectId), pageId);
}

/** Compatibility view: page-local changes join the project-wide version transaction. */
export async function applyCanvasPatch(env: AppEnv, projectId: string, userId: string, patch: CanvasPatch, pageId?: string): Promise<CanvasDocument> {
  const current = await getProjectDefinition(env, projectId);
  if (current.revision !== patch.expectedRevision) throw new AppError(409, "canvas_revision_conflict", "项目已更新，请读取最新版本后重试。");
  const view = projectPageView(current, pageId);
  const page = current.pages.find((page) => page.id === view.pageId)!;
  const changed = [...patch.upsertNodes.map((node) => node.id), ...patch.deleteNodeIds];
  for (const other of current.pages) if (other.id !== page.id && other.nodes.some((node) => changed.includes(node.id))) {
    throw new AppError(400, "node_page_mismatch", "组件不属于当前页面，请使用明确的跨页移动操作。");
  }
  const finalNodes = new Map(page.nodes.map((node) => [node.id, node]));
  patch.deleteNodeIds.forEach((id) => finalNodes.delete(id)); patch.upsertNodes.forEach((node) => finalNodes.set(node.id, node));
  const definitions = new Map(current.dataBindings.map((binding) => [binding.id, binding]));
  if (patch.dataBindings !== undefined) {
    validateLocalComponentReferences([...finalNodes.values()], patch.dataBindings);
    const otherRefs = new Set(current.pages.filter((other) => other.id !== page.id).flatMap((other) => other.nodes.flatMap((node) => node.dataBindingRefs)));
    for (const binding of view.dataBindings ?? []) if (!otherRefs.has(binding.id)) definitions.delete(binding.id);
    patch.dataBindings.forEach((binding) => definitions.set(binding.id, binding));
  }
  const metadata: PageMetadata = { id: page.id, name: page.name, width: page.width, height: page.height, theme: patch.theme ?? page.theme };
  const next = await persistProjectPatch(env, projectId, userId, {
    expectedRevision: patch.expectedRevision, upsertPages: patch.theme ? [metadata] : [], deletePageIds: [],
    upsertNodes: patch.upsertNodes.map((node) => ({ ...node, pageId: page.id })), deleteNodeIds: patch.deleteNodeIds,
    dataBindings: [...definitions.values()],
  });
  return projectPageView(next, page.id);
}
