import { memo, useMemo } from "react";
import { componentLabels, parseChartProps, type CanvasNode } from "./types";

const LEFT = 38;
const TOP = 18;
const WIDTH = 300;
const HEIGHT = 126;

const scaleValues = (values: number[]) => {
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  const range = maximum - minimum || 1;
  return values.map((value) => TOP + HEIGHT - ((value - minimum) / range) * HEIGHT);
};

export const ChartNode = memo(function ChartNode({ node }: { node: CanvasNode }) {
  const parsed = useMemo(() => parseChartProps(node.props), [node.props]);

  if (!parsed.ok) {
    return <div className="chart-config-error" role="alert"><strong>{componentLabels[node.type]}配置错误</strong><span>{parsed.message}</span></div>;
  }

  const { title, categories, values, unit, color } = parsed.value;
  const yPositions = scaleValues(values);
  const step = WIDTH / (categories.length - 1);
  const linePoints = values.map((_, index) => `${LEFT + index * step},${yPositions[index]}`).join(" ");
  const barGap = 8;
  const barWidth = Math.max((WIDTH - barGap * (values.length - 1)) / values.length, 4);
  const barMinimum = Math.min(...values, 0);
  const barMaximum = Math.max(...values, 0);
  const barRange = barMaximum - barMinimum || 1;
  const barZeroY = TOP + HEIGHT - ((0 - barMinimum) / barRange) * HEIGHT;

  return (
    <div className="chart-node-content">
      <header>
        <div><span className="chart-node-kicker">{componentLabels[node.type]}</span><strong>{title}</strong></div>
        <span className="chart-node-value">{values.at(-1)} <small>{unit}</small></span>
      </header>
      <svg aria-label={`${title}${componentLabels[node.type]}`} preserveAspectRatio="none" role="img" viewBox="0 0 360 170">
        {[0, 1, 2, 3].map((row) => {
          const y = TOP + (HEIGHT / 3) * row;
          return <line className="chart-grid-line" key={row} x1={LEFT} x2={LEFT + WIDTH} y1={y} y2={y} />;
        })}
        {node.type === "line-chart" ? (
          <>
            <polyline fill="none" points={linePoints} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
            {values.map((_, index) => <circle cx={LEFT + index * step} cy={yPositions[index]} fill="#0c1d2c" key={`${categories[index]}-${index}`} r="4" stroke={color} strokeWidth="2" />)}
          </>
        ) : values.map((value, index) => {
          const valueY = TOP + HEIGHT - ((value - barMinimum) / barRange) * HEIGHT;
          const height = Math.max(Math.abs(barZeroY - valueY), 1);
          return <rect fill={color} height={height} key={`${categories[index]}-${index}`} opacity={0.82 + (index / values.length) * 0.18} rx="3" width={barWidth} x={LEFT + index * (barWidth + barGap)} y={Math.min(valueY, barZeroY)} />;
        })}
        {categories.map((category, index) => {
          const x = node.type === "line-chart" ? LEFT + index * step : LEFT + index * (barWidth + barGap) + barWidth / 2;
          return <text className="chart-axis-label" key={`${category}-label-${index}`} textAnchor="middle" x={x} y="163">{category}</text>;
        })}
      </svg>
    </div>
  );
});
