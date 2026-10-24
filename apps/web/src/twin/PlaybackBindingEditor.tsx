import { Select } from "../components/Select";
import type { CanvasNode } from "../canvas/types";
import type { TwinActionScene } from "./TwinActionEditor";
import type { CanvasNodeInteraction } from "../../../../shared/twin-actions";
export function PlaybackBindingEditor({node, editable, scenes, onChange}: {node:CanvasNode;editable:boolean;scenes:readonly TwinActionScene[];onChange:(node:CanvasNode)=>void}) {
  const interaction = node.interaction ?? {hiddenInPreview:false,clickActions:[]};
  const update = (patch:Partial<CanvasNodeInteraction>) => onChange({...node,interaction:{...interaction,...patch}});
  const binding = interaction.playbackBinding;
  const scene = scenes.find(s => s.projectId === binding?.projectId);
  const devices = scene?.instances.filter(i => i.visible && i.renderMode === "interactive") ?? [];
  const targets = binding && Array.isArray(binding.target) ? binding.target : null;
  const missing = targets?.filter(id => !devices.some(i => i.id === id)) ?? [];
  return <section className="inspector-section"><strong>显示分组与模拟联动</strong>
    <label>显示分组 ID<input disabled={!editable} placeholder="如 process-view" value={interaction.visibilityGroup ?? ""} onChange={e => {const next={...interaction};if(e.target.value)next.visibilityGroup=e.target.value;else delete next.visibilityGroup;onChange({...node,interaction:next});}} /></label>
    <label className="inspector-check-row"><input type="checkbox" disabled={!editable} checked={interaction.hiddenInPreview} onChange={e=>update({hiddenInPreview:e.target.checked})}/>预览默认隐藏</label>
    {node.type === "process-pipe" || node.type === "plain-text" ? <>
    <label>模拟运行场景<Select disabled={!editable} value={binding?.projectId ?? ""} onValueChange={projectId=>{const next={...interaction};if(projectId)next.playbackBinding={projectId,target:"scene"};else delete next.playbackBinding;onChange({...node,interaction:next});}}><option value="">不绑定</option>{binding && !scene ? <option value={binding.projectId}>不可用的场景（{binding.projectId}）</option> : null}{scenes.map(s=><option key={s.projectId} value={s.projectId}>{s.name}</option>)}</Select></label>
    {binding ? <><label>控制对象<Select disabled={!editable} value={targets?"devices":binding.target as string} onValueChange={target=>update({playbackBinding:{...binding,target:target === "devices" ? [devices[0].id] : target as "scene"|"selected"}})}><option value="scene">整个场景</option><option value="selected">当前设备</option><option value="devices" disabled={!devices.length}>指定设备</option></Select></label>
      {targets ? [...devices.map(i=>({id:i.id,label:i.label})),...missing.map(id=>({id,label:`不可用的设备（${id}）`}))].map(i=><label className="inspector-check-row" key={i.id}><input type="checkbox" disabled={!editable || (targets.length === 1 && targets.includes(i.id) && !missing.includes(i.id))} checked={targets.includes(i.id)} onChange={e=>update({playbackBinding:{...binding,target:e.target.checked?[...targets,i.id]:targets.filter(id=>id!==i.id)}})}/>{i.label}</label>) : null}
      {targets && (!targets.length || missing.length > 0) ? <p className="error-text" role="alert">请选择至少一台可用设备，并移除失效引用。</p> : null}
    <p className="inspector-help">文本显示模拟状态；管路跟随绑定设备启停。多个设备中任一暂停即停止该管路。</p></> : null}</> : null}
  </section>;
}
