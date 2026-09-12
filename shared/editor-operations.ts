export * from "./canvas-operations";
export type { ProjectOperation } from "./project-operations";
import { AppError } from "./errors";
import { editableContent, type EditableContent } from "./canvas-operations";
import { parseProjectDefinition, projectPageView, projectContent, projectContentKey, type ProjectDefinition, type ProjectContent } from "./project-definition";
import { applyProjectOperation } from "./project-operations";
import type { CanvasDocument } from "./canvas-schema";

type HistoryEntry = { content: ProjectContent; pageId: string };
export type EditorState = {
  project: ProjectDefinition;
  pageId: string;
  document: CanvasDocument;
  savedProject: ProjectContent;
  saved: EditableContent;
  past: HistoryEntry[];
  future: HistoryEntry[];
};

function stateView(project: ProjectDefinition, savedProject: ProjectContent, past: HistoryEntry[], future: HistoryEntry[], requestedPageId?: string): EditorState {
  const pageId = project.pages.some((page) => page.id === requestedPageId) ? requestedPageId! : project.entryPageId;
  const document = projectPageView(project, pageId);
  const savedDocument = savedProject.pages.some((page) => page.id === pageId)
    ? projectPageView({ ...project, ...savedProject }, pageId)
    : { ...document, nodes: [], dataBindings: [] };
  return { project, pageId, document, savedProject, saved: editableContent(savedDocument), past, future };
}

export function createEditorState(input: unknown, pageId?: string): EditorState {
  const project = parseProjectDefinition(input);
  return stateView(project, projectContent(project), [], [], pageId);
}
export function switchEditorPage(state: EditorState, pageId: string): EditorState {
  if (!state.project.pages.some((page) => page.id === pageId)) throw new AppError(404, "page_not_found", "页面不存在。");
  return stateView(state.project, state.savedProject, state.past, state.future, pageId);
}
export function isEditorDirty(state: EditorState): boolean {
  return projectContentKey(state.project) !== projectContentKey(state.savedProject);
}
export function executeEditorOperation(state: EditorState, value: unknown): EditorState {
  const project = applyProjectOperation(state.project, value, state.pageId);
  if (projectContentKey(project) === projectContentKey(state.project)) return state;
  const operation = value as { type: string; targetPageId?: string };
  const added = project.pages.find((page) => !state.project.pages.some((old) => old.id === page.id));
  const pageId = added?.id ?? (operation.type === "nodes.move-page" ? operation.targetPageId : state.pageId);
  return stateView(project, state.savedProject, [...state.past.slice(-99), { content: projectContent(state.project), pageId: state.pageId }], [], pageId);
}
export function travelEditorHistory(state: EditorState, direction: "undo" | "redo"): EditorState {
  const source = direction === "undo" ? state.past : state.future;
  if (!source.length) return state;
  const project = parseProjectDefinition({ ...state.project, ...source.at(-1)!.content });
  const restored = project.pages.find((page) => !state.project.pages.some((old) => old.id === page.id));
  return stateView(project, state.savedProject,
    direction === "undo" ? state.past.slice(0, -1) : [...state.past, { content: projectContent(state.project), pageId: state.pageId }],
    direction === "undo" ? [...state.future, { content: projectContent(state.project), pageId: state.pageId }] : state.future.slice(0, -1),
    restored?.id ?? source.at(-1)!.pageId);
}
export function markEditorSaved(state: EditorState, input: unknown): EditorState {
  const project = parseProjectDefinition(input);
  if (project.projectId !== state.project.projectId) throw new AppError(400, "project_identity_mismatch", "保存响应来自另一项目。");
  return stateView(project, projectContent(project), state.past, state.future, state.pageId);
}
export function restoreEditorDraft(state: EditorState, content: ProjectContent, pageId?: string): EditorState {
  const project = applyProjectOperation(state.project, { type: "project.restore", content }, state.pageId);
  return stateView(project, state.savedProject, [...state.past, { content: projectContent(state.project), pageId: state.pageId }], [], pageId ?? state.pageId);
}
/** Legacy single-page adapter; the main editor saves projectDefinitionPatch. */
export function editorPatch(state: EditorState) {
  const saved = new Map(state.saved.nodes.map((node) => [node.id, node]));
  const current = new Set(state.document.nodes.map((node) => node.id));
  return {
    expectedRevision: state.document.revision, theme: state.document.theme, dataBindings: state.document.dataBindings ?? [],
    upsertNodes: state.document.nodes.filter((node) => JSON.stringify(saved.get(node.id)) !== JSON.stringify(node)),
    deleteNodeIds: state.saved.nodes.filter((node) => !current.has(node.id)).map((node) => node.id),
  };
}
