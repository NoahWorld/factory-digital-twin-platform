import { useEffect,useRef,useState } from "react";
import { request,errorMessage } from "./api";
import type { PackageInspection,PackageInstallResult } from "../../../shared/package-service";

export function PackageImportPanel({ targetProjectId,onClose,onInstalled }:{ targetProjectId?:string;onClose():void;onInstalled?():void }) {
  const [file,setFile] = useState<File|null>(null),[inspection,setInspection] = useState<PackageInspection|null>(null),[installation,setInstallation] = useState<PackageInstallResult|null>(null);
  const [name,setName] = useState(""),[busy,setBusy] = useState(false),[error,setError] = useState<string|null>(null),[target,setTarget] = useState<{ name:string;runtimeRevision:number }|null>(null),[supported,setSupported] = useState<boolean|null>(null);
  const [distribution,setDistribution] = useState(false);
  const inspectedFile = useRef<File|null>(null);
  const controller = useRef<AbortController|null>(null);
  useEffect(() => {
    const current = new AbortController();
    void Promise.all([request<{ supported:boolean;distribution?:boolean }>("/api/v1/project-packages/capabilities",{ signal:current.signal }),targetProjectId ? request<{ name:string;runtimeRevision:number }>(`/api/v1/projects/${encodeURIComponent(targetProjectId)}/package-target`,{ signal:current.signal }) : Promise.resolve(null)]).then(([capability,project]) => { if (!current.signal.aborted) { setSupported(capability.supported);setDistribution(capability.distribution ?? false);setTarget(project); } }).catch((reason) => { if (!current.signal.aborted) setError(errorMessage(reason)); });
    return () => { current.abort();controller.current?.abort(); };
  },[targetProjectId]);
  const inspect = async () => {
    if (!file || busy) return;
    setBusy(true);setError(null);const current = controller.current = new AbortController();
    try {
      if (inspection) await request(`/api/v1/project-packages/${inspection.id}`,{ method:"DELETE",signal:current.signal });
      setInspection(null);setInstallation(null);
      const result = await request<{ inspection:PackageInspection }>("/api/v1/project-packages",{ method:"POST",headers:{ "content-type":"application/zip" },body:file,signal:current.signal });
      if (!current.signal.aborted) { setInspection(result.inspection);inspectedFile.current = file;setName(result.inspection.projectName); }
    } catch (reason) { if (!current.signal.aborted) setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const install = async () => {
    if (!inspection || busy || file !== inspectedFile.current) return;
    setBusy(true);setError(null);const current = controller.current = new AbortController();
    try {
      const result = await request<{ installation:PackageInstallResult }>("/api/v1/project-packages/install",{ method:"POST",body:JSON.stringify({ inspectionId:inspection.id,...(targetProjectId ? { targetProjectId,expectedRuntimeRevision:target?.runtimeRevision } : { projectName:name }) }),signal:current.signal });
      if (!current.signal.aborted) { setInstallation(result.installation);onInstalled?.(); }
    } catch (reason) { if (!current.signal.aborted) setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const close = async () => {
    if (busy) { controller.current?.abort();return; }
    if (inspection) { try { await request(`/api/v1/project-packages/${inspection.id}`,{ method:"DELETE" }); } catch (reason) { setError(errorMessage(reason));return; } }
    onClose();
  };
  return <div className="data-source-panel-backdrop" role="dialog" aria-modal="true" aria-label="导入项目包"><section className="data-source-panel publication-panel">
    <header className="data-source-panel-header"><div><span>Project package</span><h2>{targetProjectId ? "安装项目新版本" : "导入项目包"}</h2></div><button className="data-source-panel-close" aria-label={busy ? "取消当前导入操作" : "关闭项目包导入"} onClick={() => void close()}>×</button></header>
    <div className="publication-content">
      <p>{targetProjectId ? `安装到「${target?.name ?? "正在加载"}」的版本列表；当前草稿和发布版本保持原状。` : "导入会创建项目和一个已冻结版本。检查资源与环境配置后，可以运行、激活或恢复为可编辑草稿。"}</p>
      {distribution ? <a className="secondary-button" href="/api/v1/runtime/distribution" download>下载独立运行程序</a> : null}
      {supported === false ? <p role="alert">当前宿主不支持包安装。请在独立运行服务中打开此入口。</p> : null}
      {error ? <p role="alert" className="data-source-form-error">{error}</p> : null}
      {!installation ? <section className="publication-draft"><label>项目包 ZIP<input aria-label="项目包 ZIP" type="file" accept=".zip,application/zip" disabled={busy || supported !== true} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><small>上限512MiB；服务器会检查文件内容、资源引用和模型报告。</small><button className="secondary-button" disabled={!file || busy || supported !== true} onClick={() => void inspect()}>{busy ? "正在处理…" : "上传并检查项目包"}</button></section> : null}
      {inspection && file === inspectedFile.current && !installation ? <section className="publication-draft"><h3>检查通过</h3><p>{inspection.projectName} · 来源版本 {inspection.sourceVersionNumber}</p><p>{inspection.pages} 页 · {inspection.assets} 台设备 · {inspection.models} 个模型 · {inspection.images} 张图片 · {inspection.alarms} 条告警规则</p>{!targetProjectId ? <label>新项目名称<input aria-label="新项目名称" disabled={busy} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label> : null}<p>需要在目标服务器配置的环境引用：</p>{inspection.requiredEndpoints.length ? <ul>{inspection.requiredEndpoints.map((endpoint) => <li key={endpoint.endpointRef}><code>{endpoint.endpointRef}</code></li>)}</ul> : <p>无外部数据源。</p>}<button className="primary-button" disabled={busy || (targetProjectId ? !target : name.trim().length < 2)} onClick={() => void install()}>{targetProjectId ? "安装为新版本" : "安装为新项目"}</button></section> : null}
      {installation ? <section className="publication-draft" role="status"><h3>安装完成，尚未激活</h3><p>版本 {installation.versionNumber}{installation.alreadyInstalled ? "（已安装过，未重复写入）" : ""}</p><p>目标项目 ID：<code>{installation.projectId}</code></p><p>私有环境应绑定这个项目ID及所需网络端点或只读查询。激活前会实际验证数据连接和资源。</p><a className="primary-button" href={`#/projects/${installation.projectId}/canvas`} onClick={onClose}>打开项目与版本</a><a className="secondary-button" href={`#/projects/${installation.projectId}/versions/${installation.versionId}/run`} onClick={onClose}>运行已安装版本</a></section> : null}
    </div>
  </section></div>;
}
