import { Select } from "../components/Select";
import { useId } from "react";
import { TWIN_ACTION_LIMITS, type TwinAction } from "../../../../shared/twin-actions";
import type { StandaloneSceneInstance } from "../../../../shared/standalone-3d";
import type { ProjectAsset } from "../canvas/assets";
import { componentLabels, type CanvasDocument } from "../canvas/types";

export type TwinActionScene = {
  projectId: string;
  name: string;
  instances: readonly Pick<StandaloneSceneInstance, "id" | "label" | "visible" | "renderMode">[];
};

export type TwinActionEditorProps = {
  actions: readonly TwinAction[];
  onChange: (actions: TwinAction[]) => void;
  disabled?: boolean;
  canvasDocument?: CanvasDocument | null;
  assets?: readonly ProjectAsset[];
  scenes?: readonly TwinActionScene[];
  loading?: boolean;
  error?: string | null;
};

const actionLabels: Record<TwinAction["type"], string> = {
  message: "弹出文字消息",
  "select-asset": "查看设备详情 / 联动设备",
  panel: "显示 / 隐藏 2D 组件",
  "panel-group": "显示 / 隐藏 2D 分组",
  "scene-playback": "模拟启停（场景 / 设备）",
  "focus-model": "聚焦 3D 模型",
  "set-text": "更新 2D 文本",
};

function unavailableOption({ value, present, label }: { value: string; present: boolean; label: string }) {
  return value && !present ? <option value={value}>不可用的{label}（{value}）</option> : null;
}

/** Edits only the approved action vocabulary; all targets come from authorized documents. */
export function TwinActionEditor({ actions, onChange, disabled = false, canvasDocument = null, assets = [], scenes = [], loading = false, error = null }: TwinActionEditorProps) {
  const editorId = useId();
  const nodes = (canvasDocument?.nodes ?? []).filter((node) => node.type !== "model-3d" && node.type !== "scene-3d");
  const plainTextNodes = nodes.filter((node) => node.type === "plain-text");
  const groups = [...new Set(nodes.flatMap(node => node.interaction?.visibilityGroup ? [node.interaction.visibilityGroup] : []))];
  const replace = (index: number, action: TwinAction) => onChange(actions.map((existing, position) => position === index ? action : existing));
  const createAction = (type: TwinAction["type"]): TwinAction => {
    switch (type) {
      case "panel-group": return {type, groupId: nodes.find(n => n.interaction?.visibilityGroup)?.interaction?.visibilityGroup ?? "", operation: "toggle"};
      case "scene-playback": return {type, projectId: scenes[0]?.projectId ?? "", target: "scene", operation: "toggle"};
      case "message": return { type, title: "消息", text: "" };
      case "select-asset": return { type, assetId: assets[0]?.assetId ?? "" };
      case "panel": return { type, nodeId: nodes[0]?.id ?? "", operation: "show" };
      case "set-text": return { type, nodeId: plainTextNodes[0]?.id ?? "", text: "" };
      case "focus-model": {
        const scene = scenes.find((candidate) => candidate.instances.some((instance) => instance.visible));
        return { type, projectId: scene?.projectId ?? "", instanceId: scene?.instances.find((instance) => instance.visible)?.id ?? "" };
      }
    }
  };

  return (
    <section aria-label="点击交互配置" className="twin-action-editor">
      <header className="twin-action-editor-heading"><strong>点击交互</strong><span>{actions.length} / {TWIN_ACTION_LIMITS.maximumActions}</span></header>
      {loading ? <p role="status">正在读取可选组件、模型和设备…</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {actions.map((action, index) => {
        const fieldId = `${editorId}-${index}`;
        const selectedScene = action.type === "focus-model" || action.type === "scene-playback" ? scenes.find((scene) => scene.projectId === action.projectId) : undefined;
        const playbackDevices = selectedScene?.instances.filter(i => i.visible && i.renderMode === "interactive") ?? [];
        const selectableNodes = action.type === "set-text" ? plainTextNodes : nodes;
        return (
          <fieldset className="twin-action-card" disabled={disabled} key={index}>
            <legend>动作 {index + 1}</legend>
            <div className="twin-action-card-heading">
              <label htmlFor={`${fieldId}-type`}>动作类型</label>
              <button aria-label={`移除动作 ${index + 1}`} className="inspector-action-button is-danger twin-action-remove" onClick={() => onChange(actions.filter((_, position) => position !== index))} type="button">移除</button>
            </div>
            <Select id={`${fieldId}-type`} onValueChange={(value) => replace(index, createAction(value as TwinAction["type"]))} value={action.type}>
              {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            {action.type === "message" ? <>
              <label htmlFor={`${fieldId}-title`}>消息标题</label>
              <input id={`${fieldId}-title`} maxLength={TWIN_ACTION_LIMITS.maximumTitleLength} onChange={(event) => replace(index, { ...action, title: event.target.value })} value={action.title} />
              <label htmlFor={`${fieldId}-message`}>消息内容</label>
              <textarea id={`${fieldId}-message`} maxLength={TWIN_ACTION_LIMITS.maximumTextLength} onChange={(event) => replace(index, { ...action, text: event.target.value })} rows={3} value={action.text} />
            </> : null}
            {action.type === "select-asset" ? <>
              <label htmlFor={`${fieldId}-asset`}>业务设备</label>
              <Select id={`${fieldId}-asset`} onValueChange={(value) => replace(index, { ...action, assetId: value })} value={action.assetId}>
                <option value="">选择设备</option>
                {unavailableOption({ label: "设备", present: assets.some((asset) => asset.assetId === action.assetId), value: action.assetId })}
                {assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · {asset.assetId}</option>)}
              </Select>
            </> : null}
            {action.type === "panel" || action.type === "set-text" ? <>
              <label htmlFor={`${fieldId}-node`}>{action.type === "set-text" ? "目标纯文本" : "目标 2D 组件"}</label>
              <Select id={`${fieldId}-node`} onValueChange={(value) => replace(index, { ...action, nodeId: value })} value={action.nodeId}>
                <option value="">选择组件</option>
                {unavailableOption({ label: "组件", present: selectableNodes.some((node) => node.id === action.nodeId), value: action.nodeId })}
                {selectableNodes.map((node) => <option key={node.id} value={node.id}>{componentLabels[node.type]} · {String(node.props.title || node.props.text || node.id)}</option>)}
              </Select>
              {action.type === "panel" ? <>
                <label htmlFor={`${fieldId}-operation`}>显示方式</label>
                <Select id={`${fieldId}-operation`} onValueChange={(value) => replace(index, { ...action, operation: value as "show" | "hide" | "toggle" })} value={action.operation}>
                  <option value="show">显示</option><option value="hide">隐藏</option><option value="toggle">切换显示 / 隐藏</option>
                </Select>
              </> : <>
                <label htmlFor={`${fieldId}-text`}>新的文本内容</label>
                <textarea id={`${fieldId}-text`} maxLength={TWIN_ACTION_LIMITS.maximumTextLength} onChange={(event) => replace(index, { ...action, text: event.target.value })} rows={3} value={action.text} />
              </>}
            </> : null}
            {action.type === "panel-group" ? <>
              <label>目标显示分组<Select value={action.groupId} onValueChange={groupId => replace(index, {...action, groupId})}><option value="">选择分组</option>{unavailableOption({label:"分组",present:groups.includes(action.groupId),value:action.groupId})}{groups.map(id => <option key={id} value={id}>{id}</option>)}</Select></label>
              <label>显示方式<Select value={action.operation} onValueChange={operation => replace(index, {...action, operation: operation as "show" | "hide" | "toggle"})}><option value="show">显示</option><option value="hide">隐藏</option><option value="toggle">切换</option></Select></label>
            </> : null}
            {action.type === "scene-playback" ? <>
              <label>3D 场景<Select value={action.projectId} onValueChange={projectId => replace(index, {...action, projectId, target: "scene"})}><option value="">选择场景</option>{unavailableOption({label:"场景",present:Boolean(selectedScene),value:action.projectId})}{scenes.map(s => <option key={s.projectId} value={s.projectId}>{s.name}</option>)}</Select></label>
              <label>控制对象<Select value={Array.isArray(action.target) ? "devices" : action.target} onValueChange={target => replace(index, {...action, target: target === "devices" ? [playbackDevices[0].id] : target as "scene" | "selected"})}><option value="scene">整个数字孪生</option><option value="selected">当前选中设备</option><option value="devices" disabled={!playbackDevices.length}>指定设备</option></Select></label>
              {Array.isArray(action.target) ? [...playbackDevices, ...action.target.filter(id => !playbackDevices.some(i => i.id === id)).map(id => ({id,label:`不可用的设备（${id}）`}))].map(i => <label className="inspector-check-row" key={i.id}><input type="checkbox" checked={action.target.includes(i.id)} disabled={action.target.length === 1 && action.target.includes(i.id) && playbackDevices.some(d => d.id === i.id)} onChange={event => {if(Array.isArray(action.target))replace(index,{...action,target:event.target.checked ? [...action.target,i.id] : action.target.filter(id=>id!==i.id)});}}/>{i.label}</label>) : null}
              {Array.isArray(action.target) && (!action.target.length || action.target.some(id => !playbackDevices.some(i => i.id === id))) ? <p className="error-text" role="alert">请选择至少一台可用设备，并移除失效引用。</p> : null}
              <label>操作<Select value={action.operation} onValueChange={operation => replace(index, {...action, operation: operation as "play" | "pause" | "toggle"})}><option value="toggle">切换暂停 / 启动</option><option value="pause">暂停</option><option value="play">启动</option></Select></label>
              <p className="inspector-help">仅控制当前看板的模拟动画与绑定管路，不下发现场指令。</p>
            </> : null}
            {action.type === "focus-model" ? <>
              <label htmlFor={`${fieldId}-project`}>3D 场景</label>
              <Select id={`${fieldId}-project`} onValueChange={(value) => {
                const nextScene = scenes.find((scene) => scene.projectId === value);
                replace(index, { ...action, projectId: value, instanceId: nextScene?.instances.find((instance) => instance.visible)?.id ?? "" });
              }} value={action.projectId}>
                <option value="">选择场景</option>
                {unavailableOption({ label: "场景", present: Boolean(selectedScene), value: action.projectId })}
                {scenes.map((scene) => <option key={scene.projectId} value={scene.projectId}>{scene.name}</option>)}
              </Select>
              <label htmlFor={`${fieldId}-instance`}>目标模型</label>
              <Select id={`${fieldId}-instance`} onValueChange={(value) => replace(index, { ...action, instanceId: value })} value={action.instanceId}>
                <option value="">选择模型</option>
                {unavailableOption({ label: "模型", present: Boolean(selectedScene?.instances.some((instance) => instance.id === action.instanceId)), value: action.instanceId })}
                {selectedScene?.instances.map((instance) => <option disabled={!instance.visible} key={instance.id} value={instance.id}>{instance.label}{instance.visible ? "" : "（已隐藏）"}</option>)}
              </Select>
              <p className="inspector-help">跨项目聚焦需打开目标 3D 预览；已嵌入 2D 的场景可直接联动。</p>
            </> : null}
          </fieldset>
        );
      })}
      <button className="secondary-button twin-action-add" disabled={disabled || actions.length >= TWIN_ACTION_LIMITS.maximumActions} onClick={() => onChange([...actions, createAction("message")])} type="button">添加点击动作</button>
    </section>
  );
}
