import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, request } from "./api";
import { AssetDataBindingSection } from "./canvas/AssetDataBindingSection";
import { projectAssetsPath, type ProjectAsset, type ProjectAssetListResponse, type ProjectAssetResponse } from "./canvas/assets";

export function AssetPanel({ projectId, editable, onClose }: { projectId: string; editable: boolean; onClose: () => void }) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState("");
  const [name, setName] = useState("");
  const [simulated, setSimulated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void request<ProjectAssetListResponse>(projectAssetsPath(projectId), { signal: controller.signal })
      .then((result) => { setAssets(result.assets); setSelectedId(result.assets[0]?.id ?? null); })
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId]);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const result = await request<ProjectAssetResponse>(projectAssetsPath(projectId), {
        method: "POST", body: JSON.stringify({ assetId, name, assetType: "equipment", modelNode: null, metadata: { simulated } }),
      });
      setAssets((current) => [...current, result.asset]); setSelectedId(result.asset.id);
      setAssetId(""); setName("");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };
  const selected = assets.find((asset) => asset.id === selectedId);
  return <div className="newpower-asset-backdrop"><section className="newpower-asset-panel" role="dialog" aria-modal="true" aria-label="资产与指标">
    <header><div><h2>资产与指标</h2><p>二维组件和三维模型共用设备台账；设备不需要先绑定模型。</p></div><button className="data-source-panel-close" aria-label="关闭资产与指标" onClick={onClose} type="button">×</button></header>
    {error ? <p className="binding-form-error" role="alert">{error}</p> : null}
    <div className="newpower-asset-columns"><aside>
      {loading ? <p>正在读取设备…</p> : <label><span>当前设备</span><select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value || null)}><option value="">选择设备</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.assetId}</option>)}</select></label>}
      {selected ? <p className="binding-help">{selected.assetId} · {selected.modelNode ? `模型：${selected.modelNode}` : "未绑定模型，可独立用于二维组件"}{selected.metadata.simulated === true ? " · 模拟设备" : ""}</p> : null}
      {editable ? <form onSubmit={(event) => void create(event)}><h3>新增设备</h3>
        <label><span>设备编号</span><input required maxLength={80} value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="例如 DEVICE-003" /></label>
        <label><span>设备名称</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="binding-checkbox"><input type="checkbox" checked={simulated} onChange={(event) => setSimulated(event.target.checked)} /><span>模拟设备（运行时显示标识）</span></label>
        <button className="secondary-button" type="submit" disabled={saving}>{saving ? "添加中…" : "添加设备"}</button>
      </form> : null}
    </aside><div className="newpower-asset-metrics">
      {selected ? <AssetDataBindingSection key={selected.id} asset={selected} editable={editable && !saving} projectId={projectId} /> : <p>选择或添加设备后配置指标；数据源可在画布工具栏“数据源”中管理。</p>}
    </div></div>
  </section></div>;
}
