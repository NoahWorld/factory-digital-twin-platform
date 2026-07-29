import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { errorMessage, request } from "../api";
import {
  formatFileSize,
  modelAssetsPath,
  type ModelAsset,
  type ModelAssetListResponse,
  type ModelAssetUploadResponse,
} from "./model-assets";
import {
  findModelSceneNode,
  type ModelSceneNode,
  type ModelSceneSnapshot,
} from "./model-scene";
import {
  componentLabels,
  parseModel3DProps,
  type CanvasNode,
  type Model3DProps,
} from "./types";

type Model3DInspectorProps = {
  editable: boolean;
  modelScene: ModelSceneSnapshot | null;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onSceneNodeSelect: (path: string | null) => void;
  onValidationChange: (message: string | null) => void;
  projectId: string;
  selectedSceneNodePath: string | null;
};

const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const MAX_VISIBLE_TREE_ROWS = 400;

type SceneTreeRow = {
  depth: number;
  node: ModelSceneNode;
};

const nodeLabel = (node: ModelSceneNode): string =>
  node.name || `未命名 ${node.objectType}`;

const filterTree = (
  nodes: ModelSceneNode[],
  normalizedQuery: string,
): ModelSceneNode[] =>
  nodes.flatMap((node) => {
    const children = filterTree(node.children, normalizedQuery);
    const matches = `${node.name} ${node.objectType}`.toLocaleLowerCase().includes(normalizedQuery);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });

const flattenTree = (
  nodes: ModelSceneNode[],
  expandedPaths: Set<string>,
  expandAll: boolean,
  depth = 0,
  rows: SceneTreeRow[] = [],
): SceneTreeRow[] => {
  for (const node of nodes) {
    if (rows.length >= MAX_VISIBLE_TREE_ROWS) break;
    rows.push({ depth, node });
    if (node.children.length > 0 && (expandAll || expandedPaths.has(node.path))) {
      flattenTree(node.children, expandedPaths, expandAll, depth + 1, rows);
    }
  }
  return rows;
};

export function Model3DInspector({
  editable,
  modelScene,
  node,
  onNodeChange,
  onSceneNodeSelect,
  onValidationChange,
  projectId,
  selectedSceneNodePath,
}: Model3DInspectorProps) {
  const parsed = parseModel3DProps(node.props);
  const [assets, setAssets] = useState<ModelAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [sceneSearch, setSceneSearch] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAssetId = node.resourceRefs[0] ?? "";
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );
  const activeScene = modelScene?.assetId === selectedAssetId ? modelScene : null;
  const normalizedSceneSearch = sceneSearch.trim().toLocaleLowerCase();
  const visibleSceneTree = useMemo(
    () => normalizedSceneSearch && activeScene
      ? filterTree(activeScene.roots, normalizedSceneSearch)
      : activeScene?.roots ?? [],
    [activeScene, normalizedSceneSearch],
  );
  const visibleSceneRows = useMemo(
    () => flattenTree(
      visibleSceneTree,
      expandedPaths,
      normalizedSceneSearch.length > 0,
    ),
    [expandedPaths, normalizedSceneSearch, visibleSceneTree],
  );
  const selectedSceneNode = useMemo(
    () => findModelSceneNode(activeScene?.roots ?? [], selectedSceneNodePath),
    [activeScene, selectedSceneNodePath],
  );

  useEffect(() => {
    onValidationChange(parsed.ok ? null : parsed.message);
    return () => onValidationChange(null);
  }, [onValidationChange, parsed.ok ? null : parsed.message]);

  useEffect(() => {
    let active = true;
    setLoadingAssets(true);
    setAssetError(null);
    void request<ModelAssetListResponse>(modelAssetsPath(projectId))
      .then((result) => {
        if (active) setAssets(result.modelAssets);
      })
      .catch((reason) => {
        if (active) setAssetError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoadingAssets(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    setSceneSearch("");
    setExpandedPaths(new Set(activeScene?.roots.map((root) => root.path) ?? []));
    onSceneNodeSelect(null);
  }, [activeScene?.assetId, onSceneNodeSelect]);

  useEffect(() => {
    if (selectedSceneNodePath !== null && activeScene && selectedSceneNode === null) {
      onSceneNodeSelect(null);
    }
  }, [activeScene, onSceneNodeSelect, selectedSceneNode, selectedSceneNodePath]);

  if (!parsed.ok) {
    return <section className="component-inspector"><div className="inspector-empty is-error"><strong>3D 组件配置无效</strong><p>{parsed.message}</p></div></section>;
  }

  const updateProps = (patch: Partial<Model3DProps>) => {
    onNodeChange({ ...node, props: { ...parsed.value, ...patch } });
  };

  const chooseAsset = (assetId: string) => {
    onSceneNodeSelect(null);
    onNodeChange({ ...node, resourceRefs: assetId ? [assetId] : [] });
  };

  const toggleSceneNode = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (extension !== "glb" && extension !== "gltf") {
      setAssetError("只支持 .glb 和 .gltf 模型文件。");
      return;
    }
    if (file.size === 0) {
      setAssetError("不能上传空模型文件。");
      return;
    }
    if (file.size > MAX_MODEL_BYTES) {
      setAssetError(`模型不能超过 ${formatFileSize(MAX_MODEL_BYTES)}。`);
      return;
    }

    setUploading(true);
    setAssetError(null);
    try {
      const result = await request<ModelAssetUploadResponse>(
        `${modelAssetsPath(projectId)}?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          body: file,
          headers: {
            "content-type": extension === "glb" ? "model/gltf-binary" : "model/gltf+json",
          },
        },
      );
      setAssets((current) => [
        result.modelAsset,
        ...current.filter((asset) => asset.id !== result.modelAsset.id),
      ]);
      chooseAsset(result.modelAsset.id);
    } catch (reason) {
      setAssetError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  return (
    <aside className="component-inspector">
      <div className="inspector-heading">
        <span className="eyebrow">3D component</span>
        <h2>{componentLabels[node.type]}</h2>
        <p>模型文件独立存储，画布节点只保存资源 ID。</p>
      </div>

      <div className="inspector-section">
        <label className="inspector-label" htmlFor={`model-asset-${node.id}`}>模型资源</label>
        <select
          disabled={!editable || uploading || loadingAssets}
          id={`model-asset-${node.id}`}
          onChange={(event) => chooseAsset(event.target.value)}
          value={selectedAssetId}
        >
          <option value="">{loadingAssets ? "正在读取模型…" : "请选择模型"}</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.originalFilename} · {formatFileSize(asset.byteSize)}
            </option>
          ))}
        </select>
        <input
          accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          className="model-file-input"
          disabled={!editable || uploading}
          onChange={(event) => void upload(event)}
          ref={fileInputRef}
          type="file"
        />
        <button
          className="secondary-button model-upload-button"
          disabled={!editable || uploading}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          {uploading ? "正在检查并上传…" : "导入 GLB / GLTF"}
        </button>
        <p className="inspector-help">最大 25 MB；GLTF 必须内嵌纹理与二进制资源。</p>
        {assetError ? <p className="inspector-inline-error" role="alert">模型资源错误：{assetError}</p> : null}
      </div>

      {selectedAsset ? (
        <div className="model-inspection-card">
          <strong>{selectedAsset.originalFilename}</strong>
          <span>{selectedAsset.format.toUpperCase()} 2.x · {formatFileSize(selectedAsset.byteSize)}</span>
          <dl>
            <div><dt>节点</dt><dd>{selectedAsset.inspection.nodeCount}</dd></div>
            <div><dt>网格</dt><dd>{selectedAsset.inspection.meshCount}</dd></div>
            <div><dt>材质</dt><dd>{selectedAsset.inspection.materialCount}</dd></div>
            <div><dt>动画</dt><dd>{selectedAsset.inspection.animationCount}</dd></div>
          </dl>
          {selectedAsset.inspection.duplicateNodeNames.length > 0 ? (
            <p className="model-inspection-warning">存在 {selectedAsset.inspection.duplicateNodeNames.length} 个重复节点名，发布前必须处理。</p>
          ) : <p className="model-inspection-ok">节点名称检查通过</p>}
        </div>
      ) : null}

      {selectedAsset ? (
        <section className="inspector-section model-scene-tree-section">
          <div className="inspector-section-title">
            <strong>模型节点树</strong>
            <span>
              {activeScene
                ? `${activeScene.namedNodeCount}/${activeScene.totalNodeCount} 已命名`
                : "正在解析场景…"}
            </span>
          </div>
          <label className="model-scene-search">
            <span className="sr-only">搜索模型节点</span>
            <input
              disabled={!activeScene}
              onChange={(event) => setSceneSearch(event.target.value)}
              placeholder="搜索节点名称或类型"
              type="search"
              value={sceneSearch}
            />
          </label>
          {activeScene ? (
            <>
              <div
                aria-label="模型节点树"
                className="model-scene-tree"
                role="tree"
              >
                {visibleSceneRows.map(({ depth, node: sceneNode }) => {
                  const expanded = expandedPaths.has(sceneNode.path);
                  const selected = selectedSceneNodePath === sceneNode.path;
                  return (
                    <div
                      aria-level={depth + 1}
                      aria-selected={selected}
                      className={`model-scene-tree-row${selected ? " is-selected" : ""}`}
                      key={sceneNode.path}
                      role="treeitem"
                      style={{ "--scene-depth": depth } as CSSProperties}
                    >
                      {sceneNode.children.length > 0 ? (
                        <button
                          aria-label={`${expanded ? "收起" : "展开"} ${nodeLabel(sceneNode)}`}
                          className="model-scene-tree-toggle"
                          onClick={() => toggleSceneNode(sceneNode.path)}
                          type="button"
                        >
                          {expanded || normalizedSceneSearch ? "⌄" : "›"}
                        </button>
                      ) : <span className="model-scene-tree-toggle is-placeholder" />}
                      <button
                        className="model-scene-tree-select"
                        onClick={() => onSceneNodeSelect(sceneNode.path)}
                        title={`${nodeLabel(sceneNode)} · ${sceneNode.objectType}`}
                        type="button"
                      >
                        <span className={`model-scene-node-icon${sceneNode.isMesh ? " is-mesh" : ""}`}>
                          {sceneNode.isMesh ? "◆" : "◇"}
                        </span>
                        <span>{nodeLabel(sceneNode)}</span>
                        <small>{sceneNode.objectType}</small>
                      </button>
                    </div>
                  );
                })}
              </div>
              {visibleSceneRows.length === 0 ? (
                <p className="model-scene-empty">没有匹配的模型节点。</p>
              ) : null}
              {visibleSceneRows.length >= MAX_VISIBLE_TREE_ROWS ? (
                <p className="model-inspection-warning">
                  当前最多展示 {MAX_VISIBLE_TREE_ROWS} 行，请通过搜索缩小范围。
                </p>
              ) : null}
              {selectedSceneNode ? (
                <div className="model-scene-selection">
                  <span>当前节点</span>
                  <strong>{nodeLabel(selectedSceneNode)}</strong>
                  <code>{selectedSceneNode.path}</code>
                </div>
              ) : (
                <p className="inspector-help">选择节点后，后续位置、材质和数据绑定都将作用于该节点。</p>
              )}
            </>
          ) : (
            <div className="model-scene-tree-loading">
              <span className="model-loading-spinner" />
              <span>等待模型渲染器返回实际场景层级…</span>
            </div>
          )}
        </section>
      ) : null}

      <div className="inspector-section inspector-grid-two">
        <label>
          <span>背景色</span>
          <input
            disabled={!editable}
            onChange={(event) => updateProps({ backgroundColor: event.target.value })}
            type="color"
            value={parsed.value.backgroundColor}
          />
        </label>
        <label>
          <span>旋转速度</span>
          <input
            disabled={!editable}
            max="5"
            min="0"
            onChange={(event) => updateProps({ rotationSpeed: Number(event.target.value) })}
            step="0.05"
            type="number"
            value={parsed.value.rotationSpeed}
          />
        </label>
      </div>

      <div className="inspector-section inspector-switches">
        <label>
          <input
            checked={parsed.value.autoRotate}
            disabled={!editable}
            onChange={(event) => updateProps({ autoRotate: event.target.checked })}
            type="checkbox"
          />
          <span>自动旋转</span>
        </label>
        <label>
          <input
            checked={parsed.value.showGrid}
            disabled={!editable}
            onChange={(event) => updateProps({ showGrid: event.target.checked })}
            type="checkbox"
          />
          <span>显示地面网格</span>
        </label>
      </div>
    </aside>
  );
}
