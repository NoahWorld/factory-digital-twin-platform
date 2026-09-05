import {
  type BasicAppearanceProps,
  type AlarmListProps,
  type ButtonProps,
  type CanvasDocument,
  type CanvasNode,
  type CarouselProps,
  type ChartProps,
  type CheckboxGroupProps,
  type DashboardBaseProps,
  type DataTableProps,
  type DecorationProps,
  type ImageProps,
  type MetricCardProps,
  type Model3DProps,
  type PanelFrameProps,
  type PlainTextProps,
  type RadioGroupProps,
  type ProgressListProps,
  type RankingListProps,
  type SelectProps,
  type ShapeProps,
  type SwitchProps,
  type StatusGridProps,
  type TextLinkProps,
  type EventTimelineProps,
} from "./canvas";

const COVER_WIDTH = 480;
const COVER_HEIGHT = 270;
const MAX_RENDERED_NODES = 160;

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);

const truncate = (value: string, maximumLength: number): string =>
  value.length > maximumLength ? `${value.slice(0, Math.max(0, maximumLength - 1))}…` : value;

const safeColor = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const scaledBox = (node: CanvasNode, canvas: CanvasDocument) => {
  const scaleX = COVER_WIDTH / canvas.width;
  const scaleY = COVER_HEIGHT / canvas.height;
  return {
    x: finite(node.x) * scaleX,
    y: finite(node.y) * scaleY,
    width: Math.max(1, finite(node.width, 1) * scaleX),
    height: Math.max(1, finite(node.height, 1) * scaleY),
  };
};

const panel = (
  node: CanvasNode,
  canvas: CanvasDocument,
  fill: string,
  border: string,
  opacity = 0.94,
): string => {
  const box = scaledBox(node, canvas);
  const radius = Math.min(10, Math.max(0, canvas.theme.panelRadius * 0.25));
  return `<rect x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" width="${box.width.toFixed(2)}" height="${box.height.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${fill}" fill-opacity="${Math.min(Math.max(opacity, 0), 1).toFixed(2)}" stroke="${border}" stroke-width="0.8"/>`;
};

const renderPanelFrame = (node: CanvasNode, canvas: CanvasDocument): string => {
  const props = node.props as PanelFrameProps;
  const box = scaledBox(node, canvas);
  const fill = safeColor(props.fillColor, canvas.theme.surfaceColor);
  const border = safeColor(props.borderColor, canvas.theme.borderColor);
  const accent = safeColor(props.accentColor, canvas.theme.accentColor);
  const text = safeColor(props.textColor, canvas.theme.textColor);
  const corner = Math.min(box.width / 3, box.height / 3, Math.max(3, props.cornerSize * COVER_WIDTH / canvas.width));
  const headerHeight = Math.min(box.height, props.headerHeight * COVER_HEIGHT / canvas.height);
  const outline = panel(node, canvas, fill, border, props.opacity);
  const corners = props.style === "corners" || props.style === "neon"
    ? [
        `M ${box.x.toFixed(2)} ${(box.y + corner).toFixed(2)} V ${box.y.toFixed(2)} H ${(box.x + corner).toFixed(2)}`,
        `M ${(box.x + box.width - corner).toFixed(2)} ${box.y.toFixed(2)} H ${(box.x + box.width).toFixed(2)} V ${(box.y + corner).toFixed(2)}`,
        `M ${box.x.toFixed(2)} ${(box.y + box.height - corner).toFixed(2)} V ${(box.y + box.height).toFixed(2)} H ${(box.x + corner).toFixed(2)}`,
        `M ${(box.x + box.width - corner).toFixed(2)} ${(box.y + box.height).toFixed(2)} H ${(box.x + box.width).toFixed(2)} V ${(box.y + box.height - corner).toFixed(2)}`,
      ].map((path) => `<path d="${path}" fill="none" stroke="${accent}" stroke-width="1.8"/>`).join("")
    : "";
  const header = props.showHeader ? [
    `<rect x="${(box.x + 7).toFixed(2)}" y="${(box.y + 7).toFixed(2)}" width="2" height="${Math.max(4, headerHeight - 14).toFixed(2)}" fill="${accent}"/>`,
    `<text x="${(box.x + 14).toFixed(2)}" y="${(box.y + Math.max(12, headerHeight * 0.5)).toFixed(2)}" fill="${text}" font-size="7" font-weight="700">${escapeXml(truncate(props.title, 34))}</text>`,
    `<line x1="${(box.x + 14).toFixed(2)}" x2="${(box.x + box.width - 7).toFixed(2)}" y1="${(box.y + headerHeight).toFixed(2)}" y2="${(box.y + headerHeight).toFixed(2)}" stroke="${border}" stroke-width="0.8"/>`,
  ].join("") : "";
  return outline + corners + header;
};

const renderShape = (node: CanvasNode, canvas: CanvasDocument): string => {
  const props = node.props as ShapeProps;
  const box = scaledBox(node, canvas);
  const fill = safeColor(props.fillColor, canvas.theme.surfaceColor);
  const border = safeColor(props.borderColor, canvas.theme.borderColor);
  const opacity = Math.min(Math.max(finite(props.opacity, 1), 0), 1);
  const strokeWidth = Math.min(Math.max(finite(props.borderWidth, 0) * 0.25, 0), 4);

  if (node.type === "circle") {
    return `<ellipse cx="${(box.x + box.width / 2).toFixed(2)}" cy="${(box.y + box.height / 2).toFixed(2)}" rx="${(box.width / 2).toFixed(2)}" ry="${(box.height / 2).toFixed(2)}" fill="${fill}" fill-opacity="${opacity.toFixed(2)}" stroke="${border}" stroke-width="${strokeWidth.toFixed(2)}"/>`;
  }

  const radius = Math.min(Math.max(finite(props.borderRadius, 0) * 0.25, 0), 12);
  return `<rect x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" width="${box.width.toFixed(2)}" height="${box.height.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${fill}" fill-opacity="${opacity.toFixed(2)}" stroke="${border}" stroke-width="${strokeWidth.toFixed(2)}"/>`;
};

const renderChart = (node: CanvasNode, canvas: CanvasDocument): string => {
  const props = node.props as ChartProps;
  const box = scaledBox(node, canvas);
  const color = safeColor(props.color, canvas.theme.accentColor);
  const contentX = box.x + 8;
  const contentY = box.y + 18;
  const contentWidth = Math.max(1, box.width - 16);
  const contentHeight = Math.max(1, box.height - 26);
  const values = props.values.slice(0, 16);
  const maximum = Math.max(...values.map((value) => Math.abs(finite(value))), 1);

  let marks: string;
  if (node.type === "bar-chart") {
    marks = values.map((value, index) => {
      const slot = contentWidth / Math.max(values.length, 1);
      const height = Math.max(1, Math.abs(finite(value)) / maximum * contentHeight);
      return `<rect x="${(contentX + slot * index + slot * 0.2).toFixed(2)}" y="${(contentY + contentHeight - height).toFixed(2)}" width="${Math.max(1, slot * 0.6).toFixed(2)}" height="${height.toFixed(2)}" rx="1" fill="${color}" fill-opacity="0.86"/>`;
    }).join("");
  } else if (node.type === "pie-chart" || node.type === "donut-chart") {
    const total = Math.max(values.reduce((sum, value) => sum + Math.max(finite(value), 0), 0), 1);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height * 0.58;
    const radius = Math.max(3, Math.min(box.width, box.height) * 0.2);
    const circumference = Math.PI * 2 * radius;
    let offset = 0;
    const colors = [color, "#55d8ff", "#ffbd59", "#a78bfa", "#ff6b7a", "#5aa0ff"];
    marks = values.map((value, index) => {
      const length = Math.max(finite(value), 0) / total * circumference;
      const circle = `<circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${radius.toFixed(2)}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="${(node.type === "pie-chart" ? radius : radius * 0.42).toFixed(2)}" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${centerX.toFixed(2)} ${centerY.toFixed(2)})"/>`;
      offset += length;
      return circle;
    }).join("");
  } else if (node.type === "radar-chart") {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height * 0.58;
    const radius = Math.max(4, Math.min(box.width, box.height) * 0.24);
    const points = values.map((value, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
      const valueRadius = Math.abs(finite(value)) / maximum * radius;
      return `${(centerX + Math.cos(angle) * valueRadius).toFixed(2)},${(centerY + Math.sin(angle) * valueRadius).toFixed(2)}`;
    }).join(" ");
    marks = `<polygon points="${points}" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="1.5"/>`;
  } else {
    const points = values.map((value, index) => {
      const x = contentX + (values.length <= 1 ? 0 : index / (values.length - 1) * contentWidth);
      const y = contentY + contentHeight - Math.abs(finite(value)) / maximum * contentHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    marks = `${node.type === "area-chart" ? `<polygon points="${contentX.toFixed(2)},${(contentY + contentHeight).toFixed(2)} ${points} ${(contentX + contentWidth).toFixed(2)},${(contentY + contentHeight).toFixed(2)}" fill="${color}" fill-opacity="0.2"/>` : ""}<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  return [
    panel(node, canvas, canvas.theme.surfaceColor, canvas.theme.borderColor),
    `<text x="${(box.x + 8).toFixed(2)}" y="${(box.y + 12).toFixed(2)}" fill="${canvas.theme.textColor}" font-size="7" font-weight="700">${escapeXml(truncate(props.title, 30))}</text>`,
    marks,
  ].join("");
};

const renderDecoration = (node: CanvasNode, canvas: CanvasDocument): string => {
  const props = node.props as DecorationProps;
  const box = scaledBox(node, canvas);
  const fill = safeColor(props.fillColor, canvas.theme.surfaceColor);
  const border = safeColor(props.borderColor, canvas.theme.borderColor);
  const text = safeColor(props.textColor, canvas.theme.textColor);
  const accent = safeColor(props.accentColor, canvas.theme.accentColor);
  const anchor = props.align === "center" ? "middle" : props.align === "right" ? "end" : "start";
  const textX = props.align === "center" ? box.x + box.width / 2 : props.align === "right" ? box.x + box.width - 8 : box.x + 8;

  return [
    panel(node, canvas, fill, border, finite(props.opacity, 1)),
    `<rect x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" width="${Math.min(3, box.width).toFixed(2)}" height="${box.height.toFixed(2)}" fill="${accent}"/>`,
    `<text x="${textX.toFixed(2)}" y="${(box.y + box.height * 0.55).toFixed(2)}" text-anchor="${anchor}" fill="${text}" font-size="${Math.min(13, Math.max(6, box.height * 0.24)).toFixed(1)}" font-weight="700">${escapeXml(truncate(props.text, 38))}</text>`,
  ].join("");
};

const renderDashboard = (node: CanvasNode, canvas: CanvasDocument): string => {
  const props = node.props as DashboardBaseProps;
  const box = scaledBox(node, canvas);
  const fill = safeColor(props.fillColor, canvas.theme.surfaceColor);
  const border = safeColor(props.borderColor, canvas.theme.borderColor);
  const text = safeColor(props.textColor, canvas.theme.textColor);
  const accent = safeColor(props.accentColor, canvas.theme.accentColor);
  const metric = node.type === "metric-card" ? node.props as MetricCardProps : null;
  const contentTop = box.y + 24;
  const contentHeight = Math.max(box.height - 30, 4);
  let body: string;

  if (metric) {
    body = `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + Math.min(box.height - 8, 36)).toFixed(2)}" fill="${text}" font-size="${Math.min(16, Math.max(9, box.height * 0.28)).toFixed(1)}" font-weight="800">${escapeXml(truncate(`${metric.value}${metric.unit}`, 18))}</text>`;
  } else if (node.type === "progress-list" || node.type === "ranking-list") {
    const items = node.type === "progress-list"
      ? (node.props as ProgressListProps).items.map((item) => ({ label: item.label, value: item.value, maximum: item.maximum }))
      : (() => {
          const ranking = (node.props as RankingListProps).items;
          const maximum = Math.max(...ranking.map((item) => item.value), 1);
          return ranking.map((item) => ({ label: item.label, value: item.value, maximum }));
        })();
    body = items.slice(0, 6).map((item, index) => {
      const rowHeight = contentHeight / Math.min(items.length, 6);
      const y = contentTop + index * rowHeight;
      const width = Math.max(1, (box.width - 18) * Math.min(Math.max(item.value / item.maximum, 0), 1));
      return `<text x="${(box.x + 7).toFixed(2)}" y="${(y + 5).toFixed(2)}" fill="${text}" font-size="5">${escapeXml(truncate(item.label, 18))}</text><rect x="${(box.x + 7).toFixed(2)}" y="${(y + 8).toFixed(2)}" width="${Math.max(1, box.width - 14).toFixed(2)}" height="2" fill="${border}" fill-opacity="0.5"/><rect x="${(box.x + 7).toFixed(2)}" y="${(y + 8).toFixed(2)}" width="${width.toFixed(2)}" height="2" fill="${accent}"/>`;
    }).join("");
  } else if (node.type === "status-grid") {
    const status = node.props as StatusGridProps;
    const cellWidth = Math.max(4, (box.width - 14) / status.columns);
    body = status.items.slice(0, 12).map((item, index) => {
      const x = box.x + 7 + index % status.columns * cellWidth;
      const y = contentTop + Math.floor(index / status.columns) * 10;
      const toneColor = item.tone === "danger" ? "#ff6b7a" : item.tone === "warning" ? "#ffbd59" : item.tone === "offline" ? "#74808a" : accent;
      return `<circle cx="${(x + 3).toFixed(2)}" cy="${(y + 3).toFixed(2)}" r="2" fill="${toneColor}"/><text x="${(x + 7).toFixed(2)}" y="${(y + 5).toFixed(2)}" fill="${text}" font-size="4.5">${escapeXml(truncate(item.label, 8))}</text>`;
    }).join("");
  } else if (node.type === "alarm-list" || node.type === "event-timeline") {
    const items = node.type === "alarm-list"
      ? (node.props as AlarmListProps).items.map((item) => ({ time: item.time, label: item.source, tone: item.tone }))
      : (node.props as EventTimelineProps).items.map((item) => ({ time: item.time, label: item.title, tone: item.tone }));
    body = items.slice(0, 7).map((item, index) => {
      const y = contentTop + index * Math.max(7, contentHeight / Math.min(items.length, 7));
      const toneColor = item.tone === "danger" ? "#ff6b7a" : item.tone === "warning" ? "#ffbd59" : item.tone === "offline" ? "#74808a" : accent;
      return `<circle cx="${(box.x + 9).toFixed(2)}" cy="${(y + 2).toFixed(2)}" r="1.8" fill="${toneColor}"/><text x="${(box.x + 14).toFixed(2)}" y="${(y + 4).toFixed(2)}" fill="${text}" font-size="5">${escapeXml(truncate(`${item.time}  ${item.label}`, 34))}</text>`;
    }).join("");
  } else if (node.type === "data-table") {
    const table = node.props as DataTableProps;
    const rowHeight = Math.max(6, contentHeight / Math.min(table.rows.length + 1, 7));
    const columnWidth = Math.max(5, (box.width - 14) / table.columns.length);
    const header = table.columns.map((column, index) => `<text x="${(box.x + 7 + index * columnWidth).toFixed(2)}" y="${(contentTop + 5).toFixed(2)}" fill="${accent}" font-size="4.5" font-weight="700">${escapeXml(truncate(column, 8))}</text>`).join("");
    const rows = table.rows.slice(0, 6).map((row, rowIndex) => row.map((cell, columnIndex) => `<text x="${(box.x + 7 + columnIndex * columnWidth).toFixed(2)}" y="${(contentTop + (rowIndex + 1) * rowHeight + 5).toFixed(2)}" fill="${text}" fill-opacity="0.78" font-size="4.5">${escapeXml(truncate(cell, 8))}</text>`).join("")).join("");
    body = header + rows;
  } else {
    body = `<circle cx="${(box.x + box.width / 2).toFixed(2)}" cy="${(box.y + box.height * 0.62).toFixed(2)}" r="${Math.max(4, Math.min(box.width, box.height) * 0.17).toFixed(2)}" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="22 8"/>`;
  }

  return [
    panel(node, canvas, fill, border),
    `<rect x="${(box.x + 7).toFixed(2)}" y="${(box.y + 7).toFixed(2)}" width="${Math.max(8, box.width * 0.18).toFixed(2)}" height="2" rx="1" fill="${accent}"/>`,
    `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + 17).toFixed(2)}" fill="${text}" fill-opacity="0.78" font-size="6">${escapeXml(truncate(props.title, 26))}</text>`,
    body,
  ].join("");
};

const renderModel = (node: CanvasNode, canvas: CanvasDocument): string => {
  const props = node.props as Model3DProps;
  const box = scaledBox(node, canvas);
  const background = safeColor(props.backgroundColor, "#071525");
  const accent = safeColor(props.keyLightColor, canvas.theme.accentColor);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const size = Math.max(8, Math.min(box.width, box.height) * 0.24);

  return [
    panel(node, canvas, background, canvas.theme.borderColor, finite(props.backgroundOpacity, 1)),
    `<path d="M ${centerX.toFixed(2)} ${(centerY - size).toFixed(2)} L ${(centerX + size).toFixed(2)} ${(centerY - size * 0.45).toFixed(2)} L ${centerX.toFixed(2)} ${(centerY + size * 0.15).toFixed(2)} L ${(centerX - size).toFixed(2)} ${(centerY - size * 0.45).toFixed(2)} Z" fill="${accent}" fill-opacity="0.34" stroke="${accent}" stroke-width="1"/>`,
    `<path d="M ${(centerX - size).toFixed(2)} ${(centerY - size * 0.45).toFixed(2)} L ${centerX.toFixed(2)} ${(centerY + size * 0.15).toFixed(2)} L ${centerX.toFixed(2)} ${(centerY + size).toFixed(2)} L ${(centerX - size).toFixed(2)} ${(centerY + size * 0.35).toFixed(2)} Z" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="1"/>`,
    `<path d="M ${(centerX + size).toFixed(2)} ${(centerY - size * 0.45).toFixed(2)} L ${centerX.toFixed(2)} ${(centerY + size * 0.15).toFixed(2)} L ${centerX.toFixed(2)} ${(centerY + size).toFixed(2)} L ${(centerX + size).toFixed(2)} ${(centerY + size * 0.35).toFixed(2)} Z" fill="${accent}" fill-opacity="0.08" stroke="${accent}" stroke-width="1"/>`,
  ].join("");
};

const renderImagePlaceholder = (
  node: CanvasNode,
  canvas: CanvasDocument,
  props: ImageProps | CarouselProps,
): string => {
  const box = scaledBox(node, canvas);
  const background = safeColor(props.backgroundColor, canvas.theme.surfaceColor);
  const border = safeColor(props.borderColor, canvas.theme.borderColor);
  const accent = safeColor(canvas.theme.accentColor, "#33c7ff");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const iconWidth = Math.max(12, Math.min(34, box.width * 0.22));
  const iconHeight = Math.max(9, Math.min(25, box.height * 0.22));
  const boundCount = node.resourceRefs.length;

  return [
    panel(node, canvas, background, border),
    `<rect x="${(centerX - iconWidth / 2).toFixed(2)}" y="${(centerY - iconHeight / 2).toFixed(2)}" width="${iconWidth.toFixed(2)}" height="${iconHeight.toFixed(2)}" rx="2" fill="none" stroke="${accent}" stroke-width="1.2" stroke-opacity="0.82"/>`,
    `<circle cx="${(centerX - iconWidth * 0.2).toFixed(2)}" cy="${(centerY - iconHeight * 0.18).toFixed(2)}" r="${Math.max(1.2, iconWidth * 0.06).toFixed(2)}" fill="${accent}" fill-opacity="0.9"/>`,
    `<path d="M ${(centerX - iconWidth * 0.38).toFixed(2)} ${(centerY + iconHeight * 0.28).toFixed(2)} L ${(centerX - iconWidth * 0.08).toFixed(2)} ${(centerY - iconHeight * 0.02).toFixed(2)} L ${(centerX + iconWidth * 0.1).toFixed(2)} ${(centerY + iconHeight * 0.14).toFixed(2)} L ${(centerX + iconWidth * 0.34).toFixed(2)} ${(centerY - iconHeight * 0.12).toFixed(2)}" fill="none" stroke="${accent}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    boundCount > 0
      ? `<text x="${(box.x + box.width - 6).toFixed(2)}" y="${(box.y + box.height - 6).toFixed(2)}" text-anchor="end" fill="${accent}" font-size="6">${boundCount}</text>`
      : "",
  ].join("");
};

const renderBasicAppearance = (
  node: CanvasNode,
  canvas: CanvasDocument,
  props: BasicAppearanceProps,
): { box: ReturnType<typeof scaledBox>; panelSvg: string; text: string; accent: string } => ({
  box: scaledBox(node, canvas),
  panelSvg: panel(
    node,
    canvas,
    safeColor(props.fillColor, canvas.theme.surfaceColor),
    safeColor(props.borderColor, canvas.theme.borderColor),
  ),
  text: safeColor(props.textColor, canvas.theme.textColor),
  accent: safeColor(props.accentColor, canvas.theme.accentColor),
});

const renderBasic = (node: CanvasNode, canvas: CanvasDocument): string => {
  if (node.type === "image" || node.type === "carousel") {
    return renderImagePlaceholder(node, canvas, node.props as ImageProps | CarouselProps);
  }

  const props = node.props as BasicAppearanceProps;
  const { box, panelSvg, text, accent } = renderBasicAppearance(node, canvas, props);

  if (node.type === "plain-text") {
    const textProps = node.props as PlainTextProps;
    return [
      panelSvg,
      `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + box.height * 0.56).toFixed(2)}" fill="${text}" font-size="${Math.min(12, Math.max(6, box.height * 0.28)).toFixed(1)}" font-weight="${textProps.fontWeight}">${escapeXml(truncate(textProps.text, 54))}</text>`,
    ].join("");
  }

  if (node.type === "text-link") {
    const linkProps = node.props as TextLinkProps;
    return [
      panelSvg,
      `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + box.height * 0.57).toFixed(2)}" fill="${accent}" font-size="${Math.min(11, Math.max(6, box.height * 0.3)).toFixed(1)}" font-weight="${linkProps.fontWeight}" text-decoration="${linkProps.underline ? "underline" : "none"}">${escapeXml(truncate(linkProps.text, 42))}</text>`,
    ].join("");
  }

  if (node.type === "button") {
    const buttonProps = node.props as ButtonProps;
    return [
      panelSvg,
      `<rect x="${(box.x + 4).toFixed(2)}" y="${(box.y + 4).toFixed(2)}" width="${Math.max(1, box.width - 8).toFixed(2)}" height="${Math.max(1, box.height - 8).toFixed(2)}" rx="3" fill="${accent}" fill-opacity="${buttonProps.disabled ? "0.24" : "0.78"}"/>`,
      `<text x="${(box.x + box.width / 2).toFixed(2)}" y="${(box.y + box.height * 0.58).toFixed(2)}" text-anchor="middle" fill="${text}" font-size="${Math.min(11, Math.max(6, box.height * 0.27)).toFixed(1)}" font-weight="${buttonProps.fontWeight}">${escapeXml(truncate(buttonProps.text, 32))}</text>`,
    ].join("");
  }

  if (node.type === "switch") {
    const switchProps = node.props as SwitchProps;
    const trackWidth = Math.min(25, Math.max(14, box.width * 0.18));
    const trackHeight = Math.min(12, Math.max(7, box.height * 0.26));
    const trackX = box.x + box.width - trackWidth - 7;
    const trackY = box.y + (box.height - trackHeight) / 2;
    return [
      panelSvg,
      `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + box.height * 0.58).toFixed(2)}" fill="${text}" font-size="${Math.min(10, Math.max(6, box.height * 0.25)).toFixed(1)}">${escapeXml(truncate(switchProps.label, 28))}</text>`,
      `<rect x="${trackX.toFixed(2)}" y="${trackY.toFixed(2)}" width="${trackWidth.toFixed(2)}" height="${trackHeight.toFixed(2)}" rx="${(trackHeight / 2).toFixed(2)}" fill="${switchProps.defaultChecked ? accent : safeColor(props.borderColor, canvas.theme.borderColor)}"/>`,
      `<circle cx="${(switchProps.defaultChecked ? trackX + trackWidth - trackHeight / 2 : trackX + trackHeight / 2).toFixed(2)}" cy="${(trackY + trackHeight / 2).toFixed(2)}" r="${Math.max(2, trackHeight * 0.36).toFixed(2)}" fill="${text}"/>`,
    ].join("");
  }

  if (node.type === "select") {
    const selectProps = node.props as SelectProps;
    const selected = selectProps.options.find((option) => option.value === selectProps.selectedValue)?.label
      ?? selectProps.placeholder;
    return [
      panelSvg,
      `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + 12).toFixed(2)}" fill="${text}" fill-opacity="0.7" font-size="6">${escapeXml(truncate(selectProps.label, 28))}</text>`,
      `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + box.height - 8).toFixed(2)}" fill="${text}" font-size="7">${escapeXml(truncate(selected, 32))}</text>`,
      `<path d="M ${(box.x + box.width - 12).toFixed(2)} ${(box.y + box.height * 0.55 - 2).toFixed(2)} l 3 3 l 3 -3" fill="none" stroke="${accent}" stroke-width="1.2"/>`,
    ].join("");
  }

  const choiceProps = node.props as CheckboxGroupProps | RadioGroupProps;
  const optionMarks = choiceProps.options.slice(0, 5).map((option, index) => {
    const y = box.y + 18 + index * Math.min(12, Math.max(7, (box.height - 24) / 5));
    const selected = node.type === "checkbox-group"
      ? (choiceProps as CheckboxGroupProps).selectedValues.includes(option.value)
      : (choiceProps as RadioGroupProps).selectedValue === option.value;
    const mark = node.type === "radio-group"
      ? `<circle cx="${(box.x + 10).toFixed(2)}" cy="${y.toFixed(2)}" r="3" fill="${selected ? accent : "none"}" stroke="${accent}" stroke-width="0.8"/>`
      : `<rect x="${(box.x + 7).toFixed(2)}" y="${(y - 3).toFixed(2)}" width="6" height="6" rx="1" fill="${selected ? accent : "none"}" stroke="${accent}" stroke-width="0.8"/>`;
    return `${mark}<text x="${(box.x + 17).toFixed(2)}" y="${(y + 2).toFixed(2)}" fill="${text}" font-size="6">${escapeXml(truncate(option.label, 28))}</text>`;
  }).join("");

  return [
    panelSvg,
    `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + 10).toFixed(2)}" fill="${text}" font-size="6" font-weight="700">${escapeXml(truncate(choiceProps.title, 30))}</text>`,
    optionMarks,
  ].join("");
};

const renderNode = (node: CanvasNode, canvas: CanvasDocument): string => {
  if (node.type === "rectangle" || node.type === "circle") return renderShape(node, canvas);
  if (
    node.type === "line-chart"
    || node.type === "bar-chart"
    || node.type === "area-chart"
    || node.type === "pie-chart"
    || node.type === "donut-chart"
    || node.type === "radar-chart"
  ) return renderChart(node, canvas);
  if (
    node.type === "screen-title"
    || node.type === "background-decoration"
    || node.type === "datetime"
    || node.type === "section-title"
    || node.type === "card-background"
    || node.type === "icon-background"
  ) return renderDecoration(node, canvas);
  if (node.type === "panel-frame") return renderPanelFrame(node, canvas);
  if (
    node.type === "metric-card"
    || node.type === "radial-gauge"
    || node.type === "progress-list"
    || node.type === "status-grid"
    || node.type === "ranking-list"
    || node.type === "alarm-list"
    || node.type === "data-table"
    || node.type === "event-timeline"
  ) return renderDashboard(node, canvas);
  if (node.type === "model-3d") return renderModel(node, canvas);
  if (
    node.type === "plain-text"
    || node.type === "text-link"
    || node.type === "image"
    || node.type === "carousel"
    || node.type === "button"
    || node.type === "switch"
    || node.type === "checkbox-group"
    || node.type === "radio-group"
    || node.type === "select"
  ) return renderBasic(node, canvas);

  const exhaustiveCheck: never = node.type;
  throw new Error(`Unsupported canvas node in project cover: ${exhaustiveCheck}`);
};

export const renderProjectCoverSvg = (
  canvas: CanvasDocument,
): string => {
  const background = safeColor(canvas.theme.backgroundColor, "#071525");
  const pattern = canvas.theme.backgroundPattern;
  const patternMarkup = pattern === "none"
    ? ""
    : pattern === "dots"
      ? `<pattern id="canvas-pattern" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="${safeColor(canvas.theme.borderColor, "#286783")}" fill-opacity="0.3"/></pattern>`
      : `<pattern id="canvas-pattern" width="${pattern === "circuit" ? 30 : 20}" height="${pattern === "circuit" ? 30 : 20}" patternUnits="userSpaceOnUse"><path d="M 0 0 H ${pattern === "circuit" ? 18 : 20} M 0 0 V ${pattern === "circuit" ? 12 : 20}${pattern === "circuit" ? " M 18 0 V 8 H 26" : ""}" fill="none" stroke="${safeColor(canvas.theme.borderColor, "#286783")}" stroke-width="0.55" stroke-opacity="0.28"/></pattern>`;
  const sortedNodes = [...canvas.nodes]
    .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id))
    .slice(0, MAX_RENDERED_NODES);
  const isBackdropNode = (node: CanvasNode) => (
    node.type === "rectangle"
    && node.x <= 0
    && node.y <= 0
    && node.width >= canvas.width
    && node.height >= canvas.height
  );
  const backdropNodes = sortedNodes.filter(isBackdropNode).map((node) => renderNode(node, canvas)).join("");
  const contentNodes = sortedNodes.filter((node) => !isBackdropNode(node)).map((node) => renderNode(node, canvas)).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" role="img" aria-label="项目画布缩略图">`,
    `<defs>${patternMarkup}<clipPath id="canvas-cover-clip"><rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}"/></clipPath></defs>`,
    `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="${background}"/>`,
    `<g clip-path="url(#canvas-cover-clip)">${backdropNodes}</g>`,
    pattern === "none" ? "" : `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="url(#canvas-pattern)"/>`,
    `<g clip-path="url(#canvas-cover-clip)">${contentNodes}</g>`,
    "</svg>",
  ].join("");
};

export const projectCoverResponse = (
  request: Request,
  canvas: CanvasDocument,
): Response => {
  const etag = `"project-${canvas.projectId}-canvas-${canvas.revision}"`;
  const headers = new Headers({
    "cache-control": "private, max-age=0, must-revalidate",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "content-type": "image/svg+xml; charset=utf-8",
    etag,
    "x-content-type-options": "nosniff",
  });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(renderProjectCoverSvg(canvas), { headers });
};
