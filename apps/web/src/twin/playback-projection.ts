import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { playbackRunning, type PlaybackState, type PlaybackSelection, type SceneFluidBinding } from "../../../../shared/scene-playback";
import type { CanvasNode } from "../canvas/types";
export function projectPlaybackScene(scene: StandaloneSceneDocument, playback: PlaybackState, bindings: SceneFluidBinding[] = []): StandaloneSceneDocument {
  const error = playbackSceneError(scene, bindings);
  if (error) throw new Error(error);
  const state = playback[scene.projectId];
  if (!state) return scene;
  return { ...scene,
    settings: { ...scene.settings, playAnimations: scene.settings.playAnimations && state.playing, autoRotate: scene.settings.autoRotate && state.playing },
    instances: scene.instances.map(i => ({...i, animation: {...i.animation, speed: i.animation?.speed ?? 1, enabled: i.animation?.enabled !== false && state.instances[i.id] !== false}})),
    fluids: scene.fluids?.map(f => ({...f, playing: f.playing && state.playing && bindings.filter(b => b.fluidIds.includes(f.id)).every(b => state.instances[b.instanceId] !== false)})),
  };
}
export function playbackSceneError(scene: StandaloneSceneDocument, bindings: SceneFluidBinding[] = []): string | null {
  for (const binding of bindings) {
    if (!scene.instances.some(i => i.id === binding.instanceId)) return `启停绑定找不到模型 ${binding.instanceId}`;
    for (const id of binding.fluidIds) if (!scene.fluids?.some(f => f.id === id)) return `启停绑定找不到流体 ${id}（设备 ${binding.instanceId}）`;
  }
  return null;
}
export function projectPlaybackNode(node: CanvasNode, state: PlaybackState, selection: PlaybackSelection): CanvasNode {
  const binding = node.interaction?.playbackBinding;
  const action = node.interaction?.clickActions.find(a => a.type === "scene-playback");
  let props = node.props;
  if (binding) {
    const running = playbackRunning(binding, state, selection);
    if (node.type === "process-pipe") props = {...props, flowing: props.flowing && running};
    if (node.type === "plain-text") props = {...props, text: binding.target === "selected" && !selection[binding.projectId] ? "请选择设备" : `${running ? "模拟运行" : "已暂停"} · 演示数据`, textColor: running ? "#63d6c3" : "#e3b778"};
  }
  if (action?.type === "scene-playback" && node.type === "button") {
    const running = playbackRunning(action, state, selection);
    const whole = action.target === "scene";
    const unavailable = action.target === "selected" && !selection[action.projectId];
    const toggleText = whole ? (running ? "暂停数字孪生" : "开启数字孪生") : (running ? "暂停该设备" : "启动该设备");
    props = {...props, text: unavailable ? "先选择设备" : !whole && state[action.projectId]?.playing === false ? "整线已暂停" : action.operation === "toggle" ? toggleText : props.text, disabled: props.disabled === true || unavailable || (!whole && state[action.projectId]?.playing === false)};
  }
  return props === node.props ? node : {...node, props};
}
