import { Children, Fragment, isValidElement, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./select.css";

type SelectOption = { value: string; label: string; disabled: boolean };
type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean; label?: string };

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return textContent(child.props.children);
    return "";
  }).join("");
}

/** Options remain declarative, but no OS-native select or popup is rendered. */
export function readSelectOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child): SelectOption[] => {
    if (!isValidElement<OptionProps>(child)) throw new Error("Select 的子项必须是 option 或 Fragment。");
    if (child.type === Fragment) return readSelectOptions(child.props.children);
    if (child.type !== "option") throw new Error("Select 不支持自定义子组件；请直接传入 option。");
    const label = child.props.label ?? textContent(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) }];
  });
}

type SelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange" | "children" | "type"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  required?: boolean;
};

export function Select({ value, onValueChange, children, disabled, required, name, className = "", id, onKeyDown, onClick, onBlur, ...props }: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-options`;
  const options = useMemo(() => readSelectOptions(children), [children]);
  const selectedIndex = options.findIndex((option) => option.value === String(value));
  const selectedLabel = options[selectedIndex]?.label ?? (value === "" ? "暂无选项" : `不可用（${value}）`);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [label, setLabel] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (props["aria-label"] || props["aria-labelledby"]) return;
    const labels = Array.from(trigger.current?.labels ?? []);
    setLabel(labels.map((element) => element.querySelector(":scope > span")?.textContent ?? element.textContent).join(" ").trim() || undefined);
  }, [props["aria-label"], props["aria-labelledby"], children]);

  const available = (index: number) => index >= 0 && index < options.length && !options[index].disabled;
  const first = options.findIndex((option) => !option.disabled);
  const last = options.reduce((index, option, current) => option.disabled ? index : current, -1);
  function show(index = available(selectedIndex) ? selectedIndex : first) {
    if (trigger.current?.matches(":disabled")) return;
    search.current = { text: "", at: 0 };
    setActiveIndex(index);
    setPlacement({ visibility: "hidden" });
    setOpen(true);
  }
  function choose(index: number) {
    if (!available(index) || trigger.current?.matches(":disabled")) return;
    setOpen(false);
    setInvalid(false);
    if (options[index].value !== String(value)) onValueChange(options[index].value);
  }

  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const anchor = trigger.current;
    const list = popup.current;
    // The browser top layer escapes clipping and also works inside dialogs/fullscreen.
    list.showPopover();
    function position() {
      const rect = anchor.getBoundingClientRect();
      if (anchor.matches(":disabled") || rect.bottom <= 0 || rect.top >= window.innerHeight) {
        setOpen(false);
        return;
      }
      const margin = 8;
      const below = window.innerHeight - rect.bottom - margin - 6;
      const above = rect.top - margin - 6;
      const upwards = below < Math.min(280, list.scrollHeight) && above > below;
      const maxHeight = Math.max(40, Math.min(320, upwards ? above : below));
      const width = Math.min(window.innerWidth - margin * 2, Math.max(rect.width, Math.min(380, selectedLabel.length * 10 + 52)));
      setPlacement({
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        top: upwards ? Math.max(margin, rect.top - Math.min(list.scrollHeight, maxHeight) - 6) : rect.bottom + 6,
        width, maxHeight,
      });
    }
    function outside(event: Event) {
      if (event.target instanceof Node && !list.contains(event.target) && !anchor.contains(event.target)) setOpen(false);
    }
    function scroll(event: Event) {
      if (!(event.target instanceof Node) || !list.contains(event.target)) position();
    }
    function close() { setOpen(false); }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    const disabledObserver = new MutationObserver(position);
    for (let parent: HTMLElement | null = anchor; parent; parent = parent.parentElement) {
      if (parent === anchor || parent.tagName === "FIELDSET") disabledObserver.observe(parent, { attributes: true, attributeFilter: ["disabled"] });
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("fullscreenchange", close);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      disabledObserver.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("fullscreenchange", close);
      window.removeEventListener("resize", position);
      if (list.matches(":popover-open")) list.hidePopover();
    };
  }, [open, selectedLabel]);

  useLayoutEffect(() => {
    if (!open) return;
    if (!available(activeIndex)) setActiveIndex(available(selectedIndex) ? selectedIndex : first);
    const item = popup.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    if (item && popup.current) {
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < popup.current.scrollTop) popup.current.scrollTop = top;
      else if (bottom > popup.current.scrollTop + popup.current.clientHeight) popup.current.scrollTop = bottom - popup.current.clientHeight;
    }
  }, [open, activeIndex, options, selectedIndex, first, placement]);

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const key = event.key;
    if (key === "Tab") {
      if (open) choose(activeIndex);
      setOpen(false);
      return;
    }
    if (key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      if (key === "Home" || key === "End") {
        if (!open) show(key === "Home" ? first : last);
        else setActiveIndex(key === "Home" ? first : last);
      } else if (key === "Enter" || key === " ") {
        if (open) choose(activeIndex); else show();
      } else if (!open) show();
      else if (event.altKey && key === "ArrowUp") choose(activeIndex);
      else {
        const direction = key === "ArrowDown" ? 1 : -1;
        for (let index = activeIndex + direction; index >= 0 && index < options.length; index += direction) {
          if (available(index)) { setActiveIndex(index); break; }
        }
      }
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      const previous = now - search.current.at < 700 ? search.current.text : "";
      const next = previous + key.toLocaleLowerCase();
      const query = [...next].every((character) => character === next[0]) ? next[0] : next;
      if (!open) show();
      const start = open ? activeIndex : selectedIndex;
      const match = Array.from({ length: options.length }, (_, offset) => (start + 1 + offset) % options.length)
        .find((index) => available(index) && options[index].label.toLocaleLowerCase().startsWith(query));
      search.current = { text: next, at: now };
      if (match !== undefined) setActiveIndex(match);
    }
  }

  const portalRoot = open ? trigger.current?.closest("dialog[open]") ?? document.fullscreenElement ?? document.body : null;
  return <>
    <button {...props} id={triggerId} ref={trigger} type="button" role="combobox"
      className={`ui-select-trigger ${className}`} disabled={disabled} aria-label={props["aria-label"] ?? label}
      aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox"
      aria-activedescendant={open && available(activeIndex) ? `${listId}-${activeIndex}` : undefined}
      aria-required={required || undefined} aria-invalid={invalid || props["aria-invalid"]}
      title={invalid ? "请选择一项" : props.title ?? selectedLabel}
      onKeyDown={keyDown} onBlur={onBlur}
      onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) { if (open) setOpen(false); else show(); } }}>
      <span className="ui-select-value">{selectedLabel}</span>
      <svg className="ui-select-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {(required || name) && <input className="ui-select-form-value" tabIndex={-1} aria-hidden="true" autoComplete="off"
      name={name} required={required} disabled={disabled} value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }} />}
    {invalid && <span className="ui-select-error" role="alert">请选择一项</span>}
    {open && portalRoot && createPortal(<div ref={popup} id={listId} className="ui-select-popover" popover="manual" role="listbox"
      aria-label={props["aria-label"] ?? label ?? "选项"} style={placement}
      onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => event.stopPropagation()}>
      {options.length === 0 ? <div className="ui-select-empty">暂无选项</div> : options.map((option, index) => <div
        role="option" id={`${listId}-${index}`} key={`${option.value}-${index}`} data-option-index={index}
        aria-selected={index === selectedIndex} aria-disabled={option.disabled || undefined}
        className={`ui-select-option${index === activeIndex ? " is-active" : ""}`}
        onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
        onClick={() => { choose(index); trigger.current?.focus({ preventScroll: true }); }}>
        <span>{option.label}</span><span className="ui-select-check" aria-hidden="true">{index === selectedIndex ? "✓" : ""}</span>
      </div>)}
    </div>, portalRoot)}
  </>;
}
