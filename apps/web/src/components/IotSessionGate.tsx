import { IOT_HOME_PATH, IOT_LOGIN_PATH } from "../iot/config";
import { PRODUCT_NAME } from "../product-config";
import { ProductLogo } from "./ProductLogo";
import "./IotSessionGate.css";

type IotSessionGateProps = { onRetry: () => void } & (
  | { state: "missing" | "expired" | "verifying" }
  | { state: "error"; error: string }
);

const content = {
  missing: {
    title: "请先登录 IoT",
    description: "登录 IoT 后，即可访问 3D 平台。",
  },
  expired: {
    title: "IoT 登录已失效",
    description: "请重新登录 IoT，恢复访问当前项目与场景。",
  },
  verifying: {
    title: "正在验证 IoT 登录状态",
    description: "验证完成后将自动进入 3D 平台。",
  },
  error: {
    title: "暂时无法连接 IoT",
    description: "登录验证未完成，请检查连接后重试。",
  },
};

export function IotSessionGate(props: IotSessionGateProps) {
  const { state, onRetry } = props;
  const { title, description } = content[state];
  const needsLogin = state === "missing" || state === "expired";

  return (
    <div className="iot-gate">
      <header className="iot-gate-header">
        <div className="iot-gate-brand">
          <ProductLogo />
          <span>{PRODUCT_NAME}</span>
        </div>
        <a className="iot-gate-back" href={IOT_HOME_PATH} target="_top">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m10 6-6 6 6 6M4 12h16" /></svg>
          返回 IoT
        </a>
      </header>
      <main className="iot-gate-main">
        <section className="iot-gate-panel" aria-labelledby="iot-gate-title" aria-busy={state === "verifying"}>
          <div className={`iot-gate-symbol is-${state}`} aria-hidden="true">
            <svg viewBox="0 0 32 32">
              {state === "error" ? <>
                <path d="m16 4 13 23H3L16 4Z" /><path d="M16 12v7m0 4v1" />
              </> : state === "verifying" ? <>
                <path d="m16 3 11 6.5v13L16 29 5 22.5v-13L16 3Z" />
                <path d="m5 9.5 11 6.6 11-6.6M16 16v13" />
              </> : <>
                <rect x="6" y="13" width="20" height="15" rx="3" />
                <path d="M10 13V9a6 6 0 0 1 12 0v4m-6 6v3" />
              </>}
            </svg>
          </div>
          <h1 id="iot-gate-title" role={state === "verifying" ? "status" : undefined}>{title}</h1>
          <p className="iot-gate-description">{description}</p>
          {state === "error" ? <p className="iot-gate-error" role="alert">{props.error}</p> : null}
          {needsLogin ? (
            <div className="iot-gate-actions">
              <a className="primary-button" href={IOT_LOGIN_PATH} target="_top">
                前往 IoT 登录
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>
              </a>
              <button className="secondary-button" type="button" onClick={onRetry}>已登录，重新验证</button>
            </div>
          ) : state === "error" ? (
            <div className="iot-gate-actions is-single">
              <button className="primary-button" type="button" onClick={onRetry}>重新连接</button>
            </div>
          ) : null}
          {needsLogin ? (
            <details className="iot-gate-help">
              <summary>登录后仍无法进入？</summary>
              <p>请在同一浏览器、同一地址登录 IoT，再返回此页重新验证。不同浏览器或浏览器用户的登录状态不共享。</p>
            </details>
          ) : null}
          <div className="iot-gate-origin">
            <span>当前访问地址</span>
            <span>{window.location.origin}</span>
          </div>
        </section>
      </main>
    </div>
  );
}
