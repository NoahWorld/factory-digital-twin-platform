import { NumberField } from "./NumberField";
import { SceneMotionEditor } from "./SceneMotionEditor";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectEditorContext } from "../project-editor";
import { request, errorMessage } from "../api";
import { AssetPanel } from "../AssetPanel";
import { AssetDataBindingSection } from "./AssetDataBindingSection";
import { SceneViewport } from "./SceneViewport";
import { ModelReplacementDialog } from "./ModelReplacementDialog";
import { IDENTITY_TRANSFORM, type SceneDefinition, type ModelInstance } from "../../../../shared/scene-definition";
import type { ModelNodeTransform, ModelNodeAppearance } from "./types";
import { modelAssetsPath, type ModelAsset, type ModelAssetListResponse } from "./model-assets";
import { projectAssetsPath, type ProjectAsset, type ProjectAssetListResponse } from "./assets";
import type { ModelSceneNode, ModelSceneSnapshot } from "./model-scene";
import type { SceneViewportRuntime } from "./scene-viewport-runtime";
import type { ObjectTarget } from "./model-instance";

function TransformFields({ label, value, disabled, onChange }: { label: string; value: ModelNodeTransform; disabled: boolean; onChange: (value: ModelNodeTransform) => void }) {
  return <div className="scene-transform-fields">{(["position", "rotation", "scale"] as const).map((field) => <div key={field}><span>{field === "position" ? "位置（米）" : field === "rotation" ? "旋转（度）" : "缩放"}</span><div>{["X", "Y", "Z"].map((axis, index) => <label key={axis}>{axis}<NumberField step={field === "rotation" ? 1 : .1} aria-label={`${label}${field === "position" ? "位置" : field === "rotation" ? "旋转" : "缩放"} ${axis}`} disabled={disabled} value={value[field][index]} onCommit={(number) => {
    const next = structuredClone(value); next[field][index] = number; onChange(next);
  }} /></label>)}</div></div>)}</div>;
}
const flatten = (nodes: ModelSceneNode[]): ModelSceneNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
const defaultAppearance = (node?: ModelSceneNode): ModelNodeAppearance => ({ color: node?.appearance.materialColor ?? "#55b8d2", opacity: node?.appearance.materialOpacity ?? 1, visible: node?.appearance.visible ?? true });

export function SceneModelEditor({ projectId, scene, editable }: { projectId: string; scene: SceneDefinition; editable: boolean }) {
  const { execute, setSaveError } = useProjectEditorContext();
  const [showMotions,setShowMotions] = useState(false);
  const [models, setModels] = useState<ModelAsset[]>([]); const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [resource, setResource] = useState(""); const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ObjectTarget | null>(scene.instances[0] ? { instanceId: scene.instances[0].id, objectId: null } : null);
  const [snapshots, setSnapshots] = useState<Record<string, ModelSceneSnapshot>>({});
  const [objectSearch, setObjectSearch] = useState("");
  const [replacementInstanceId, setReplacementInstanceId] = useState<string | null>(null);
  const [assetChoice, setAssetChoice] = useState(""); const [showAssets, setShowAssets] = useState(false); const [reload, setReload] = useState(0);
  const engine = useRef<SceneViewportRuntime | null>(null); const fileInput = useRef<HTMLInputElement>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([request<ModelAssetListResponse>(modelAssetsPath(projectId), { signal: controller.signal }), request<ProjectAssetListResponse>(projectAssetsPath(projectId), { signal: controller.signal })])
      .then(([models, assets]) => { if (!controller.signal.aborted) { setModels(models.modelAssets); setAssets(assets.assets); setResource((id) => id || models.modelAssets[0]?.id || ""); } })
      .catch((reason) => { if (!controller.signal.aborted) setSaveError(errorMessage(reason)); });
    return () => controller.abort();
  }, [projectId, reload, setSaveError]);
  useEffect(() => {
    if (selected && !scene.instances.some((instance) => instance.id === selected.instanceId)) setSelected(scene.instances[0] ? { instanceId: scene.instances[0].id, objectId: null } : null);
  }, [scene.instances, selected]);
  const instance = scene.instances.find((instance) => instance.id === selected?.instanceId);
  const snapshot = instance ? snapshots[instance.id] : undefined;
  const object = selected?.objectId ? flatten(snapshot?.roots ?? []).find((node) => node.objectId === selected.objectId) : undefined;
  const binding = scene.assetBindings.find((binding) => binding.instanceId === selected?.instanceId && binding.objectId === selected?.objectId);
  const boundAsset = assets.find((asset) => asset.assetId === binding?.assetId);
  useEffect(() => setAssetChoice(binding?.assetId ?? ""), [binding?.assetId, selected?.instanceId, selected?.objectId]);
  const onSnapshot = useCallback((instanceId: string, value: ModelSceneSnapshot | null) => setSnapshots((current) => {
    if (value) return { ...current, [instanceId]: value }; const next = { ...current }; delete next[instanceId]; return next;
  }), []);
  const onReady = useCallback((value: SceneViewportRuntime | null) => { engine.current = value; }, []);
  const updateInstance = (next: ModelInstance) => execute({ type: "instance.upsert", sceneId: scene.id, instance: next });
  const updateScene = (next: SceneDefinition) => execute({ type: "scene.update", scene: next });
  const add = async () => {
    if (!resource) return; setBusy(true); setSaveError(null);
    try {
      const { modelAsset } = await request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}/${encodeURIComponent(resource)}/inspect`, { method: "POST" });
      if (!mounted.current) return;
      const id = crypto.randomUUID(); const transform = structuredClone(IDENTITY_TRANSFORM); transform.position[0] = scene.instances.length * 4;
      const result = execute({ type: "instance.upsert", sceneId: scene.id, instance: { id, name: `${modelAsset.originalFilename.slice(0,85)} ${scene.instances.length + 1}`, modelAssetId: resource, transform, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} } });
      if (result) setSelected({ instanceId: id, objectId: null });
    } catch (reason) { if (mounted.current) setSaveError(errorMessage(reason)); }
    finally { if (mounted.current) setBusy(false); }
  };
  let remainingRows = 400;
  const tree = (nodes: ModelSceneNode[], depth = 0) => nodes.flatMap((node) => --remainingRows < 0 ? [] : [<li key={node.path}>
    <button type="button" disabled={!node.objectId} className={node.objectId === selected?.objectId ? "is-selected" : ""} onClick={() => setSelected({ instanceId: instance!.id, objectId: node.objectId! })} style={{ paddingLeft: 10 + depth * 14 }}>{node.isMesh ? "◆" : "◇"} {node.name || "未命名对象"}</button>
    {node.children.length ? <ul>{tree(node.children, depth + 1)}</ul> : null}
  </li>]);
  const selectedTransform = object && instance ? instance.objectTransforms[object.objectId!] ?? object.transform : null;
  const selectedAppearance = object && instance ? instance.objectAppearances[object.objectId!] ?? defaultAppearance(object) : null;
  return <>
    <div className="model-editor-workbench scene-editor-workbench">
      <section className="model-editor-stage" aria-label="3D 场景编辑视口">
        <header className="model-editor-stage-heading"><div><span className="eyebrow">Shared scene</span><h1>{scene.name}</h1></div><div className="scene-view-actions"><span>{scene.instances.length} 个模型实例</span><button type="button" onClick={() => setShowMotions(true)}>动画与路径</button><button type="button" onClick={() => engine.current?.fit()}>查看全部</button><button type="button" disabled={!instance} onClick={() => engine.current?.fit(instance?.id)}>定位实例</button></div></header>
        <div className="model-editor-viewport"><SceneViewport projectId={projectId} scene={scene} cameraControlsEnabled interactive selectedTarget={selected} onSnapshot={onSnapshot} onReady={onReady} onPick={(target) => setSelected(target)} hint="选择对象 · 拖动旋转镜头 · 变换不会重置镜头" /></div>
        <footer className="model-editor-stage-footer"><span>实例配置独立；相同模型资源共用加载。</span><span>对象选择使用稳定标识。</span></footer>
      </section>
      <aside className="component-inspector scene-instance-inspector">
        <header className="inspector-heading"><span className="eyebrow">Scene & instances</span><h2>场景与实例</h2></header>
        <section className="inspector-section">
          <label>场景名称<input aria-label="场景名称" value={scene.name} disabled={!editable} onChange={(event) => { if (event.target.value.trim()) updateScene({ ...scene, name: event.target.value }); }} /></label>
          <label>添加资源<select aria-label="添加模型资源" value={resource} disabled={!editable || busy} onChange={(event) => setResource(event.target.value)}><option value="">选择模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.originalFilename} · v{model.versionNumber}</option>)}</select></label>
          <div className="scene-editor-actions"><button type="button" disabled={!editable || busy || !resource} onClick={() => void add()}>添加模型实例</button><button type="button" disabled={!editable || busy} onClick={() => fileInput.current?.click()}>导入模型资源</button></div>
          <input type="file" ref={fileInput} hidden accept=".gltf,.glb" onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy(true); setSaveError(null);
            try {
              const { modelAsset } = await request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(projectId)}?filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { "content-type": file.name.toLowerCase().endsWith(".glb") ? "model/gltf-binary" : "model/gltf+json" } });
              if (mounted.current) { setModels((models) => [modelAsset, ...models]); setResource(modelAsset.id); }
            } catch (reason) { if (mounted.current) setSaveError(errorMessage(reason)); } finally { if (mounted.current) setBusy(false); }
          }} />
          <p className="inspector-help">资源最多 25 MB；导入后选择“添加模型实例”。</p>
        </section>
        <section className="inspector-section"><strong>模型实例</strong><div className="scene-instance-list">{scene.instances.map((item) => <button key={item.id} type="button" className={item.id === instance?.id ? "is-selected" : ""} onClick={() => setSelected({ instanceId: item.id, objectId: null })}>{item.visible ? "◉" : "○"} {item.name}</button>)}</div></section>
        {instance ? <>
          <section className="inspector-section"><label>实例名称<input aria-label="实例名称" value={instance.name} disabled={!editable} onChange={(event) => { if (event.target.value.trim()) updateInstance({ ...instance, name: event.target.value }); }} /></label>
            <p className="inspector-help">资源：{models.find((model) => model.id === instance.modelAssetId)?.originalFilename ?? "正在读取…"} · v{models.find((model) => model.id === instance.modelAssetId)?.versionNumber ?? "—"}</p>
            <button type="button" disabled={!editable || busy} onClick={() => { setSaveError(null); setReplacementInstanceId(instance.id); }}>模型版本与替换</button>
            <label><input aria-label="显示实例" type="checkbox" disabled={!editable} checked={instance.visible} onChange={(event) => updateInstance({ ...instance, visible: event.target.checked })} />显示实例</label>
            <TransformFields label="实例" value={instance.transform} disabled={!editable} onChange={(transform) => updateInstance({ ...instance, transform })} />
            <label>整体颜色<input aria-label="实例颜色" type="color" value={instance.appearance?.color ?? "#55b8d2"} disabled={!editable} onChange={(event) => updateInstance({ ...instance, appearance: { ...(instance.appearance ?? defaultAppearance()), color: event.target.value } })} /></label>
            <label>整体透明度<input aria-label="实例透明度" type="number" min={0} max={1} step={.05} value={instance.appearance?.opacity ?? 1} disabled={!editable} onChange={(event) => updateInstance({ ...instance, appearance: { ...(instance.appearance ?? defaultAppearance()), opacity: Number(event.target.value) } })} /></label>
            <div className="scene-editor-actions"><button type="button" disabled={!editable || !instance.appearance} onClick={() => updateInstance({ ...instance, appearance: null })}>恢复实例原材质</button><button type="button" disabled={!editable} onClick={() => execute({ type: "instance.duplicate", sceneId: scene.id, instanceId: instance.id })}>复制实例</button><button type="button" disabled={!editable} onClick={() => execute({ type: "instance.delete", sceneId: scene.id, instanceId: instance.id })}>删除实例</button></div>
          </section>
          <section className="inspector-section"><strong>模型对象树</strong><input aria-label="搜索场景对象" placeholder="搜索对象名称" value={objectSearch} onChange={(event) => setObjectSearch(event.target.value)} />{snapshot ? <><ul className="scene-object-tree">{tree(objectSearch.trim() ? flatten(snapshot.roots).filter((node) => node.name.toLowerCase().includes(objectSearch.toLowerCase())).map((node) => ({ ...node, children: [] })) : snapshot.roots)}</ul>{remainingRows < 0 ? <p className="inspector-help">本次显示前 400 项，请搜索具体对象。</p> : null}</> : <p>模型对象正在加载…</p>}</section>
          {object && selectedTransform && selectedAppearance ? <section className="inspector-section"><strong>对象：{object.name || "未命名对象"}</strong>
            <TransformFields label="对象" value={selectedTransform} disabled={!editable} onChange={(transform) => updateInstance({ ...instance, objectTransforms: { ...instance.objectTransforms, [object.objectId!]: transform } })} />
            <label>对象颜色<input type="color" aria-label="对象颜色" value={selectedAppearance.color} disabled={!editable || !object.appearance.materialCount} onChange={(event) => updateInstance({ ...instance, objectAppearances: { ...instance.objectAppearances, [object.objectId!]: { ...selectedAppearance, color: event.target.value } } })} /></label>
            <label>对象透明度<NumberField aria-label="对象透明度" min={0} max={1} step={.05} value={selectedAppearance.opacity} disabled={!editable || !object.appearance.materialCount} onCommit={(opacity) => updateInstance({ ...instance, objectAppearances: { ...instance.objectAppearances, [object.objectId!]: { ...selectedAppearance, opacity } } })} /></label>
            <label><input type="checkbox" aria-label="显示对象" checked={selectedAppearance.visible} disabled={!editable} onChange={(event) => updateInstance({ ...instance, objectAppearances: { ...instance.objectAppearances, [object.objectId!]: { ...selectedAppearance, visible: event.target.checked } } })} />显示对象</label>
            <button type="button" disabled={!editable || (!instance.objectTransforms[object.objectId!] && !instance.objectAppearances[object.objectId!])} onClick={() => { const next = structuredClone(instance); delete next.objectTransforms[object.objectId!]; delete next.objectAppearances[object.objectId!]; updateInstance(next); }}>恢复对象原值</button>
            <label>资产<select aria-label="对象绑定资产" disabled={!editable} value={assetChoice} onChange={(event) => setAssetChoice(event.target.value)}><option value="">不绑定资产</option>{assets.map((asset) => <option key={asset.id} value={asset.assetId}>{asset.name} · {asset.assetId}</option>)}</select></label>
            <div className="scene-editor-actions"><button type="button" disabled={!editable} onClick={() => updateScene({ ...scene, assetBindings: [...scene.assetBindings.filter((item) => !(item.instanceId === instance.id && item.objectId === object.objectId)), ...(assetChoice ? [{ id: binding?.id ?? crypto.randomUUID(), assetId: assetChoice, instanceId: instance.id, objectId: object.objectId! }] : [])] })}>保存对象绑定</button><button type="button" onClick={() => setShowAssets(true)}>资产与指标</button></div>
          </section> : null}
          {object && boundAsset ? <AssetDataBindingSection asset={boundAsset} editable={editable} projectId={projectId} /> : null}
        </> : null}
        <section className="inspector-section"><strong>场景环境与镜头</strong>
          {([['backgroundColor','背景颜色'],['environmentLightColor','环境光颜色'],['keyLightColor','主光源颜色']] as const).map(([key,label]) => <label key={key}>{label}<input type="color" aria-label={label} disabled={!editable} value={scene.settings[key]} onChange={(event) => execute({ type: "scene.settings", sceneId: scene.id, settings: { ...scene.settings, [key]: event.target.value } })} /></label>)}
          {([['backgroundOpacity','背景透明度',0,1,.05],['environmentLightIntensity','环境光强度',0,10,.1],['keyLightIntensity','主光源强度',0,10,.1],['cameraFov','镜头 FOV',15,90,1]] as const).map(([key,label,min,max,step]) => <label key={key}>{label}<input type="number" aria-label={label} min={min} max={max} step={step} disabled={!editable} value={scene.settings[key]} onChange={(event) => execute({ type: "scene.settings", sceneId: scene.id, settings: { ...scene.settings, [key]: Number(event.target.value) } })} /></label>)}
          <label>初始视角<select aria-label="场景初始视角" disabled={!editable} value={scene.settings.cameraView} onChange={(event) => execute({ type: "scene.settings", sceneId: scene.id, settings: { ...scene.settings, cameraView: event.target.value as SceneDefinition["settings"]["cameraView"] } })}><option value="isometric">等距</option><option value="front">正面</option><option value="top">顶部</option></select></label>
          <label><input type="checkbox" aria-label="场景显示网格" disabled={!editable} checked={scene.settings.showGrid} onChange={(event) => execute({ type: "scene.settings", sceneId: scene.id, settings: { ...scene.settings, showGrid: event.target.checked } })} />显示网格</label>
          <label><input type="checkbox" aria-label="场景自动旋转" disabled={!editable} checked={scene.settings.autoRotate} onChange={(event) => execute({ type: "scene.settings", sceneId: scene.id, settings: { ...scene.settings, autoRotate: event.target.checked } })} />自动旋转镜头</label>
          <label>旋转速度<NumberField aria-label="场景旋转速度" min={0} max={5} step={.05} disabled={!editable} value={scene.settings.rotationSpeed} onCommit={(rotationSpeed) => execute({ type: "scene.settings", sceneId: scene.id, settings: { ...scene.settings, rotationSpeed } })} /></label>
        </section>
      </aside>
    </div>
    {showMotions ? <SceneMotionEditor projectId={projectId} scene={scene} snapshots={snapshots} editable={editable} onApply={(motions) => !!execute({ type: "scene.motions",sceneId: scene.id,motions })} onClose={() => setShowMotions(false)} /> : null}
    {showAssets ? <AssetPanel projectId={projectId} editable={editable} onClose={() => { setShowAssets(false); setReload((value) => value + 1); }} /> : null}
    {replacementInstanceId && scene.instances.some((instance) => instance.id === replacementInstanceId) ? <ModelReplacementDialog projectId={projectId} scene={scene} instanceId={replacementInstanceId} onClose={() => setReplacementInstanceId(null)} onModelAdded={(model) => setModels((models) => [model, ...models.filter((item) => item.id !== model.id)])} onApply={(replacement) => !!execute({ type: "instance.replace-resource", sceneId: scene.id, instanceId: replacement.instanceId, expectedAssetId: replacement.expectedAssetId, newAssetId: replacement.newAssetId, objectMap: replacement.objectMap })} /> : null}
  </>;
}
