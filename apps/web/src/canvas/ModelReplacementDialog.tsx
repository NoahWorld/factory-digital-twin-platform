import type { SceneViewportRuntime } from "./scene-viewport-runtime";
import type { SceneMotion } from "../../../../shared/scene-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request, errorMessage } from "../api";
import { useProjectEditorContext } from "../project-editor";
import { SceneViewport } from "./SceneViewport";
import { modelAssetsPath, type ModelAsset, type ModelAssetListResponse } from "./model-assets";
import { IDENTITY_TRANSFORM, type SceneDefinition } from "../../../../shared/scene-definition";
import { planModelReplacement, replaceInstanceResource, validateReplacementTargets, type ObjectReplacementMap } from "../../../../shared/model-replacement";

export type ReplacementApplication = { scene: SceneDefinition; instanceId: string; expectedAssetId: string; newAssetId: string; objectMap: ObjectReplacementMap; clipMap: ObjectReplacementMap; clipTimeScales: Record<string,number> };
type Props = { projectId: string; scene: SceneDefinition; instanceId: string; initialAssetId?: string;
  onApply: (replacement: ReplacementApplication) => boolean; onClose: () => void; onModelAdded?: (model: ModelAsset) => void };
const matchLabels = { identity: "稳定标识保留", source: "源标识对应", name: "按名称建议", unresolved: "需要选择" };
const emptySnapshot = () => {};
const bbox = (model: ModelAsset) => model.inspection.bounds ? `${model.inspection.bounds.min.map((value) => value.toFixed(2)).join(", ")} → ${model.inspection.bounds.max.map((value) => value.toFixed(2)).join(", ")}` : "无几何边界";

export function ModelReplacementDialog({ projectId, scene, instanceId, initialAssetId, onApply, onClose, onModelAdded }: Props) {
  const { saveError } = useProjectEditorContext();
  const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true); const instance = scene.instances.find((instance) => instance.id === instanceId)!;
  const [models, setModels] = useState<ModelAsset[]>([]); const [previous, setPrevious] = useState<ModelAsset | null>(null);
  const [candidateId, setCandidateId] = useState(initialAssetId ?? ""); const [candidate, setCandidate] = useState<ModelAsset | null>(null);
  const [optimizationSupported,setOptimizationSupported]=useState<boolean|null>(null);const [optimizationError,setOptimizationError]=useState<string|null>(null);const optimization=useRef<AbortController|null>(null);
  const [loading, setLoading] = useState(true); const [targetLoading, setTargetLoading] = useState(false); const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [choices, setChoices] = useState<Record<string,string>>({});
  const [clipChoices,setClipChoices] = useState<Record<string,string>>({});
  const [scaleClipTimes,setScaleClipTimes] = useState(true);
  const [activeReference, setActiveReference] = useState(""); const [referenceSearch, setReferenceSearch] = useState(""); const [candidateSearch, setCandidateSearch] = useState("");
  const [previewEngine,setPreviewEngine] = useState<SceneViewportRuntime | null>(null);
  const [previewAttempt,setPreviewAttempt] = useState(0);
  const [previewClipId,setPreviewClipId] = useState<string | null>(null);
  const [clipPreviewMessage,setClipPreviewMessage] = useState("");
  const clipPreviewCommand = useRef<AbortController | null>(null);
  const [previewMode, setPreviewMode] = useState<"old" | "new">("new");
  useEffect(() => { mounted.current = true; dialog.current?.showModal(); return () => { mounted.current = false;optimization.current?.abort(); dialog.current?.close(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void Promise.all([request<ModelAssetListResponse>(modelAssetsPath(projectId), { signal: controller.signal }), request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}/${encodeURIComponent(instance.modelAssetId)}/inspect`, { method: "POST", signal: controller.signal })])
      .then(([list, source]) => {
        if (controller.signal.aborted) return;
        setPrevious(source.modelAsset); setModels(list.modelAssets.map((asset) => asset.id === source.modelAsset.id ? source.modelAsset : asset));
        setCandidateId((id) => id || list.modelAssets.filter((asset) => asset.familyId === source.modelAsset.familyId && asset.id !== source.modelAsset.id).sort((a,b) => b.versionNumber - a.versionNumber)[0]?.id || "");
      }).catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, instance.modelAssetId]);
  useEffect(() => {
    setCandidate(null); setError(null); if (!candidateId) return;
    const known = models.find((asset) => asset.id === candidateId);
    if (known?.inspection.objectManifestVersion === 2 && known.inspection.animationManifestVersion === 1 && known.inspection.objects?.every((object) => typeof object.inDefaultScene === "boolean")) { setCandidate(known); setTargetLoading(false); return; }
    const controller = new AbortController(); setTargetLoading(true);
    void request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}/${encodeURIComponent(candidateId)}/inspect`, { method: "POST", signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setCandidate(result.modelAsset); setModels((models) => models.map((model) => model.id === result.modelAsset.id ? result.modelAsset : model)); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setTargetLoading(false); });
    return () => controller.abort();
  }, [candidateId, models, projectId]);
  useEffect(()=>{const controller=new AbortController();setOptimizationSupported(null);setOptimizationError(null);void request<{supported:boolean}>(`${modelAssetsPath(projectId)}/${instance.modelAssetId}/optimize`,{signal:controller.signal}).then((result)=>{if(!controller.signal.aborted)setOptimizationSupported(result.supported);}).catch((reason)=>{if(!controller.signal.aborted)setOptimizationError(errorMessage(reason));});return()=>controller.abort();},[projectId,instance.modelAssetId]);
  const optimize=async()=>{
    if(uploading || !previous)return;const controller=new AbortController();optimization.current=controller;setUploading(true);setError(null);
    try{const result=await request<{modelAsset:ModelAsset}>(`${modelAssetsPath(projectId)}/${previous.id}/optimize`,{method:"POST",body:"{}",signal:controller.signal});if(mounted.current && !controller.signal.aborted){setModels((items)=>[result.modelAsset,...items]);setCandidateId(result.modelAsset.id);onModelAdded?.(result.modelAsset);}}
    catch(reason){if(mounted.current && !controller.signal.aborted)setError(errorMessage(reason));}
    finally{if(mounted.current)setUploading(false);if(optimization.current===controller)optimization.current=null;}
  };
  const planResult = useMemo(() => {
    try { return { plan: previous && candidate ? planModelReplacement(scene, instanceId, previous, candidate) : null, error: null }; }
    catch (reason) { return { plan: null, error: errorMessage(reason) }; }
  }, [scene, instanceId, previous, candidate]);
  const plan = planResult.plan;
  useEffect(() => {
    setPreviewClipId(null);
    if (!plan) { setClipChoices({}); setChoices({}); setActiveReference(""); return; }
    setClipChoices(Object.fromEntries(plan.clipReferences.map((ref) => [ref.clipId,ref.suggestedId ?? ""])));
    setChoices(Object.fromEntries(plan.references.map((ref) => [ref.objectId, ref.suggestedId ?? ""])));
    setActiveReference(plan.references.find((ref) => !ref.suggestedId)?.objectId ?? plan.references[0]?.objectId ?? "");
  }, [plan]);
  const map = useMemo(() => Object.fromEntries(Object.entries(choices).map(([id, choice]) => [id, choice === "__remove__" ? null : choice])), [choices]);
  const clipMap = useMemo(() => Object.fromEntries(Object.entries(clipChoices).map(([id,choice]) => [id,choice === "__remove__" ? null : choice])),[clipChoices]);
  const clipTimeScales = useMemo(() => Object.fromEntries((plan?.clipReferences ?? []).flatMap((ref) => { const next = plan?.clipCandidates.find((clip) => clip.clipId === clipMap[ref.clipId]); return scaleClipTimes && next && ref.duration > 0 ? [[ref.clipId,next.duration / ref.duration]] : []; })),[plan,clipMap,scaleClipTimes]);
  const unresolvedClips = plan?.clipReferences.filter((ref) => !clipChoices[ref.clipId]).length ?? 0;
  const unresolved = plan?.references.filter((ref) => !choices[ref.objectId]).length ?? 0;
  const validation = useMemo(() => {
    if (!plan || unresolved || unresolvedClips) return null;
    try { validateReplacementTargets(plan, map,clipMap,clipTimeScales); replaceInstanceResource(scene, instanceId, plan.oldAssetId, plan.newAssetId, map,clipMap,clipTimeScales); return null; }
    catch (reason) { return errorMessage(reason); }
  }, [plan, unresolved, unresolvedClips, map, clipMap, clipTimeScales, scene, instanceId]);
  const previewAsset = previewMode === "old" ? previous : candidate;
  const previewMotion = useMemo<SceneMotion | null>(() => {
    const clip = previewAsset?.inspection.clips?.find((clip) => clip.clipId === previewClipId);
    if (!clip) return null;
    const durationMs = Math.max(1,Math.min(60000,Math.round((clip.duration-clip.startTime)*1000)));
    return { id: "clip-preview",name: "片段预览",version: 1,durationMs,repeat: 1,fill: "restore",tracks: [{ id: "source-clip",type: "clip",target: { instanceId: "preview-instance",objectId: null },property: "clip",clipId: clip.clipId,easing: "linear",keyframes: [{ timeMs: 0,value: clip.startTime },{ timeMs: durationMs,value: clip.duration }] }] };
  },[previewAsset,previewClipId]);
  const preview = useMemo<SceneDefinition | null>(() => previewAsset ? { motions: previewMotion ? [previewMotion] : [], id: `replacement-${previewMode}-${previewAsset.id}`, name: previewAsset.originalFilename, settings: { ...scene.settings, autoRotate: false }, assetBindings: [], instances: [previewMode === "old" ? { ...instance, id: "preview-instance", visible: true } : { id: "preview-instance", name: "新模型", modelAssetId: previewAsset.id, transform: IDENTITY_TRANSFORM, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} }] } : null, [previewAsset, previewMotion, scene.settings, instance, previewMode]);
  useEffect(() => {
    if (!previewMotion || !previewEngine) return;
    const controller = new AbortController(); clipPreviewCommand.current = controller; setClipPreviewMessage("片段预览播放中…");
    void previewEngine.playMotion(previewMotion.id,controller.signal).then(() => { if (mounted.current && !controller.signal.aborted) setClipPreviewMessage("片段预览完成。"); }).catch((reason) => { if (mounted.current && !controller.signal.aborted) setClipPreviewMessage(`片段预览失败：${errorMessage(reason)}`); });
    return () => controller.abort();
  },[previewMotion,previewEngine,previewAttempt]);
  const selectedId = activeReference ? choices[activeReference] : "";
  const selectedTarget = useMemo(() => previewMode === "old" && activeReference ? { instanceId: "preview-instance", objectId: activeReference } : selectedId && selectedId !== "__remove__" ? { instanceId: "preview-instance", objectId: selectedId } : null, [selectedId, previewMode, activeReference]);
  const pick = useCallback((target: { objectId: string | null } | null) => {
    if (!target?.objectId) return;
    if (previewMode === "old") { if (plan?.references.some((reference) => reference.objectId === target.objectId)) setActiveReference(target.objectId); }
    else if (activeReference) { setChoices((current) => ({ ...current, [activeReference]: target.objectId! })); setCandidateSearch(""); }
  }, [activeReference, previewMode, plan]);
  const filteredRefs = plan?.references.filter((ref) => ref.name.toLowerCase().includes(referenceSearch.toLowerCase())) ?? [];
  const filteredCandidates = plan?.candidates.filter((object) => object.name.toLowerCase().includes(candidateSearch.toLowerCase())).slice(0,200) ?? [];
  const selectedObject = plan?.candidates.find((object) => object.objectId === selectedId);
  const options = selectedObject && !filteredCandidates.some((object) => object.objectId === selectedId) ? [selectedObject, ...filteredCandidates] : filteredCandidates;
  const active = plan?.references.find((ref) => ref.objectId === activeReference);
  const busy = loading || targetLoading || uploading;
  return <dialog className="model-replacement-dialog" ref={dialog} aria-label="模型版本与映射修复" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><div><span className="eyebrow">Model versions</span><h2>模型版本与映射修复</h2></div><button type="button" onClick={onClose}>关闭</button></header>
    <div className="model-replacement-body">
      <section className="model-version-controls">
        <p>当前实例：<strong>{instance.name}</strong> · {previous?.originalFilename ?? "正在读取…"} · v{previous?.versionNumber ?? "—"}</p>
        <label>候选模型<select aria-label="替换模型版本" value={candidateId} disabled={busy} onChange={(event) => setCandidateId(event.target.value)}><option value="">选择版本或项目内其他模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.originalFilename} · v{model.versionNumber}{model.id === instance.modelAssetId ? "（当前）" : ""}</option>)}</select></label>
        {optimizationSupported ? <button type="button" disabled={busy || !!previous?.inspection.compression} onClick={()=>void optimize()}>生成Meshopt压缩版本</button>:<p className="inspector-help">{optimizationError ? `压缩能力检查失败：${optimizationError}`:optimizationSupported===null ? "正在检查压缩能力…":"此宿主未提供模型压缩能力，可在独立运行器中生成。"}</p>}
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>{uploading ? "正在检查新版本…" : "上传后续模型版本"}</button>
        <input type="file" hidden ref={input} accept=".gltf,.glb" onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setUploading(true); setError(null);
          try {
            const { modelAsset } = await request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}/${encodeURIComponent(instance.modelAssetId)}/versions?filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { "content-type": file.name.toLowerCase().endsWith(".glb") ? "model/gltf-binary" : "model/gltf+json" } });
            if (mounted.current) { setModels((models) => [modelAsset, ...models]); setCandidateId(modelAsset.id); onModelAdded?.(modelAsset); }
          } catch (reason) { if (mounted.current) setError(errorMessage(reason)); } finally { if (mounted.current) setUploading(false); }
        }} />
        {previous && candidate ? <div className="model-version-diff"><p>三角面：{previous.inspection.sceneTriangleCount ?? "待检查"} → {candidate.inspection.sceneTriangleCount ?? "待检查"} · 对象：{previous.inspection.objects?.length ?? 0} → {candidate.inspection.objects?.length ?? 0}</p><p>旧范围（米）：{bbox(previous)}</p><p>新范围（米）：{bbox(candidate)}</p><p>新纹理：{candidate.inspection.textures?.length ? candidate.inspection.textures.map((texture) => `${texture.width} × ${texture.height}`).join("，") : "无"}</p></div> : null}
        {error || saveError || validation || planResult.error ? <p className="inspector-inline-error" role="alert">{error ?? validation ?? planResult.error ?? saveError}</p> : null}
      </section>
      {plan?.clipReferences.length ? <section className="model-clip-repairs"><h3>受影响原生动画 · {plan.clipReferences.length}</h3><label><input type="checkbox" checked={scaleClipTimes} onChange={(event) => setScaleClipTimes(event.target.checked)} />按新片段总时长同比调整采样时间</label>{plan.clipReferences.map((ref) => <label key={ref.clipId}><span>{ref.name} · {ref.duration.toFixed(2)} 秒 · {ref.tracks} 条轨道</span><select aria-label={`片段映射 ${ref.name}`} value={clipChoices[ref.clipId] ?? ""} onChange={(event) => setClipChoices((current) => ({ ...current,[ref.clipId]: event.target.value }))}><option value="">选择新动画片段</option><option value="__remove__">移除相关原生动画轨道</option>{plan.clipCandidates.map((clip) => <option key={clip.clipId} value={clip.clipId}>{clip.name || "未命名片段"} · 片段 {clip.animationIndex+1} · {clip.duration.toFixed(2)} 秒</option>)}</select><button type="button" onClick={() => { setPreviewMode("old"); setPreviewClipId(ref.clipId); setPreviewAttempt((value) => value+1); }}>预览旧片段</button><button type="button" disabled={!clipMap[ref.clipId]} onClick={() => { setPreviewMode("new"); setPreviewClipId(clipMap[ref.clipId]); setPreviewAttempt((value) => value+1); }}>预览新片段</button></label>)}<p>映射保留轨道与交互引用；移除最后轨道时，仍被引用的动画须先修复关联动作。</p></section> : null}
      {candidate?.inspection.optimization ? <p className="model-optimization-report" role="status">压缩版本：{candidate.inspection.optimization.sourceBytes.toLocaleString()} → {candidate.byteSize.toLocaleString()} 字节（{candidate.byteSize <= candidate.inspection.optimization.sourceBytes ? "减少":"增加"}{(Math.abs(1-candidate.byteSize/candidate.inspection.optimization.sourceBytes)*100).toFixed(1)}%）；逐字节验证属性与索引保留。原版本保留，应用替换后可撤销。</p>:null}
      {plan ? <div className="model-replacement-grid">
        <section className="model-reference-list"><h3>受影响对象 · {plan.references.length}</h3><input aria-label="搜索受影响对象" placeholder="搜索旧对象名称" value={referenceSearch} onChange={(event) => setReferenceSearch(event.target.value)} />
          {filteredRefs.slice(0,200).map((ref) => <button key={ref.objectId} type="button" className={`${activeReference === ref.objectId ? "is-selected" : ""} ${!choices[ref.objectId] ? "is-unresolved" : ""}`} onClick={() => setActiveReference(ref.objectId)}><strong>{ref.name}</strong><span>资产绑定 {ref.bindings}{ref.transform ? " · 变换" : ""}{ref.appearance ? " · 外观" : ""}{ref.motionTracks ? ` · 动画轨道 ${ref.motionTracks}` : ""}</span><small>{choices[ref.objectId] === "__remove__" ? "明确移除" : !choices[ref.objectId] ? "需要选择" : choices[ref.objectId] !== ref.suggestedId ? "手动对应" : matchLabels[ref.match]}</small></button>)}
          {!plan.references.length ? <p>当前实例没有需要迁移的对象绑定或覆盖。</p> : null}
          {filteredRefs.length > 200 ? <p>显示前 200 项，请搜索其余对象。</p> : null}
        </section>
        <section className="model-candidate-preview">
          <div className="scene-editor-actions"><button type="button" aria-pressed={previewMode === "old"} onClick={() => { setPreviewClipId(null); setPreviewMode("old"); }}>查看旧配置</button><button type="button" aria-pressed={previewMode === "new"} onClick={() => { setPreviewClipId(null); setPreviewMode("new"); }}>查看新文件</button></div>
          <div className="replacement-viewport">{preview ? <SceneViewport projectId={projectId} scene={preview} cameraControlsEnabled interactive onReady={setPreviewEngine} onSnapshot={emptySnapshot} selectedTarget={selectedTarget} onPick={pick} hint={previewMode === "old" ? "点击旧对象选择需要修复的引用" : "先选旧对象，再点击新模型对应对象"} /> : null}</div>
          {previewClipId ? <div className="scene-editor-actions"><p role="status">{clipPreviewMessage}</p><button type="button" onClick={() => { clipPreviewCommand.current?.abort(); previewEngine?.stopMotion(); setPreviewClipId(null); }}>停止片段预览</button></div> : null}
          {active ? <div className="model-object-mapping"><strong>「{active.name}」对应到</strong><input aria-label="搜索候选对象" placeholder="搜索新对象名称" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} /><select aria-label="新对象映射" value={selectedId ?? ""} onChange={(event) => setChoices((current) => ({ ...current, [active.objectId]: event.target.value }))}><option value="">请选择对应对象</option><option value="__remove__">移除此实例的相关绑定与覆盖</option>{options.map((object) => <option key={object.objectId} value={object.objectId}>{object.name || "未命名对象"} · 节点 {object.nodeIndex}{object.primitiveIndex !== undefined ? ` / 子网格 ${object.primitiveIndex}` : object.attachment ? ` / ${object.attachment}` : ""}</option>)}</select><p>选择移除会清除此实例对应的绑定和覆盖，资产台账保留。</p></div> : null}
        </section>
      </div> : <p className="inspector-help">选择候选模型后，可查看新模型和需要修复的引用。</p>}
    </div>
    <footer><span>{(unresolved || unresolvedClips) ? `${[unresolved ? `${unresolved} 个对象` : "",unresolvedClips ? `${unresolvedClips} 个片段` : ""].filter(Boolean).join("、")}仍需选择` : plan ? "映射已完整，可应用后撤销" : "原模型版本保留"}</span><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={busy || !plan || unresolved > 0 || unresolvedClips > 0 || !!validation} onClick={() => {
      if (!plan) return;
      try { validateReplacementTargets(plan, map,clipMap,clipTimeScales); const replaced = replaceInstanceResource(scene, instanceId, plan.oldAssetId, plan.newAssetId, map,clipMap,clipTimeScales);
        if (onApply({ scene: replaced, instanceId, expectedAssetId: plan.oldAssetId, newAssetId: plan.newAssetId, objectMap: map,clipMap,clipTimeScales })) onClose();
      } catch (reason) { setError(errorMessage(reason)); }
    }}>应用替换与修复</button></footer>
  </dialog>;
}
