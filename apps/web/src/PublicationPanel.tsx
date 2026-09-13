import { useEffect,useState } from "react";
import { request,errorMessage } from "./api";
import type { PublicationVersion,PublicationPointer } from "../../../shared/runtime-project";

type DraftCheck = { runtimeRevision:number;canvasRevision:number;projectName:string;pages:number;scenes:number;assets:number;dataSources:number;models:number;images:number };
export function PublicationPanel({ projectId,editable,onClose }:{ projectId:string;editable:boolean;onClose():void }) {
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
  return <div className="data-source-panel-backdrop" role="dialog" aria-modal="true" aria-label="项目发布与版本">
    <section className="data-source-panel publication-panel">
      <header className="data-source-panel-header"><div><span>Project versions</span><h2>发布与版本</h2></div><button className="data-source-panel-close" aria-label="关闭发布与版本" disabled={busy} onClick={onClose}>×</button></header>
      <div className="publication-content">
        <p>版本会冻结已保存的页面、资产、指标映射和数据源。之后修改草稿不会改变该版本。</p>
        {error ? <p role="alert" className="data-source-form-error">{error}</p> : null}
        {notice ? <p role="status" className="data-source-form-notice">{notice}</p> : null}
        {editable ? <section className="publication-draft"><h3>创建版本</h3><button className="secondary-button" disabled={busy || loading} onClick={check}>检查已保存配置与资源</button>
          {draft ? <><p>{draft.pages} 页 · {draft.scenes} 个场景 · {draft.assets} 台设备 · {draft.models} 个模型 · {draft.images} 张图片</p><small>配置修订 {draft.runtimeRevision} · 画布版本 {draft.canvasRevision}</small><label>版本说明<input aria-label="版本说明" value={label} maxLength={200} disabled={busy} onChange={(event) => setLabel(event.target.value)} /></label><button className="primary-button" disabled={busy} onClick={create}>冻结为新版本</button></> : null}
        </section> : null}
        {active ? <a className="secondary-button" href={`#/projects/${encodeURIComponent(projectId)}/run`}>打开当前发布版本</a> : null}
        <section><h3>已冻结版本</h3>{loading ? <p>正在加载…</p> : !versions.length ? <p>还没有发布版本。</p> : null}
          {versions.map((version) => <article className="publication-version" key={version.id} data-version-id={version.id}>
            <div><strong>版本 {version.versionNumber}{active?.versionId === version.id ? " · 当前发布" : ""}</strong><p>{version.label || "无版本说明"}</p><small>{new Date(version.createdAt).toLocaleString("zh-CN")} · 配置修订 {version.sourceRevision}</small></div>
            <div className="publication-actions"><a className="secondary-button" href={`#/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(version.id)}/run`}>运行此版本</a>{editable ? <button className="primary-button" disabled={busy || active?.versionId === version.id} onClick={() => activate(version)}>{active && version.versionNumber < (versions.find((item) => item.id === active.versionId)?.versionNumber ?? 0) ? "回滚到此版本" : "激活此版本"}</button> : null}</div>
          </article>)}
        </section>
      </div>
    </section>
  </div>;
}
