import { parseOrnamentProps, titleFonts, type OrnamentNodeType } from "./canvas-ornaments";
import { getIcon } from "./icon-catalog";

const xml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
// Derived thumbnail only: all icons/attributes are allowlisted, and user text is XML-escaped.
export function renderOrnamentSvg(type: OrnamentNodeType, raw: Record<string, unknown>, width: number, height: number, nodeId: string): string {
  const parsed = parseOrnamentProps(type, raw);
  if (!parsed.ok) throw new Error(`Cannot render ornament ${nodeId}: ${parsed.message}`);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(`Invalid ornament dimensions: ${nodeId}`);
  const p = parsed.value;
  const icon = (x: number, y: number, size: number) => p.icon === "none" ? "" : `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${p.iconColor}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(${p.rotation} 12 12)">${getIcon(p.icon).body}</g></svg>`;
  let content: string;
  if (!("text" in p)) {
    const size = Math.min(p.iconSize, width, height);
    content = icon((width - size) / 2, (height - size) / 2, size);
  } else {
    const id = `title-${nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const iconWidth = p.icon === "none" ? 0 : p.iconSize + p.gap;
    const available = Math.max(0, width - p.padding * 2 - iconWidth);
    const measure = (text: string) => [...text].reduce((sum, char) => sum + p.fontSize * (/[^\u0000-\u00ff]/.test(char) ? 1 : 0.58) + p.letterSpacing, 0);
    let text = p.text;
    if (measure(text) > available) {
      const characters = [...text];
      while (characters.length > 0 && measure(characters.join("") + "…") > available) characters.pop();
      text = characters.length ? characters.join("") + "…" : "";
    }
    const used = iconWidth + measure(text);
    const x = p.align === "left" ? p.padding : p.align === "right" ? width - p.padding - used : (width - used) / 2;
    let background = `<rect width="${width}" height="${height}" fill="${p.fillColor}" fill-opacity="${p.backgroundOpacity}"/>`;
    if (p.variant === "underline") background += `<path d="M0 ${height - 1}H${width}" stroke="${p.accentColor}" stroke-opacity=".55"/><path d="M0 ${height - 1}H${Math.min(52, width)}" stroke="${p.accentColor}" stroke-width="3"/>`;
    if (p.variant === "band") background += `<defs><linearGradient id="${id}"><stop stop-color="${p.accentColor}" stop-opacity=".22"/><stop offset="1" stop-color="${p.accentColor}" stop-opacity="0"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#${id})"/><path d="M1 0V${height}" stroke="${p.accentColor}" stroke-width="3"/>`;
    if (p.variant === "corner") background += `<path d="M0 ${height}V10L10 0H${width}M0 ${height - 1}H${width - 10}L${width} ${height - 11}" fill="none" stroke="${p.accentColor}" stroke-opacity=".7"/>`;
    content = background + icon(x, (height - p.iconSize) / 2, p.iconSize) + `<text x="${x + iconWidth}" y="${height / 2}" dominant-baseline="central" fill="${p.textColor}" font-family="${xml(titleFonts[p.fontFamily].family)}" font-size="${p.fontSize}" font-weight="${p.fontWeight}" font-style="${p.italic ? "italic" : "normal"}" letter-spacing="${p.letterSpacing}" text-decoration="${p.underline ? "underline" : "none"}">${xml(text)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" overflow="hidden"><g opacity="${p.opacity}">${content}</g></svg>`;
}
