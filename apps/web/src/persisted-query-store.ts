import type { ComponentBinding } from "../../../shared/component-bindings";
import type { HistorySeries } from "../../../shared/history-series";
import type { AlarmSnapshot } from "../../../shared/alarms";
export type PersistedQuery = { kind:"history";assetId:string;metricKey:string;options:NonNullable<ComponentBinding["history"]> } | { kind:"alarms";assetIds:string[];options:NonNullable<ComponentBinding["alarm"]> };
export type PersistedQueryData = { kind:"history";value:HistorySeries } | { kind:"alarms";value:AlarmSnapshot };
export type PersistedQuerySnapshot = { status:"loading"|"ready"|"error";data?:PersistedQueryData;error?:string;fetchedAt?:number };
export class PersistedQueryError extends Error { constructor(message:string,readonly terminal=false) { super(message); } }
const EMPTY:PersistedQuerySnapshot = { status:"loading" };
type Entry = { query:PersistedQuery;key:string;listeners:Set<() => void>;snapshot:PersistedQuerySnapshot;admitted:boolean;terminal:boolean;queued:boolean;controller?:AbortController;timer?:ReturnType<typeof setTimeout> };
export function persistedQueryKey(query:PersistedQuery):string {
  return JSON.stringify(query.kind === "history" ? [query.kind,query.assetId,query.metricKey,query.options.windowMinutes,query.options.points,query.options.aggregation]:[query.kind,[...new Set(query.assetIds)].sort(),query.options.mode,query.options.limit,query.options.windowMinutes]);
}
/** One project scope. Equal component queries share requests and last release cancels. */
export class PersistedQueryStore {
  private entries = new Map<string,Entry>();
  private queue:Entry[] = [];
  private active = 0;
  private disposed = false;
  constructor(private load:(query:PersistedQuery,signal:AbortSignal) => Promise<PersistedQueryData>,private intervalMs=3000,private timeoutMs=10000,private limit=64,private concurrency=4) {}
  private current(entry:Entry) { return !this.disposed && this.entries.get(entry.key) === entry && !!entry.listeners.size; }
  getSnapshot(query:PersistedQuery):PersistedQuerySnapshot { return this.entries.get(persistedQueryKey(query))?.snapshot ?? EMPTY; }
  subscribe(query:PersistedQuery,listener:() => void) {
    if (this.disposed) return () => {};
    const key = persistedQueryKey(query);let entry = this.entries.get(key);
    if (!entry) { entry = { query,key,listeners:new Set(),snapshot:EMPTY,admitted:false,terminal:false,queued:false };this.entries.set(key,entry); }
    const notification = () => listener();entry.listeners.add(notification);this.admit();const owned = entry;let released = false;
    return () => { if (released) return;released = true;owned.listeners.delete(notification);if (owned.listeners.size) return;clearTimeout(owned.timer);owned.controller?.abort();this.entries.delete(key);this.queue = this.queue.filter((entry) => entry !== owned);this.admit(); };
  }
  private emit(entry:Entry,snapshot:PersistedQuerySnapshot) { if (!this.current(entry)) return;entry.snapshot = snapshot;entry.listeners.forEach((listener) => listener()); }
  private admit() {
    let available = this.limit-[...this.entries.values()].filter((entry) => entry.admitted).length;
    for (const entry of this.entries.values()) if (!entry.admitted && !entry.terminal) {
      if (available>0) { entry.admitted = true;available--;this.emit(entry,{ ...entry.snapshot,status:"loading",error:undefined });this.enqueue(entry); }
      else if (entry.snapshot.error !== "同页不同历史/告警查询已达上限，请减少查询配置。") this.emit(entry,{ status:"error",error:"同页不同历史/告警查询已达上限，请减少查询配置。" });
    }
  }
  private enqueue(entry:Entry) { if (!this.current(entry) || entry.queued || entry.controller || !entry.admitted) return;entry.queued = true;this.queue.push(entry);queueMicrotask(() => this.drain()); }
  private drain() {
    while (!this.disposed && this.active<this.concurrency && this.queue.length) {
      const entry = this.queue.shift()!;entry.queued = false;if (!this.current(entry)) continue;
      this.active++;void this.fetch(entry).finally(() => { this.active--;this.drain(); });
    }
  }
  private async fetch(entry:Entry) {
    const controller = new AbortController();entry.controller = controller;let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true;controller.abort(); },this.timeoutMs);
    this.emit(entry,{ ...entry.snapshot,status:"loading",error:undefined });
    try { const data = await this.load(entry.query,controller.signal);if (controller.signal.aborted) throw new Error("查询已取消。");this.emit(entry,{ status:"ready",data,fetchedAt:Date.now() }); }
    catch (reason) {
      if (!this.current(entry)) return;
      entry.terminal = reason instanceof PersistedQueryError && reason.terminal;
      this.emit(entry,{ status:"error",error:timedOut ? "数据查询超时，请检查运行器连接。":reason instanceof Error ? reason.message:String(reason) });
      if (entry.terminal) { entry.admitted = false;this.admit(); }
    } finally {
      clearTimeout(timeout);if (entry.controller === controller) entry.controller = undefined;
      if (this.current(entry) && !entry.terminal) entry.timer = setTimeout(() => { entry.timer = undefined;this.enqueue(entry); },this.intervalMs);
    }
  }
  refresh(query:PersistedQuery) { const entry = this.entries.get(persistedQueryKey(query));if (!entry) return;entry.terminal = false;clearTimeout(entry.timer);entry.timer = undefined;this.admit();this.enqueue(entry); }
  dispose() { if (this.disposed) return;this.disposed = true;for (const entry of this.entries.values()) { clearTimeout(entry.timer);entry.controller?.abort(); }this.entries.clear();this.queue = []; }
}
