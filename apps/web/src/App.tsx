import { useEffect, useState } from "react";

type HealthResponse = {
  status: "ok";
  service: string;
  timestamp: string;
  requestId: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch(`${apiBaseUrl}/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API health check failed with HTTP ${response.status}.`);
        }

        return (await response.json()) as HealthResponse;
      })
      .then((result) => setHealth(result))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }

        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Factory Digital Twin</p>
        <h1>2D + 3D 工厂数字孪生交付平台</h1>
        <p className="intro">
          首期从一个资产对象出发：模型节点、实时数据与看板详情通过同一个
          <code> assetId </code>联动。
        </p>
      </section>

      <section className="cards" aria-label="首期工作区">
        <article>
          <span>01</span>
          <h2>3D 场景</h2>
          <p>导入 GLB、检查模型预算、映射稳定的资产节点。</p>
        </article>
        <article>
          <span>02</span>
          <h2>资产与数据</h2>
          <p>维护资产台账，定义 REST 轮询或 WebSocket 数据契约。</p>
        </article>
        <article>
          <span>03</span>
          <h2>2D 运行看板</h2>
          <p>用受约束模板组合指标、告警和设备详情，而非任意画布。</p>
        </article>
      </section>

      <section className="api-status">
        <div>
          <p className="eyebrow">API 连通性</p>
          <h2>{health ? "后端已响应" : error ? "后端不可达" : "正在检查后端"}</h2>
        </div>
        {health ? (
          <p>
            {health.service} · 请求 {health.requestId}
          </p>
        ) : (
          <p className={error ? "error" : undefined}>
            {error ?? `请求 ${apiBaseUrl}/health`}
          </p>
        )}
      </section>
    </main>
  );
}
