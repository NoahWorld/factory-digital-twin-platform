import type { TwinDriveConfig } from "../../../../shared/twin-drive";
import { withTwinDriveEnabled } from "./twin-config-state";

type TwinSourceStepProps = {
  config: TwinDriveConfig;
  onChange: (config: TwinDriveConfig) => void;
  onContinue: () => void;
};

export function TwinSourceStep({ config, onChange, onContinue }: TwinSourceStepProps) {
  return <>
      <div className="twin-source-grid" aria-label="数据来源">
        <button type="button" className="twin-source-option is-selected" aria-pressed="true"
          onClick={() => onChange({ ...config, source: "simulator" })}>
          <span className="twin-source-status">已选择 · 模拟数据</span>
          <strong>平台模拟数据</strong>
          <span>通过 WebSocket 接收，用来验证模型动作。</span>
        </button>
        <button type="button" className="twin-source-option" disabled aria-pressed="false"
          aria-describedby="twin-rest-source-help">
          <span className="twin-source-status">暂不可选</span>
          <strong>API 轮询</strong>
          <span id="twin-rest-source-help">已支持设备数据展示，尚未接入模型运动。</span>
        </button>
        <button type="button" className="twin-source-option" disabled aria-pressed="false"
          aria-describedby="twin-external-source-help">
          <span className="twin-source-status">暂不可选</span>
          <strong>外部 WebSocket</strong>
          <span id="twin-external-source-help">外部数据订阅尚未接入，当前不能用于模型运动。</span>
        </button>
      </div>
    <section className="twin-card twin-source-settings" aria-label="数据驱动设置">
      <div className="twin-row"><label className="twin-check">
        <input type="checkbox" checked={config.enabled}
          onChange={(event) => onChange(withTwinDriveEnabled(config, event.target.checked))} />
        启用数据驱动
      </label><button type="button" className="secondary-button" onClick={onContinue}>选择订阅数据 →</button></div>
      <p className="twin-help">保存后按 Topic 自动订阅，再到“接入测试”检查数据。{!config.enabled ? "当前未启用，可先完成配置；关闭并保存后自动模拟也会停止。" : "数据更新后，绑定的部件会按配置变化。"}</p>
      <div className="twin-source-summary">
        <span><strong>{config.points.length}</strong> 项数据</span>
        <span><strong>{config.bindings.length}</strong> 个部件绑定</span>
      </div>
    </section>
  </>;
}
