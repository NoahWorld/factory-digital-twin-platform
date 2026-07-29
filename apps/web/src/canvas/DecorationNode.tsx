import { memo, useSyncExternalStore, type CSSProperties } from "react";
import {
  componentLabels,
  isDecorationNodeType,
  parseDecorationProps,
  type CanvasNode,
  type DecorationProps,
} from "./types";

type DecorationNodeProps = {
  node: CanvasNode;
};

type DecorationStyle = CSSProperties & {
  "--decoration-accent": string;
  "--decoration-border": string;
  "--decoration-fill": string;
  "--decoration-text": string;
};

let clockSnapshot = Date.now();
let clockTimer: number | null = null;
const clockListeners = new Set<() => void>();

const publishClock = () => {
  clockSnapshot = Date.now();
  for (const listener of clockListeners) listener();
};

const subscribeClock = (listener: () => void) => {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockTimer = window.setInterval(publishClock, 1_000);
  }

  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
};

const subscribeStatic = () => () => undefined;
const getClockSnapshot = () => clockSnapshot;

const formatClock = (timestamp: number, showDate: boolean, showSeconds: boolean) => {
  const date = new Date(timestamp);
  const dateText = showDate
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      }).format(date)
    : "";
  const timeText = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(date);

  return { dateText, timeText };
};

const decorationStyle = (props: DecorationProps): DecorationStyle => ({
  "--decoration-accent": props.accentColor,
  "--decoration-border": props.borderColor,
  "--decoration-fill": props.fillColor,
  "--decoration-text": props.textColor,
  opacity: props.opacity,
});

export const DecorationNode = memo(function DecorationNode({ node }: DecorationNodeProps) {
  if (!isDecorationNodeType(node.type)) {
    throw new Error(`DecorationNode received unsupported node type: ${node.type}`);
  }

  const result = parseDecorationProps(node.type, node.props);
  const timestamp = useSyncExternalStore(
    node.type === "datetime" ? subscribeClock : subscribeStatic,
    getClockSnapshot,
    getClockSnapshot,
  );

  if (!result.ok) {
    return (
      <div className="decoration-invalid" role="alert">
        <strong>{componentLabels[node.type]}配置无效</strong>
        <span>{result.message}</span>
      </div>
    );
  }

  const props = result.value;
  const style = decorationStyle(props);
  const alignClassName = ` is-align-${props.align}`;

  if (node.type === "screen-title") {
    return (
      <div className={`decoration-node decoration-screen-title${alignClassName}`} style={style}>
        <span className="decoration-screen-wing is-left" />
        <span className="decoration-screen-center">
          <strong>{props.text}</strong>
          {props.subtitle ? <small>{props.subtitle}</small> : null}
        </span>
        <span className="decoration-screen-wing is-right" />
      </div>
    );
  }

  if (node.type === "background-decoration") {
    return (
      <div className="decoration-node decoration-background" style={style}>
        <span className="decoration-background-grid" />
        <span className="decoration-background-orbit is-outer" />
        <span className="decoration-background-orbit is-inner" />
        <span className="decoration-background-core" />
      </div>
    );
  }

  if (node.type === "datetime") {
    const formatted = formatClock(timestamp, props.showDate, props.showSeconds);
    return (
      <div className={`decoration-node decoration-datetime${alignClassName}`} style={style}>
        <span className="decoration-datetime-mark" />
        <span className="decoration-datetime-content">
          <small>{props.text}</small>
          {formatted.dateText ? <span>{formatted.dateText}</span> : null}
          <strong>{formatted.timeText}</strong>
        </span>
      </div>
    );
  }

  if (node.type === "section-title") {
    return (
      <div className={`decoration-node decoration-section-title${alignClassName}`} style={style}>
        <span className="decoration-section-mark" />
        <strong>{props.text}</strong>
        <span className="decoration-section-line" />
      </div>
    );
  }

  if (node.type === "card-background") {
    return (
      <div className="decoration-node decoration-card-background" style={style}>
        <span className="decoration-card-scanline" />
        <span className="decoration-corner is-north-west" />
        <span className="decoration-corner is-north-east" />
        <span className="decoration-corner is-south-east" />
        <span className="decoration-corner is-south-west" />
      </div>
    );
  }

  return (
    <div className="decoration-node decoration-icon-background" style={style}>
      <span className="decoration-icon-diamond is-outer" />
      <span className="decoration-icon-diamond is-inner" />
      <strong>{props.text}</strong>
    </div>
  );
});
