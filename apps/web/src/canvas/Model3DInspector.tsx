import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { errorMessage, request } from "../api";
import {
  formatFileSize,
  modelAssetsPath,
  type ModelAsset,
  type ModelAssetListResponse,
  type ModelAssetUploadResponse,
} from "./model-assets";
import {
  componentLabels,
  parseModel3DProps,
  type CanvasNode,
  type Model3DProps,
} from "./types";

type Model3DInspectorProps = {
  editable: boolean;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onValidationChange: (message: string | null) => void;
  projectId: string;
};

const MAX_MODEL_BYTES = 25 * 1024 * 1024;

export function Model3DInspector({
  editable,
  node,
  onNodeChange,
  onValidationChange,
  projectId,
}: Model3DInspectorProps) {
  const parsed = parseModel3DProps(node.props);
  const [assets, setAssets] = useState<ModelAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAssetId = node.resourceRefs[0] ?? "";
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
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

  if (!parsed.ok) {
    return <section className="component-inspector"><div className="inspector-empty is-error"><strong>3D 组件配置无效</strong><p>{parsed.message}</p></div></section>;
  }

  const updateProps = (patch: Partial<Model3DProps>) => {
    onNodeChange({ ...node, props: { ...parsed.value, ...patch } });
  };

  const chooseAsset = (assetId: string) => {
    onNodeChange({ ...node, resourceRefs: assetId ? [assetId] : [] });
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
