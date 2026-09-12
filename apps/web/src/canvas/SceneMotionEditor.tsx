import { useEffect, useMemo, useRef, useState } from "react";
import { SceneViewport } from "./SceneViewport";
import { NumberField } from "./NumberField";
import type { SceneViewportRuntime } from "./scene-viewport-runtime";
import type { SceneDefinition } from "../../../../shared/scene-definition";
import { validateSceneMotions, type SceneMotion, type SceneMotionTrack, type MotionValue, type MotionVector } from "../../../../shared/scene-motion";
import type { ModelSceneNode, ModelSceneSnapshot } from "./model-scene";

const flatten = (nodes: ModelSceneNode[]): ModelSceneNode[] => nodes.flatMap((node) => [node,...flatten(node.children)]);
const propertyNames: Record<string,string> = { position: "位置路径（米）", rotation: "旋转（度）", scale: "缩放", color: "颜色", opacity: "透明度", visible: "显隐", target: "镜头目标路径（米）" };

export function SceneMotionEditor({ projectId, scene, snapshots, editable, onApply, onClose }: { projectId: string; scene: SceneDefinition; snapshots: Record<string,ModelSceneSnapshot>; editable: boolean; onApply: (motions: SceneMotion[]) => boolean; onClose: () => void }) {
  const [motions,setMotions] = useState(() => structuredClone(scene.motions ?? []));
  const [selected,setSelected] = useState(motions[0]?.id ?? ""); const [trackId,setTrackId] = useState("");
  const [message,setMessage] = useState("选择对象或镜头，按时间配置关键帧。");
  const dialog = useRef<HTMLDialogElement>(null), engine = useRef<SceneViewportRuntime | null>(null), playing = useRef<AbortController | null>(null);
  useEffect(() => { dialog.current?.showModal(); return () => playing.current?.abort(); },[]);
  const motion = motions.find((motion) => motion.id === selected);
  const track = motion?.tracks.find((track) => track.id === trackId) ?? motion?.tracks[0];
  const previewScene = useMemo(() => ({ ...scene,motions }),[scene,motions]);
  const update = (patch: Partial<SceneMotion>) => setMotions(motions.map((item) => item.id === selected ? { ...item,...patch } : item));
  const updateTrack = (next: SceneMotionTrack) => motion && update({ tracks: motion.tracks.map((item) => item.id === next.id ? next : item) });
  const makeTrack = (type: "object" | "camera", durationMs: number): SceneMotionTrack => {
    if (type === "camera") {
      const camera = engine.current?.cameraState(); const position: MotionVector = camera?.fitted ? camera.position : [8,6,8];
      return { id: crypto.randomUUID(), type, property: "position", easing: "smooth", keyframes: [{ timeMs: 0,value: [...position] },{ timeMs: durationMs,value: [...position] }] };
    }
    const instance = scene.instances[0];
    return { id: crypto.randomUUID(),type, target: { instanceId: instance?.id ?? "",objectId: null },property: "position",easing: "linear",keyframes: [{ timeMs: 0,value: [...(instance?.transform.position ?? [0,0,0])] as MotionVector },{ timeMs: durationMs,value: [instance?.transform.position[0] ?? 0,(instance?.transform.position[1] ?? 0)+2,instance?.transform.position[2] ?? 0] }] };
  };
  const objects = track?.type === "object" ? flatten(snapshots[track.target.instanceId]?.roots ?? []).filter((node) => node.objectId) : [];
  const setProperty = (property: SceneMotionTrack["property"]) => {
    if (!track || !motion) return;
    const value: MotionValue = property === "visible" ? true : property === "opacity" ? 1 : property === "color" ? "#55b8d2" : property === "scale" ? [1,1,1] : [0,0,0];
    updateTrack({ ...track,property,keyframes: [{ timeMs: 0,value: structuredClone(value) },{ timeMs: motion.durationMs,value: structuredClone(value) }] } as SceneMotionTrack);
  };
  const changeFrame = (index: number, value: MotionValue) => track && updateTrack({ ...track,keyframes: track.keyframes.map((frame,i) => i === index ? { ...frame,value } : frame) } as SceneMotionTrack);
  const play = async () => {
    if (!motion || !engine.current) return;
    try {
      validateSceneMotions(motions); playing.current?.abort(); const controller = new AbortController(); playing.current = controller;
      setMessage("播放中…"); await engine.current.playMotion(motion.id,controller.signal);
      if (playing.current === controller) setMessage(motion.fill === "hold" ? "播放完成，保持末帧；停止可恢复配置。" : "播放完成，已恢复配置。");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <dialog className="model-replacement-dialog scene-motion-editor" aria-label="场景动画与路径" ref={dialog} onCancel={onClose}>
    <header><div><span className="eyebrow">Scene motion</span><h2>场景动画与路径</h2></div><button type="button" onClick={onClose}>关闭</button></header>
    <div className="scene-motion-body"><section className="scene-motion-config"><fieldset disabled={!editable}>
      <div className="interaction-fields"><select aria-label="当前动画" value={selected} onChange={(event) => { setSelected(event.target.value); setTrackId(""); }}><option value="">选择动画</option>{motions.map((motion) => <option key={motion.id} value={motion.id}>{motion.name}</option>)}</select><button type="button" disabled={motions.length >= 100} onClick={() => { const id = crypto.randomUUID(); const next: SceneMotion = { id,name: "新动画",version: 1,durationMs: 2000,repeat: 1,fill: "restore",tracks: [makeTrack(scene.instances.length ? "object" : "camera",2000)] }; setMotions([...motions,next]); setSelected(id); }}>添加动画</button></div>
      {motion ? <><label>动画名称<input aria-label="动画名称" value={motion.name} onChange={(event) => update({ name: event.target.value })} /></label><div className="interaction-fields"><label>时长（毫秒）<NumberField aria-label="动画时长" min={1} max={60000} value={motion.durationMs} onCommit={(durationMs) => update({ durationMs,tracks: motion.tracks.map((track) => ({ ...track,keyframes: track.keyframes.map((frame) => ({ ...frame,timeMs: Math.round(frame.timeMs * durationMs / motion.durationMs) })) })) as SceneMotionTrack[] })} /></label><label>重复<NumberField aria-label="动画重复次数" min={1} max={100} value={motion.repeat} onCommit={(repeat) => update({ repeat })} /></label></div>
        <label>结束后<select aria-label="动画结束方式" value={motion.fill} onChange={(event) => update({ fill: event.target.value as typeof motion.fill })}><option value="restore">恢复配置</option><option value="hold">保持末帧</option></select></label>
        <h3>轨道</h3><div className="interaction-fields"><select aria-label="当前轨道" value={track?.id ?? ""} onChange={(event) => setTrackId(event.target.value)}>{motion.tracks.map((track,index) => <option key={track.id} value={track.id}>{index+1} · {track.type === "camera" ? "镜头" : "对象"} · {propertyNames[track.property]}</option>)}</select><button type="button" disabled={!scene.instances.length || motion.tracks.length >= 64} onClick={() => { const track = makeTrack("object",motion.durationMs); update({ tracks: [...motion.tracks,track] }); setTrackId(track.id); }}>添加对象轨道</button><button type="button" disabled={motion.tracks.length >= 64} onClick={() => { const track = makeTrack("camera",motion.durationMs); update({ tracks: [...motion.tracks,track] }); setTrackId(track.id); }}>添加镜头轨道</button></div>
        {track ? <>
          {track.type === "object" ? <div className="interaction-fields"><select aria-label="轨道实例" value={track.target.instanceId} onChange={(event) => updateTrack({ ...track,target: { instanceId: event.target.value,objectId: null } })}>{scene.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select><select aria-label="轨道对象" value={track.target.objectId ?? ""} onChange={(event) => updateTrack({ ...track,target: { ...track.target,objectId: event.target.value || null } })}><option value="">整个实例</option>{objects.map((object) => <option key={object.path} value={object.objectId!}>{object.name || "未命名对象"} · {object.path}</option>)}</select></div> : null}
          <div className="interaction-fields"><select aria-label="轨道属性" value={track.property} onChange={(event) => setProperty(event.target.value as SceneMotionTrack["property"])}>{(track.type === "camera" ? ["position","target"] : ["position","rotation","scale","color","opacity","visible"]).map((property) => <option key={property} value={property}>{propertyNames[property]}</option>)}</select><select aria-label="轨道插值" value={track.easing} onChange={(event) => updateTrack({ ...track,easing: event.target.value as typeof track.easing })}><option value="linear">线性</option><option value="smooth">平滑进出</option></select><button type="button" onClick={() => update({ tracks: motion.tracks.filter((item) => item.id !== track.id) })}>删除轨道</button></div>
          <h3>关键帧</h3><div className="scene-motion-frame scene-motion-frame-heading"><span>毫秒</span>{Array.isArray(track.keyframes[0]?.value) ? <><span>X</span><span>Y</span><span>Z</span></> : <span>目标值</span>}</div>{track.keyframes.map((frame,index) => <div className="scene-motion-frame" key={index}><NumberField aria-label={`关键帧 ${index+1} 时间`} min={0} max={motion.durationMs} value={frame.timeMs} onCommit={(timeMs) => updateTrack({ ...track,keyframes: track.keyframes.map((item,i) => i === index ? { ...item,timeMs } : item) } as SceneMotionTrack)} />
            {Array.isArray(frame.value) ? frame.value.map((number,axis) => <NumberField key={axis} aria-label={`关键帧 ${index+1} ${["X","Y","Z"][axis]}`} step={.1} value={number} onCommit={(number) => { const value = [...frame.value as MotionVector] as MotionVector; value[axis] = number; changeFrame(index,value); }} />) : typeof frame.value === "boolean" ? <select aria-label={`关键帧 ${index+1} 显隐`} value={String(frame.value)} onChange={(event) => changeFrame(index,event.target.value === "true")}><option value="true">显示</option><option value="false">隐藏</option></select> : typeof frame.value === "number" ? <NumberField aria-label={`关键帧 ${index+1} 透明度`} min={0} max={1} step={.05} value={frame.value} onCommit={(value) => changeFrame(index,value)} /> : <input aria-label={`关键帧 ${index+1} 颜色`} type="color" value={frame.value} onChange={(event) => changeFrame(index,event.target.value)} />}
            <button type="button" aria-label={`删除关键帧 ${index+1}`} disabled={index === 0 || index === track.keyframes.length-1} onClick={() => updateTrack({ ...track,keyframes: track.keyframes.filter((_,i) => i !== index) } as SceneMotionTrack)}>×</button></div>)}
          <button type="button" disabled={track.keyframes.length >= 128} onClick={() => { let index = 0; for (let i = 1; i < track.keyframes.length-1; i++) if (track.keyframes[i+1].timeMs-track.keyframes[i].timeMs > track.keyframes[index+1].timeMs-track.keyframes[index].timeMs) index = i; const frames = [...track.keyframes]; frames.splice(index+1,0,{ timeMs: Math.round((frames[index].timeMs+frames[index+1].timeMs)/2),value: structuredClone(frames[index].value) }); updateTrack({ ...track,keyframes: frames } as SceneMotionTrack); }}>插入路径关键帧</button>
          {track.type === "camera" ? <div className="interaction-fields">{[0,track.keyframes.length-1].map((index) => <button type="button" key={index} onClick={() => { const pose = engine.current?.cameraState(); if (pose) changeFrame(index,pose[track.property]); }}>{index === 0 ? "将当前镜头写入首帧" : "将当前镜头写入末帧"}</button>)}</div> : null}
        </> : null}<div className="interaction-fields"><button type="button" onClick={() => { const copy = { ...structuredClone(motion),id: crypto.randomUUID(),name: `${motion.name.slice(0,95)} 副本` }; setMotions([...motions,copy]); setSelected(copy.id); }}>复制动画</button><button type="button" onClick={() => { setMotions(motions.filter((item) => item.id !== motion.id)); setSelected(""); }}>删除动画</button></div>
      </> : null}</fieldset></section>
      <section className="scene-motion-preview"><SceneViewport projectId={projectId} scene={previewScene} cameraControlsEnabled interactive selectedTarget={track?.type === "object" ? track.target : null} onSnapshot={() => {}} onReady={(value) => { engine.current = value; }} onPick={(target) => { if (target && track?.type === "object" && editable) updateTrack({ ...track,target }); }} /><div className="interaction-fields"><button type="button" disabled={!motion} onClick={() => void play()}>播放动画</button><button type="button" onClick={() => { playing.current?.abort(); engine.current?.stopMotion(); setMessage("已停止并恢复配置。"); }}>停止并恢复</button></div><p role="status">{message}</p><p>播放只影响当前预览。对象位置使用局部坐标；镜头使用场景坐标。绑定设备的实时状态外观优先。</p></section>
    </div><footer><span>应用后可撤销，仍需保存项目。</span><button type="button" onClick={onClose}>取消</button><button type="button" disabled={!editable} onClick={() => { try { if (onApply(validateSceneMotions(motions))) onClose(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } }}>应用场景动画</button></footer>
  </dialog>;
}
