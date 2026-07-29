import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { componentLabels, isChartNodeType, parseChartProps, type CanvasNode } from "./types";

type ChartSize = { width: number; height: number };

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

export const ChartNode = memo(function ChartNode({ node }: { node: CanvasNode }) {
  const parsed = useMemo(() => parseChartProps(node.props), [node.props]);
  const { size, svgRef } = useChartSize();

  if (!isChartNodeType(node.type)) {
    return <div className="chart-config-error" role="alert"><strong>组件类型错误</strong><span>{node.type} 不是图表组件</span></div>;
  }

  if (!parsed.ok) {
    return <div className="chart-config-error" role="alert"><strong>{componentLabels[node.type]}配置错误</strong><span>{parsed.message}</span></div>;
  }

  const { title, categories, values, unit, color } = parsed.value;
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
  const step = plotWidth / (categories.length - 1);
  const linePoints = values.map((_, index) => `${left + index * step},${yPositions[index]}`).join(" ");
  const barGap = Math.min(10, Math.max(3, plotWidth / (values.length * 6)));
  const barWidth = Math.max((plotWidth - barGap * (values.length - 1)) / values.length, 2);
  const barZeroY = top + plotHeight - ((0 - minimum) / range) * plotHeight;
  const labelIndexes = buildLabelIndexes(categories.length, plotWidth);
  const labelCharacterLimit = Math.max(Math.floor((plotWidth / labelIndexes.size) / 9), 2);

  return (
    <div className="chart-node-content">
      <header>
        <div><span className="chart-node-kicker">{componentLabels[node.type]}</span><strong title={title}>{title}</strong></div>
        <span className="chart-node-value">{values.at(-1)} <small>{unit}</small></span>
      </header>
      <svg aria-label={`${title}${componentLabels[node.type]}`} ref={svgRef} role="img">
        {[0, 1, 2, 3].map((row) => {
          const y = top + (plotHeight / 3) * row;
          return <line className="chart-grid-line" key={row} x1={left} x2={left + plotWidth} y1={y} y2={y} />;
        })}
        {node.type === "line-chart" ? (
          <>
            <polyline className="chart-line" fill="none" points={linePoints} stroke={color} strokeLinecap="round" strokeLinejoin="round" />
            {values.map((_, index) => <circle className="chart-point" cx={left + index * step} cy={yPositions[index]} fill="var(--canvas-theme-surface)" key={`${categories[index]}-${index}`} r="4" stroke={color} />)}
          </>
        ) : values.map((value, index) => {
          const valueY = top + plotHeight - ((value - minimum) / range) * plotHeight;
          const height = Math.max(Math.abs(barZeroY - valueY), 1);
          return <rect fill={color} height={height} key={`${categories[index]}-${index}`} opacity={0.82 + (index / values.length) * 0.18} rx="3" width={barWidth} x={left + index * (barWidth + barGap)} y={Math.min(valueY, barZeroY)} />;
        })}
        {categories.map((category, index) => {
          if (!labelIndexes.has(index)) return null;
          const x = node.type === "line-chart" ? left + index * step : left + index * (barWidth + barGap) + barWidth / 2;
          return <text className="chart-axis-label" key={`${category}-label-${index}`} textAnchor="middle" x={x} y={chartHeight - 3}><title>{category}</title>{shortenLabel(category, labelCharacterLimit)}</text>;
        })}
      </svg>
    </div>
  );
});
