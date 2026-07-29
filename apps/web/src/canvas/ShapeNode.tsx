import { memo, useMemo } from "react";
import { componentLabels, isShapeNodeType, parseShapeProps, type CanvasNode } from "./types";

export const ShapeNode = memo(function ShapeNode({ node }: { node: CanvasNode }) {
  const parsed = useMemo(() => parseShapeProps(node.props), [node.props]);

  if (!isShapeNodeType(node.type)) {
    return <div className="chart-config-error" role="alert"><strong>组件类型错误</strong><span>{node.type} 不是图形组件</span></div>;
  }

  if (!parsed.ok) {
    return <div className="chart-config-error" role="alert"><strong>{componentLabels[node.type]}配置错误</strong><span>{parsed.message}</span></div>;
  }

  const { fillColor, borderColor, borderWidth, borderRadius, opacity } = parsed.value;
  return (
    <div
      aria-label={componentLabels[node.type]}
      className={`shape-node-content is-${node.type}`}
      role="img"
      style={{
        backgroundColor: fillColor,
        borderColor,
        borderRadius: node.type === "circle" ? "50%" : borderRadius,
        borderWidth,
        opacity,
      }}
    />
  );
});
