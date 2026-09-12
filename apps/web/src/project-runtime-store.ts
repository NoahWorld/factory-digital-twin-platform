import type { AssetRuntimeState, RuntimeAssetConnection } from "./runtime-state";

type Demand = { assetId: string; id: string };
type Job = Demand & { controller: AbortController; queued: boolean; timer?: ReturnType<typeof setTimeout> };
type Collector = (assetRecordId: string, signal: AbortSignal) => Promise<AssetRuntimeState>;

/** One store per mounted project page. Consumers contribute a deduplicated demand set. */
export class ProjectRuntimeStore {
  private connections: Record<string, RuntimeAssetConnection> = {};
  private listeners = new Set<() => void>();
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private active = 0;
  private staleTimer?: ReturnType<typeof setInterval>;

  constructor(private collect: Collector, private concurrency = 6) {}

  getSnapshot = () => this.connections;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private emit() { this.listeners.forEach((listener) => listener()); }
  private current(job: Job) { return this.jobs.get(job.assetId) === job; }

  setDemand(assets: Demand[]) {
    const wanted = new Map(assets.map((asset) => [asset.assetId, asset]));
    for (const [assetId, job] of this.jobs) {
      if (wanted.get(assetId)?.id === job.id) continue;
      job.controller.abort();
      clearTimeout(job.timer);
      this.jobs.delete(assetId);
      const next = { ...this.connections };
      delete next[assetId];
      this.connections = next;
    }
    this.queue = this.queue.filter((job) => this.current(job));
    for (const asset of wanted.values()) {
      if (this.jobs.has(asset.assetId)) continue;
      const job = { ...asset, controller: new AbortController(), queued: false };
      this.jobs.set(asset.assetId, job);
      this.connections = { ...this.connections, [asset.assetId]: { status: "loading", failureCount: 0 } };
      this.enqueue(job);
    }
    if (this.jobs.size > 0 && !this.staleTimer) {
      this.staleTimer = setInterval(() => this.checkFreshness(), 1000);
    } else if (this.jobs.size === 0) {
      clearInterval(this.staleTimer);
      this.staleTimer = undefined;
    }
    this.emit();
  }

  private checkFreshness() {
    let changed = false;
    for (const [assetId, connection] of Object.entries(this.connections)) {
      const snapshot = connection.snapshot;
      if (connection.status !== "live" || !snapshot) continue;
      const stale = snapshot.sources.some((source) => Date.now() - Date.parse(source.sourceTimestamp ?? source.collectedAt)
        > (source.staleAfterSeconds ?? snapshot.staleAfterSeconds) * 1000);
      if (!stale) continue;
      this.connections = { ...this.connections, [assetId]: {
        ...connection, status: "offline", errorCode: "data_source_stale",
        errorMessage: "数据超过有效期，正在等待下一次采集。", failedAt: new Date().toISOString(),
      } };
      changed = true;
    }
    if (changed) this.emit();
  }

  private enqueue(job: Job) {
    if (!this.current(job) || job.queued) return;
    job.queued = true;
    this.queue.push(job);
    // Deferring the first request also prevents abandoned mount effects issuing it.
    queueMicrotask(() => this.drain());
  }

  private drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      job.queued = false;
      if (!this.current(job)) continue;
      this.active += 1;
      void this.poll(job).finally(() => { this.active -= 1; this.drain(); });
    }
  }

  private async poll(job: Job) {
    let delaySeconds = 2;
    try {
      const snapshot = await this.collect(job.id, job.controller.signal);
      if (!this.current(job)) return;
      this.connections = { ...this.connections, [job.assetId]: {
        status: "live", snapshot, failureCount: 0, lastSuccessAt: snapshot.timestamp,
      } };
      delaySeconds = Math.max(snapshot.pollAfterSeconds, 1);
    } catch (reason) {
      if (!this.current(job) || job.controller.signal.aborted) return;
      const previous = this.connections[job.assetId];
      const failureCount = (previous?.failureCount ?? 0) + 1;
      const error = reason as { code?: string; message?: string } | null;
      this.connections = { ...this.connections, [job.assetId]: {
        status: "offline", snapshot: previous?.snapshot, lastSuccessAt: previous?.lastSuccessAt,
        failureCount, failedAt: new Date().toISOString(),
        errorCode: error?.code ?? "runtime_request_failed",
        errorMessage: error?.message ?? String(reason),
      } };
      delaySeconds = Math.min(2 ** Math.min(failureCount - 1, 5), 30);
    }
    if (!this.current(job)) return;
    this.checkFreshness();
    this.emit();
    job.timer = setTimeout(() => this.enqueue(job), delaySeconds * 1000);
  }

  dispose() {
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.controller.abort();
    }
    this.jobs.clear();
    this.queue = [];
    clearInterval(this.staleTimer);
    this.staleTimer = undefined;
    this.connections = {};
  }
}
