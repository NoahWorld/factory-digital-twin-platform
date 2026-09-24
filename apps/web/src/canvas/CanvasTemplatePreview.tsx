import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { isOrnamentNodeType } from "../../../../shared/canvas-ornaments";
import { findBuiltinImage } from "../../../../shared/builtin-images";
import {
  isBasicNodeType, isChartNodeType, isDashboardNodeType, isDecorationNodeType,
  isPanelFrameNodeType, isShapeNodeType, type CanvasNode,
} from "./types";
import { getCanvasTemplate, instantiateCanvasTemplate, type CanvasTemplateId } from "./templates";
import { BasicNode } from "./BasicNode";
import { ChartNode } from "./ChartNode";
import { DashboardNode } from "./DashboardNode";
import { DecorationNode } from "./DecorationNode";
import { OrnamentNode } from "./OrnamentNode";
import { PanelFrameNode } from "./PanelFrameNode";
import { ShapeNode } from "./ShapeNode";

function PreviewNode({ node }: { node: CanvasNode }) {
  if (node.resourceRefs.some(id => node.type !== "image" || !findBuiltinImage(id)) || node.dataBindingRefs.length > 0) {
    throw new Error(`公开模板预览不能请求项目资源或业务数据：${node.type} (${node.id})`);
  }
  const kind = isOrnamentNodeType(node.type) ? "ornament"
    : isShapeNodeType(node.type) ? "shape"
      : isDecorationNodeType(node.type) ? "decoration"
        : isPanelFrameNodeType(node.type) ? "panel-frame"
          : isDashboardNodeType(node.type) ? "dashboard"
            : isBasicNodeType(node.type) ? "basic" : "chart";
  const content = isOrnamentNodeType(node.type) ? <OrnamentNode node={node} />
    : isShapeNodeType(node.type) ? <ShapeNode node={node} />
      : isDecorationNodeType(node.type) ? <DecorationNode node={node} />
        : isPanelFrameNodeType(node.type) ? <PanelFrameNode node={node} />
          : isDashboardNodeType(node.type) ? <DashboardNode node={node} />
            : isBasicNodeType(node.type) ? <BasicNode editable node={node} projectId="" />
              : isChartNodeType(node.type) ? <ChartNode node={node} /> : null;
  if (!content) throw new Error(`公开模板包含不支持的组件：${node.type} (${node.id})`);
  const backdrop = node.type === "rectangle" && node.x === 0 && node.y === 0 && node.width === 1920 && node.height === 1080;
  return <div className={`canvas-node is-${kind}`} data-template-node-type={node.type} style={{
    transform: `translate(${node.x}px, ${node.y}px)`, width: node.width, height: node.height,
    zIndex: backdrop ? 0 : node.zIndex + 2,
  }}>{content}</div>;
}

/** Render the same components at their authored size, then scale the entire canvas uniformly. */
export function CanvasTemplatePreview({ className = "", templateId }: { className?: string; templateId: CanvasTemplateId }) {
  const template = getCanvasTemplate(templateId);
  const nodes = useMemo(() => instantiateCanvasTemplate(templateId, []), [templateId]);
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = viewport.current;
    const canvas = surface.current;
    if (!container || !canvas) return;
    const resize = () => { canvas.style.transform = `scale(${container.clientWidth / 1920})`; };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, []);
  const theme = template.canvasTheme;
  return <div ref={viewport} role="img" aria-label={`${template.showcase.title}模拟案例画布预览`}
    className={`template-canvas-preview ${className}`} data-template-id={templateId}>
    <div ref={surface} className="canvas-surface template-preview-surface" data-font={theme.fontFamily}
      data-pattern={theme.backgroundPattern} data-theme={theme.mode} style={{
        width: 1920, height: 1080,
        "--canvas-theme-accent": theme.accentColor, "--canvas-theme-background": theme.backgroundColor,
        "--canvas-theme-border": theme.borderColor, "--canvas-theme-glow": theme.glowIntensity,
        "--canvas-theme-panel-radius": `${theme.panelRadius}px`, "--canvas-theme-surface": theme.surfaceColor,
        "--canvas-theme-text": theme.textColor,
      } as CSSProperties}>
      <div aria-hidden="true" className="canvas-theme-pattern" />
      {nodes.map(node => <PreviewNode key={node.id} node={node} />)}
    </div>
  </div>;
}
