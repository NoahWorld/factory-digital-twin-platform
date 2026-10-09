import { useEffect, useRef, useState } from "react";
import { emptyTwinDriveConfig, twinApiConnectionErrors, twinDrivePath, twinSourcePathValid, type TwinApiConnection, type TwinApiSourceTest, type TwinDriveConfig } from "../../../../shared/twin-drive";
import { errorMessage, request, reportError, UserFacingError } from "../api";
import { Select } from "../components/Select";

type TwinSourceStepProps = {
  projectId: string;
  config: TwinDriveConfig;
  onChange: (config: TwinDriveConfig) => void;
  onContinue: () => void;
  onInspect: (result: TwinApiSourceTest | null) => void;
};

/** Inspect the configured source through the authenticated project gateway. */
function checkedSourceTest(value: unknown): TwinApiSourceTest {
  if (!value || typeof value !== "object") throw new UserFacingError("接口检查返回异常，请联系管理员。");
  const result = value as TwinApiSourceTest;
  if (typeof result.timestamp !== "string" || !Number.isFinite(Date.parse(result.timestamp)) || !Array.isArray(result.fields)) throw new UserFacingError("接口检查未返回有效时间与字段，请联系管理员。");
  if (result.fields.some(field => !field || !twinSourcePathValid(field.path) || !["number", "boolean", "string"].includes(field.type) || typeof field.value !== field.type || (field.type === "number" && !Number.isFinite(field.value)))) throw new UserFacingError("接口检查返回了无效字段，请联系管理员。");
  return result;
}

export function TwinSourceStep({ projectId, config, onChange, onContinue, onInspect }: TwinSourceStepProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TwinApiSourceTest | null>(null);
  const pending = useRef<AbortController | null>(null);
  const connectionKey = JSON.stringify(config.connection);
  useEffect(() => {
    pending.current?.abort(); setChecking(false); setResult(null); setError(null);
    return () => pending.current?.abort();
  }, [connectionKey]);
  if (config.source === "simulator") return <section className="twin-card" aria-label="旧版配置迁移">
    <h3>旧版平台模拟配置已停用</h3>
    <p className="twin-help">旧配置仍保留。重新接入会创建空的接口配置草稿，保存后替换原配置；场景模型不会被改动。</p>
    <button type="button" className="primary-button" onClick={() => onChange(emptyTwinDriveConfig())}>重新接入接口</button>
  </section>;
  const connection = config.connection;
  if (!connection) return <p role="alert" className="twin-error">接口配置缺失，请在高级配置中修正，或重新载入配置。</p>;
  if (connection.redacted) return <section className="twin-card"><h3>{connection.protocol === "websocket" ? "WebSocket 订阅" : "REST 轮询"}</h3><p className="twin-readonly">当前账号只能查看模型效果，接口地址与订阅信息由数据网关保护。</p></section>;
  const patch = (change: Partial<TwinApiConnection>) => onChange({ ...config, connection: { ...connection, ...change } });
  const sample = (protocol: TwinApiConnection["protocol"]) => onChange({ ...config, connection: { protocol, url: `/api/v1/test-business/handling-cell/${protocol === "rest" ? "state" : "live"}`, timestampPath: "timestamp", intervalMs: 500, timeoutMs: 5000 } });
  const inspect = async () => {
    if (checking || twinApiConnectionErrors(connection).length) return;
    const controller = new AbortController(); pending.current = controller;
    setChecking(true); setError(null); setResult(null); onInspect(null);
    try {
      const response = checkedSourceTest(await request<unknown>(`${twinDrivePath(projectId)}/test-source`, { method: "POST", body: JSON.stringify({ connection }), signal: controller.signal }));
      if (!controller.signal.aborted) { setResult(response); onInspect(response); }
    } catch (reason) {
      if (!controller.signal.aborted) { reportError(reason, { operation: "inspect_twin_source", projectId }); setError(errorMessage(reason)); }
    } finally { if (!controller.signal.aborted) { setChecking(false); pending.current = null; } }
  };
  return <>
    <section className="twin-card" aria-label="接口连接">
      <div className="twin-fields">
        <label><span>接入方式</span><Select value={connection.protocol} onValueChange={(protocol) => {
          if (protocol === connection.protocol) return;
          const { subscribeMessage: _removed, ...rest } = connection;
          onChange({ ...config, connection: { ...rest, protocol: protocol as TwinApiConnection["protocol"], url: "" } });
        }}><option value="rest">REST 轮询</option><option value="websocket">WebSocket 订阅</option></Select></label>
        <label className="twin-wide"><span>接口地址</span><input value={connection.url} maxLength={2048} placeholder={connection.protocol === "rest" ? "https://业务服务地址/api/state" : "wss://业务服务地址/live"} onChange={event => patch({ url: event.target.value })} /></label>
      </div>
      <div className="twin-source-examples"><span>先试用后端测试接口：</span><button type="button" className="secondary-button compact-button" onClick={() => sample("rest")}>填写 REST 示例</button><button type="button" className="secondary-button compact-button" onClick={() => sample("websocket")}>填写 WebSocket 示例</button></div>
      <p className="twin-help">示例是后端实际生成的搬运工位数据，包含小车位置 agv.positionM 和机械臂转角 robot.angleDeg。真实业务接入时替换接口地址和字段即可。</p>
      <details className="twin-advanced"><summary>连接高级设置</summary><div className="twin-fields">
        <label><span>采样时间字段</span><input value={connection.timestampPath} maxLength={256} placeholder="timestamp" onChange={event => patch({ timestampPath: event.target.value })} /></label>
        {connection.protocol === "rest" ? <label><span>轮询间隔（毫秒）</span><input type="number" min={200} max={60000} value={Number.isFinite(connection.intervalMs) ? connection.intervalMs : ""} onChange={event => patch({ intervalMs: event.target.value.trim() === "" ? NaN : Number(event.target.value) })} /></label> : null}
        <label><span>请求超时（毫秒）</span><input type="number" min={500} max={30000} value={Number.isFinite(connection.timeoutMs) ? connection.timeoutMs : ""} onChange={event => patch({ timeoutMs: event.target.value.trim() === "" ? NaN : Number(event.target.value) })} /></label>
        {connection.protocol === "websocket" ? <label className="twin-wide"><span>订阅消息（可选 JSON）</span><textarea rows={3} maxLength={8192} value={connection.subscribeMessage ?? ""} onChange={event => {
          const { subscribeMessage: _removed, ...without } = connection;
          onChange({ ...config, connection: event.target.value === "" ? without : { ...connection, subscribeMessage: event.target.value } });
        }} /></label> : null}
      </div><p className="twin-help">由后端采集接口数据。外部业务地址需由管理员在服务端允许连接。</p></details>
      <div className="twin-row"><button type="button" className="secondary-button" disabled={checking || twinApiConnectionErrors(connection).length > 0} onClick={() => void inspect()}>{checking ? "正在读取接口…" : "检查接口并读取字段"}</button>{checking ? <span className="twin-help" role="status">正在等待真实接口响应。</span> : null}</div>
      {error ? <p className="twin-error" role="alert">🔴 接口检查失败：{error}</p> : null}
      {result ? <div className="twin-source-result" role="status"><p className="twin-success">已读取接口 · 采样时间 {new Date(result.timestamp).toLocaleTimeString()}</p><div className="twin-source-fields">{result.fields.map(field => <span key={field.path}><code>{field.path}</code><small>{String(field.value)}</small></span>)}</div><p className="twin-help">下一步选择数值或布尔字段，让模型动作跟随它变化。</p></div> : null}
    </section>
    <section className="twin-card twin-source-settings" aria-label="数据驱动设置">
      <div className="twin-row"><label className="twin-check"><input type="checkbox" checked={config.enabled} onChange={event => onChange({ ...config, enabled: event.target.checked })} />启用数据驱动</label><button type="button" className="secondary-button" onClick={onContinue}>绑定动作 →</button></div>
      <p className="twin-help">完成动作绑定后启用并保存，模型会跟随接口返回的数据变化。</p>
    </section>
  </>;
}
