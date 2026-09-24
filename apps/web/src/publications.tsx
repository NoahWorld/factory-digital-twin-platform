import { useEffect, useMemo, useState } from "react";
import type { StandaloneSceneDocument } from "../../../shared/standalone-3d";
import type { TwinAction } from "../../../shared/twin-actions";
import { errorMessage, request } from "./api";
import { CanvasSurface } from "./canvas/CanvasSurface";
import { Model3DNode } from "./canvas/Model3DNode";
import { standaloneRendererNode } from "./canvas/standalone-renderer-node";
import type { ProjectAsset } from "./canvas/assets";
import type { CanvasDocument, CanvasNode } from "./canvas/types";
import { useAssetRuntimeConnections } from "./twin/useAssetRuntimeConnections";
import { useTwinActions } from "./twin/useTwinActions";
import { AssetRuntimeDetailPanel } from "./twin/AssetRuntimeDetailPanel";
import { TwinActionFeedback } from "./twin/TwinActionFeedback";
import { PublicationContext, publicationRunRoute, publicationsPath } from "./publication-runtime";
import type { PublicationSnapshot } from "./publication-runtime";

type PublicationVersion = {
  id: string;
  title: string;
  documentRevision: number;
  createdAt: string;
  snapshot: PublicationSnapshot;
};

type VersionResponse = { version: PublicationVersion; pointerRevision?: number };
type PublicationList = {
  activeVersionId: string | null;
  pointerRevision: number;
  versions: Array<Pick<PublicationVersion, "id" | "title" | "documentRevision" | "createdAt">>;
};
type DraftResponse = { draftHash: string; documentRevision: number; projectCount: number; resourceCount: number; pointerRevision: number };

export function PublicationPanel({ projectId, canEdit, disabled }: { projectId: string; canEdit: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [list, setList] = useState<PublicationList | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [nextDraft, nextList] = await Promise.all([
      canEdit ? request<DraftResponse>(`${publicationsPath(projectId)}/draft`) : Promise.resolve(null),
      request<PublicationList>(publicationsPath(projectId)),
    ]);
    setDraft(nextDraft);
    setList(nextList);
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([
      canEdit ? request<DraftResponse>(`${publicationsPath(projectId)}/draft`) : Promise.resolve(null),
      request<PublicationList>(publicationsPath(projectId)),
    ]).then(([nextDraft, nextList]) => {
      if (active) { setDraft(nextDraft); setList(nextList); }
    }).catch((reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [canEdit, open, projectId]);

  const create = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await request(publicationsPath(projectId), {
        method: "POST",
        body: JSON.stringify({ title: title.trim() || `修订版 ${draft.documentRevision}`, expectedDraftHash: draft.draftHash }),
      });
      setTitle("");
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  };

  const activate = async (versionId: string) => {
    if (!list) return;
    setBusy(true);
    setError(null);
    try {
      await request(`${publicationsPath(projectId)}/${encodeURIComponent(versionId)}/activate`, {
        method: "POST",
        body: JSON.stringify({ expectedPointerRevision: list.pointerRevision }),
      });
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
      try { await refresh(); } catch (refreshReason) { console.error("Failed to refresh publication state", { projectId, refreshReason }); }
    } finally { setBusy(false); }
  };

  return <>
    <button className="secondary-button compact-button" disabled={disabled} onClick={() => { setError(null); setOpen(true); }} type="button">发布版本</button>
    {open ? <div className="dialog-backdrop" role="presentation">
      <section aria-label="发布版本与回滚" aria-modal="true" className="dialog-card publication-dialog" role="dialog">
        <button aria-label="关闭发布版本" className="dialog-close" disabled={busy} onClick={() => setOpen(false)} type="button">×</button>
        <h2>发布版本与回滚</h2>
        <p>发布会冻结已保存的项目文档、关联场景、设备配置和资源引用。创建版本后再选择激活。</p>
        {canEdit ? draft ? <p>当前草稿修订版 {draft.documentRevision} · {draft.projectCount} 个项目 · {draft.resourceCount} 个资源</p> : <p>正在读取草稿…</p> : null}
        {canEdit ? <div className="publication-create">
          <input aria-label="版本名称" disabled={busy || disabled || !draft} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="版本名称（可选）" value={title} />
          <button className="primary-button" disabled={busy || disabled || !draft} onClick={() => void create()} type="button">创建快照</button>
        </div> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="publication-versions">
          {list?.versions.map((version) => <div className="publication-version" key={version.id}>
            <div><strong>{version.title}</strong><small>修订版 {version.documentRevision} · {new Date(version.createdAt).toLocaleString("zh-CN")}{list.activeVersionId === version.id ? " · 当前运行" : ""}</small></div>
            <a className="secondary-button" href={publicationRunRoute(projectId, version.id)} target="_blank" rel="noreferrer">查看固定版本</a>
            {canEdit && list.activeVersionId !== version.id ? <button className="secondary-button" disabled={busy} onClick={() => void activate(version.id)} type="button">{list.activeVersionId ? "回滚到此版本" : "激活版本"}</button> : null}
          </div>)}
          {list && list.versions.length === 0 ? <p>尚无发布快照。</p> : null}
        </div>
        {list?.activeVersionId ? <a href={publicationRunRoute(projectId)} target="_blank" rel="noreferrer">打开当前运行版本 ↗</a> : null}
      </section>
    </div> : null}
  </>;
}

const ignore = () => undefined;

export function PublicationRunPage({ projectId, versionId }: { projectId: string; versionId?: string }) {
  const [response, setResponse] = useState<VersionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ projectId: string; instanceId: string; requestId: string } | null>(null);
  const [embeddedSelection, setEmbeddedSelection] = useState<import("./canvas/EmbeddedSceneNode").EmbeddedSceneRuntimeSelection | null>(null);
  const [embeddedActionError, setEmbeddedActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setResponse(null);
    setError(null);
    void request<VersionResponse>(versionId ? `${publicationsPath(projectId)}/${encodeURIComponent(versionId)}` : `${publicationsPath(projectId)}/active`)
      .then((result) => {
        if (!active) return;
        if (!versionId) {
          window.location.replace(publicationRunRoute(projectId, result.version.id));
          return;
        }
        setResponse(result);
      }).catch((reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [projectId, versionId]);

  const snapshot = response?.version.snapshot ?? null;
  const root = snapshot?.projects[projectId] ?? null;
  const isCanvas = root?.project.projectType === "2d";
  const canvas = root ? (isCanvas ? root.document as CanvasDocument : snapshot?.projects[(root.document as StandaloneSceneDocument).linked2dProjectId ?? ""]?.document as CanvasDocument | undefined) : null;
  const assets = root ? (isCanvas ? root.assets : snapshot?.projects[canvas?.projectId ?? ""]?.assets ?? []) : [];
  const runtimeProjectId = canvas?.projectId ?? null;
  const runtimeConnections = useAssetRuntimeConnections({
    assets, enabled: Boolean(response), projectId: runtimeProjectId,
    publicationVersion: versionId ? { rootProjectId: projectId, versionId } : undefined,
  });
  const embeddedProjectId = embeddedSelection?.assetId ? embeddedSelection.linked2dProjectId : null;
  const embeddedAssets = embeddedProjectId ? snapshot?.projects[embeddedProjectId]?.assets ?? [] : [];
  const embeddedAsset = embeddedSelection?.assetId
    ? embeddedAssets.find((asset) => asset.assetId === embeddedSelection.assetId) ?? null : null;
  const embeddedRuntimeAssets = useMemo(() => embeddedAsset ? [embeddedAsset] : [], [embeddedAsset]);
  const embeddedRuntimeError = embeddedSelection?.assetId && !embeddedAsset
    ? `发布快照中没有业务设备 ${embeddedSelection.assetId}。` : null;
  const embeddedConnections = useAssetRuntimeConnections({
    assets: embeddedRuntimeAssets, enabled: Boolean(response) && Boolean(embeddedAsset),
    blockedReason: embeddedRuntimeError, projectId: embeddedProjectId,
    publicationVersion: versionId ? { rootProjectId: projectId, versionId } : undefined,
  });
  const scenes = useMemo(() => snapshot ? Object.values(snapshot.projects)
    .filter((entry) => entry.project.projectType === "3d")
    .map((entry) => ({ projectId: entry.project.id, name: entry.project.name,
      instances: (entry.document as StandaloneSceneDocument).instances })) : [], [snapshot]);
  const actions = useTwinActions({
    canvasDocument: canvas ?? null, assets, scenes, contextKey: `${projectId}:${versionId ?? "active"}`,
    onSelectAsset: (assetId) => {
      const asset = assets.find((candidate) => candidate.assetId === assetId);
      if (!asset) throw new Error(`发布快照中没有业务设备 ${assetId}。`);
      setEmbeddedSelection(null);
      setSelectedAssetId(asset.id);
    },
    onFocusModel: (sceneProjectId, instanceId) => setFocus({ projectId: sceneProjectId, instanceId, requestId: crypto.randomUUID() }),
  });
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const execute = (steps: readonly TwinAction[], source: string) => {
    setEmbeddedActionError(null);
    actions.execute(steps, source);
  };
  const scene = root && !isCanvas ? root.document as StandaloneSceneDocument : null;
  const rendererNode = scene ? standaloneRendererNode(scene) : null;
  const runVersionId = response?.version.id;

  if (error) return <main className="canvas-page-state error-state"><h1>发布版本加载失败</h1><p>{error}</p><a href="#/projects">返回项目</a></main>;
  if (!response || !root || !runVersionId) return <main className="canvas-page-state"><h1>正在加载发布版本…</h1></main>;
  if (snapshot?.rootProjectId !== projectId || snapshot.schemaVersion !== 1)
    return <main className="canvas-page-state error-state"><h1>发布快照无效</h1></main>;

  return <PublicationContext.Provider value={snapshot}>
    <main className={isCanvas ? "canvas-page publication-run" : "standalone-3d-preview publication-run"}>
      <header className={isCanvas ? "canvas-toolbar" : undefined}>
        <a className="secondary-button compact-button" href="#/projects">返回项目</a>
        <div><span>发布运行版本</span><strong>{root.project.name} · {response.version.title}</strong></div>
        <a className="secondary-button compact-button" href={isCanvas ? `#/projects/${encodeURIComponent(projectId)}/canvas` : `#/projects/${encodeURIComponent(projectId)}/scene`}>编辑草稿</a>
      </header>
      {isCanvas && canvas ? <CanvasSurface
        document={canvas} editable={false} modelInteractionEnabled runtimeControlsEnabled
        selectedNodeId={null} selectedModelSceneNodePath={null}
        embeddedSceneSelection={embeddedSelection} onEmbeddedSceneSelectionChange={setEmbeddedSelection}
        modelFocusRequest={focus} onEmbeddedSceneActions={(selection, steps) => {
          if (selection.linked2dProjectId && selection.linked2dProjectId !== projectId
            && steps.some((step) => step.type !== "focus-model" && step.type !== "message")) {
            setEmbeddedActionError(`模型事件属于另一个 2D 项目 ${selection.linked2dProjectId}，不能操作当前看板。`);
            return;
          }
          execute(steps, `模型 ${selection.label}`);
        }}
        onNodeActions={(node: CanvasNode) => execute(node.interaction?.clickActions ?? [], `组件 ${node.id}`)}
        onCreateNode={ignore} onModelSceneNodeSelect={ignore} onNodeChange={ignore} onSelectNode={ignore}
        runtimeAsset={embeddedSelection?.assetId ? embeddedAsset : selectedAsset}
        runtimeAssetConnection={embeddedSelection?.assetId
          ? embeddedAsset ? embeddedConnections[embeddedAsset.id] : undefined
          : selectedAsset ? runtimeConnections[selectedAsset.id] : undefined}
        runtimeAssetError={embeddedRuntimeError}
        runtimeNodeVisibility={actions.nodeVisibility} runtimeTextOverrides={actions.textOverrides}
      /> : null}
      {!isCanvas && rendererNode && scene ? <section className="standalone-3d-preview-stage" data-canvas-fullscreen-root>
        <Model3DNode cameraControlsEnabled editable={false} interactive node={rendererNode}
          onModelInstanceSelect={(_nodeId, instanceId) => {
            setSelectedInstanceId(instanceId);
            const instance = scene.instances.find((candidate) => candidate.id === instanceId);
            if (!instance || instance.renderMode === "background") return;
            const steps: TwinAction[] = instance.clickActions
              ?? (instance.assetId && scene.linked2dProjectId
                ? [{ type: "select-asset", assetId: instance.assetId }] : []);
            if (steps.length) execute(steps, `模型 ${instance.label}`);
          }}
          onSceneNodeSelect={ignore} projectId={projectId} runtimeControlsEnabled={false}
          selectedModelInstanceId={selectedInstanceId} selectedSceneNodePath={null} />
        {canvas ? <CanvasSurface document={canvas} editable={false} presentation="overlay"
          selectedNodeId={null} selectedModelSceneNodePath={null}
          onCreateNode={ignore} onModelSceneNodeSelect={ignore} onNodeChange={ignore} onSelectNode={ignore}
          onNodeActions={(node: CanvasNode) => execute(node.interaction?.clickActions ?? [], `组件 ${node.id}`)}
          runtimeAsset={selectedAsset} runtimeAssetConnection={selectedAsset ? runtimeConnections[selectedAsset.id] : undefined}
          runtimeNodeVisibility={actions.nodeVisibility} runtimeTextOverrides={actions.textOverrides} /> : null}
      </section> : null}
      {selectedAsset && !canvas?.nodes.some((node) => node.type === "asset-detail") ? <AssetRuntimeDetailPanel
        asset={selectedAsset} connection={runtimeConnections[selectedAsset.id]}
        onClose={() => setSelectedAssetId(null)} /> : null}
      <TwinActionFeedback messages={actions.messages} error={actions.error}
        onDismissMessage={actions.dismissMessage} onDismissError={actions.dismissError} />
      {embeddedActionError ? <div className="runtime-selection-message" role="alert">{embeddedActionError}</div> : null}
    </main>
  </PublicationContext.Provider>;
}
