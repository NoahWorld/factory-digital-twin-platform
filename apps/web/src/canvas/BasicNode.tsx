import { memo, useEffect, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { imageAssetContentUrl } from "./image-assets";
import {
  parseBasicProps,
  type BasicOption,
  type BasicNodeType,
  type ButtonProps,
  type CanvasNode,
  type CarouselProps,
  type CheckboxGroupProps,
  type FullscreenToggleProps,
  type ImageProps,
  type PlainTextProps,
  type RadioGroupProps,
  type SelectProps,
  type SwitchProps,
  type TextLinkProps,
} from "./types";

let carouselTimestamp = Date.now();
let carouselTimer: ReturnType<typeof setInterval> | null = null;
const carouselSubscribers = new Set<() => void>();

const subscribeCarouselClock = (subscriber: () => void) => {
  carouselSubscribers.add(subscriber);
  if (!carouselTimer) {
    carouselTimer = setInterval(() => {
      carouselTimestamp = Date.now();
      carouselSubscribers.forEach((currentSubscriber) => currentSubscriber());
    }, 1_000);
  }
  return () => {
    carouselSubscribers.delete(subscriber);
    if (carouselSubscribers.size === 0 && carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  };
};

const getCarouselTimestamp = () => carouselTimestamp;
const getCarouselServerTimestamp = () => 0;

const fullscreenSubscribers = new Set<() => void>();
let fullscreenListenerAttached = false;
const notifyFullscreenSubscribers = () => fullscreenSubscribers.forEach((subscriber) => subscriber());
const subscribeFullscreen = (subscriber: () => void) => {
  if (typeof document === "undefined") return () => undefined;
  fullscreenSubscribers.add(subscriber);
  if (!fullscreenListenerAttached) {
    document.addEventListener("fullscreenchange", notifyFullscreenSubscribers);
    fullscreenListenerAttached = true;
  }
  return () => {
    fullscreenSubscribers.delete(subscriber);
    if (fullscreenSubscribers.size === 0 && fullscreenListenerAttached) {
      document.removeEventListener("fullscreenchange", notifyFullscreenSubscribers);
      fullscreenListenerAttached = false;
    }
  };
};
const getFullscreenSnapshot = () => typeof document !== "undefined" && document.fullscreenElement !== null;
const getFullscreenServerSnapshot = () => false;

const baseStyle = (
  props: { textColor: string; accentColor: string; fillColor: string; borderColor: string; borderRadius: number },
): CSSProperties => ({
  "--basic-accent": props.accentColor,
  "--basic-border": props.borderColor,
  "--basic-fill": props.fillColor,
  "--basic-radius": `${props.borderRadius}px`,
  "--basic-text": props.textColor,
} as CSSProperties);

const preventEditorNavigation = (editable: boolean) => (event: MouseEvent) => {
  if (editable) event.preventDefault();
};

function ImageError({ message }: { message: string }) {
  return <span className="basic-image-empty" role="alert"><span aria-hidden="true">▧</span><strong>{message}</strong></span>;
}

function ImageNode({ node, projectId, props }: { node: CanvasNode; projectId: string; props: ImageProps }) {
  const assetId = node.resourceRefs[0] ?? null;
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null);

  useEffect(() => setFailedAssetId(null), [assetId]);

  return (
    <div
      className="basic-image-node"
      style={{ backgroundColor: props.backgroundColor, borderColor: props.borderColor, borderRadius: props.borderRadius }}
    >
      {assetId && failedAssetId !== assetId ? (
        <img
          alt={props.alt}
          draggable={false}
          onError={() => setFailedAssetId(assetId)}
          src={imageAssetContentUrl(projectId, assetId)}
          style={{ objectFit: props.fit }}
        />
      ) : assetId ? <ImageError message="图片加载失败" /> : null}
    </div>
  );
}

function CarouselNode({ editable, node, projectId, props }: { editable: boolean; node: CanvasNode; projectId: string; props: CarouselProps }) {
  const timestamp = useSyncExternalStore(
    props.autoplay && !editable && node.resourceRefs.length > 1 ? subscribeCarouselClock : () => () => undefined,
    getCarouselTimestamp,
    getCarouselServerTimestamp,
  );
  const automaticIndex = node.resourceRefs.length > 0
    ? Math.floor(timestamp / (props.interval * 1_000)) % node.resourceRefs.length
    : 0;
  const [manualIndex, setManualIndex] = useState<number | null>(null);
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null);
  const activeIndex = manualIndex === null ? automaticIndex : manualIndex % Math.max(node.resourceRefs.length, 1);
  const assetId = node.resourceRefs[activeIndex] ?? null;

  useEffect(() => {
    setManualIndex(null);
    setFailedAssetId(null);
  }, [node.id, node.resourceRefs.join("|"), props.interval, props.autoplay]);

  const move = (direction: -1 | 1) => {
    if (editable || node.resourceRefs.length < 2) return;
    setManualIndex((activeIndex + direction + node.resourceRefs.length) % node.resourceRefs.length);
  };

  return (
    <div
      className="basic-carousel-node"
      style={{ backgroundColor: props.backgroundColor, borderColor: props.borderColor, borderRadius: props.borderRadius }}
    >
      {assetId && failedAssetId !== assetId ? (
        <img
          alt={`${props.alt} ${activeIndex + 1}`}
          draggable={false}
          onError={() => setFailedAssetId(assetId)}
          src={imageAssetContentUrl(projectId, assetId)}
          style={{ objectFit: props.fit }}
        />
      ) : assetId ? <ImageError message="轮播图片加载失败" /> : null}
      {props.showArrows && node.resourceRefs.length > 1 ? (
        <>
          <button aria-label="上一张" className="basic-carousel-arrow is-previous" disabled={editable} onClick={() => move(-1)} type="button">‹</button>
          <button aria-label="下一张" className="basic-carousel-arrow is-next" disabled={editable} onClick={() => move(1)} type="button">›</button>
        </>
      ) : null}
      {props.showDots && node.resourceRefs.length > 1 ? (
        <span className="basic-carousel-dots">
          {node.resourceRefs.map((resourceId, index) => (
            <button
              aria-label={`显示第 ${index + 1} 张`}
              className={index === activeIndex ? "is-active" : ""}
              disabled={editable}
              key={resourceId}
              onClick={() => setManualIndex(index)}
              type="button"
            />
          ))}
        </span>
      ) : null}
    </div>
  );
}

function PlainTextNode({ node, props }: { node: CanvasNode; props: PlainTextProps }) {
  const style = {
    ...baseStyle(props),
    "--basic-font-size": `${Math.min(props.fontSize, Math.max(12, node.height * 0.62))}px`,
    "--basic-font-weight": props.fontWeight,
    "--basic-scroll-duration": `${props.scrollDuration}s`,
    textAlign: props.align,
  } as CSSProperties;
  return (
    <div className={`basic-text-node is-scroll-${props.scrollMode}`} style={style}>
      <span>{props.text}</span>
      {props.scrollMode === "horizontal" ? <span aria-hidden="true">{props.text}</span> : null}
    </div>
  );
}

function TextLinkNode({ editable, node, props }: { editable: boolean; node: CanvasNode; props: TextLinkProps }) {
  return (
    <a
      className="basic-link-node"
      href={props.href}
      onClick={preventEditorNavigation(editable)}
      rel={props.openInNewTab ? "noopener noreferrer" : undefined}
      style={{
        ...baseStyle(props),
        fontSize: Math.min(props.fontSize, Math.max(12, node.height * 0.52)),
        fontWeight: props.fontWeight,
        justifyContent: props.align === "left" ? "flex-start" : props.align === "right" ? "flex-end" : "center",
        textDecoration: props.underline ? "underline" : "none",
      }}
      tabIndex={editable ? -1 : 0}
      target={props.openInNewTab ? "_blank" : undefined}
    >
      {props.text}
    </a>
  );
}

function ButtonNode({ editable, node, props }: { editable: boolean; node: CanvasNode; props: ButtonProps }) {
  const content = (
    <span
      className={`basic-button-node${props.disabled ? " is-disabled" : ""}`}
      style={{
        ...baseStyle(props),
        fontSize: Math.min(props.fontSize, Math.max(12, node.height * 0.42)),
        fontWeight: props.fontWeight,
      }}
    >
      {props.text}
    </span>
  );
  if (!props.href || props.disabled) return content;
  return (
    <a
      className="basic-button-link"
      href={props.href}
      onClick={preventEditorNavigation(editable)}
      rel={props.openInNewTab ? "noopener noreferrer" : undefined}
      tabIndex={editable ? -1 : 0}
      target={props.openInNewTab ? "_blank" : undefined}
    >
      {content}
    </a>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {active ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      )}
    </svg>
  );
}

function FullscreenToggleNode({ editable, node, props }: { editable: boolean; node: CanvasNode; props: FullscreenToggleProps }) {
  const fullscreen = useSyncExternalStore(subscribeFullscreen, getFullscreenSnapshot, getFullscreenServerSnapshot);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [fullscreen, node.id]);

  const toggleFullscreen = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (editable || props.disabled) return;

    setError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (!document.fullscreenEnabled) {
        throw new Error("当前浏览器或页面策略未开放全屏权限");
      }
      const target = event.currentTarget.closest<HTMLElement>("[data-canvas-fullscreen-root]");
      if (!target) {
        throw new Error("没有找到可全屏显示的画布容器");
      }
      await target.requestFullscreen();
    } catch (reason) {
      const message = reason instanceof Error && reason.message
        ? `全屏切换失败：${reason.message}`
        : "全屏切换失败：浏览器拒绝了请求";
      setError(message);
      console.error("[fullscreen-toggle] Fullscreen API request failed.", { nodeId: node.id, reason });
    }
  };

  const label = error ? "全屏失败" : fullscreen ? props.exitText : props.enterText;
  return (
    <button
      aria-disabled={editable || props.disabled}
      aria-label={error ?? label}
      className={`basic-fullscreen-toggle-node${fullscreen ? " is-fullscreen" : ""}${props.disabled ? " is-disabled" : ""}${error ? " is-error" : ""}`}
      disabled={props.disabled}
      onClick={(event) => void toggleFullscreen(event)}
      style={{
        ...baseStyle(props),
        fontSize: Math.min(props.fontSize, Math.max(12, node.height * 0.42)),
        fontWeight: props.fontWeight,
      }}
      tabIndex={editable ? -1 : 0}
      title={error ?? (editable ? "进入预览后可切换画布全屏" : label)}
      type="button"
    >
      <FullscreenIcon active={fullscreen} />
      <span>{label}</span>
    </button>
  );
}

function SwitchNode({ editable, props }: { editable: boolean; props: SwitchProps }) {
  const [checked, setChecked] = useState(props.defaultChecked);
  useEffect(() => setChecked(props.defaultChecked), [props.defaultChecked]);
  return (
    <label className="basic-switch-node" style={baseStyle(props)}>
      <span>{props.label}</span>
      <input checked={checked} disabled={editable} onChange={(event) => setChecked(event.target.checked)} type="checkbox" />
      <span className="basic-switch-track" aria-hidden="true"><i /></span>
      <strong>{checked ? props.onText : props.offText}</strong>
    </label>
  );
}

function ChoiceOptions({
  columns,
  editable,
  multiple,
  name,
  onChange,
  options,
  selectedValues,
}: {
  columns: number;
  editable: boolean;
  multiple: boolean;
  name: string;
  onChange: (value: string, checked: boolean) => void;
  options: BasicOption[];
  selectedValues: Set<string>;
}) {
  return (
    <span className="basic-choice-options" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <label key={option.value}>
          <input
            checked={selectedValues.has(option.value)}
            disabled={editable}
            name={name}
            onChange={(event) => onChange(option.value, event.target.checked)}
            type={multiple ? "checkbox" : "radio"}
          />
          <i aria-hidden="true" />
          <span>{option.label}</span>
        </label>
      ))}
    </span>
  );
}

function CheckboxGroupNode({ editable, node, props }: { editable: boolean; node: CanvasNode; props: CheckboxGroupProps }) {
  const [selectedValues, setSelectedValues] = useState(() => new Set(props.selectedValues));
  useEffect(() => setSelectedValues(new Set(props.selectedValues)), [node.id, props.selectedValues.join("|")]);
  return (
    <fieldset className="basic-choice-node" style={baseStyle(props)}>
      {props.title ? <legend>{props.title}</legend> : null}
      <ChoiceOptions
        columns={props.columns}
        editable={editable}
        multiple
        name={`checkbox-${node.id}`}
        onChange={(value, checked) => setSelectedValues((current) => {
          const next = new Set(current);
          if (checked) next.add(value);
          else next.delete(value);
          return next;
        })}
        options={props.options}
        selectedValues={selectedValues}
      />
    </fieldset>
  );
}

function RadioGroupNode({ editable, node, props }: { editable: boolean; node: CanvasNode; props: RadioGroupProps }) {
  const [selectedValue, setSelectedValue] = useState(props.selectedValue);
  useEffect(() => setSelectedValue(props.selectedValue), [node.id, props.selectedValue]);
  return (
    <fieldset className="basic-choice-node" style={baseStyle(props)}>
      {props.title ? <legend>{props.title}</legend> : null}
      <ChoiceOptions
        columns={props.columns}
        editable={editable}
        multiple={false}
        name={`radio-${node.id}`}
        onChange={(value) => setSelectedValue(value)}
        options={props.options}
        selectedValues={new Set(selectedValue ? [selectedValue] : [])}
      />
    </fieldset>
  );
}

function SelectNode({ editable, node, props }: { editable: boolean; node: CanvasNode; props: SelectProps }) {
  const [selectedValue, setSelectedValue] = useState(props.selectedValue);
  useEffect(() => setSelectedValue(props.selectedValue), [node.id, props.selectedValue]);
  return (
    <label className="basic-select-node" style={baseStyle(props)}>
      {props.label ? <span>{props.label}</span> : null}
      <select disabled={editable} onChange={(event) => setSelectedValue(event.target.value)} value={selectedValue}>
        <option value="">{props.placeholder}</option>
        {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export const BasicNode = memo(function BasicNode({
  editable,
  node,
  projectId,
}: {
  editable: boolean;
  node: CanvasNode;
  projectId: string;
}) {
  const parsed = parseBasicProps(node.type as BasicNodeType, node.props);
  if (!parsed.ok) {
    return <div className="basic-node-error" role="alert">组件配置无效：{parsed.message}</div>;
  }

  if (node.type === "plain-text") return <PlainTextNode node={node} props={parsed.value as PlainTextProps} />;
  if (node.type === "text-link") return <TextLinkNode editable={editable} node={node} props={parsed.value as TextLinkProps} />;
  if (node.type === "image") return <ImageNode node={node} projectId={projectId} props={parsed.value as ImageProps} />;
  if (node.type === "carousel") return <CarouselNode editable={editable} node={node} projectId={projectId} props={parsed.value as CarouselProps} />;
  if (node.type === "button") return <ButtonNode editable={editable} node={node} props={parsed.value as ButtonProps} />;
  if (node.type === "fullscreen-toggle") return <FullscreenToggleNode editable={editable} node={node} props={parsed.value as FullscreenToggleProps} />;
  if (node.type === "switch") return <SwitchNode editable={editable} props={parsed.value as SwitchProps} />;
  if (node.type === "checkbox-group") return <CheckboxGroupNode editable={editable} node={node} props={parsed.value as CheckboxGroupProps} />;
  if (node.type === "radio-group") return <RadioGroupNode editable={editable} node={node} props={parsed.value as RadioGroupProps} />;
  if (node.type === "select") return <SelectNode editable={editable} node={node} props={parsed.value as SelectProps} />;

  return <div className="basic-node-error" role="alert">不支持的基础组件：{node.type}</div>;
});
