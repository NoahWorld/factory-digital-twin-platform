import { PackageImportPanel } from "./PackageImportPanel";
import { useEffect,useState } from "react";
import { request,errorMessage } from "./api";
import type { PublicationVersion,PublicationPointer } from "../../../shared/runtime-project";

type RestorePreview = { version:PublicationVersion;expectedRuntimeRevision:number;current:{ name:string;pages:number;nodes:number;assets:number;sources:number };incoming:{ name:string;pages:number;nodes:number;assets:number;sources:number } };
type DraftCheck = { runtimeRevision:number;canvasRevision:number;projectName:string;pages:number;scenes:number;assets:number;dataSources:number;models:number;images:number };
export function PublicationPanel({ projectId,editable,onClose }:{ projectId:string;editable:boolean;onClose():void }) {
  const [restorePreview,setRestorePreview] = useState<RestorePreview|null>(null);
  const [importing,setImporting] = useState(false);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  const [versions,setVersions] = useState<PublicationVersion[]>([]),[active,setActive] = useState<PublicationPointer>(null);
  const [draft,setDraft] = useState<DraftCheck|null>(null),[busy,setBusy] = useState(false),[loading,setLoading] = useState(true),[error,setError] = useState<string|null>(null),[notice,setNotice] = useState<string|null>(null),[label,setLabel] = useState("");
  const reload = async (signal?:AbortSignal) => { const result = await request<{ versions:PublicationVersion[];active:PublicationPointer }>(`${base}/versions`,{ signal }); if (!signal?.aborted) { setVersions(result.versions);setActive(result.active); } };
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal).catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); },[projectId]);
  const perform = async (operation:() => Promise<void>) => { setBusy(true);setError(null);setNotice(null); try { await operation(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  const check = () => perform(async () => { setDraft(null);setDraft((await request<{ draft:DraftCheck }>(`${base}/publication-draft`)).draft); });
  const create = () => perform(async () => {
    if (!draft) return;
    const { version } = await request<{ version:PublicationVersion }>(`${base}/versions`,{ method:"POST",body:JSON.stringify({ expectedRuntimeRevision:draft.runtimeRevision,label }) });
    setDraft(null);setLabel("");await reload();setNotice(`已冻结版本 ${version.versionNumber}，尚未激活。`);
  });
  const activate = (version:PublicationVersion) => perform(async () => {
    await request(`${base}/versions/${encodeURIComponent(version.id)}/activate`,{ method:"POST",body:JSON.stringify({ expectedPublicationRevision:active?.revision ?? 0 }) });
    await reload();setNotice(`版本 ${version.versionNumber} 已成为当前发布版本；已打开的固定版本页面继续使用其原版本。`);
  });
  const inspectRestore = (version:PublicationVersion) => perform(async () => { setRestorePreview(null); setRestorePreview((await request<{ preview:RestorePreview }>(`${base}/versions/${version.id}/restore-draft`)).preview); });
  const restore = () => perform(async () => {
    if (!restorePreview) return;
    await request(`${base}/versions/${restorePreview.version.id}/restore-draft`,{ method:"POST",body:JSON.stringify({ expectedRuntimeRevision:restorePreview.expectedRuntimeRevision }) });
    window.location.reload();
  });
  if (importing) return <PackageImportPanel targetProjectId={projectId} onClose={() => { setImporting(false); void reload().catch((reason) => setError(errorMessage(reason))); }} />;
  return <div className="data-source-panel-backdrop" role="dialog" aria-modal="true" aria-label="项目发布与版本">
    <section className="data-source-panel publication-panel">
      <header className="data-source-panel-header"><div><span>Project versions</span><h2>发布与版本</h2></div><button className="data-source-panel-close" aria-label="关闭发布与版本" disabled={busy} onClick={onClose}>×</button></header>
      <div className="publication-content">
        <p>版本会冻结已保存的页面、资产、指标映射和数据源。之后修改草稿不会改变该版本。</p>
        {error ? <p role="alert" className="data-source-form-error">{error}</p> : null}
        {notice ? <p role="status" className="data-source-form-notice">{notice}</p> : null}
        {restorePreview ? <section className="publication-draft" aria-label="草稿恢复预览"><h3>用版本 {restorePreview.version.versionNumber} 替换当前草稿</h3><p>这会替换已保存的页面、资产和数据映射。当前发布版本保持不变；恢复的持续数据源按其配置运行。</p>
          <table><thead><tr><th>内容</th><th>当前草稿</th><th>恢复后</th></tr></thead><tbody>{([['页面','pages'],['组件','nodes'],['设备','assets'],['数据源','sources']] as const).map(([label,key]) => <tr key={key}><td>{label}</td><td>{restorePreview.current[key]}</td><td>{restorePreview.incoming[key]}</td></tr>)}</tbody></table><p>项目名称：{restorePreview.current.name} → {restorePreview.incoming.name}</p><div className="publication-actions"><button className="primary-button" disabled={busy} onClick={restore}>确认替换草稿</button><button className="secondary-button" disabled={busy} onClick={() => setRestorePreview(null)}>取消恢复</button></div></section> : null}
        {editable ? <section className="publication-draft"><h3>创建版本</h3><button className="secondary-button" disabled={busy || loading} onClick={check}>检查已保存配置与资源</button>
          {draft ? <><p>{draft.pages} 页 · {draft.scenes} 个场景 · {draft.assets} 台设备 · {draft.models} 个模型 · {draft.images} 张图片</p><small>配置修订 {draft.runtimeRevision} · 画布版本 {draft.canvasRevision}</small><label>版本说明<input aria-label="版本说明" value={label} maxLength={200} disabled={busy} onChange={(event) => setLabel(event.target.value)} /></label><button className="primary-button" disabled={busy} onClick={create}>冻结为新版本</button></> : null}
        </section> : null}
        {active ? <a className="secondary-button" href={`#/projects/${encodeURIComponent(projectId)}/run`}>打开当前发布版本</a> : null}
        <p>项目包会将直接连接地址转为环境端点引用。数据源实际地址与认证值不写入包，导入后需配置这些端点。</p>
        {editable ? <button className="secondary-button" disabled={busy} onClick={() => setImporting(true)}>从项目包安装版本</button> : null}
        <section><h3>已冻结版本</h3>{loading ? <p>正在加载…</p> : !versions.length ? <p>还没有发布版本。</p> : null}
          {versions.map((version) => <article className="publication-version" key={version.id} data-version-id={version.id}>
            <div><strong>版本 {version.versionNumber}{active?.versionId === version.id ? " · 当前发布" : ""}</strong><p>{version.label || "无版本说明"}</p><small>{new Date(version.createdAt).toLocaleString("zh-CN")} · 配置修订 {version.sourceRevision}</small></div>
            <div className="publication-actions">{editable ? <><a className="secondary-button" href={`${base}/versions/${encodeURIComponent(version.id)}/package`} download>导出项目包</a><button className="secondary-button" disabled={busy} onClick={() => inspectRestore(version)}>恢复为草稿</button></> : null}<a className="secondary-button" href={`#/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(version.id)}/run`}>运行此版本</a>{editable ? <button className="primary-button" disabled={busy || active?.versionId === version.id} onClick={() => activate(version)}>{active && version.versionNumber < (versions.find((item) => item.id === active.versionId)?.versionNumber ?? 0) ? "回滚到此版本" : "激活此版本"}</button> : null}</div>
          </article>)}
        </section>
      </div>
    </section>
  </div>;
}
