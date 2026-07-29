import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChartNode } from "./ChartNode";
import { DashboardNode } from "./DashboardNode";
import { DecorationNode } from "./DecorationNode";
import { buildSnapTargets, resizeCanvasNode, snapNodePosition, type ResizeDirection, type SnapTargets, type SnappedPosition } from "./geometry";
import { Model3DNode } from "./Model3DNode";
import type { ModelSceneSnapshot } from "./model-scene";
import { ShapeNode } from "./ShapeNode";
import { CANVAS_DRAG_TYPE, defaultNodeSizes, isCanvasNodeType, isDashboardNodeType, isDecorationNodeType, isModel3DNodeType, isShapeNodeType, type CanvasDocument, type CanvasNode, type CanvasNodeType } from "./types";

type ActiveDrag = {
  kind: "drag";
  node: CanvasNode;
  element: HTMLDivElement;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  latestClientX: number;
  latestClientY: number;
  targets: SnapTargets;
  snapped: SnappedPosition;
};

type ActiveResize = {
  kind: "resize";
  node: CanvasNode;
  element: HTMLDivElement;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  latestClientX: number;
  latestClientY: number;
  direction: ResizeDirection;
  resizedNode: CanvasNode;
};

type ActiveInteraction = ActiveDrag | ActiveResize;

type CanvasNodeViewProps = {
  editable: boolean;
  node: CanvasNode;
  onModelSceneChange?: (canvasNodeId: string, snapshot: ModelSceneSnapshot | null) => void;
  onModelSceneNodeSelect: (canvasNodeId: string, sceneNodePath: string | null) => void;
  projectId: string;
  selected: boolean;
  selectedModelSceneNodePath: string | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode, direction: ResizeDirection) => void;
};

const resizeHandles: Array<{ direction: ResizeDirection; label: string }> = [
  { direction: "north-west", label: "从左上角调整组件大小" },
  { direction: "north-east", label: "从右上角调整组件大小" },
  { direction: "south-east", label: "从右下角调整组件大小" },
  { direction: "south-west", label: "从左下角调整组件大小" },
];

const hasGeometryChanged = (previous: CanvasNode, next: CanvasNode) => (
  previous.x !== next.x
  || previous.y !== next.y
  || previous.width !== next.width
  || previous.height !== next.height
);

const CanvasNodeView = memo(function CanvasNodeView({ editable, node, onModelSceneChange, onModelSceneNodeSelect, projectId, selected, selectedModelSceneNodePath, onPointerDown, onResizePointerDown }: CanvasNodeViewProps) {
  return (
    <div
      aria-label={`${node.type} 组件`}
      className={`canvas-node${isShapeNodeType(node.type) ? " is-shape" : ""}${isDecorationNodeType(node.type) ? " is-decoration" : ""}${isDashboardNodeType(node.type) ? " is-dashboard" : ""}${isModel3DNodeType(node.type) ? " is-model-3d" : ""}${selected ? " is-selected" : ""}${editable ? " is-editable" : ""}`}
      data-node-id={node.id}
      onPointerDown={editable ? (event) => onPointerDown(event, node) : undefined}
      role="group"
      style={{ height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, width: node.width, zIndex: node.zIndex }}
    >
      {isShapeNodeType(node.type)
        ? <ShapeNode node={node} />
        : isDecorationNodeType(node.type)
          ? <DecorationNode node={node} />
          : isDashboardNodeType(node.type)
            ? <DashboardNode node={node} />
          : isModel3DNodeType(node.type)
            ? (
                <Model3DNode
                  editable={editable}
                  node={node}
                  onSceneChange={onModelSceneChange}
                  onSceneNodeSelect={onModelSceneNodeSelect}
                  projectId={projectId}
                  selectedSceneNodePath={selectedModelSceneNodePath}
                />
              )
            : <ChartNode node={node} />}
      {editable ? <span className="canvas-node-drag-hint">拖动</span> : null}
      {editable && selected ? resizeHandles.map(({ direction, label }) => (
        <button
          aria-label={label}
          className={`canvas-resize-handle is-${direction}`}
          key={direction}
          onPointerDown={(event) => onResizePointerDown(event, node, direction)}
          type="button"
        />
      )) : null}
    </div>
  );
});

type CanvasSurfaceProps = {
  document: CanvasDocument;
  editable: boolean;
  selectedNodeId: string | null;
  onCreateNode: (type: CanvasNodeType, x: number, y: number) => void;
  onModelSceneChange?: (canvasNodeId: string, snapshot: ModelSceneSnapshot | null) => void;
  onModelSceneNodeSelect: (canvasNodeId: string, sceneNodePath: string | null) => void;
  onNodeChange: (node: CanvasNode) => void;
  onSelectNode: (nodeId: string | null) => void;
  selectedModelSceneNodePath: string | null;
};

export function CanvasSurface({ document, editable, selectedNodeId, selectedModelSceneNodePath, onCreateNode, onModelSceneChange, onModelSceneNodeSelect, onNodeChange, onSelectNode }: CanvasSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const verticalGuideRef = useRef<HTMLDivElement>(null);
  const horizontalGuideRef = useRef<HTMLDivElement>(null);
  const activeInteractionRef = useRef<ActiveInteraction | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      const availableWidth = Math.max(viewport.clientWidth - 48, 1);
      const availableHeight = Math.max(viewport.clientHeight - 48, 1);
      const nextScale = Math.min(availableWidth / document.width, availableHeight / document.height, 1);
      scaleRef.current = nextScale;
      setScale(nextScale);
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    updateScale();
    return () => observer.disconnect();
  }, [document.height, document.width]);

  const hideGuides = useCallback(() => {
    if (verticalGuideRef.current) verticalGuideRef.current.style.display = "none";
    if (horizontalGuideRef.current) horizontalGuideRef.current.style.display = "none";
  }, []);

  const renderActiveInteraction = useCallback((): CanvasNode | null => {
    const active = activeInteractionRef.current;
    if (!active) return null;

    const deltaX = (active.latestClientX - active.startClientX) / scaleRef.current;
    const deltaY = (active.latestClientY - active.startClientY) / scaleRef.current;

    if (active.kind === "resize") {
      const resizedNode = resizeCanvasNode(active.node, active.direction, deltaX, deltaY, document.width, document.height);
      active.resizedNode = resizedNode;
      active.element.style.width = `${resizedNode.width}px`;
      active.element.style.height = `${resizedNode.height}px`;
      active.element.style.transform = `translate3d(${resizedNode.x}px, ${resizedNode.y}px, 0)`;
      return resizedNode;
    }

    const rawX = active.node.x + deltaX;
    const rawY = active.node.y + deltaY;
    const snapped = snapNodePosition(rawX, rawY, active.node, active.targets, document.width, document.height);
    active.snapped = snapped;
    active.element.style.transform = `translate3d(${snapped.x}px, ${snapped.y}px, 0)`;

    if (verticalGuideRef.current) {
      verticalGuideRef.current.style.display = snapped.verticalGuide === null ? "none" : "block";
      verticalGuideRef.current.style.transform = `translateX(${snapped.verticalGuide ?? 0}px)`;
    }
    if (horizontalGuideRef.current) {
      horizontalGuideRef.current.style.display = snapped.horizontalGuide === null ? "none" : "block";
      horizontalGuideRef.current.style.transform = `translateY(${snapped.horizontalGuide ?? 0}px)`;
    }
    return { ...active.node, x: snapped.x, y: snapped.y };
  }, [document.height, document.width]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const active = activeInteractionRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      active.latestClientX = event.clientX;
      active.latestClientY = event.clientY;
      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = null;
          renderActiveInteraction();
        });
      }
    };

    const finishPointer = (event: PointerEvent) => {
      const active = activeInteractionRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      active.latestClientX = event.clientX;
      active.latestClientY = event.clientY;
      const changedNode = renderActiveInteraction() ?? (active.kind === "drag"
        ? { ...active.node, x: active.snapped.x, y: active.snapped.y }
        : active.resizedNode);
      active.element.classList.remove("is-dragging", "is-resizing");
      activeInteractionRef.current = null;
      hideGuides();
      if (hasGeometryChanged(active.node, changedNode)) onNodeChange(changedNode);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [hideGuides, onNodeChange, renderActiveInteraction]);

  const startPointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    onSelectNode(node.id);
    const element = event.currentTarget;
    element.classList.add("is-dragging");
    activeInteractionRef.current = {
      kind: "drag",
      node,
      element,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      latestClientX: event.clientX,
      latestClientY: event.clientY,
      targets: buildSnapTargets(document.nodes, node.id, document.width, document.height),
      snapped: { x: node.x, y: node.y, verticalGuide: null, horizontalGuide: null },
    };
  }, [document.height, document.nodes, document.width, onSelectNode]);

  const startPointerResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode, direction: ResizeDirection) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectNode(node.id);
    const element = event.currentTarget.parentElement;
    if (!(element instanceof HTMLDivElement)) return;
    element.classList.add("is-resizing");
    activeInteractionRef.current = {
      kind: "resize",
      node,
      element,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      latestClientX: event.clientX,
      latestClientY: event.clientY,
      direction,
      resizedNode: node,
    };
  }, [onSelectNode]);

  const allowDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!editable || !event.dataTransfer.types.includes(CANVAS_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const dropComponent = (event: DragEvent<HTMLDivElement>) => {
    if (!editable) return;
    event.preventDefault();
    const rawType = event.dataTransfer.getData(CANVAS_DRAG_TYPE);
    if (!isCanvasNodeType(rawType)) return;
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const size = defaultNodeSizes[rawType];
    const x = Math.min(Math.max((event.clientX - bounds.left) / scaleRef.current - size.width / 2, 0), Math.max(document.width - size.width, 0));
    const y = Math.min(Math.max((event.clientY - bounds.top) / scaleRef.current - size.height / 2, 0), Math.max(document.height - size.height, 0));
    onCreateNode(rawType, Math.round(x), Math.round(y));
  };

  return (
    <div className="canvas-viewport" ref={viewportRef}>
      <div className="canvas-scale-frame" style={{ height: document.height * scale, width: document.width * scale }}>
        <div
          className={`canvas-surface${editable ? " is-editable" : " is-preview"}`}
          onClick={(event) => { if (event.target === event.currentTarget) onSelectNode(null); }}
          onDragOver={allowDrop}
          onDrop={dropComponent}
          ref={surfaceRef}
          style={{ backgroundColor: document.backgroundColor, height: document.height, transform: `scale(${scale})`, width: document.width }}
        >
          {document.nodes.map((node) => (
            <CanvasNodeView
              editable={editable}
              key={node.id}
              node={node}
              onModelSceneChange={onModelSceneChange}
              onModelSceneNodeSelect={onModelSceneNodeSelect}
              onPointerDown={startPointerDrag}
              onResizePointerDown={startPointerResize}
              projectId={document.projectId}
              selected={node.id === selectedNodeId}
              selectedModelSceneNodePath={
                node.id === selectedNodeId ? selectedModelSceneNodePath : null
              }
            />
          ))}
          {editable && document.nodes.length === 0 ? <div className="canvas-empty-hint"><span>↘</span><strong>从左侧拖入组件</strong><p>组件落入后可继续拖动，靠近画布或其他组件边缘时会自动吸附。</p></div> : null}
          <div className="canvas-guide canvas-guide-vertical" ref={verticalGuideRef} />
          <div className="canvas-guide canvas-guide-horizontal" ref={horizontalGuideRef} />
        </div>
      </div>
    </div>
  );
}
