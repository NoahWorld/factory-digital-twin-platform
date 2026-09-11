export type ResourceLease<T> = { value: T; release: () => void };

type Entry<T> = {
  controller: AbortController;
  references: number;
  value?: T;
  ready: boolean;
  promise: Promise<T>;
};

/** Scene-local ownership. A lease is held by each instance, including pending ones. */
export class ResourceManager<T> {
  private entries = new Map<string, Entry<T>>();
  private active = 0;
  private queue: Array<() => void> = [];
  private disposed = false;

  constructor(
    private readonly load: (id: string, signal: AbortSignal) => Promise<T>,
    private readonly destroy: (value: T) => void,
    private readonly concurrency = 3,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("资源加载并发数必须是正整数");
  }

  get stats() {
    return { activeLoads: this.active, queuedLoads: this.queue.length, resources: this.entries.size };
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) this.queue.shift()!();
  }

  async acquire(id: string, signal?: AbortSignal): Promise<ResourceLease<T>> {
    if (this.disposed) throw new Error("资源管理器已释放");
    signal?.throwIfAborted();
    let entry = this.entries.get(id);
    if (!entry) {
      const controller = new AbortController();
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
      entry = { controller, references: 0, ready: false, promise };
      const created = entry;
      this.entries.set(id, created);
      this.queue.push(() => {
        this.active++;
        void Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return this.load(id, controller.signal);
        }).then((value) => {
          if (controller.signal.aborted || this.disposed || created.references === 0) {
            this.destroy(value);
            throw controller.signal.reason ?? new DOMException("资源加载已取消", "AbortError");
          }
          created.value = value;
          created.ready = true;
          resolve(value);
        }).catch(reject).finally(() => {
          this.active--;
          this.pump();
        });
      });
    }
    const owned = entry;
    owned.references++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      owned.references--;
      if (owned.references === 0) {
        if (this.entries.get(id) === owned) this.entries.delete(id);
        owned.controller.abort(new DOMException(`模型资源 ${id} 已无引用`, "AbortError"));
        if (owned.ready) {
          this.destroy(owned.value!);
          owned.ready = false;
        }
      }
    };
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => { release(); reject(signal!.reason); };
      signal?.addEventListener("abort", abort, { once: true });
    });
    this.pump();
    try {
      const value = await Promise.race([owned.promise, cancelled]);
      signal?.throwIfAborted();
      return { value, release };
    } catch (reason) {
      release();
      throw reason;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.controller.abort(new DOMException("场景已关闭", "AbortError"));
      if (entry.ready) { this.destroy(entry.value!); entry.ready = false; }
    }
    this.entries.clear();
    this.pump();
  }
}
