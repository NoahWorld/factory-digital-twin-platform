import type { Model3DProps } from "./types";
import type { ModelSceneSnapshot } from "./model-scene";

export function ModelPresentationPanel({ settings, scene, animationCount, editable, runtime = false, onChange }: {
  settings: Model3DProps;
  scene: ModelSceneSnapshot | null;
  animationCount: number;
  editable: boolean;
  runtime?: boolean;
  onChange: (patch: Partial<Model3DProps>) => void;
}) {
  const view = settings.presentation;
  const update = (patch: Partial<typeof view>) => onChange({ presentation: { ...view, ...patch } });
  return (
    <section className="inspector-section model-presentation-panel" aria-label="模型检查面板">
      <div className="inspector-section-title"><strong>模型检查</strong><span>视图 · 动画 · 拆解</span></div>
      <div className="inspector-grid-two">
        <label><span>渲染质感</span><select disabled={!editable} value={view.lighting}
          onChange={(event) => update({ lighting: event.target.value as typeof view.lighting })}>
          <option value="standard">标准灯光</option><option value="studio">摄影棚金属质感</option>
        </select></label>
        <label><span>外壳显示</span><select disabled={!editable || !scene?.capabilities.shells} value={view.shellMode}
          onChange={(event) => update({ shellMode: event.target.value as typeof view.shellMode })}>
          <option value="original">透明检视</option><option value="solid">实体外壳</option><option value="hidden">查看内部</option>
        </select></label>
      </div>
      <div className="model-presentation-playback">
        <button className="secondary-button" type="button" disabled={!editable || !animationCount}
          onClick={() => onChange({ playAnimations: !settings.playAnimations })}>
          {settings.playAnimations ? "暂停动画" : "播放动画"}
        </button>
        <label><span className="sr-only">动画速度</span><select aria-label="动画速度" disabled={!editable || !animationCount}
          value={settings.animationSpeed} onChange={(event) => onChange({ animationSpeed: Number(event.target.value) })}>
          {[...new Set([0.25, 0.5, 1, 2, settings.animationSpeed])].sort((a, b) => a - b).map((speed) =>
            <option key={speed} value={speed}>{speed}×</option>)}
        </select></label>
      </div>
      <label className="model-presentation-flow"><input type="checkbox" checked={view.showFlow}
        disabled={!editable || !scene?.capabilities.flow} onChange={(event) => update({ showFlow: event.target.checked })} />
        显示水流粒子与波纹
      </label>
      <label className="model-explosion-control"><span>组件拆解 <output>{Math.round(view.explosion * 100)}%</output></span>
        <input aria-label="组件拆解" type="range" min="0" max="1" step="0.01" value={view.explosion}
          disabled={!editable || !scene?.capabilities.explosion} onChange={(event) => update({ explosion: Number(event.target.value) })} />
      </label>
      {view.explosion > 0 ? <p className="inspector-help">拆解时暂停显示水流，合拢后按开关恢复。</p> : null}
      {scene && !scene.capabilities.shells && !scene.capabilities.flow && !scene.capabilities.explosion
        ? <p className="inspector-help">此模型未标记外壳、水流和拆解部件，对应控件不可用。</p> : null}
      <p className="inspector-help">{runtime ? "仅影响本次查看，重新打开后恢复预设。" : "设置随画布保存，项目预览使用相同效果。"}</p>
    </section>
  );
}
