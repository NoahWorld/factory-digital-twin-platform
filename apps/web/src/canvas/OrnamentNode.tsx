import { memo, type CSSProperties } from "react";
import { isOrnamentNodeType, parseOrnamentProps, titleFonts } from "../../../../shared/canvas-ornaments";
import type { CanvasNode } from "./types";
import { LocalIcon } from "./LocalIcon";

export const OrnamentNode = memo(function OrnamentNode({ node }: { node: CanvasNode }) {
  if (!isOrnamentNodeType(node.type)) throw new Error(`Unsupported ornament node: ${node.type}`);
  const parsed = parseOrnamentProps(node.type, node.props);
  if (!parsed.ok) return <div className="decoration-invalid" role="alert">{parsed.message}</div>;
  const props = parsed.value;
  const icon = props.icon === "none" ? null : <LocalIcon name={props.icon} size={props.iconSize} color={props.iconColor} strokeWidth={props.strokeWidth} rotation={props.rotation} />;
  if (!("text" in props)) return <div className="vector-icon-node" style={{ opacity: props.opacity }}>{icon}</div>;
  const style = {
    "--title-accent": props.accentColor,
    "--title-fill": props.fillColor,
    "--title-background-opacity": props.backgroundOpacity,
    opacity: props.opacity, gap: props.gap, paddingInline: props.padding,
    fontFamily: titleFonts[props.fontFamily].family, fontSize: props.fontSize, fontWeight: props.fontWeight,
    fontStyle: props.italic ? "italic" : "normal", letterSpacing: props.letterSpacing,
    color: props.textColor, justifyContent: props.align === "left" ? "flex-start" : props.align === "right" ? "flex-end" : "center",
  } as CSSProperties;
  return <div className="card-title-node" data-variant={props.variant} style={style}>
    <span className="card-title-backdrop" aria-hidden="true" />
    {icon}
    <span className="card-title-text" style={{ textDecoration: props.underline ? "underline" : "none" }}>{props.text}</span>
  </div>;
});
