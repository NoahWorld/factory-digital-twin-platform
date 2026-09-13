import { memo, type CSSProperties, type ReactNode } from "react";
import {
  componentLabels,
  isDashboardNodeType,
  parseDashboardProps,
  type AlarmListProps,
  type CanvasNode,
  type DashboardBaseProps,
  type DataTableProps,
  type EventTimelineProps,
  type ProgressListProps,
  type RadialGaugeProps,
  type RankingListProps,
  type StatusGridProps,
} from "./types";

type DashboardStyle = CSSProperties & {
  "--dashboard-accent": string;
  "--dashboard-border": string;
  "--dashboard-fill": string;
  "--dashboard-text": string;
};

const dashboardStyle = (props: DashboardBaseProps): DashboardStyle => ({
  "--dashboard-accent": props.accentColor,
  "--dashboard-border": props.borderColor,
  "--dashboard-fill": props.fillColor,
  "--dashboard-text": props.textColor,
});

const SampleBadge = ({ visible }: { visible: boolean }) =>
  visible ? <span className="dashboard-sample-badge">示例数据</span> : null;

const toneLabel = {
  normal: "正常",
  warning: "预警",
  danger: "严重",
  offline: "失联",
} as const;

const RadialGauge = ({ props }: { props: RadialGaugeProps }) => {
  const percentage = Math.min(Math.max((props.value / props.maximum) * 100, 0), 100);
  const gaugeStyle = { "--dashboard-progress": `${percentage}%` } as CSSProperties;

  return (
    <div className="dashboard-gauge">
      <div className="dashboard-gauge-ring" style={gaugeStyle}>
        <div><strong>{props.value}</strong><span>{props.unit}</span></div>
      </div>
      <p>{props.subtitle}</p>
    </div>
  );
};

const ProgressList = ({ props }: { props: ProgressListProps }) => (
  <div className="dashboard-progress-list">
    {props.items.map((item, index) => {
      const percentage = Math.min(Math.max((item.value / item.maximum) * 100, 0), 100);
      return (
        <div className="dashboard-progress-row" key={`${item.label}-${index}`}>
          <div><span>{item.label}</span><strong>{item.value}<small>{item.unit}</small></strong></div>
          <span className="dashboard-progress-track"><i style={{ width: `${percentage}%` }} /></span>
        </div>
      );
    })}
  </div>
);

const StatusGrid = ({ props }: { props: StatusGridProps }) => (
  <div className="dashboard-status-grid" style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}>
    {props.items.map((item, index) => (
      <div className={`dashboard-status-item is-${item.tone}`} key={`${item.label}-${index}`}>
        <span>{item.label}</span><strong>{item.value}</strong>
      </div>
    ))}
  </div>
);

const RankingList = ({ props }: { props: RankingListProps }) => {
  const maximum = Math.max(...props.items.map((item) => item.value), 1);
  return (
    <ol className="dashboard-ranking-list">
      {props.items.map((item, index) => (
        <li key={`${item.label}-${index}`}>
          <span className={`dashboard-rank-index is-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
          <div>
            <span><strong>{item.label}</strong><em className={`is-${item.trend}`}>{item.trend === "up" ? "↑" : item.trend === "down" ? "↓" : "—"}</em></span>
            <i><b style={{ width: `${Math.max(item.value / maximum * 100, 2)}%` }} /></i>
          </div>
          <strong>{item.value.toLocaleString()}<small>{item.unit}</small></strong>
        </li>
      ))}
    </ol>
  );
};

const AlarmList = ({ props,rowAssetIds,onAssetSelect }: { props: AlarmListProps } & TableInteraction) => (
  <div className="dashboard-alarm-list">
    {props.items.map((item, index) => (
      <div className={`dashboard-alarm-row is-${item.tone}`} data-alarm-label={"label" in item && typeof item.label === "string" ? item.label:undefined} key={`${item.time}-${item.source}-${index}`}>
        <i aria-hidden="true" />
        <time>{item.time}</time>
        <div><strong>{rowAssetIds?.[index] && onAssetSelect ? <button type="button" className="dashboard-asset-select" aria-label={`选择告警设备 ${rowAssetIds[index]}`} onClick={() => onAssetSelect(rowAssetIds[index])}>{item.source}</button>:item.source}</strong><span title={item.message}>{item.message}</span></div>
        <em>{"label" in item && typeof item.label === "string" ? item.label:toneLabel[item.tone]}</em>
      </div>
    ))}
  </div>
);

type TableInteraction = { rowAssetIds?: string[]; onAssetSelect?: (assetId: string) => void; selectedAssetId?: string | null };
const DataTable = ({ props, rowAssetIds, onAssetSelect, selectedAssetId }: { props: DataTableProps } & TableInteraction) => (
  <div className="dashboard-table-wrap">
    <table className="dashboard-data-table">
      <thead><tr>{props.columns.map((column, index) => <th className={index === props.highlightColumn ? "is-highlight" : undefined} key={`${column}-${index}`}>{column}</th>)}</tr></thead>
      <tbody>
        {props.rows.map((row, rowIndex) => (
          <tr key={rowAssetIds?.[rowIndex] ?? rowIndex} data-asset-id={rowAssetIds?.[rowIndex]} className={rowAssetIds?.[rowIndex] === selectedAssetId ? "is-selected" : undefined}>
            {row.map((cell, columnIndex) => <td className={columnIndex === props.highlightColumn ? "is-highlight" : undefined} key={columnIndex}>
              {columnIndex === 0 && rowAssetIds?.[rowIndex] && onAssetSelect
                ? <button className="dashboard-asset-select" aria-label={`选择设备 ${rowAssetIds[rowIndex]}`} aria-pressed={rowAssetIds[rowIndex] === selectedAssetId} onClick={() => onAssetSelect(rowAssetIds[rowIndex])} type="button">{cell}</button>
                : cell}
            </td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const EventTimeline = ({ props }: { props: EventTimelineProps }) => (
  <ol className="dashboard-event-timeline">
    {props.items.map((item, index) => (
      <li className={`is-${item.tone}`} key={`${item.time}-${item.title}-${index}`}>
        <time>{item.time}</time><i aria-hidden="true" />
        <div><strong>{item.title}</strong><span>{item.detail}</span></div>
      </li>
    ))}
  </ol>
);

const dashboardBody = (node: CanvasNode, props: DashboardBaseProps, interaction: TableInteraction): ReactNode => {
  switch (node.type) {
    case "radial-gauge": return <RadialGauge props={props as RadialGaugeProps} />;
    case "progress-list": return <ProgressList props={props as ProgressListProps} />;
    case "status-grid": return <StatusGrid props={props as StatusGridProps} />;
    case "ranking-list": return <RankingList props={props as RankingListProps} />;
    case "alarm-list": return <AlarmList props={props as AlarmListProps} {...interaction} />;
    case "data-table": return <DataTable props={props as DataTableProps} {...interaction} />;
    case "event-timeline": return <EventTimeline props={props as EventTimelineProps} />;
    default: throw new Error(`DashboardNode body received unsupported node type: ${node.type}`);
  }
};

export const DashboardNode = memo(function DashboardNode({ node,alarmItems,...interaction }: { node:CanvasNode;alarmItems?:AlarmListProps["items"] } & TableInteraction) {
  if (!isDashboardNodeType(node.type)) {
    throw new Error(`DashboardNode received unsupported node type: ${node.type}`);
  }
  const parsed = parseDashboardProps(node.type, node.props);
  if (!parsed.ok) {
    return (
      <div className="dashboard-component-invalid" role="alert">
        <strong>{componentLabels[node.type]}配置无效</strong><span>{parsed.message}</span>
      </div>
    );
  }

  const props = node.type === "alarm-list" && alarmItems ? { ...parsed.value,items:alarmItems }:parsed.value;
  if (node.type === "metric-card") {
    const metric = props as import("./types").MetricCardProps;
    return (
      <article className="dashboard-component dashboard-metric-card" style={dashboardStyle(metric)}>
        <header><span>{metric.icon}</span><strong>{metric.title}</strong><SampleBadge visible={metric.sample} /></header>
        <div className="dashboard-metric-value"><strong>{metric.value}</strong>{metric.unit ? <span>{metric.unit}</span> : null}</div>
        <p>{metric.subtitle}</p>
      </article>
    );
  }

  return (
    <article className={`dashboard-component dashboard-${node.type}`} style={dashboardStyle(props)}>
      <header className="dashboard-component-header"><strong>{props.title}</strong><SampleBadge visible={props.sample} /></header>
      {dashboardBody(node, props, interaction)}
    </article>
  );
});
