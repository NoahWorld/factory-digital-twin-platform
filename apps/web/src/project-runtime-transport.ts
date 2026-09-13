import { apiUrl,request } from "./api";
import { ProjectRuntimeStore } from "./project-runtime-store";
import { assetRuntimeStatePath,type AssetRuntimeStateResponse,type RuntimeAssetConnection } from "./runtime-state";
import { decodeRuntimeFrame } from "../../../shared/runtime-stream";

type Demand = { id:string;assetId:string };
/** Select a declared host capability once per demand generation; failures never switch modes. */
export class ProjectRuntimeTransport {
  private listeners = new Set<() => void>();
  private connections: Record<string,RuntimeAssetConnection> = {};
  private legacy: ProjectRuntimeStore;
  private mode: "central" | "per-request" | null = null;
  private controller?: AbortController;
  private events?: EventSource;
  private retry?: ReturnType<typeof setTimeout>;
  private freshness?: ReturnType<typeof setInterval>;
  private demand: Demand[] = [];
  private epoch = "";
  private sequence = -1;
  private generation = 0;
  private retryFailures = 0;
  constructor(private projectId:string,private versionId?:string) {
    this.legacy = new ProjectRuntimeStore(async (id,signal) => (await request<AssetRuntimeStateResponse>(assetRuntimeStatePath(projectId,id),{ signal })).runtimeState);
    this.legacy.subscribe(() => { if (this.mode === "per-request") { this.connections = this.legacy.getSnapshot(); this.emit(); } });
  }
  private path(kind:"capabilities" | "stream") { return `/api/v1/projects/${encodeURIComponent(this.projectId)}${this.versionId ? `/versions/${encodeURIComponent(this.versionId)}/runtime-${kind}` : `/runtime/${kind}`}`; }
  getSnapshot = () => this.connections;
  subscribe = (listener:() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach((listener) => listener()); }
  setDemand(demand:Demand[]) {
    this.stop(); this.demand = demand; this.mode = null; this.retryFailures = 0;
    this.connections = Object.fromEntries(demand.map(({ assetId }) => [assetId,{ status:"loading",failureCount:0 }])); this.emit();
    if (!demand.length) return;
    const generation = this.generation;
    void this.connect(generation);
  }
  private async connect(generation:number) {
    if (generation !== this.generation) return;
    this.controller = new AbortController();
    try {
      const capability = await request<{ collection:"central" | "per-request" }>(this.path("capabilities"),{ signal:this.controller.signal });
      if (generation !== this.generation) return;
      if (capability.collection !== "central" && capability.collection !== "per-request") throw new Error("服务器返回了未知采集能力。");
      this.mode = capability.collection;
      if (this.mode === "per-request") { this.legacy.setDemand(this.demand); return; }
      this.epoch = ""; this.sequence = -1;
      const params = new URLSearchParams({ assets:this.demand.map(({ id }) => id).join(",") });
      const events = this.events = new EventSource(apiUrl(`${this.path("stream")}?${params}`),{ withCredentials:true });
      events.addEventListener("runtime",(event) => {
        if (generation !== this.generation || this.events !== events) return;
        try {
          if ((event as MessageEvent).data.length > 1024*1024) throw new Error("采集快照超过大小限制。");
          const frame = decodeRuntimeFrame(JSON.parse((event as MessageEvent).data));
          for (const { id,assetId } of this.demand) {
            const snapshot = (frame.connections[assetId] ?? frame.connections[id])?.snapshot;
            if (snapshot && (snapshot.asset.id !== id || snapshot.asset.assetId !== assetId)) throw new Error("采集快照的设备身份与当前订阅不符。");
          }
          if (frame.epoch === this.epoch && frame.sequence <= this.sequence) return;
          this.epoch = frame.epoch; this.sequence = frame.sequence; this.retryFailures = 0;
          this.connections = Object.fromEntries(this.demand.map(({ assetId,id }) => [assetId,frame.connections[assetId] ?? frame.connections[id] ?? { status:"loading",failureCount:0 }]));
          this.checkFreshness(); this.emit();
        } catch (reason) { events.close(); this.offline("runtime_stream_invalid",reason instanceof Error ? reason.message : "采集快照无效。"); this.scheduleRetry(generation); }
      });
      events.onerror = () => { if (generation === this.generation && this.events === events) { this.sequence = -1; this.offline("runtime_stream_disconnected","与采集服务器的连接已中断，正在重新连接。旧值不代表实时状态。"); if (events.readyState === EventSource.CLOSED) this.scheduleRetry(generation); } };
      this.freshness = setInterval(() => this.checkFreshness(),1000);
    } catch (reason) {
      if (generation !== this.generation) return;
      this.offline("runtime_capability_unavailable",reason instanceof Error ? reason.message : "无法读取采集服务能力。");
      this.scheduleRetry(generation);
    }
  }
  private scheduleRetry(generation:number) {
    this.events?.close(); this.events = undefined; clearInterval(this.freshness); clearTimeout(this.retry);
    const delay = Math.min(3000 * 2 ** Math.min(this.retryFailures++,4),30000);
    this.retry = setTimeout(() => { void this.connect(generation); },delay);
  }
  private offline(errorCode:string,errorMessage:string) {
    this.connections = Object.fromEntries(Object.entries(this.connections).map(([id,previous]) => [id,{ ...previous,status:"offline",failureCount:previous.failureCount+1,errorCode,errorMessage,failedAt:new Date().toISOString() }])); this.emit();
  }
  private checkFreshness() {
    let changed = false;
    const next = { ...this.connections };
    for (const [id,connection] of Object.entries(next)) if (connection.status === "live" && connection.snapshot?.sources.some((source) => Date.now()-Date.parse(source.sourceTimestamp ?? source.collectedAt) > (source.staleAfterSeconds ?? connection.snapshot!.staleAfterSeconds)*1000)) {
      next[id] = { ...connection,status:"offline",errorCode:"data_source_stale",errorMessage:"数据已陈旧，正在等待新快照。",failedAt:new Date().toISOString() }; changed = true;
    }
    if (changed) { this.connections = next; this.emit(); }
  }
  private stop() { this.generation++; this.controller?.abort(); this.events?.close(); this.events = undefined; clearTimeout(this.retry); clearInterval(this.freshness); this.legacy.dispose(); }
  dispose() { this.stop(); this.demand = []; this.connections = {}; }
}
