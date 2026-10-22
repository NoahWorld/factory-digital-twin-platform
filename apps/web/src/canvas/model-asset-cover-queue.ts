export type ModelAssetCoverState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string; errorCode: string };

export class ModelAssetCoverError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

type Listener = (state: ModelAssetCoverState) => void;
type Task<Input> = { key: string; input: Input; generation: number };

/** A single disposable renderer serves every subscriber; only completed images are cached. */
export function createModelAssetCoverQueue<Input>(options: {
  key: (input: Input) => string;
  session: () => string | null;
  render: (input: Input, signal: AbortSignal) => Promise<string>;
  report: (input: Input, error: ModelAssetCoverError, cause: unknown) => void;
  maximumEntries?: number;
  maximumBytes?: number;
  timeoutMs?: number;
}) {
  const subscribers = new Map<string, { input: Input; listeners: Set<Listener> }>();
  const pending = new Map<string, Task<Input>>();
  const cache = new Map<string, ModelAssetCoverState>();
  const queue: Task<Input>[] = [];
  let session = options.session();
  let generation = 0;
  let cacheBytes = 0;
  let running = false;
  let active: { task: Task<Input>; controller: AbortController } | null = null;
  const size = (state: ModelAssetCoverState) => state.status === "ready" ? state.url.length * 2 : 0;
  const cancelled = () => new DOMException("Model cover subscription cancelled.", "AbortError");
  const sessionError = (): ModelAssetCoverState => ({ status: "error", errorCode: "model_cover_session_changed", message: "登录状态已变化，请重新打开资源库。" });
  const emit = (key: string, state: ModelAssetCoverState) => {
    for (const listener of [...(subscribers.get(key)?.listeners ?? [])]) listener(state);
  };
  const removeCached = (key: string) => {
    const value = cache.get(key);
    if (value) { cacheBytes -= size(value); cache.delete(key); }
  };
  const remember = (key: string, state: ModelAssetCoverState) => {
    removeCached(key);
    cache.set(key, state);
    cacheBytes += size(state);
    while (cache.size > (options.maximumEntries ?? 64) || cacheBytes > (options.maximumBytes ?? 16 * 1024 * 1024)) {
      removeCached(cache.keys().next().value!);
    }
  };
  const invalidateSession = () => {
    session = options.session();
    generation++;
    active?.controller.abort(cancelled());
    queue.length = 0;
    pending.clear();
    cache.clear();
    cacheBytes = 0;
    const listeners = [...subscribers.values()].flatMap(value => [...value.listeners]);
    subscribers.clear();
    listeners.forEach(listener => listener(sessionError()));
  };
  const syncSession = () => {
    if (session !== options.session()) invalidateSession();
  };

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        syncSession();
        const task = queue.shift();
        if (!task) break;
        if (pending.get(task.key) !== task || !subscribers.has(task.key)) continue;
        const controller = new AbortController();
        active = { task, controller };
        const timer = setTimeout(() => controller.abort(new ModelAssetCoverError("model_cover_timeout", "模型封面生成超时，请重试。")), options.timeoutMs ?? 60_000);
        try {
          const url = await options.render(task.input, controller.signal);
          controller.signal.throwIfAborted();
          syncSession();
          if (task.generation !== generation || pending.get(task.key) !== task) continue;
          const state: ModelAssetCoverState = { status: "ready", url };
          remember(task.key, state);
          emit(task.key, state);
        } catch (reason) {
          syncSession();
          if (task.generation !== generation || pending.get(task.key) !== task || !subscribers.has(task.key)) continue;
          const failure = controller.signal.aborted ? controller.signal.reason : reason;
          const error = failure instanceof ModelAssetCoverError ? failure
            : new ModelAssetCoverError("model_cover_render_failed", "模型封面生成失败，请重试或打开预览检查模型。");
          const state: ModelAssetCoverState = { status: "error", message: error.message, errorCode: error.code };
          remember(task.key, state);
          options.report(task.input, error, failure);
          emit(task.key, state);
        } finally {
          clearTimeout(timer);
          if (pending.get(task.key) === task) pending.delete(task.key);
          active = null;
        }
      }
    } finally { running = false; }
  };
  const enqueue = (key: string, input: Input) => {
    if (pending.has(key)) return;
    const task = { key, input, generation };
    pending.set(key, task);
    queue.push(task);
    void pump();
  };
  const subscribe = (input: Input, listener: Listener): (() => void) => {
    syncSession();
    if (!session) {
      listener({ status: "error", errorCode: "unauthenticated", message: "请先登录，再生成模型封面。" });
      return () => undefined;
    }
    const key = options.key(input);
    let group = subscribers.get(key);
    if (!group) { group = { input, listeners: new Set() }; subscribers.set(key, group); }
    group.listeners.add(listener);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      listener(cached);
    } else {
      listener({ status: "loading" });
      enqueue(key, input);
    }
    const subscribedGroup = group;
    return () => {
      subscribedGroup.listeners.delete(listener);
      if (subscribedGroup.listeners.size || subscribers.get(key) !== subscribedGroup) return;
      subscribers.delete(key);
      pending.delete(key);
      if (active?.task.key === key) active.controller.abort(cancelled());
    };
  };
  const invalidate = (input: Input) => {
    syncSession();
    const key = options.key(input);
    removeCached(key);
    pending.delete(key);
    if (active?.task.key === key) active.controller.abort(cancelled());
    if (subscribers.has(key)) {
      emit(key, { status: "loading" });
      enqueue(key, input);
    }
  };
  return { subscribe, invalidate, invalidateSession, syncSession };
}
