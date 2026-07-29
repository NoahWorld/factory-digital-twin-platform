import {
  type CanvasDocument,
  type CanvasNode,
  type ChartProps,
  type DashboardBaseProps,
  type DecorationProps,
  type MetricCardProps,
  type Model3DProps,
  type ShapeProps,
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
  return `<rect x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" width="${box.width.toFixed(2)}" height="${box.height.toFixed(2)}" rx="3" fill="${fill}" fill-opacity="${Math.min(Math.max(opacity, 0), 1).toFixed(2)}" stroke="${border}" stroke-width="0.8"/>`;
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

  const marks = node.type === "bar-chart"
    ? values.map((value, index) => {
      const slot = contentWidth / Math.max(values.length, 1);
      const height = Math.max(1, Math.abs(finite(value)) / maximum * contentHeight);
      return `<rect x="${(contentX + slot * index + slot * 0.2).toFixed(2)}" y="${(contentY + contentHeight - height).toFixed(2)}" width="${Math.max(1, slot * 0.6).toFixed(2)}" height="${height.toFixed(2)}" rx="1" fill="${color}" fill-opacity="0.86"/>`;
    }).join("")
    : `<polyline points="${values.map((value, index) => {
      const x = contentX + (values.length <= 1 ? 0 : index / (values.length - 1) * contentWidth);
      const y = contentY + contentHeight - Math.abs(finite(value)) / maximum * contentHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

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

  return [
    panel(node, canvas, fill, border),
    `<rect x="${(box.x + 7).toFixed(2)}" y="${(box.y + 7).toFixed(2)}" width="${Math.max(8, box.width * 0.18).toFixed(2)}" height="2" rx="1" fill="${accent}"/>`,
    `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + 17).toFixed(2)}" fill="${text}" fill-opacity="0.78" font-size="6">${escapeXml(truncate(props.title, 26))}</text>`,
    metric
      ? `<text x="${(box.x + 7).toFixed(2)}" y="${(box.y + Math.min(box.height - 8, 36)).toFixed(2)}" fill="${text}" font-size="${Math.min(16, Math.max(9, box.height * 0.28)).toFixed(1)}" font-weight="800">${escapeXml(truncate(`${metric.value}${metric.unit}`, 18))}</text>`
      : `<circle cx="${(box.x + box.width / 2).toFixed(2)}" cy="${(box.y + box.height * 0.62).toFixed(2)}" r="${Math.max(4, Math.min(box.width, box.height) * 0.17).toFixed(2)}" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="22 8"/>`,
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

const renderNode = (node: CanvasNode, canvas: CanvasDocument): string => {
  if (node.type === "rectangle" || node.type === "circle") return renderShape(node, canvas);
  if (node.type === "line-chart" || node.type === "bar-chart") return renderChart(node, canvas);
  if (
    node.type === "screen-title"
    || node.type === "background-decoration"
    || node.type === "datetime"
    || node.type === "section-title"
    || node.type === "card-background"
    || node.type === "icon-background"
  ) return renderDecoration(node, canvas);
  if (
    node.type === "metric-card"
    || node.type === "radial-gauge"
    || node.type === "progress-list"
    || node.type === "status-grid"
  ) return renderDashboard(node, canvas);
  if (node.type === "model-3d") return renderModel(node, canvas);

  const exhaustiveCheck: never = node.type;
  throw new Error(`Unsupported canvas node in project cover: ${exhaustiveCheck}`);
};

export const renderProjectCoverSvg = (
  canvas: CanvasDocument,
): string => {
  const background = safeColor(canvas.theme.backgroundColor, "#071525");
  const nodes = [...canvas.nodes]
    .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id))
    .slice(0, MAX_RENDERED_NODES)
    .map((node) => renderNode(node, canvas))
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" role="img" aria-label="项目画布缩略图">`,
    `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="${background}"/>`,
    `<g clip-path="url(#canvas-cover-clip)">${nodes}</g>`,
    `<defs><clipPath id="canvas-cover-clip"><rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}"/></clipPath></defs>`,
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
