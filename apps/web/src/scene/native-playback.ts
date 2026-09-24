import { LoopOnce, LoopRepeat, type AnimationAction, type AnimationMixer } from "three";

export type AnimationProgress = { time: number; duration: number; finished: boolean };
export type NativePlaybackMode = "once" | "repeat";
type AnimatedRecord = { mixer: AnimationMixer | null; actions: AnimationAction[] };

/** Optional session-only transport. Never changes imported tracks or saved scene settings. */
export function createNativePlayback(records: AnimatedRecord[], mode: NativePlaybackMode = "once") {
  const actions = records.flatMap(record => record.actions);
  if (!actions.length) throw new Error("当前场景没有可播放的原生动画");
  const duration = Math.max(...actions.map(action => action.getClip().duration));
  const configure = (action: AnimationAction) => {
    action.setLoop(mode === "repeat" ? LoopRepeat : LoopOnce, mode === "repeat" ? Infinity : 1);
    action.clampWhenFinished = mode === "once";
  };
  actions.forEach(configure);
  return {
    progress(): AnimationProgress {
      const time = Math.max(...actions.map(action => action.time));
      return { time, duration, finished: mode === "once" && time >= duration };
    },
    seek(time: number) {
      if (!Number.isFinite(time) || time < 0 || time > duration) throw new Error(`动画定位超出有效范围：${time} / ${duration}`);
      actions.forEach(action => { action.reset(); configure(action); action.time = Math.min(time, action.getClip().duration); action.play(); });
      records.forEach(record => record.mixer?.update(0));
    },
  };
}
