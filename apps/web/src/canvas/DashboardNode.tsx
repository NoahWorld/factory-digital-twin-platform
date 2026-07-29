import { memo, type CSSProperties } from "react";
import {
  componentLabels,
  isDashboardNodeType,
  parseDashboardProps,
  type CanvasNode,
  type DashboardBaseProps,
  type ProgressListProps,
  type RadialGaugeProps,
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

const RadialGauge = ({ props }: { props: RadialGaugeProps }) => {
  const percentage = Math.min(Math.max((props.value / props.maximum) * 100, 0), 100);
  const gaugeStyle = {
    "--dashboard-progress": `${percentage}%`,
  } as CSSProperties;

  return (
    <div className="dashboard-gauge">
      <div className="dashboard-gauge-ring" style={gaugeStyle}>
        <div>
          <strong>{props.value}</strong>
          <span>{props.unit}</span>
        </div>
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
          <div>
            <span>{item.label}</span>
            <strong>{item.value}<small>{item.unit}</small></strong>
          </div>
          <span className="dashboard-progress-track">
            <i style={{ width: `${percentage}%` }} />
          </span>
        </div>
      );
    })}
  </div>
);

const StatusGrid = ({ props }: { props: StatusGridProps }) => (
  <div
    className="dashboard-status-grid"
    style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}
  >
    {props.items.map((item, index) => (
      <div className={`dashboard-status-item is-${item.tone}`} key={`${item.label}-${index}`}>
        <span>{item.label}</span>
        <strong>{item.value}</strong>
      </div>
    ))}
  </div>
);

export const DashboardNode = memo(function DashboardNode({ node }: { node: CanvasNode }) {
  if (!isDashboardNodeType(node.type)) {
    throw new Error(`DashboardNode received unsupported node type: ${node.type}`);
  }
  const parsed = parseDashboardProps(node.type, node.props);
  if (!parsed.ok) {
    return (
      <div className="dashboard-component-invalid" role="alert">
        <strong>{componentLabels[node.type]}配置无效</strong>
        <span>{parsed.message}</span>
      </div>
    );
  }

  const props = parsed.value;
  if (node.type === "metric-card" && "icon" in props) {
    return (
      <article className="dashboard-component dashboard-metric-card" style={dashboardStyle(props)}>
        <header>
          <span>{props.icon}</span>
          <strong>{props.title}</strong>
          <SampleBadge visible={props.sample} />
        </header>
        <div className="dashboard-metric-value">
          <strong>{props.value}</strong>
          {props.unit ? <span>{props.unit}</span> : null}
        </div>
        <p>{props.subtitle}</p>
      </article>
    );
  }

  return (
    <article className={`dashboard-component dashboard-${node.type}`} style={dashboardStyle(props)}>
      <header className="dashboard-component-header">
        <strong>{props.title}</strong>
        <SampleBadge visible={props.sample} />
      </header>
      {node.type === "radial-gauge" && "maximum" in props
        ? <RadialGauge props={props} />
        : node.type === "progress-list" && "items" in props
          ? <ProgressList props={props as ProgressListProps} />
          : <StatusGrid props={props as StatusGridProps} />}
    </article>
  );
});
