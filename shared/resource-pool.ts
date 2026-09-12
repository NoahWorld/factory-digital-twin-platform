type Entry<T> = { key: string; refs: number; controller: AbortController; ready: Promise<T>; value?: T; settled: boolean; disposed: boolean };

/** Owns immutable resources. Consumers must release their lease, including failures. */
export class ResourcePool<T> {
  private entries = new Map<string, Entry<T>>();
  private live = new Set<Entry<T>>();
  private loads = 0;
  private disposals = 0;
  constructor(private load: (key: string, signal: AbortSignal) => Promise<T>, private dispose: (value: T) => void) {}

  acquire(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, refs: 0, controller: new AbortController(), ready: null!, settled: false, disposed: false };
      const current = entry;
      this.entries.set(key, current); this.live.add(current); this.loads++;
      current.ready = Promise.resolve().then(() => this.load(key, current.controller.signal)).then((value) => {
        current.value = value; current.settled = true;
        if (current.refs === 0) this.cleanup(current);
        return value;
      }, (error) => {
        current.settled = true;
        if (this.entries.get(key) === current) this.entries.delete(key);
        if (current.refs === 0) this.live.delete(current);
        throw error;
      });
    }
    entry.refs++;
    const current = entry;
    let released = false;
    return {
      ready: current.ready.then((value) => {
        if (released) throw new DOMException("Resource lease released", "AbortError");
        return value;
      }),
      release: () => {
        if (released) return;
        released = true; current.refs--;
        if (current.refs === 0) {
          if (this.entries.get(key) === current) this.entries.delete(key);
          current.controller.abort();
          this.cleanup(current);
        }
      },
    };
  }

  private cleanup(entry: Entry<T>) {
    if (!entry.settled) return;
    this.live.delete(entry);
    if (entry.value !== undefined && !entry.disposed) {
      entry.disposed = true; this.dispose(entry.value); this.disposals++;
    }
  }

  snapshot() {
    return { resources: this.entries.size, leases: [...this.live].reduce((sum, entry) => sum + entry.refs, 0),
      pending: [...this.live].filter((entry) => !entry.settled).length, loads: this.loads, disposals: this.disposals };
  }
}
