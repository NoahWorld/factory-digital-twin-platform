import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChartNode } from "./ChartNode";
import { buildSnapTargets, snapNodePosition, type SnapTargets, type SnappedPosition } from "./geometry";
import { CANVAS_DRAG_TYPE, isCanvasNodeType, type CanvasDocument, type CanvasNode, type CanvasNodeType } from "./types";

type ActiveDrag = {
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

type CanvasNodeViewProps = {
  editable: boolean;
  node: CanvasNode;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => void;
};

const CanvasNodeView = memo(function CanvasNodeView({ editable, node, selected, onPointerDown }: CanvasNodeViewProps) {
  return (
    <div
      aria-label={`${node.type} 组件`}
      className={`canvas-node${selected ? " is-selected" : ""}${editable ? " is-editable" : ""}`}
      data-node-id={node.id}
      onPointerDown={editable ? (event) => onPointerDown(event, node) : undefined}
      role="group"
      style={{ height: node.height, transform: `translate3d(${node.x}px, ${node.y}px, 0)`, width: node.width, zIndex: node.zIndex }}
    >
      <ChartNode node={node} />
      {editable ? <span className="canvas-node-drag-hint">拖动</span> : null}
    </div>
  );
});

type CanvasSurfaceProps = {
  document: CanvasDocument;
  editable: boolean;
  selectedNodeId: string | null;
  onCreateNode: (type: CanvasNodeType, x: number, y: number) => void;
  onNodeChange: (node: CanvasNode) => void;
  onSelectNode: (nodeId: string | null) => void;
};

export function CanvasSurface({ document, editable, selectedNodeId, onCreateNode, onNodeChange, onSelectNode }: CanvasSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const verticalGuideRef = useRef<HTMLDivElement>(null);
  const horizontalGuideRef = useRef<HTMLDivElement>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
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

  const renderActiveDrag = useCallback((): SnappedPosition | null => {
    const active = activeDragRef.current;
    if (!active) return null;

    const rawX = active.node.x + (active.latestClientX - active.startClientX) / scaleRef.current;
    const rawY = active.node.y + (active.latestClientY - active.startClientY) / scaleRef.current;
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
    return snapped;
  }, [document.height, document.width]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const active = activeDragRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      active.latestClientX = event.clientX;
      active.latestClientY = event.clientY;
      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = null;
          renderActiveDrag();
        });
      }
    };

    const finishPointer = (event: PointerEvent) => {
      const active = activeDragRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      active.latestClientX = event.clientX;
      active.latestClientY = event.clientY;
      const snapped = renderActiveDrag() ?? active.snapped;
      active.element.classList.remove("is-dragging");
      activeDragRef.current = null;
      hideGuides();
      onNodeChange({ ...active.node, x: snapped.x, y: snapped.y });
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
  }, [hideGuides, onNodeChange, renderActiveDrag]);

  const startPointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    onSelectNode(node.id);
    const element = event.currentTarget;
    element.classList.add("is-dragging");
    activeDragRef.current = {
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
    const x = Math.min(Math.max((event.clientX - bounds.left) / scaleRef.current - 260, 0), Math.max(document.width - 520, 0));
    const y = Math.min(Math.max((event.clientY - bounds.top) / scaleRef.current - 30, 0), Math.max(document.height - 300, 0));
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
          {document.nodes.map((node) => <CanvasNodeView editable={editable} key={node.id} node={node} onPointerDown={startPointerDrag} selected={node.id === selectedNodeId} />)}
          {editable && document.nodes.length === 0 ? <div className="canvas-empty-hint"><span>↘</span><strong>从左侧拖入图表组件</strong><p>组件落入后可继续拖动，靠近画布或其他组件边缘时会自动吸附。</p></div> : null}
          <div className="canvas-guide canvas-guide-vertical" ref={verticalGuideRef} />
          <div className="canvas-guide canvas-guide-horizontal" ref={horizontalGuideRef} />
        </div>
      </div>
    </div>
  );
}
