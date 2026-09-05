import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  isBasicNodeType,
  isChartNodeType,
  isDashboardNodeType,
  isDecorationNodeType,
  isModel3DNodeType,
  isShapeNodeType,
  parseBasicProps,
  parseChartProps,
  parseDashboardProps,
  parseDecorationProps,
  parseModel3DProps,
  parseShapeProps,
  type CanvasNode,
  type ChartProps,
  type ProgressListProps,
  type RadialGaugeProps,
  type StatusGridProps,
} from "./types";
import { getCanvasTemplate, instantiateCanvasTemplate, type CanvasTemplateId } from "./templates";

type PreviewStyle = CSSProperties & {
  "--preview-accent"?: string;
  "--preview-border"?: string;
  "--preview-surface"?: string;
  "--preview-text"?: string;
  "--preview-progress"?: string;
};

type CanvasTemplatePreviewProps = {
  className?: string;
  templateId: CanvasTemplateId;
};

const nodePosition = (node: CanvasNode): CSSProperties => ({
  left: `${(node.x / 1920) * 100}%`,
  top: `${(node.y / 1080) * 100}%`,
  width: `${(node.width / 1920) * 100}%`,
  height: `${(node.height / 1080) * 100}%`,
  zIndex: node.zIndex,
});

const invalidNode = (node: CanvasNode, message: string) => (
  <div className="template-canvas-node-error" role="alert">
    {node.type}: {message}
  </div>
);

const padTimePart = (value: number) => String(value).padStart(2, "0");

function previewDateTime(showDate: boolean, showSeconds: boolean) {
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), ...(showSeconds ? [now.getSeconds()] : [])]
    .map(padTimePart)
    .join(":");
  const date = showDate
    ? `${now.getFullYear()}-${padTimePart(now.getMonth() + 1)}-${padTimePart(now.getDate())}`
    : "";
  return { date, time };
}

function PreviewChart({ props, type }: { props: ChartProps; type: "line-chart" | "bar-chart" }) {
  const minimum = Math.min(...props.values, 0);
  const maximum = Math.max(...props.values, 1);
  const range = maximum - minimum || 1;
  const points = props.values.map((value, index) => {
    const x = props.values.length === 1 ? 50 : (index / (props.values.length - 1)) * 96 + 2;
    const y = 44 - ((value - minimum) / range) * 38;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="template-preview-chart">
      <header><span>{props.title}</span><strong>{props.values.at(-1)}{props.unit}</strong></header>
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 48">
        <line x1="1" x2="99" y1="44" y2="44" />
        <line x1="1" x2="99" y1="25" y2="25" />
        <line x1="1" x2="99" y1="6" y2="6" />
        {type === "line-chart" ? (
          <polyline fill="none" points={points} stroke={props.color} strokeLinecap="round" strokeLinejoin="round" />
        ) : props.values.map((value, index) => {
          const barWidth = 76 / props.values.length;
          const height = Math.max(((value - minimum) / range) * 38, 2);
          return (
            <rect
              fill={props.color}
              height={height}
              key={`${props.categories[index]}-${index}`}
              opacity={0.72 + index / props.values.length / 4}
              rx="1"
              width={barWidth}
              x={12 + index * (76 / props.values.length) + 1}
              y={44 - height}
            />
          );
        })}
      </svg>
    </div>
  );
}

function PreviewDashboard({ node }: { node: CanvasNode }) {
  if (!isDashboardNodeType(node.type)) {
    throw new Error(`PreviewDashboard received unsupported node type: ${node.type}`);
  }
  const parsed = parseDashboardProps(node.type, node.props);
  if (!parsed.ok) return invalidNode(node, parsed.message);
  const props = parsed.value;
  const style: PreviewStyle = {
    "--preview-accent": props.accentColor,
    "--preview-border": props.borderColor,
    "--preview-surface": props.fillColor,
    "--preview-text": props.textColor,
  };

  if (node.type === "metric-card" && "value" in props) {
    return (
      <div className="template-preview-metric-card" style={style}>
        <span>{props.title}</span>
        <strong>{props.value}<small>{props.unit}</small></strong>
        <i>{props.subtitle}</i>
      </div>
    );
  }

  if (node.type === "radial-gauge" && "maximum" in props) {
    const gauge = props as RadialGaugeProps;
    const percentage = Math.min(Math.max((gauge.value / gauge.maximum) * 100, 0), 100);
    return (
      <div className="template-preview-dashboard" style={style}>
        <span>{gauge.title}</span>
        <div className="template-preview-gauge" style={{ "--preview-progress": `${percentage}%` } as PreviewStyle}>
          <strong>{gauge.value}<small>{gauge.unit}</small></strong>
        </div>
      </div>
    );
  }

  if (node.type === "progress-list" && "items" in props) {
    const progressProps = props as ProgressListProps;
    return (
      <div className="template-preview-dashboard" style={style}>
        <span>{progressProps.title}</span>
        <div className="template-preview-progress-list">
          {progressProps.items.slice(0, 4).map((item, index) => (
            <div key={`${item.label}-${index}`}>
              <small>{item.label}</small>
              <i><b style={{ width: `${Math.min(Math.max(item.value / item.maximum * 100, 0), 100)}%` }} /></i>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const statusProps = props as StatusGridProps;
  return (
    <div className="template-preview-dashboard" style={style}>
      <span>{statusProps.title}</span>
      <div className="template-preview-status-grid" style={{ gridTemplateColumns: `repeat(${statusProps.columns}, 1fr)` }}>
        {statusProps.items.slice(0, 6).map((item, index) => (
          <i className={`is-${item.tone}`} key={`${item.label}-${index}`} title={`${item.label}：${item.value}`} />
        ))}
      </div>
    </div>
  );
}

function renderNode(node: CanvasNode): ReactNode {
  if (isShapeNodeType(node.type)) {
    const parsed = parseShapeProps(node.props);
    if (!parsed.ok) return invalidNode(node, parsed.message);
    return (
      <div
        className={`template-preview-shape is-${node.type}`}
        style={{
          background: parsed.value.fillColor,
          borderColor: parsed.value.borderColor,
          borderRadius: node.type === "circle" ? "50%" : `${parsed.value.borderRadius / 19.2}cqw`,
          borderWidth: parsed.value.borderWidth ? "1px" : 0,
          opacity: parsed.value.opacity,
        }}
      />
    );
  }

  if (isDecorationNodeType(node.type)) {
    const parsed = parseDecorationProps(node.type, node.props);
    if (!parsed.ok) return invalidNode(node, parsed.message);
    const props = parsed.value;
    const style: PreviewStyle = {
      "--preview-accent": props.accentColor,
      "--preview-border": props.borderColor,
      "--preview-surface": props.fillColor,
      "--preview-text": props.textColor,
      opacity: props.opacity,
    };
    if (node.type === "screen-title") {
      return <div className="template-preview-screen-title" style={style}><strong>{props.text}</strong><small>{props.subtitle}</small></div>;
    }
    if (node.type === "datetime") {
      const { date, time } = previewDateTime(props.showDate, props.showSeconds);
      return <div className="template-preview-datetime" style={style}><strong>{time}</strong>{date ? <small>{date}</small> : null}</div>;
    }
    return <div className={`template-preview-decoration is-${node.type}`} style={style}>{props.text}</div>;
  }

  if (isChartNodeType(node.type)) {
    const parsed = parseChartProps(node.props);
    if (!parsed.ok) return invalidNode(node, parsed.message);
    return <PreviewChart props={parsed.value} type={node.type} />;
  }

  if (isDashboardNodeType(node.type)) return <PreviewDashboard node={node} />;

  if (isModel3DNodeType(node.type)) {
    const parsed = parseModel3DProps(node.props);
    if (!parsed.ok) return invalidNode(node, parsed.message);
    return (
      <div className="template-preview-model" style={{ background: parsed.value.backgroundColor }}>
        <div><i /><i /><i /><i /></div>
        <span>{node.resourceRefs.length ? "3D 场景" : "3D 模型区"}</span>
      </div>
    );
  }

  if (isBasicNodeType(node.type)) {
    const parsed = parseBasicProps(node.type, node.props);
    if (!parsed.ok) return invalidNode(node, parsed.message);
    const props = parsed.value;
    const label = "text" in props
      ? props.text
      : "label" in props
        ? props.label
        : "title" in props
          ? props.title
          : node.type === "carousel"
            ? "轮播图"
            : "图片";
    return <div className={`template-preview-basic is-${node.type}`}>{label}</div>;
  }

  throw new Error(`Unsupported canvas template preview node: ${node.type}`);
}

export function CanvasTemplatePreview({ className = "", templateId }: CanvasTemplatePreviewProps) {
  const template = getCanvasTemplate(templateId);
  const nodes = useMemo(() => instantiateCanvasTemplate(templateId, []), [templateId]);

  return (
    <div
      aria-label={`${template.name}真实画布缩略预览`}
      className={`template-canvas-preview${className ? ` ${className}` : ""}`}
      role="img"
      style={{
        "--preview-accent": template.canvasTheme.accentColor,
        "--preview-border": template.canvasTheme.borderColor,
        "--preview-surface": template.canvasTheme.surfaceColor,
        "--preview-text": template.canvasTheme.textColor,
        backgroundColor: template.canvasTheme.backgroundColor,
      } as PreviewStyle}
    >
      {nodes.map((node) => (
        <div className={`template-canvas-preview-node is-${node.type}`} key={node.id} style={nodePosition(node)}>
          {renderNode(node)}
        </div>
      ))}
    </div>
  );
}
