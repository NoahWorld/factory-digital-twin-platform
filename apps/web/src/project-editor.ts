import { createContext, createElement, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errorMessage, request } from "./api";
import { createEditorState, executeEditorOperation, isEditorDirty, markEditorSaved, restoreEditorDraft, switchEditorPage, travelEditorHistory, type EditorState, type ProjectOperation } from "../../../shared/editor-operations";
import { parseProjectDefinition, projectContent, projectDefinitionPatch, type ProjectContent, type ProjectDefinition } from "../../../shared/project-definition";

export const projectDefinitionPath = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}/definition`;
type DefinitionResponse = { definition: ProjectDefinition; project: { name: string }; editable: boolean };
type Draft = { schemaVersion: 2; userId: string; projectId: string; baseRevision: number; pageId: string; content: ProjectContent; savedAt: string };

export function useProjectEditor(projectId: string, userId: string, editing: boolean, requestedPageId?: string) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  const [projectName, setProjectName] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [reloadIndex, setReloadIndex] = useState(0);
  const draftPrepared = useRef(false);
  const draftWritable = useRef(true);
  const requestedPageRef = useRef(requestedPageId);
  requestedPageRef.current = requestedPageId;
  const draftKey = `newpower:draft:${userId}:${projectId}`;
  const conflictKey = `${draftKey}:conflicts`;
  const dirty = useMemo(() => editor ? isEditorDirty(editor) : false, [editor]);
  const draftDifferences = useMemo(() => {
    if (!pendingDraft || !editor) return [];
    const patch = projectDefinitionPatch({ ...editor.project, ...pendingDraft.content }, projectContent(editor.project));
    const lines = patch.upsertPages.map((page) => {
      const old = editor.project.pages.find((item) => item.id === page.id);
      return old ? `页面「${old.name}」→「${page.name}」，尺寸 ${page.width} × ${page.height}` : `新增页面「${page.name}」`;
    });
    patch.deletePageIds.forEach((id) => lines.push(`删除页面「${editor.project.pages.find((page) => page.id === id)?.name ?? id}」`));
    if (patch.upsertNodes.length || patch.deleteNodeIds.length) lines.push(`新增或修改 ${patch.upsertNodes.length} 个组件，删除 ${patch.deleteNodeIds.length} 个组件`);
    if (JSON.stringify(editor.project.dataBindings) !== JSON.stringify(pendingDraft.content.dataBindings)) lines.push(`绑定定义将变为 ${pendingDraft.content.dataBindings.length} 条`);
    if (editor.project.entryPageId !== pendingDraft.content.entryPageId) lines.push("入口页面改变");
    if (JSON.stringify(editor.project.pages.map((page) => page.id)) !== JSON.stringify(pendingDraft.content.pages.map((page) => page.id))) lines.push("页面顺序改变");
    return lines.length ? lines : ["内容与当前编辑器相同"];
  }, [pendingDraft, editor]);

  const store = useCallback((next: EditorState) => { editorRef.current = next; setEditor(next); }, []);
  const persistDraft = useCallback((next: EditorState) => {
    if (!editing || !canEdit || !draftWritable.current) return false;
    try {
      if (isEditorDirty(next)) {
        const draft: Draft = { schemaVersion: 2, userId, projectId, baseRevision: next.project.revision, pageId: next.pageId, content: projectContent(next.project), savedAt: new Date().toISOString() };
        localStorage.setItem(draftKey, JSON.stringify(draft));
        setDraftNotice("已在本机暂存，仍需保存画布。");
      } else { localStorage.removeItem(draftKey); setDraftNotice(null); }
      return true;
    } catch (reason) { setDraftNotice(`本机草稿无法保存：${errorMessage(reason)}。请保存画布或保留当前页面。`); return false; }
  }, [editing, canEdit, userId, projectId, draftKey]);

  useEffect(() => {
    const controller = new AbortController();
    draftPrepared.current = editing; draftWritable.current = true;
    setLoading(true); setLoadError(null); setSaveError(null); setPendingDraft(null); setDraftNotice(null);
    editorRef.current = null; setEditor(null);
    void request<DefinitionResponse>(projectDefinitionPath(projectId), { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      let state = createEditorState(result.definition, requestedPageRef.current);
      setProjectName(result.project.name); setCanEdit(result.editable);
      if (editing && result.editable) {
        try {
          const validateDraft = (value: unknown): Draft => {
            const draft = value as Draft;
            if (!draft || draft.schemaVersion !== 2 || draft.userId !== userId || draft.projectId !== projectId || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0) throw new Error("草稿身份或版本不匹配");
            const candidate = parseProjectDefinition({ ...result.definition, entryPageId: draft.content?.entryPageId, pages: draft.content?.pages, dataBindings: draft.content?.dataBindings });
            return { ...draft, content: projectContent(candidate) };
          };
          const storedConflicts: unknown = JSON.parse(localStorage.getItem(conflictKey) ?? "[]");
          if (!Array.isArray(storedConflicts)) throw new Error("冲突草稿记录无效");
          const conflicts = storedConflicts.map(validateDraft);
          const serialized = localStorage.getItem(draftKey);
          if (serialized) {
            const draft = validateDraft(JSON.parse(serialized));
            if (draft.baseRevision === result.definition.revision) {
              state = restoreEditorDraft(state, draft.content, requestedPageRef.current ?? draft.pageId);
              setDraftNotice("已恢复本机未保存草稿；服务器内容尚未改变。");
            } else {
              if (!conflicts.some((item) => JSON.stringify(item) === JSON.stringify(draft))) conflicts.push(draft);
              // Back up first. A storage failure must leave the active draft intact.
              localStorage.setItem(conflictKey, JSON.stringify(conflicts));
              localStorage.removeItem(draftKey);
            }
          }
          if (conflicts.length) {
            setPendingDraft(conflicts[0]);
            setDraftNotice(`另有 ${conflicts.length} 份冲突草稿保留在本机。当前服务器版本 ${result.definition.revision}，该草稿基线 ${conflicts[0].baseRevision}。`);
          }
        } catch (reason) { draftWritable.current = false; setDraftNotice(`本机草稿未恢复：${errorMessage(reason)}。原始草稿仍保留，后续编辑请直接保存服务器。`); }
      }
      store(state);
    }).catch((reason) => { if (!controller.signal.aborted) setLoadError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, userId, draftKey, conflictKey, store, reloadIndex]);

  useEffect(() => {
    if (editing && !loading && editorRef.current && !draftPrepared.current) {
      draftPrepared.current = true; setReloadIndex((value) => value + 1);
    }
  }, [editing, loading]);

  useEffect(() => {
    if (!requestedPageId || !editorRef.current || !editorRef.current.project.pages.some((page) => page.id === requestedPageId)) return;
    store(switchEditorPage(editorRef.current, requestedPageId));
  }, [requestedPageId, store]);

  const execute = useCallback((operation: ProjectOperation) => {
    const current = editorRef.current;
    if (!current || !editing || !canEdit || savingRef.current) return null;
    try {
      const next = executeEditorOperation(current, operation); store(next); persistDraft(next); setSaveError(null); return next.document;
    } catch (reason) { setSaveError(errorMessage(reason)); return null; }
  }, [editing, canEdit, store, persistDraft]);
  const travel = useCallback((direction: "undo" | "redo") => {
    const current = editorRef.current;
    if (!current || !editing || !canEdit || savingRef.current) return null;
    const next = travelEditorHistory(current, direction); store(next); persistDraft(next); setSaveError(null); return next.document;
  }, [editing, canEdit, store, persistDraft]);
  const selectPage = useCallback((id: string) => {
    const current = editorRef.current; if (!current || savingRef.current) return;
    try { const next = switchEditorPage(current, id); store(next); if (isEditorDirty(next)) persistDraft(next); }
    catch (reason) { setSaveError(errorMessage(reason)); }
  }, [store, persistDraft]);
  const save = useCallback(async () => {
    const current = editorRef.current;
    if (!current || !editing || !canEdit || savingRef.current) return false;
    if (!isEditorDirty(current)) return true;
    savingRef.current = true; setSaving(true); setSaveError(null);
    try {
      const result = await request<{ definition: ProjectDefinition }>(projectDefinitionPath(projectId), { method: "PATCH", body: JSON.stringify(projectDefinitionPatch(current.project, current.savedProject)) });
      const next = markEditorSaved(current, result.definition); store(next);
      try { if (draftWritable.current) localStorage.removeItem(draftKey); setDraftNotice(pendingDraft ? "项目已保存；此前冲突草稿仍保留，可恢复或放弃。" : null); }
      catch (reason) { setDraftNotice(`项目已保存，但本机草稿清理失败：${errorMessage(reason)}`); }
      return true;
    } catch (reason) { setSaveError(errorMessage(reason)); return false; }
    finally { savingRef.current = false; setSaving(false); }
  }, [editing, canEdit, projectId, draftKey, store, pendingDraft]);
  const resolvePendingDraft = useCallback(() => {
    if (!pendingDraft) return;
    const conflicts = JSON.parse(localStorage.getItem(conflictKey) ?? "[]") as Draft[];
    const remaining = conflicts.filter((draft) => JSON.stringify(draft) !== JSON.stringify(pendingDraft));
    if (remaining.length) localStorage.setItem(conflictKey, JSON.stringify(remaining));
    else localStorage.removeItem(conflictKey);
    setPendingDraft(remaining[0] ?? null);
  }, [pendingDraft, conflictKey]);
  const restoreDraft = useCallback(() => {
    if (!pendingDraft || !editorRef.current || !canEdit || savingRef.current) return;
    try {
      const next = restoreEditorDraft(editorRef.current, pendingDraft.content, pendingDraft.pageId);
      store(next);
      if (persistDraft(next)) { resolvePendingDraft(); setDraftNotice("草稿已恢复到编辑器；请核对后保存，或撤销恢复。"); }
    } catch (reason) { setSaveError(errorMessage(reason)); }
  }, [pendingDraft, canEdit, store, persistDraft, resolvePendingDraft]);
  const discardDraft = useCallback(() => {
    if (savingRef.current) return;
    try {
      if (pendingDraft) { resolvePendingDraft(); setDraftNotice("已放弃此冲突草稿；当前编辑内容保留。"); return; }
      if (editorRef.current && isEditorDirty(editorRef.current)) store(restoreEditorDraft(editorRef.current, editorRef.current.savedProject));
      if (draftWritable.current) localStorage.removeItem(draftKey);
      setDraftNotice(null);
    } catch (reason) { setDraftNotice(`本机草稿清理失败：${errorMessage(reason)}`); }
  }, [draftKey, pendingDraft, resolvePendingDraft, store]);
  return { editor, document: editor?.document ?? null, projectName, canEdit, loading, loadError, saveError, setSaveError,
    saving, dirty, execute, travel, selectPage, save, pendingDraft, draftNotice, draftDifferences, restoreDraft, discardDraft };
}

const ProjectEditorContext = createContext<ReturnType<typeof useProjectEditor> | null>(null);
export function ProjectEditorProvider({ projectId, userId, editing, pageId, children }: { projectId: string; userId: string; editing: boolean; pageId?: string; children: ReactNode }) {
  const value = useProjectEditor(projectId, userId, editing, pageId);
  return createElement(ProjectEditorContext.Provider, { value }, children);
}
export function useProjectEditorContext() {
  const value = useContext(ProjectEditorContext);
  if (!value) throw new Error("Project editor provider is required.");
  return value;
}
