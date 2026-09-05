import type { CSSProperties } from "react";
import { parsePanelFrameProps, type CanvasNode } from "./types";

export function PanelFrameNode({ node }: { node: CanvasNode }) {
  const parsed = parsePanelFrameProps(node.props);
  if (!parsed.ok) {
    return <div className="panel-frame-node is-invalid">科技面板配置无效</div>;
  }

  const props = parsed.value;
  const style = {
    "--panel-accent": props.accentColor,
    "--panel-border": props.borderColor,
    "--panel-corner-size": `${props.cornerSize}px`,
    "--panel-fill": props.fillColor,
    "--panel-glow-strength": props.glowStrength,
    "--panel-header-height": `${props.headerHeight}px`,
    "--panel-opacity": props.opacity,
    "--panel-text": props.textColor,
  } as CSSProperties;

  return (
    <div className="panel-frame-node" data-style={props.style} style={style}>
      <span className="panel-frame-fill" />
      <span className="panel-frame-border" />
      <span className="panel-frame-corner is-top-left" />
      <span className="panel-frame-corner is-top-right" />
      <span className="panel-frame-corner is-bottom-left" />
      <span className="panel-frame-corner is-bottom-right" />
      {props.showHeader ? (
        <header className="panel-frame-header">
          <span className="panel-frame-heading-mark" aria-hidden="true" />
          <span className="panel-frame-heading-copy">
            <strong>{props.title}</strong>
            {props.subtitle ? <small>{props.subtitle}</small> : null}
          </span>
          <span className="panel-frame-heading-line" aria-hidden="true" />
        </header>
      ) : null}
    </div>
  );
}
