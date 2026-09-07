import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  componentLabels,
  isChartNodeType,
  parseChartProps,
  type CanvasNode,
  type ChartNodeType,
  type ChartProps,
} from "./types";

type ChartSize = { width: number; height: number };

const SERIES_COLORS = ["#46e3b7", "#55d8ff", "#ffbd59", "#a78bfa", "#ff6b7a", "#5aa0ff", "#7ed957", "#ff8f5c"];

const useChartSize = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const measure = () => {
      const nextSize = {
        width: Math.max(Math.round(svg.clientWidth), 0),
        height: Math.max(Math.round(svg.clientHeight), 0),
      };
      setSize((current) => current.width === nextSize.width && current.height === nextSize.height
        ? current
        : nextSize);
    };

    const observer = new ResizeObserver(() => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        measure();
      });
    });
    observer.observe(svg);
    measure();

    return () => {
      observer.disconnect();
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  return { size, svgRef };
};

const shortenLabel = (value: string, maximum: number) =>
  value.length > maximum ? `${value.slice(0, Math.max(maximum - 1, 1))}…` : value;

const buildLabelIndexes = (itemCount: number, plotWidth: number) => {
  const labelCount = Math.min(itemCount, Math.max(Math.floor(plotWidth / 56), 2));
  return new Set(
    Array.from({ length: labelCount }, (_, index) =>
      Math.round(index * (itemCount - 1) / Math.max(labelCount - 1, 1))),
  );
};

const seriesColor = (primary: string, index: number) => index === 0
  ? primary
  : SERIES_COLORS[index % SERIES_COLORS.length];

const polarPoint = (cx: number, cy: number, radius: number, angle: number) => ({
  x: cx + Math.cos(angle) * radius,
  y: cy + Math.sin(angle) * radius,
});

const pieArcPath = (
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) => {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
};

function CartesianChart({
  nodeId,
  props,
  size,
  type,
}: {
  nodeId: string;
  props: ChartProps;
  size: ChartSize;
  type: "line-chart" | "bar-chart" | "area-chart";
}) {
  const { categories, values, color } = props;
  const chartWidth = Math.max(size.width, 1);
  const chartHeight = Math.max(size.height, 1);
  const left = Math.min(42, Math.max(28, chartWidth * 0.09));
  const right = Math.min(16, Math.max(8, chartWidth * 0.03));
  const top = Math.min(14, Math.max(6, chartHeight * 0.08));
  const bottom = Math.min(24, Math.max(17, chartHeight * 0.16));
  const plotWidth = Math.max(chartWidth - left - right, 1);
  const plotHeight = Math.max(chartHeight - top - bottom, 1);
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  const range = maximum - minimum || 1;
  const yPositions = values.map((value) => top + plotHeight - ((value - minimum) / range) * plotHeight);
  const step = plotWidth / Math.max(categories.length - 1, 1);
  const linePoints = values.map((_, index) => `${left + index * step},${yPositions[index]}`).join(" ");
  const barGap = Math.min(10, Math.max(3, plotWidth / (values.length * 6)));
  const barWidth = Math.max((plotWidth - barGap * (values.length - 1)) / values.length, 2);
  const barZeroY = top + plotHeight - ((0 - minimum) / range) * plotHeight;
  const labelIndexes = buildLabelIndexes(categories.length, plotWidth);
  const labelCharacterLimit = Math.max(Math.floor((plotWidth / labelIndexes.size) / 9), 2);
  const gradientId = `area-${nodeId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const areaPoints = `${left},${top + plotHeight} ${linePoints} ${left + plotWidth},${top + plotHeight}`;

  return (
    <>
      {type === "area-chart" ? (
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.52" />
            <stop offset="100%" stopColor={color} stopOpacity="0.04" />
          </linearGradient>
        </defs>
      ) : null}
      {[0, 1, 2, 3].map((row) => {
        const y = top + (plotHeight / 3) * row;
        return <line className="chart-grid-line" key={row} x1={left} x2={left + plotWidth} y1={y} y2={y} />;
      })}
      {type === "bar-chart" ? values.map((value, index) => {
        const valueY = top + plotHeight - ((value - minimum) / range) * plotHeight;
        const height = Math.max(Math.abs(barZeroY - valueY), 1);
        return <rect fill={color} height={height} key={`${categories[index]}-${index}`} opacity={0.82 + (index / values.length) * 0.18} rx="3" width={barWidth} x={left + index * (barWidth + barGap)} y={Math.min(valueY, barZeroY)} />;
      }) : (
        <>
          {type === "area-chart" ? <polygon fill={`url(#${gradientId})`} points={areaPoints} /> : null}
          <polyline className="chart-line" fill="none" points={linePoints} stroke={color} strokeLinecap="round" strokeLinejoin="round" />
          {values.map((_, index) => <circle className="chart-point" cx={left + index * step} cy={yPositions[index]} fill="var(--canvas-theme-surface)" key={`${categories[index]}-${index}`} r="4" stroke={color} />)}
        </>
      )}
      {categories.map((category, index) => {
        if (!labelIndexes.has(index)) return null;
        const x = type === "bar-chart" ? left + index * (barWidth + barGap) + barWidth / 2 : left + index * step;
        return <text className="chart-axis-label" key={`${category}-label-${index}`} textAnchor="middle" x={x} y={chartHeight - 3}><title>{category}</title>{shortenLabel(category, labelCharacterLimit)}</text>;
      })}
    </>
  );
}

function PieChart({ props, size, type }: { props: ChartProps; size: ChartSize; type: "pie-chart" | "donut-chart" }) {
  const { categories, values, color, unit } = props;
  const chartWidth = Math.max(size.width, 1);
  const chartHeight = Math.max(size.height, 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  const hasSideLegend = chartWidth >= 300;
  const cx = hasSideLegend ? chartWidth * 0.32 : chartWidth * 0.5;
  const cy = chartHeight * (hasSideLegend ? 0.5 : 0.42);
  const radius = Math.max(Math.min(chartHeight * 0.36, chartWidth * (hasSideLegend ? 0.22 : 0.3)), 12);
  let currentAngle = -Math.PI / 2;
  const segments = values.map((value, index) => {
    const startAngle = currentAngle;
    const endAngle = currentAngle + (value / total) * Math.PI * 2;
    currentAngle = endAngle;
    return { startAngle, endAngle, value, index };
  });
  const legendRows = categories.slice(0, Math.min(categories.length, hasSideLegend ? 8 : 4));

  return (
    <>
      {segments.map((segment) => segment.value === 0 ? null : (
        <path
          d={pieArcPath(cx, cy, radius, segment.startAngle, Math.min(segment.endAngle, segment.startAngle + Math.PI * 2 - 0.0001))}
          fill={seriesColor(color, segment.index)}
          key={`${categories[segment.index]}-${segment.index}`}
          opacity={0.94}
          stroke="var(--canvas-theme-surface)"
          strokeWidth="2"
        />
      ))}
      {type === "donut-chart" ? (
        <>
          <circle cx={cx} cy={cy} fill="var(--canvas-theme-surface)" r={radius * 0.56} />
          <text className="chart-donut-total" textAnchor="middle" x={cx} y={cy - 2}>{total}</text>
          <text className="chart-donut-unit" textAnchor="middle" x={cx} y={cy + 15}>{unit || "总计"}</text>
        </>
      ) : null}
      {legendRows.map((category, index) => {
        const rowHeight = Math.min(24, chartHeight / Math.max(legendRows.length + 1, 2));
        const legendX = hasSideLegend ? chartWidth * 0.61 : chartWidth * 0.1 + (index % 2) * chartWidth * 0.46;
        const legendY = hasSideLegend
          ? chartHeight * 0.14 + index * rowHeight
          : chartHeight * 0.79 + Math.floor(index / 2) * rowHeight;
        return (
          <g key={`${category}-legend-${index}`}>
            <circle cx={legendX} cy={legendY} fill={seriesColor(color, index)} r="4" />
            <text className="chart-pie-label" x={legendX + 10} y={legendY + 4}>
              {shortenLabel(category, 8)} {Math.round(values[index] / total * 100)}%
            </text>
          </g>
        );
      })}
    </>
  );
}

function RadarChart({ props, size }: { props: ChartProps; size: ChartSize }) {
  const { categories, values, color } = props;
  const chartWidth = Math.max(size.width, 1);
  const chartHeight = Math.max(size.height, 1);
  const cx = chartWidth / 2;
  const cy = chartHeight / 2;
  const radius = Math.max(Math.min(chartWidth, chartHeight) * 0.34, 12);
  const maximum = Math.max(...values, 1);
  const angleFor = (index: number) => -Math.PI / 2 + index * Math.PI * 2 / categories.length;
  const polygon = (scale: number) => categories.map((_, index) => {
    const point = polarPoint(cx, cy, radius * scale, angleFor(index));
    return `${point.x},${point.y}`;
  }).join(" ");
  const valuePolygon = values.map((value, index) => {
    const point = polarPoint(cx, cy, radius * (value / maximum), angleFor(index));
    return `${point.x},${point.y}`;
  }).join(" ");

  return (
    <>
      {[0.25, 0.5, 0.75, 1].map((scale) => <polygon className="chart-radar-grid" key={scale} points={polygon(scale)} />)}
      {categories.map((category, index) => {
        const edge = polarPoint(cx, cy, radius, angleFor(index));
        const label = polarPoint(cx, cy, radius * 1.16, angleFor(index));
        return (
          <g key={`${category}-${index}`}>
            <line className="chart-radar-axis" x1={cx} x2={edge.x} y1={cy} y2={edge.y} />
            <text className="chart-radar-label" dominantBaseline="middle" textAnchor={label.x < cx - 2 ? "end" : label.x > cx + 2 ? "start" : "middle"} x={label.x} y={label.y}>{shortenLabel(category, 6)}</text>
          </g>
        );
      })}
      <polygon className="chart-radar-value" fill={color} points={valuePolygon} stroke={color} />
      {values.map((value, index) => {
        const point = polarPoint(cx, cy, radius * (value / maximum), angleFor(index));
        return <circle cx={point.x} cy={point.y} fill={color} key={index} r="3" />;
      })}
    </>
  );
}

const summaryValue = (type: ChartNodeType, values: number[]) => {
  if (type === "pie-chart" || type === "donut-chart") {
    return values.reduce((sum, value) => sum + value, 0);
  }
  if (type === "radar-chart") {
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return values.at(-1);
};

export const ChartNode = memo(function ChartNode({ node }: { node: CanvasNode }) {
  const { size, svgRef } = useChartSize();
  const chartType = isChartNodeType(node.type) ? node.type : null;
  const parsed = useMemo(
    () => chartType
      ? parseChartProps(chartType, node.props)
      : { ok: false as const, message: `${node.type} 不是图表组件` },
    [chartType, node.props, node.type],
  );

  if (!chartType) {
    return <div className="chart-config-error" role="alert"><strong>组件类型错误</strong><span>{node.type} 不是图表组件</span></div>;
  }

  if (!parsed.ok) {
    return <div className="chart-config-error" role="alert"><strong>{componentLabels[chartType]}配置错误</strong><span>{parsed.message}</span></div>;
  }

  const { title, values, unit } = parsed.value;
  return (
    <div className="chart-node-content">
      <header>
        <div><strong title={title}>{title}</strong></div>
        <span className="chart-node-value">{summaryValue(chartType, values)} <small>{unit}</small></span>
      </header>
      <svg aria-label={`${title}${componentLabels[chartType]}`} ref={svgRef} role="img">
        {chartType === "pie-chart" || chartType === "donut-chart"
          ? <PieChart props={parsed.value} size={size} type={chartType} />
          : chartType === "radar-chart"
            ? <RadarChart props={parsed.value} size={size} />
            : <CartesianChart nodeId={node.id} props={parsed.value} size={size} type={chartType} />}
      </svg>
    </div>
  );
});
