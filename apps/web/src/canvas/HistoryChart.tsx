import { useChartSize } from "./ChartNode";
import type { HistorySeries,HistoryPoint } from "../../../../shared/history-series";
import type { CanvasNode } from "./types";
const format = (value:number) => value !== 0 && (Math.abs(value)>=1e8 || Math.abs(value)<0.001) ? value.toExponential(2):Number(value.toPrecision(6)).toLocaleString("zh-CN");
export function HistoryChart({ node,series,unit }:{ node:CanvasNode;series:HistorySeries;unit:string|null }) {
  const { size,svgRef } = useChartSize(),width = Math.max(size.width,120),height = Math.max(size.height,100),left = Math.min(64,width*.25),right = width-12,top = 12,bottom = height-29;
  const values = series.points.filter((point) => point.quality === "good" && point.value !== null && point.unit === unit).map((point) => point.value!);
  const amplitude = Math.max(...values.map(Math.abs),0) || 1,min = Math.min(0,...values.map((value) => value/amplitude)),maximum = Math.max(0,...values.map((value) => value/amplitude)),max = maximum === min ? min+1:maximum;
  const from = Date.parse(series.from),to = Date.parse(series.to),x = (point:HistoryPoint) => left+(Date.parse(point.at)-from)/(to-from)*(right-left),y = (value:number) => bottom-(value/amplitude-min)/(max-min)*(bottom-top);
  const segments:HistoryPoint[][] = [];let segment:HistoryPoint[] = [];
  for (const point of series.points) {
    if (point.quality !== "good" || point.value === null || point.unit !== unit) { if (segment.length) segments.push(segment);segment = [];continue; }
    if (segment.length && segment.at(-1)!.configRevision !== point.configRevision) { segments.push(segment);segment = []; }
    segment.push(point);
  }
  if (segment.length) segments.push(segment);
  const last = series.points.at(-1),lastValue = last?.quality === "good" && last.unit === unit ? last.value:null;
  const color = typeof node.props.color === "string" && /^#[a-f\d]{6}$/i.test(node.props.color) ? node.props.color:"#55d8ff",title = String(node.props.title ?? "历史曲线"),aggregation = { avg:"均值",min:"最小值",max:"最大值",last:"末次值" }[series.aggregation];
  const time = (value:number) => new Date(value).toLocaleTimeString("zh-CN",{ hour:"2-digit",minute:"2-digit",...(to-from<=300000 ? { second:"2-digit" as const }:{}) });
  return <div className="chart-node-content history-chart-content"><header><div><span className="chart-node-kicker">历史 · {aggregation}</span><strong>{title}</strong></div><span className="chart-node-value">{lastValue === null || lastValue === undefined ? "—":format(lastValue)} <small>{unit ?? ""}</small></span></header>
    <svg ref={svgRef} role="img" aria-label={`${title}历史曲线`} viewBox={`0 0 ${width} ${height}`}>
      {Array.from({ length:5 },(_,index) => { const yy = top+(bottom-top)*index/4,value = (max-(max-min)*index/4)*amplitude;return <g key={index}><line x1={left} x2={right} y1={yy} y2={yy} stroke="currentColor" opacity="0.14"/><text x={left-6} y={yy+4} textAnchor="end" fill="currentColor" fontSize="10">{format(value)}</text></g>; })}
      {segments.map((points,index) => { const path = points.map((point) => `${x(point)},${y(point.value!)}`).join(" ");return <g key={index}>{node.type === "area-chart" && points.length>1 ? <polygon points={`${x(points[0])},${bottom} ${path} ${x(points.at(-1)!)},${bottom}`} fill={color} opacity="0.15"/>:null}<polyline data-history-segment="true" points={path} fill="none" stroke={color} strokeWidth="2"/>{points.map((point) => <circle data-history-value={point.value} key={point.at} cx={x(point)} cy={y(point.value!)} r="2.5" fill={color}><title>{time(Date.parse(point.at))} · {format(point.value!)} {unit ?? ""} · {point.count}个样本 · 配置修订{point.configRevision}</title></circle>)}</g>; })}
      {Array.from({ length:width>400 ? 5:3 },(_,index) => { const slots = width>400 ? 4:2,at = from+(to-from)*index/slots;return <text key={index} x={left+(right-left)*index/slots} y={height-7} textAnchor={index === 0 ? "start":index === slots ? "end":"middle"} fill="currentColor" fontSize="10">{time(at)}</text>; })}
      {!values.length ? <text x={(left+right)/2} y={(top+bottom)/2} textAnchor="middle" fill="currentColor" fontSize="12">此范围暂无可绘制的有效样本</text>:null}
    </svg><p className="history-chart-caption">采集时间 · {values.length}/{series.points.length}个有效点 · 空缺、质量、单位或配置变化处断开</p>
  </div>;
}
