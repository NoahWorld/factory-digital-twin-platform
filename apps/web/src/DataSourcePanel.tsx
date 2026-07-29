import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, request } from "./api";
import {
  dataSourcePath,
  dataSourcesPath,
  type DataSourceListResponse,
  type DataSourceResponse,
  type DataSourceType,
  type ProjectDataSource,
} from "./data-sources";

type DataSourcePanelProps = {
  editable: boolean;
  onClose: () => void;
  projectId: string;
};

type DataSourceDraft = {
  id: string | null;
  sourceType: DataSourceType;
  name: string;
  url: string;
  intervalSeconds: string;
  timeoutMs: string;
  heartbeatSeconds: string;
  reconnectMaxSeconds: string;
  credentialRef: string;
};

const emptyDraft = (): DataSourceDraft => ({
  id: null,
  sourceType: "rest_polling",
  name: "",
  url: "",
  intervalSeconds: "10",
  timeoutMs: "5000",
  heartbeatSeconds: "30",
  reconnectMaxSeconds: "60",
  credentialRef: "",
});

const draftFromSource = (source: ProjectDataSource): DataSourceDraft => ({
  id: source.id,
  sourceType: source.sourceType,
  name: source.name,
  url: source.config.url,
  intervalSeconds: source.sourceType === "rest_polling"
    ? String(source.config.intervalSeconds)
    : "10",
  timeoutMs: source.sourceType === "rest_polling"
    ? String(source.config.timeoutMs)
    : "5000",
  heartbeatSeconds: source.sourceType === "websocket"
    ? String(source.config.heartbeatSeconds)
    : "30",
  reconnectMaxSeconds: source.sourceType === "websocket"
    ? String(source.config.reconnectMaxSeconds)
    : "60",
  credentialRef: source.config.credentialRef ?? "",
});

const sourceTypeLabel: Record<DataSourceType, string> = {
  rest_polling: "REST 轮询",
  websocket: "WebSocket",
};

const requiredInteger = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label}必须是整数。`);
  }
  return parsed;
};

export function DataSourcePanel({
  editable,
  onClose,
  projectId,
}: DataSourcePanelProps) {
  const [dataSources, setDataSources] = useState<ProjectDataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DataSourceDraft>(emptyDraft);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void request<DataSourceListResponse>(dataSourcesPath(projectId))
      .then((result) => {
        if (active) setDataSources(result.dataSources);
      })
      .catch((reason) => {
        if (active) setLoadError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const selectSource = (source: ProjectDataSource) => {
    setDraft(draftFromSource(source));
    setSaveError(null);
    setNotice(null);
  };

  const startNewSource = () => {
    setDraft(emptyDraft());
    setSaveError(null);
    setNotice(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || saving || loading || loadError) return;

    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const config = draft.sourceType === "rest_polling"
        ? {
            url: draft.url,
            intervalSeconds: requiredInteger(draft.intervalSeconds, "轮询周期"),
            timeoutMs: requiredInteger(draft.timeoutMs, "请求超时"),
            credentialRef: draft.credentialRef || null,
          }
        : {
            url: draft.url,
            heartbeatSeconds: requiredInteger(draft.heartbeatSeconds, "心跳周期"),
            reconnectMaxSeconds: requiredInteger(
              draft.reconnectMaxSeconds,
              "最大重连间隔",
            ),
            credentialRef: draft.credentialRef || null,
          };
      const result = await request<DataSourceResponse>(
        draft.id
          ? dataSourcePath(projectId, draft.id)
          : dataSourcesPath(projectId),
        {
          method: draft.id ? "PATCH" : "POST",
          body: JSON.stringify({
            sourceType: draft.sourceType,
            name: draft.name,
            config,
          }),
        },
      );
      setDataSources((current) => [
        result.dataSource,
        ...current.filter((source) => source.id !== result.dataSource.id),
      ]);
      setDraft(draftFromSource(result.dataSource));
      setNotice(draft.id ? "数据源配置已更新。" : "数据源已创建。");
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = !editable || saving || loading || Boolean(loadError);

  return (
    <div aria-modal="true" className="data-source-panel-backdrop" role="dialog">
      <section className="data-source-panel">
        <header className="data-source-panel-header">
          <div>
            <span>Data sources</span>
            <h2>项目数据源</h2>
          </div>
          <button
            aria-label="关闭数据源配置"
            className="data-source-panel-close"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        {loadError ? (
          <div className="data-source-panel-error" role="alert">
            <strong>数据源列表加载失败</strong>
            <p>{loadError}</p>
          </div>
        ) : null}

        <div className="data-source-panel-body">
          <aside className="data-source-list" aria-label="项目数据源列表">
            <div className="data-source-list-heading">
              <strong>连接配置</strong>
              <button
                disabled={formDisabled}
                onClick={startNewSource}
                type="button"
              >
                ＋ 新建
              </button>
            </div>
            {loading ? <p className="data-source-list-state">正在读取数据源…</p> : null}
            {!loading && !loadError && dataSources.length === 0 ? (
              <p className="data-source-list-state">还没有数据源。</p>
            ) : null}
            {!loading && !loadError ? dataSources.map((source) => (
              <button
                className={`data-source-list-item${draft.id === source.id ? " is-active" : ""}`}
                disabled={saving}
                key={source.id}
                onClick={() => selectSource(source)}
                type="button"
              >
                <span>
                  <strong>{source.name}</strong>
                  <small>{sourceTypeLabel[source.sourceType]}</small>
                </span>
                <em>已配置</em>
              </button>
            )) : null}
          </aside>

          <form className="data-source-form" onSubmit={(event) => void save(event)}>
            <div className="data-source-form-heading">
              <div>
                <span>{draft.id ? "Edit connection" : "New connection"}</span>
                <h3>{draft.id ? "编辑数据源" : "新建数据源"}</h3>
              </div>
            </div>

            <div className="data-source-form-grid">
              <label>
                <span>数据源名称</span>
                <input
                  disabled={formDisabled}
                  maxLength={100}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))}
                  placeholder="例如：设备状态接口"
                  required
                  value={draft.name}
                />
              </label>
              <label>
                <span>连接类型</span>
                <select
                  disabled={formDisabled}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    sourceType: event.target.value as DataSourceType,
                    url: "",
                  }))}
                  value={draft.sourceType}
                >
                  <option value="rest_polling">REST 轮询</option>
                  <option value="websocket">WebSocket</option>
                </select>
              </label>
              <label className="is-wide">
                <span>{draft.sourceType === "rest_polling" ? "HTTP(S) 地址" : "WS(S) 地址"}</span>
                <input
                  disabled={formDisabled}
                  maxLength={2048}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    url: event.target.value,
                  }))}
                  placeholder={
                    draft.sourceType === "rest_polling"
                      ? "http://gateway.local/api/equipment/state"
                      : "ws://gateway.local/realtime"
                  }
                  required
                  type="url"
                  value={draft.url}
                />
              </label>
              {draft.sourceType === "rest_polling" ? (
                <>
                  <label>
                    <span>轮询周期（秒）</span>
                    <input
                      disabled={formDisabled}
                      max={3600}
                      min={1}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        intervalSeconds: event.target.value,
                      }))}
                      required
                      type="number"
                      value={draft.intervalSeconds}
                    />
                  </label>
                  <label>
                    <span>请求超时（毫秒）</span>
                    <input
                      disabled={formDisabled}
                      max={30000}
                      min={500}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        timeoutMs: event.target.value,
                      }))}
                      required
                      step={100}
                      type="number"
                      value={draft.timeoutMs}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>心跳周期（秒）</span>
                    <input
                      disabled={formDisabled}
                      max={300}
                      min={5}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        heartbeatSeconds: event.target.value,
                      }))}
                      required
                      type="number"
                      value={draft.heartbeatSeconds}
                    />
                  </label>
                  <label>
                    <span>最大重连间隔（秒）</span>
                    <input
                      disabled={formDisabled}
                      max={300}
                      min={5}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        reconnectMaxSeconds: event.target.value,
                      }))}
                      required
                      type="number"
                      value={draft.reconnectMaxSeconds}
                    />
                  </label>
                </>
              )}
              <label className="is-wide">
                <span>服务端凭据引用（可选）</span>
                <input
                  autoComplete="off"
                  disabled={formDisabled}
                  maxLength={120}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    credentialRef: event.target.value,
                  }))}
                  pattern="[A-Za-z0-9][A-Za-z0-9._:-]*"
                  placeholder="例如：factory-a-api"
                  value={draft.credentialRef}
                />
              </label>
            </div>

            <div className="data-source-security-note">
              <strong>凭据不会保存在这里</strong>
              <p>
                账号、Token 与 API Key 必须由服务端密钥存储按引用提供，不能写进 URL、前端配置或 Git。
              </p>
            </div>
            {saveError ? <p className="data-source-form-error" role="alert">{saveError}</p> : null}
            {notice ? <p className="data-source-form-notice" role="status">{notice}</p> : null}
            {!editable ? <p className="data-source-readonly">当前项目只有查看权限。</p> : null}
            <footer>
              <button
                className="primary-button"
                disabled={formDisabled}
                type="submit"
              >
                {saving ? "保存中…" : draft.id ? "保存修改" : "创建数据源"}
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
