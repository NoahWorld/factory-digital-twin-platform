import { PersistedBoundNode } from "./PersistedBoundNode";
import { useProjectRuntimeContext } from "../project-runtime";
import { ChartNode } from "./ChartNode";
import { DashboardNode } from "./DashboardNode";
import { bindingStateLabels, resolveBinding } from "./binding-values";
import type { CanvasNode } from "./types";

export function BoundNode({ node, interactive }: { node: CanvasNode; interactive: boolean }) {
  const runtime = useProjectRuntimeContext();
  const binding = runtime?.bindings.find((item) => item.id === node.dataBindingRefs[0]);
  const title = String(node.props.title ?? "组件数据");
  const message = (text: string, state = "invalid") => <div className={`bound-node-message is-${state}`} data-binding-state={state} role="status"><strong>{title}</strong><p>{text}</p></div>;
  if (!runtime || runtime.loading) return message("正在加载数据绑定…", "loading");
  if (runtime.error) return message(runtime.error);
  if (!binding) return message(`绑定 ${node.dataBindingRefs[0]} 不存在，请在属性面板重新配置或切回静态演示。`);
  if (binding.version === 2) return <PersistedBoundNode node={node} binding={binding} interactive={interactive}/>;
  const result = resolveBinding(binding, runtime.assets, runtime.metrics, runtime.connections, runtime.selectedAssetId);
  if (result.error) return message(result.error, "empty");
  const rows = result.rows;
  const simulated = rows.some((row) => row.asset?.metadata.simulated === true);
  const badge = <span className="bound-data-badge">{simulated ? "模拟设备数据" : "设备数据"}</span>;
  const base = { ...node, props: { ...node.props, sample: false } };
  if (binding.target === "value") {
    const cell = rows[0].cells[0];
    const status = bindingStateLabels[cell.state];
    return <div className="bound-node" data-binding-state={cell.state}>
      {badge}
      <DashboardNode node={{ ...base, props: {
        ...base.props,
        value: cell.state === "live" ? cell.text.slice(0, 40) : "—",
        unit: cell.state === "live" ? cell.unit : "",
        subtitle: `${rows[0].asset?.name} · ${status}`,
      } }} />
      {cell.state !== "live" ? <p className="bound-data-error" title={cell.text}>{status}：{cell.text}</p> : null}
    </div>;
  }
  if (binding.target === "series") {
    const failed = rows.filter((row) => row.cells[0].state !== "live");
    if (failed.length) return message(failed.map((row) => `${row.asset?.name}：${bindingStateLabels[row.cells[0].state]}`).join("；"), failed[0].cells[0].state);
    return <div className="bound-node" data-binding-state="live">{badge}<ChartNode node={{ ...base, props: {
      ...base.props, categories: rows.map((row) => row.asset?.name ?? row.assetId),
      values: rows.map((row) => row.cells[0].value), unit: rows[0].cells[0].unit,
    } }} /></div>;
  }
  const failed = rows.flatMap((row) => row.cells).find((cell) => cell.state !== "live");
  return <div className="bound-node" data-binding-state={failed?.state ?? "live"}>{badge}<DashboardNode
    node={{ ...base, props: {
      ...base.props, columns: ["设备", ...binding.metrics.map((metric) => metric.metricKey), "数据状态"],
      rows: rows.map((row) => [row.asset?.name ?? row.assetId,
        ...row.cells.map((cell) => cell.state === "live" ? `${cell.text}${cell.unit ? ` ${cell.unit}` : ""}`.slice(0, 120) : "—"),
        [...new Set(row.cells.map((cell) => bindingStateLabels[cell.state]))].join(" / "),
      ]), highlightColumn: -1,
    } }}
    rowAssetIds={rows.map((row) => row.assetId)}
    onAssetSelect={interactive ? runtime.selectAsset : undefined}
    selectedAssetId={runtime.selectedAssetId}
  /></div>;
}
