import { INTERACTION_EVENTS, interactionScalar, validateInteractions, type InteractionAction, type InteractionCondition, type InteractionDefinition, type InteractionEvent, type InteractionRule, type InteractionValue, type Scalar } from "./interactions";

export type InteractionHost = {
  metric: (assetId: string, metricKey: string) => Scalar | undefined;
  perform: (action: InteractionAction, value: Scalar | undefined, signal: AbortSignal) => Promise<InteractionEvent[] | void> | InteractionEvent[] | void;
};
export type InteractionTrace = { id: number; time: number; rootId: number; ruleId?: string; actionIndex?: number;
  status: "event" | "started" | "succeeded" | "skipped" | "failed" | "cancelled" | "limited"; message: string };
export type InteractionSnapshot = { states: Record<string, Scalar>; traces: InteractionTrace[]; active: number; pageId: string | null };
type Chain = { id: number; remaining: number; controller: AbortController; pending: number };
type Run = { rule: InteractionRule; controller: AbortController; chain: Chain };
type Envelope = { event: InteractionEvent; chain: Chain; pageId: string | null; generation: number };
const abortError = () => new Error("执行已取消");

export function resolveInteractionValue(value: InteractionValue, event: InteractionEvent, states: ReadonlyMap<string, Scalar>, metric: InteractionHost["metric"]): Scalar | undefined {
  if (value.kind === "literal") return value.value;
  if (value.kind === "state") return states.get(value.stateId);
  if (value.kind === "event") return event[value.field];
  return metric(value.assetId, value.metricKey);
}
/** Undefined means unknown. Negation must not turn stale/missing input into true. */
export function evaluateInteractionCondition(condition: InteractionCondition, resolve: (value: InteractionValue) => Scalar | undefined): boolean | undefined {
  if ("conditions" in condition) {
    const values = condition.conditions.map((item) => evaluateInteractionCondition(item, resolve));
    if (condition.op === "all") return values.includes(false) ? false : values.includes(undefined) ? undefined : true;
    return values.includes(true) ? true : values.includes(undefined) ? undefined : false;
  }
  if ("condition" in condition) { const value = evaluateInteractionCondition(condition.condition, resolve); return value === undefined ? undefined : !value; }
  if ("value" in condition) return resolve(condition.value) !== undefined;
  const left = resolve(condition.left), right = resolve(condition.right);
  if (left === undefined || right === undefined) return undefined;
  if (condition.op === "eq") return left === right;
  if (condition.op === "ne") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return undefined;
  if (condition.op === "gt") return left > right;
  if (condition.op === "gte") return left >= right;
  if (condition.op === "lt") return left < right;
  return left <= right;
}

/** One project session. Host effects never write the editor definition. */
export class InteractionRuntime {
  readonly definition: InteractionDefinition;
  private states = new Map<string, Scalar>();
  private pageId: string | null = null;
  private generation = 0;
  private traces: InteractionTrace[] = [];
  private listeners = new Set<() => void>();
  private runs = new Set<Run>();
  private chains = new Set<Chain>();
  private queue: Envelope[] = [];
  private scheduled = false;
  private disposed = false;
  private sequence = 0;
  private rootSequence = 0;
  private snapshot: InteractionSnapshot = { states: {}, traces: [], active: 0, pageId: null };
  constructor(definition: InteractionDefinition, private host: InteractionHost) {
    this.definition = validateInteractions(definition);
    this.definition.states.filter((state) => state.pageId === null).forEach((state) => this.states.set(state.id, state.initial));
    this.publish();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() {
    this.snapshot = { states: Object.fromEntries(this.states), traces: [...this.traces], active: this.runs.size, pageId: this.pageId };
    this.listeners.forEach((listener) => listener());
  }
  private log(status: InteractionTrace["status"], message: string, chain: Chain, ruleId?: string, actionIndex?: number) {
    this.traces = [...this.traces.slice(-255), { id: ++this.sequence, time: Date.now(), rootId: chain.id, ruleId, actionIndex, status, message }];
    this.publish();
  }
  clearTrace() { this.traces = []; this.publish(); }
  private finishChain(chain: Chain) { if (!chain.pending) this.chains.delete(chain); }
  private consume(chain: Chain): boolean {
    if (this.disposed || chain.controller.signal.aborted) return false;
    if (--chain.remaining >= 0) return true;
    this.log("limited", "事件链超过 128 步，已终止循环或过量动作。", chain);
    chain.controller.abort(); return false;
  }
  emit(event: InteractionEvent) {
    if (this.disposed) return;
    const chain: Chain = { id: ++this.rootSequence, remaining: 128, controller: new AbortController(), pending: 0 };
    if (this.chains.size >= 32) { this.log("limited", "同时执行的事件链达到 32 条，本次事件未执行。", chain); return; }
    this.chains.add(chain);
    try { this.enqueue(event, chain, this.pageId); }
    catch (reason) { this.log("failed", reason instanceof Error ? reason.message : String(reason), chain); this.finishChain(chain); }
  }
  private enqueue(event: InteractionEvent, chain: Chain, pageId: string | null = null) {
    if (!this.consume(chain)) { this.finishChain(chain); return; }
    // Copy event payload: callers cannot mutate a queued event.
    if (!INTERACTION_EVENTS.includes(event.type)) throw new Error("事件类型无效。");
    const copy: InteractionEvent = { type: event.type };
    for (const field of ["sourceId", "assetId", "metricKey", "status"] as const) if (event[field] !== undefined) {
      if (typeof event[field] !== "string" || event[field]!.length > 2000) throw new Error("事件标识无效。");
      copy[field] = event[field];
    }
    for (const field of ["value", "previous"] as const) if (event[field] !== undefined) copy[field] = interactionScalar(event[field]);
    chain.pending++; this.queue.push({ event: copy, chain, pageId, generation: this.generation });
    if (!this.scheduled) { this.scheduled = true; queueMicrotask(() => this.drain()); }
  }
  private drain() {
    this.scheduled = false;
    while (this.queue.length) {
      const { event, chain, pageId, generation } = this.queue.shift()!;
      try {
      if (!this.disposed && !chain.controller.signal.aborted && (pageId === null || (pageId === this.pageId && generation === this.generation))) {
        this.log("event", `${event.type}${event.sourceId ? ` · ${event.sourceId}` : ""}`, chain);
        for (const rule of this.definition.rules) {
          if (!rule.enabled || (rule.pageId !== null && rule.pageId !== this.pageId)) continue;
          if (rule.trigger.type !== event.type || (rule.trigger.sourceId !== undefined && rule.trigger.sourceId !== event.sourceId) || (rule.trigger.metricKey !== undefined && rule.trigger.metricKey !== event.metricKey)) continue;
          if (!this.consume(chain)) break;
          const resolve = (value: InteractionValue) => resolveInteractionValue(value, event, this.states, this.host.metric);
          if (rule.condition && evaluateInteractionCondition(rule.condition, resolve) !== true) { this.log("skipped", "条件未满足或数据不可用。", chain, rule.id); continue; }
          const previous = [...this.runs].filter((run) => run.rule.id === rule.id && !run.controller.signal.aborted);
          if (previous.length && rule.reentry === "ignore") { this.log("skipped", "上次执行尚未结束，忽略本次触发。", chain, rule.id); continue; }
          previous.forEach((run) => run.controller.abort());
          if (this.runs.size >= 64) { this.log("limited", "并发规则达到 64 条，本次规则未执行。", chain, rule.id); continue; }
          const run: Run = { rule, chain, controller: new AbortController() };
          const abort = () => run.controller.abort();
          chain.controller.signal.addEventListener("abort", abort, { once: true });
          this.runs.add(run); chain.pending++;
          void this.execute(run, event).finally(() => {
            chain.controller.signal.removeEventListener("abort", abort);
            this.runs.delete(run); chain.pending--; this.finishChain(chain); this.publish();
          });
        }
      }
      } catch (reason) { this.log("failed", reason instanceof Error ? reason.message : String(reason), chain); }
      finally { chain.pending--; this.finishChain(chain); }
    }
  }
  private async execute(run: Run, event: InteractionEvent) {
    const { chain, rule, controller } = run;
    const signal = controller.signal;
    this.log("started", rule.name, chain, rule.id);
    let index = 0;
    try {
      for (const action of rule.actions) {
        if (signal.aborted || !this.consume(chain)) throw abortError();
        const value = "value" in action ? resolveInteractionValue(action.value, event, this.states, this.host.metric) : undefined;
        if ("value" in action && value === undefined) throw new Error("动作取值不可用，后续动作未执行。");
        if (action.type === "state.set") {
          const state = this.definition.states.find((item) => item.id === action.stateId);
          if (!state || !this.states.has(state.id)) throw new Error("状态未定义或不属于当前页面。");
          if (value !== null && typeof value !== state.valueType) throw new Error("状态值类型不匹配。");
          const previous = this.states.get(state.id)!;
          if (previous !== value) { this.states.set(state.id, value!); this.enqueue({ type: "state.change", sourceId: state.id, value, previous }, chain, rule.pageId); }
        } else if (action.type === "event.emit") {
          this.enqueue({ type: "custom", sourceId: action.name, value }, chain, rule.pageId);
        } else if (action.type === "delay") {
          await abortableWait(action.milliseconds, signal);
        } else {
          const result = await abortableEffect(() => this.host.perform(action, value, signal), signal);
          if (signal.aborted) throw abortError();
          for (const emitted of result ?? []) this.enqueue(emitted, chain, rule.pageId);
          if (action.type === "page.navigate") this.setPage(action.pageId, chain);
        }
        if (signal.aborted) throw abortError();
        this.log("succeeded", action.type, chain, rule.id, index++);
      }
      this.log("succeeded", "规则执行完成。", chain, rule.id);
    } catch (reason) {
      const cancelled = signal.aborted || chain.controller.signal.aborted;
      controller.abort();
      this.log(cancelled ? "cancelled" : "failed", reason instanceof Error ? reason.message : String(reason), chain, rule.id, index);
    }
  }
  setPage(pageId: string, chain?: Chain) {
    if (this.disposed || this.pageId === pageId) return;
    this.generation++;
    for (const run of this.runs) if (run.rule.pageId !== null) run.controller.abort();
    for (const state of this.definition.states) if (state.pageId !== null) {
      if (state.pageId === pageId) this.states.set(state.id, state.initial); else this.states.delete(state.id);
    }
    this.pageId = pageId; this.publish();
    if (chain) this.enqueue({ type: "page.enter", sourceId: pageId }, chain, pageId);
    else this.emit({ type: "page.enter", sourceId: pageId });
  }
  cancelAll() {
    for (const chain of this.chains) chain.controller.abort();
    for (const { chain } of this.queue) { chain.pending--; this.finishChain(chain); }
    this.queue = [];
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.cancelAll(); this.listeners.clear(); }
}

function abortableWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Bounds a host failure even if its implementation ignores cancellation. */
function abortableEffect(effect: () => ReturnType<InteractionHost["perform"]>, signal: AbortSignal): Promise<InteractionEvent[] | void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("动作执行超过 60 秒。")); }, 60000);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw abortError(); return effect(); }).then((result) => { cleanup(); resolve(result); }, (reason) => { cleanup(); reject(reason); });
  });
}
