import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request, errorMessage } from "../api";
import { useProjectEditorContext } from "../project-editor";
import { SceneViewport } from "./SceneViewport";
import { modelAssetsPath, type ModelAsset, type ModelAssetListResponse } from "./model-assets";
import { IDENTITY_TRANSFORM, type SceneDefinition } from "../../../../shared/scene-definition";
import { planModelReplacement, replaceInstanceResource, validateReplacementTargets, type ObjectReplacementMap } from "../../../../shared/model-replacement";

export type ReplacementApplication = { scene: SceneDefinition; instanceId: string; expectedAssetId: string; newAssetId: string; objectMap: ObjectReplacementMap };
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
  const [loading, setLoading] = useState(true); const [targetLoading, setTargetLoading] = useState(false); const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [choices, setChoices] = useState<Record<string,string>>({});
  const [activeReference, setActiveReference] = useState(""); const [referenceSearch, setReferenceSearch] = useState(""); const [candidateSearch, setCandidateSearch] = useState("");
  const [previewMode, setPreviewMode] = useState<"old" | "new">("new");
  useEffect(() => { mounted.current = true; dialog.current?.showModal(); return () => { mounted.current = false; dialog.current?.close(); }; }, []);
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
    if (known?.inspection.objectManifestVersion === 2 && known.inspection.objects?.every((object) => typeof object.inDefaultScene === "boolean")) { setCandidate(known); setTargetLoading(false); return; }
    const controller = new AbortController(); setTargetLoading(true);
    void request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}/${encodeURIComponent(candidateId)}/inspect`, { method: "POST", signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setCandidate(result.modelAsset); setModels((models) => models.map((model) => model.id === result.modelAsset.id ? result.modelAsset : model)); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setTargetLoading(false); });
    return () => controller.abort();
  }, [candidateId, models, projectId]);
  const planResult = useMemo(() => {
    try { return { plan: previous && candidate ? planModelReplacement(scene, instanceId, previous, candidate) : null, error: null }; }
    catch (reason) { return { plan: null, error: errorMessage(reason) }; }
  }, [scene, instanceId, previous, candidate]);
  const plan = planResult.plan;
  useEffect(() => {
    if (!plan) { setChoices({}); setActiveReference(""); return; }
    setChoices(Object.fromEntries(plan.references.map((ref) => [ref.objectId, ref.suggestedId ?? ""])));
    setActiveReference(plan.references.find((ref) => !ref.suggestedId)?.objectId ?? plan.references[0]?.objectId ?? "");
  }, [plan]);
  const map = useMemo(() => Object.fromEntries(Object.entries(choices).map(([id, choice]) => [id, choice === "__remove__" ? null : choice])), [choices]);
  const unresolved = plan?.references.filter((ref) => !choices[ref.objectId]).length ?? 0;
  const validation = useMemo(() => {
    if (!plan || unresolved) return null;
    try { validateReplacementTargets(plan, map); replaceInstanceResource(scene, instanceId, plan.oldAssetId, plan.newAssetId, map); return null; }
    catch (reason) { return errorMessage(reason); }
  }, [plan, unresolved, map, scene, instanceId]);
  const previewAsset = previewMode === "old" ? previous : candidate;
  const preview = useMemo<SceneDefinition | null>(() => previewAsset ? { id: `replacement-${previewMode}-${previewAsset.id}`, name: previewAsset.originalFilename, settings: { ...scene.settings, autoRotate: false }, assetBindings: [], instances: [previewMode === "old" ? { ...instance, id: "preview-instance", visible: true } : { id: "preview-instance", name: "新模型", modelAssetId: previewAsset.id, transform: IDENTITY_TRANSFORM, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} }] } : null, [previewAsset, scene.settings, instance, previewMode]);
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
      {plan ? <div className="model-replacement-grid">
        <section className="model-reference-list"><h3>受影响对象 · {plan.references.length}</h3><input aria-label="搜索受影响对象" placeholder="搜索旧对象名称" value={referenceSearch} onChange={(event) => setReferenceSearch(event.target.value)} />
          {filteredRefs.slice(0,200).map((ref) => <button key={ref.objectId} type="button" className={`${activeReference === ref.objectId ? "is-selected" : ""} ${!choices[ref.objectId] ? "is-unresolved" : ""}`} onClick={() => setActiveReference(ref.objectId)}><strong>{ref.name}</strong><span>资产绑定 {ref.bindings}{ref.transform ? " · 变换" : ""}{ref.appearance ? " · 外观" : ""}{ref.motionTracks ? ` · 动画轨道 ${ref.motionTracks}` : ""}</span><small>{choices[ref.objectId] === "__remove__" ? "明确移除" : !choices[ref.objectId] ? "需要选择" : choices[ref.objectId] !== ref.suggestedId ? "手动对应" : matchLabels[ref.match]}</small></button>)}
          {!plan.references.length ? <p>当前实例没有需要迁移的对象绑定或覆盖。</p> : null}
          {filteredRefs.length > 200 ? <p>显示前 200 项，请搜索其余对象。</p> : null}
        </section>
        <section className="model-candidate-preview">
          <div className="scene-editor-actions"><button type="button" aria-pressed={previewMode === "old"} onClick={() => setPreviewMode("old")}>查看旧配置</button><button type="button" aria-pressed={previewMode === "new"} onClick={() => setPreviewMode("new")}>查看新文件</button></div>
          <div className="replacement-viewport">{preview ? <SceneViewport projectId={projectId} scene={preview} cameraControlsEnabled interactive onSnapshot={emptySnapshot} selectedTarget={selectedTarget} onPick={pick} hint={previewMode === "old" ? "点击旧对象选择需要修复的引用" : "先选旧对象，再点击新模型对应对象"} /> : null}</div>
          {active ? <div className="model-object-mapping"><strong>「{active.name}」对应到</strong><input aria-label="搜索候选对象" placeholder="搜索新对象名称" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} /><select aria-label="新对象映射" value={selectedId ?? ""} onChange={(event) => setChoices((current) => ({ ...current, [active.objectId]: event.target.value }))}><option value="">请选择对应对象</option><option value="__remove__">移除此实例的相关绑定与覆盖</option>{options.map((object) => <option key={object.objectId} value={object.objectId}>{object.name || "未命名对象"} · 节点 {object.nodeIndex}{object.primitiveIndex !== undefined ? ` / 子网格 ${object.primitiveIndex}` : object.attachment ? ` / ${object.attachment}` : ""}</option>)}</select><p>选择移除会清除此实例对应的绑定和覆盖，资产台账保留。</p></div> : null}
        </section>
      </div> : <p className="inspector-help">选择候选模型后，可查看新模型和需要修复的引用。</p>}
    </div>
    <footer><span>{unresolved ? `${unresolved} 个对象仍需选择` : plan ? "映射已完整，可应用后撤销" : "原模型版本保留"}</span><button type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={busy || !plan || unresolved > 0 || !!validation} onClick={() => {
      if (!plan) return;
      try { validateReplacementTargets(plan, map); const replaced = replaceInstanceResource(scene, instanceId, plan.oldAssetId, plan.newAssetId, map);
        if (onApply({ scene: replaced, instanceId, expectedAssetId: plan.oldAssetId, newAssetId: plan.newAssetId, objectMap: map })) onClose();
      } catch (reason) { setError(errorMessage(reason)); }
    }}>应用替换与修复</button></footer>
  </dialog>;
}
