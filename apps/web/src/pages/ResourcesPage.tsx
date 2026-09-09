import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { findBuiltinModel } from "../../../../shared/builtin-models";
import { ApiRequestError, errorMessage, request } from "../api";
import {
  formatFileSize,
  modelAssetContentUrl,
  modelAssetPath,
  modelAssetsPath,
  type ModelAsset,
  type ModelAssetDeletionResponse,
  type ModelAssetListResponse,
  type ModelAssetUploadResponse,
} from "../canvas/model-assets";
import {
  imageAssetContentUrl,
  imageAssetPath,
  imageAssetsPath,
  type ImageAsset,
  type ImageAssetDeletionResponse,
  type ImageAssetListResponse,
  type ImageAssetUploadResponse,
} from "../canvas/image-assets";
import {
  mediaAssetContentUrl,
  mediaAssetPath,
  mediaAssetsPath,
  type MediaAsset,
  type MediaAssetDeletionResponse,
  type MediaAssetListResponse,
  type MediaAssetUploadResponse,
} from "../canvas/media-assets";
import { Model3DNode } from "../canvas/Model3DNode";
import { createCanvasNode, type CanvasNode } from "../canvas/types";

export type ResourceProject = {
  id: string;
  name: string;
  projectRole: "owner" | "editor" | "viewer" | null;
};

type ResourcesPageProps = {
  isPlatformAdmin: boolean;
  loadingProjects: boolean;
  projectError: string | null;
  projects: ResourceProject[];
};

type ResourceKind = "model" | "image" | "video" | "audio";
type ResourceFilter = "all" | ResourceKind;
type ResourceItem =
  | { kind: "model"; asset: ModelAsset }
  | { kind: "image"; asset: ImageAsset }
  | { kind: "video" | "audio"; asset: MediaAsset };

const filterLabels: Array<{ id: ResourceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "model", label: "3D 模型" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
];

const kindLabels: Record<ResourceKind, string> = {
  model: "3D 模型",
  image: "图片",
  video: "视频",
  audio: "音频",
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    hour12: false,
  }).format(new Date(value));

const itemName = (item: ResourceItem): string =>
  item.kind === "model"
    ? findBuiltinModel(item.asset.id)?.name ?? item.asset.originalFilename
    : item.asset.originalFilename;

const itemDescription = (item: ResourceItem): string | null =>
  item.kind === "model" ? findBuiltinModel(item.asset.id)?.description ?? null : null;

const contentUrl = (projectId: string, item: ResourceItem): string => {
  if (item.kind === "model") return modelAssetContentUrl(projectId, item.asset.id);
  if (item.kind === "image") return imageAssetContentUrl(projectId, item.asset.id);
  return mediaAssetContentUrl(projectId, item.asset.id);
};

const deletePath = (projectId: string, item: ResourceItem): string => {
  if (item.kind === "model") return modelAssetPath(projectId, item.asset.id);
  if (item.kind === "image") return imageAssetPath(projectId, item.asset.id);
  return mediaAssetPath(projectId, item.asset.id);
};

const previewModelNode = (item: Extract<ResourceItem, { kind: "model" }>): CanvasNode => {
  const node = createCanvasNode("model-3d", 0, 0, 1);
  const builtin = findBuiltinModel(item.asset.id);
  return {
    ...node,
    height: 540,
    width: 960,
    props: builtin ? { ...node.props, ...builtin.defaults } : node.props,
    resourceRefs: [item.asset.id],
  };
};

function ResourceVisual({ item, projectId }: { item: ResourceItem; projectId: string }) {
  if (item.kind === "image") {
    return <img alt="" loading="lazy" src={contentUrl(projectId, item)} />;
  }
  if (item.kind === "video") {
    return <video aria-label={`${itemName(item)} 视频缩略预览`} muted preload="metadata" src={contentUrl(projectId, item)} />;
  }
  if (item.kind === "audio") {
    return (
      <span className="resource-audio-visual" aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i /><i /><i />
      </span>
    );
  }
  const builtin = findBuiltinModel(item.asset.id);
  return builtin ? (
    <img alt="" loading="lazy" src={builtin.thumbnailPath} />
  ) : (
    <span className="resource-model-visual" aria-hidden="true"><i>3D</i><b>MODEL</b></span>
  );
}

function ResourcePreviewDialog({
  item,
  onClose,
  projectId,
}: {
  item: ResourceItem;
  onClose: () => void;
  projectId: string;
}) {
  const modelNode = useMemo(
    () => item.kind === "model" ? previewModelNode(item) : null,
    [item],
  );
  const url = contentUrl(projectId, item);
  return (
    <div aria-modal="true" className="dialog-backdrop resource-preview-backdrop" role="dialog">
      <section className="resource-preview-dialog">
        <header>
          <div>
            <p className="eyebrow">Resource preview</p>
            <h2>{itemName(item)}</h2>
          </div>
          <button aria-label="关闭资源预览" className="dialog-close" onClick={onClose} type="button">×</button>
        </header>
        <div className={`resource-preview-stage is-${item.kind}`}>
          {item.kind === "model" && modelNode ? (
            <Model3DNode
              cameraControlsEnabled
              editable={false}
              interactive
              node={modelNode}
              onSceneNodeSelect={() => undefined}
              projectId={projectId}
              selectedSceneNodePath={null}
            />
          ) : item.kind === "image" ? (
            <img alt={itemName(item)} src={url} />
          ) : item.kind === "video" ? (
            <video autoPlay controls src={url}>当前浏览器无法播放该视频。</video>
          ) : (
            <div className="resource-audio-player">
              <span className="resource-audio-disc" aria-hidden="true">♪</span>
              <strong>{itemName(item)}</strong>
              <audio autoPlay controls src={url}>当前浏览器无法播放该音频。</audio>
            </div>
          )}
        </div>
        <footer>
          <span>{kindLabels[item.kind]} · {item.asset.format.toUpperCase()} · {formatFileSize(item.asset.byteSize)}</span>
          <button className="secondary-button" onClick={onClose} type="button">关闭</button>
        </footer>
      </section>
    </div>
  );
}

function ResourceDeleteDialog({
  item,
  onClose,
  onConfirm,
  submitting,
}: {
  item: ResourceItem;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const referenceCount = item.asset.usage.count;
  return (
    <div aria-modal="true" className="dialog-backdrop" role="dialog">
      <section className="dialog-card delete-project-dialog resource-delete-dialog">
        <button aria-label="关闭删除确认" className="dialog-close" disabled={submitting} onClick={onClose} type="button">×</button>
        <p className="eyebrow">Delete resource</p>
        <h2>删除“{itemName(item)}”？</h2>
        {referenceCount > 0 ? (
          <div className="resource-delete-warning" role="alert">
            <strong>该资源已被 {referenceCount} 个画布组件关联</strong>
            <p>删除可能导致相关项目内容无法展示，是否确认删除？画布中的资源引用会保留，方便后续定位失效组件。</p>
          </div>
        ) : (
          <p>资源文件及元数据将被永久删除，此操作不可撤销。</p>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" disabled={submitting} onClick={onClose} type="button">取消</button>
          <button className="danger-button" disabled={submitting} onClick={onConfirm} type="button">
            {submitting ? "正在删除…" : referenceCount > 0 ? "仍然删除" : "永久删除"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ResourcesPage({
  isPlatformAdmin,
  loadingProjects,
  projectError,
  projects,
}: ResourcesPageProps) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<ResourceItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<ResourceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<ResourceKind | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId("");
      return;
    }
    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setItems([]);
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    void Promise.all([
      request<ModelAssetListResponse>(modelAssetsPath(selectedProjectId)),
      request<ImageAssetListResponse>(imageAssetsPath(selectedProjectId)),
      request<MediaAssetListResponse>(mediaAssetsPath(selectedProjectId)),
    ]).then(([models, images, media]) => {
      if (!active) return;
      setItems([
        ...models.modelAssets.map((asset): ResourceItem => ({ kind: "model", asset })),
        ...images.imageAssets.map((asset): ResourceItem => ({ kind: "image", asset })),
        ...media.mediaAssets.map((asset): ResourceItem => ({ kind: asset.mediaType, asset })),
      ]);
    }).catch((reason) => {
      if (active) setLoadError(errorMessage(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reloadVersion, selectedProjectId]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const canEdit = Boolean(selectedProject) && (
    isPlatformAdmin
    || selectedProject?.projectRole === "owner"
    || selectedProject?.projectRole === "editor"
  );
  const filteredItems = filter === "all" ? items : items.filter((item) => item.kind === filter);

  const upload = async (kind: ResourceKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedProjectId || !canEdit) return;
    setUploadingKind(kind);
    setNotice(null);
    setLoadError(null);
    try {
      const path = `${kind === "model" ? modelAssetsPath(selectedProjectId)
        : kind === "image" ? imageAssetsPath(selectedProjectId)
          : mediaAssetsPath(selectedProjectId)}?filename=${encodeURIComponent(file.name)}`;
      const options: RequestInit = {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      };
      if (kind === "model") await request<ModelAssetUploadResponse>(path, options);
      else if (kind === "image") await request<ImageAssetUploadResponse>(path, options);
      else await request<MediaAssetUploadResponse>(path, options);
      setNotice(`${kindLabels[kind]}“${file.name}”已上传。`);
      setReloadVersion((value) => value + 1);
    } catch (reason) {
      setLoadError(errorMessage(reason));
    } finally {
      setUploadingKind(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteItem || !selectedProjectId) return;
    setDeleting(true);
    setLoadError(null);
    try {
      const confirmation = deleteItem.asset.usage.count > 0 ? "?confirmReferenced=true" : "";
      const path = `${deletePath(selectedProjectId, deleteItem)}${confirmation}`;
      let result: ModelAssetDeletionResponse | ImageAssetDeletionResponse | MediaAssetDeletionResponse;
      if (deleteItem.kind === "model") result = await request<ModelAssetDeletionResponse>(path, { method: "DELETE" });
      else if (deleteItem.kind === "image") result = await request<ImageAssetDeletionResponse>(path, { method: "DELETE" });
      else result = await request<MediaAssetDeletionResponse>(path, { method: "DELETE" });
      setNotice(result.warning
        ? `资源已删除，但对象存储清理需要处理：${result.warning}`
        : `资源“${itemName(deleteItem)}”已永久删除。`);
      setDeleteItem(null);
      setReloadVersion((value) => value + 1);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.code === "resource_in_use") {
        setDeleteItem(null);
        setNotice("资源引用状态刚刚发生变化，请查看最新引用数量后重新确认删除。");
        setReloadVersion((value) => value + 1);
      } else {
        setLoadError(errorMessage(reason));
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loadingProjects) {
    return <section className="workspace-content"><section className="state-card"><p className="eyebrow">Loading</p><h2>正在加载资源范围…</h2></section></section>;
  }

  return (
    <section className="workspace-content resource-library" id="resources">
      <div className="page-heading resource-page-heading">
        <div>
          <p className="eyebrow">Asset library</p>
          <h1>资源库</h1>
          <p>集中管理系统模型与项目上传的模型、图片、视频和音频。</p>
        </div>
        {projects.length > 0 ? (
          <label className="resource-project-select">
            <span>资源所属项目</span>
            <select value={selectedProjectId} onChange={(event) => {
              setSelectedProjectId(event.target.value);
              setPreviewItem(null);
              setDeleteItem(null);
              setNotice(null);
            }}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {projectError ? <section className="state-card error-state"><h2>项目范围加载失败</h2><p>{projectError}</p></section> : null}
      {!projectError && projects.length === 0 ? (
        <section className="empty-projects"><div className="empty-icon">◇</div><h2>还没有可用项目</h2><p>资源按项目隔离，请先创建或加入一个项目。</p></section>
      ) : null}

      {selectedProject ? (
        <>
          <div className="resource-toolbar">
            <div aria-label="资源类型筛选" className="resource-filters" role="group">
              {filterLabels.map((option) => (
                <button
                  aria-pressed={filter === option.id}
                  className={filter === option.id ? "is-active" : ""}
                  key={option.id}
                  onClick={() => setFilter(option.id)}
                  type="button"
                >
                  {option.label}
                  <span>{option.id === "all" ? items.length : items.filter((item) => item.kind === option.id).length}</span>
                </button>
              ))}
            </div>
            <div className="resource-upload-actions">
              {([
                ["model", "上传模型", ".glb,.gltf"],
                ["image", "上传图片", ".png,.jpg,.jpeg,.webp"],
                ["video", "上传视频", ".mp4,.webm"],
                ["audio", "上传音频", ".mp3,.wav,.ogg,.m4a,.aac"],
              ] as const).map(([kind, label, accept]) => (
                <label className={`secondary-button ${!canEdit || uploadingKind !== null ? "is-disabled" : ""}`} key={kind}>
                  <span>{uploadingKind === kind ? "上传中…" : label}</span>
                  <input
                    accept={accept}
                    disabled={!canEdit || uploadingKind !== null}
                    onChange={(event) => void upload(kind, event)}
                    type="file"
                  />
                </label>
              ))}
            </div>
          </div>

          {!canEdit ? <p className="resource-readonly-note">当前项目为只读权限，可以浏览和预览资源，但不能上传或删除。</p> : null}
          {notice ? <div className="project-notice" role="status"><span>{notice}</span><button aria-label="关闭资源提示" onClick={() => setNotice(null)} type="button">×</button></div> : null}
          {loadError ? <section className="state-card error-state"><h2>资源操作失败</h2><p>{loadError}</p></section> : null}
          {loading ? <section className="state-card"><p className="eyebrow">Loading</p><h2>正在加载资源…</h2></section> : null}

          {!loading && !loadError && filteredItems.length === 0 ? (
            <section className="resource-empty"><span aria-hidden="true">＋</span><h2>当前分类还没有资源</h2><p>{canEdit ? "可从右上角上传本地文件。" : "当前项目尚未提供此类资源。"}</p></section>
          ) : null}

          {!loading && filteredItems.length > 0 ? (
            <div aria-label="资源列表" className="resource-grid">
              {filteredItems.map((item) => {
                const systemResource = item.asset.source === "system";
                return (
                  <article className="resource-card" key={`${item.kind}:${item.asset.id}`}>
                    <button className="resource-card-preview" onClick={() => setPreviewItem(item)} type="button">
                      <ResourceVisual item={item} projectId={selectedProjectId} />
                      <span className="resource-preview-hint">点击预览</span>
                    </button>
                    <div className="resource-card-body">
                      <div className="resource-card-tags">
                        <span>{kindLabels[item.kind]}</span>
                        {systemResource ? <span className="is-system">系统内置</span> : <span>项目上传</span>}
                        {item.asset.usage.count > 0 ? <span className="is-used">已关联 {item.asset.usage.count}</span> : null}
                      </div>
                      <h2 title={itemName(item)}>{itemName(item)}</h2>
                      {itemDescription(item) ? <p>{itemDescription(item)}</p> : null}
                      <dl>
                        <div><dt>格式</dt><dd>{item.asset.format.toUpperCase()}</dd></div>
                        <div><dt>大小</dt><dd>{formatFileSize(item.asset.byteSize)}</dd></div>
                        <div><dt>添加日期</dt><dd>{formatDate(item.asset.createdAt)}</dd></div>
                      </dl>
                      <footer>
                        <button className="secondary-button" onClick={() => setPreviewItem(item)} type="button">预览</button>
                        <button
                          className="resource-delete-button"
                          disabled={systemResource || !canEdit}
                          onClick={() => setDeleteItem(item)}
                          title={systemResource ? "系统内置资源不可删除" : !canEdit ? "当前项目为只读权限" : "删除资源"}
                          type="button"
                        >
                          {systemResource ? "系统资源不可删除" : "删除"}
                        </button>
                      </footer>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}

      {previewItem && selectedProjectId ? <ResourcePreviewDialog item={previewItem} onClose={() => setPreviewItem(null)} projectId={selectedProjectId} /> : null}
      {deleteItem ? <ResourceDeleteDialog item={deleteItem} onClose={() => setDeleteItem(null)} onConfirm={() => void confirmDelete()} submitting={deleting} /> : null}
    </section>
  );
}
