import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, request } from "../api";
import {
  dataSourcesPath,
  type DataSourceListResponse,
  type ProjectDataSource,
} from "../data-sources";
import {
  assetDataBindingPath,
  assetDataBindingsPath,
  type AssetDataBinding,
  type AssetDataBindingListResponse,
  type AssetDataBindingResponse,
  type MetricValueType,
} from "./asset-data-bindings";
import type { ProjectAsset } from "./assets";

type AssetDataBindingSectionProps = {
  asset: ProjectAsset;
  editable: boolean;
  projectId: string;
};

type AssetDataBindingDraft = {
  id: string | null;
  dataSourceId: string;
  metricKey: string;
  sourcePath: string;
  valueType: MetricValueType;
  unit: string;
  staleAfterSeconds: string;
};

const newDraft = (dataSourceId = ""): AssetDataBindingDraft => ({
  id: null,
  dataSourceId,
  metricKey: "",
  sourcePath: "$.data.value",
  valueType: "number",
  unit: "",
  staleAfterSeconds: "30",
});

const draftFromBinding = (
  binding: AssetDataBinding,
): AssetDataBindingDraft => ({
  id: binding.id,
  dataSourceId: binding.dataSourceId,
  metricKey: binding.metricKey,
  sourcePath: binding.sourcePath,
  valueType: binding.valueType,
  unit: binding.unit ?? "",
  staleAfterSeconds: String(binding.staleAfterSeconds),
});

const sourceTypeLabel = (
  source: ProjectDataSource,
): string =>
  source.sourceType === "rest_polling" ? "REST" : "WebSocket";

const valueTypeLabels: Record<MetricValueType, string> = {
  number: "数值",
  string: "文本",
  boolean: "布尔",
  timestamp: "时间戳",
};

const requiredInteger = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label}必须是整数。`);
  }
  return parsed;
};

export function AssetDataBindingSection({
  asset,
  editable,
  projectId,
}: AssetDataBindingSectionProps) {
  const [dataSources, setDataSources] = useState<ProjectDataSource[]>([]);
  const [dataBindings, setDataBindings] = useState<AssetDataBinding[]>([]);
  const [draft, setDraft] = useState<AssetDataBindingDraft>(newDraft);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setNotice(null);
    setDataBindings([]);
    setDataSources([]);
    setDraft(newDraft());

    void Promise.all([
      request<AssetDataBindingListResponse>(
        assetDataBindingsPath(projectId, asset.id),
      ),
      request<DataSourceListResponse>(dataSourcesPath(projectId)),
    ])
      .then(([bindingResult, sourceResult]) => {
        if (!active) return;
        setDataBindings(bindingResult.dataBindings);
        setDataSources(sourceResult.dataSources);
        if (bindingResult.dataBindings[0]) {
          setDraft(draftFromBinding(bindingResult.dataBindings[0]));
        } else {
          setDraft(newDraft(sourceResult.dataSources[0]?.id ?? ""));
        }
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
  }, [asset.id, projectId]);

  const selectBinding = (binding: AssetDataBinding) => {
    setDraft(draftFromBinding(binding));
    setSaveError(null);
    setNotice(null);
  };

  const startNewBinding = () => {
    setDraft(newDraft(dataSources[0]?.id ?? ""));
    setSaveError(null);
    setNotice(null);
  };

  const replaceBinding = (binding: AssetDataBinding) => {
    setDataBindings((current) => [
      binding,
      ...current.filter((candidate) => candidate.id !== binding.id),
    ].sort((left, right) => left.metricKey.localeCompare(right.metricKey)));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || saving || loading || loadError || dataSources.length === 0) return;

    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const payload = {
        dataSourceId: draft.dataSourceId,
        metricKey: draft.metricKey,
        sourcePath: draft.sourcePath,
        valueType: draft.valueType,
        unit: draft.unit.trim() || null,
        staleAfterSeconds: requiredInteger(
          draft.staleAfterSeconds,
          "数据过期时间",
        ),
      };
      const result = await request<AssetDataBindingResponse>(
        draft.id
          ? assetDataBindingPath(projectId, asset.id, draft.id)
          : assetDataBindingsPath(projectId, asset.id),
        {
          method: draft.id ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      replaceBinding(result.dataBinding);
      setDraft(draftFromBinding(result.dataBinding));
      setNotice(draft.id ? "指标映射已更新。" : "指标映射已创建。");
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editable || saving || !draft.id) return;
    const current = dataBindings.find((binding) => binding.id === draft.id);
    if (!current) {
      setSaveError("当前指标映射已不在列表中，请重新打开该资产。");
      return;
    }
    if (!window.confirm(`确定删除指标映射“${current.metricKey}”吗？`)) return;

    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      await request<void>(
        assetDataBindingPath(projectId, asset.id, current.id),
        { method: "DELETE" },
      );
      setDataBindings((items) => items.filter((item) => item.id !== current.id));
      setDraft(newDraft(dataSources[0]?.id ?? ""));
      setNotice(`指标映射“${current.metricKey}”已删除。`);
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = !editable
    || saving
    || loading
    || Boolean(loadError)
    || dataSources.length === 0;

  return (
    <section className="inspector-section asset-data-binding-section">
      <div className="inspector-section-title">
        <strong>资产指标映射</strong>
        <span>{dataBindings.length} 项</span>
      </div>
      <div className="asset-data-binding-context">
        <span>当前资产</span>
        <strong>{asset.name}</strong>
        <code>{asset.assetId}</code>
      </div>

      {loading ? (
        <div className="model-scene-tree-loading">
          <span className="model-loading-spinner" />
          <span>正在读取指标映射与数据源…</span>
        </div>
      ) : null}
      {loadError ? (
        <p className="inspector-inline-error" role="alert">
          指标映射读取失败：{loadError}
        </p>
      ) : null}

      {!loading && !loadError ? (
        <>
          <div className="asset-data-binding-list-heading">
            <span>已配置指标</span>
            <button
              disabled={formDisabled}
              onClick={startNewBinding}
              type="button"
            >
              ＋ 新建
            </button>
          </div>
          {dataBindings.length > 0 ? (
            <div className="asset-data-binding-list">
              {dataBindings.map((binding) => (
                <button
                  className={draft.id === binding.id ? "is-active" : ""}
                  disabled={saving}
                  key={binding.id}
                  onClick={() => selectBinding(binding)}
                  type="button"
                >
                  <span>
                    <strong>{binding.metricKey}</strong>
                    <small>{binding.sourcePath}</small>
                  </span>
                  <em>{valueTypeLabels[binding.valueType]}{binding.unit ? ` · ${binding.unit}` : ""}</em>
                </button>
              ))}
            </div>
          ) : (
            <p className="asset-data-binding-empty">当前资产还没有指标映射。</p>
          )}

          {dataSources.length === 0 ? (
            <div className="model-inspection-warning">
              项目还没有数据源。请先返回画布，在“数据源”中创建 REST 或 WebSocket 连接配置。
            </div>
          ) : (
            <form className="asset-data-binding-form" onSubmit={(event) => void save(event)}>
              <div className="asset-data-binding-form-heading">
                <strong>{draft.id ? "编辑指标" : "新建指标"}</strong>
                <span>只保存映射，不采集实时数据</span>
              </div>
              <label>
                <span>数据源</span>
                <select
                  disabled={formDisabled}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    dataSourceId: event.target.value,
                  }))}
                  required
                  value={draft.dataSourceId}
                >
                  <option value="">请选择数据源</option>
                  {dataSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} · {sourceTypeLabel(source)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>指标键 metricKey</span>
                <input
                  autoComplete="off"
                  disabled={formDisabled}
                  maxLength={80}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    metricKey: event.target.value,
                  }))}
                  pattern="[A-Za-z][A-Za-z0-9._:-]*"
                  placeholder="例如：temperature"
                  required
                  value={draft.metricKey}
                />
              </label>
              <label>
                <span>响应字段路径</span>
                <input
                  autoComplete="off"
                  disabled={formDisabled}
                  maxLength={256}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    sourcePath: event.target.value,
                  }))}
                  pattern={"\\$.*"}
                  placeholder="例如：$.data.temperature"
                  required
                  value={draft.sourcePath}
                />
              </label>
              <div className="asset-data-binding-grid">
                <label>
                  <span>值类型</span>
                  <select
                    disabled={formDisabled}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      valueType: event.target.value as MetricValueType,
                    }))}
                    value={draft.valueType}
                  >
                    {Object.entries(valueTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>单位（可选）</span>
                  <input
                    disabled={formDisabled}
                    maxLength={32}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      unit: event.target.value,
                    }))}
                    placeholder="例如：℃"
                    value={draft.unit}
                  />
                </label>
              </div>
              <label>
                <span>数据过期时间（秒）</span>
                <input
                  disabled={formDisabled}
                  max={86400}
                  min={1}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    staleAfterSeconds: event.target.value,
                  }))}
                  required
                  type="number"
                  value={draft.staleAfterSeconds}
                />
              </label>
              <p className="inspector-help">
                路径统一使用以 <code>$</code> 开头的 JSON 路径；同一资产内的指标键必须唯一。
              </p>
              <div className="asset-data-binding-actions">
                {draft.id ? (
                  <button
                    className="secondary-button"
                    disabled={formDisabled}
                    onClick={() => void remove()}
                    type="button"
                  >
                    删除映射
                  </button>
                ) : null}
                <button className="primary-button" disabled={formDisabled} type="submit">
                  {saving ? "保存中…" : draft.id ? "保存修改" : "创建映射"}
                </button>
              </div>
            </form>
          )}
          {saveError ? (
            <p className="inspector-inline-error" role="alert">
              指标映射错误：{saveError}
            </p>
          ) : null}
          {notice ? (
            <p className="model-asset-binding-notice" role="status">{notice}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
