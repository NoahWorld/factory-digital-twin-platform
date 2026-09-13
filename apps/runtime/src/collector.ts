import { AppError,type AppEnv } from "../../api/src/auth";
import { listContinuousDataSources,type DataSource } from "../../api/src/data-sources";
import { loadRuntimeAssetPlan,fetchRuntimeSource,normalizeRuntimeAsset,type RuntimeAssetPlan,type SourceSample } from "../../api/src/runtime-state";
import type { CentralConnection,CentralRuntime,RuntimeFrame,RuntimeSubscription,SourceDiagnostic } from "../../../shared/runtime-stream";

type SourceJob = { generation:number; key: string; projectId: string; source: DataSource; controller: AbortController; timer?: ReturnType<typeof setTimeout>; queued: boolean; sample?: SourceSample; error?: AppError; failures: number };
type Client = { generation:number; projectId: string; ids: string[]; identities:Map<string,string>; plans: Map<string,RuntimeAssetPlan>; errors: Map<string,AppError>; connections: Record<string,CentralConnection>; changed: (frame: RuntimeFrame) => void; sequence: number; released: boolean };
const failure = (reason: unknown) => reason instanceof AppError ? reason : new AppError(502,"collection_failed","Source collection failed.");

/** Source jobs belong to the server, independent of the number of browser consumers. */
export class RuntimeCollector implements CentralRuntime {
  readonly epoch = crypto.randomUUID();
  private generations = new Map<string,number>();
  private version(projectId:string) { return this.generations.get(projectId) ?? 0; }
  private continuous = new Map<string,DataSource>();
  private unavailable = new Map<string,DataSource>();
  private jobs = new Map<string,SourceJob>();
  private clients = new Set<Client>();
  private queue: SourceJob[] = [];
  private active = 0;
  private tasks = new Set<Promise<void>>();
  private operations: Promise<void> = Promise.resolve();
  private closed = false;
  private freshness?: ReturnType<typeof setInterval>;
  constructor(private env: AppEnv) {}
  private key(projectId: string,sourceId: string) { return JSON.stringify([projectId,sourceId]); }
  private current(job: SourceJob) { return !this.closed && this.jobs.get(job.key) === job && !job.controller.signal.aborted && job.generation === this.version(job.projectId); }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation); this.operations = result.then(() => {},() => {}); return result;
  }
  async start() {
    const sources = await listContinuousDataSources(this.env);
    if (this.closed) return;
    for (const source of sources) this.continuous.set(this.key(source.projectId,source.id),source);
    this.reconcile();
  }
  diagnostics(projectId:string) {
    const sources:SourceDiagnostic[] = [];
    const configured = new Map([...this.jobs].map(([key,job]) => [key,job.source]));
    for (const [key,source] of this.unavailable) configured.set(key,source);
    for (const [key,source] of configured) if (source.projectId === projectId) {
      const job = this.jobs.get(key);
      sources.push({ id:source.id,name:source.name,mode:source.config.collectionMode ?? "demand",state:!job || job.error ? "failed" : job.sample ? "sampled" : "collecting",subscribers:[...this.clients].filter((client) => client.projectId === projectId && [...client.plans.values()].some((plan) => plan.sources.some((item) => item.id === source.id))).length,collectedAt:job?.sample?.collectedAt ?? null,errorCode:job?.error?.code ?? (!job ? "runtime_source_limit" : null) });
    }
    return { epoch:this.epoch,sources };
  }
  async subscribe(projectId: string,ids: string[],changed: Client["changed"]): Promise<RuntimeSubscription> {
    return this.serial(async () => {
      if (this.closed) throw new AppError(503,"runtime_stopping","Runtime is stopping.");
      if (this.clients.size >= 128) throw new AppError(429,"runtime_subscriber_limit","Runtime subscriber limit reached.");
      const client: Client = { generation:-1,projectId,ids:[...new Set(ids)],identities:new Map(),plans:new Map(),errors:new Map(),connections:{},changed,sequence:0,released:false };
      if (!client.ids.length || client.ids.length > 100) throw new AppError(400,"runtime_demand_invalid","Subscribe to 1–100 asset record IDs.");
      await this.load(client);
      if (this.closed) throw new AppError(503,"runtime_stopping","Runtime is stopping.");
      this.clients.add(client);
      try { this.reconcile(); } catch (reason) { this.clients.delete(client); this.reconcile(); throw reason; }
      this.update(client);
      if (!this.freshness) this.freshness = setInterval(() => { for (const entry of this.clients) this.update(entry); },1000);
      return { snapshot: () => this.frame(client),release: () => {
        if (client.released) return; client.released = true; this.clients.delete(client); this.reconcile(); for (const entry of this.clients) this.update(entry);
        if (!this.clients.size) { clearInterval(this.freshness); this.freshness = undefined; }
      } };
    });
  }
  private async load(client: Client) {
    for (let attempt = 0; attempt < 4; attempt++) {
    const generation = this.version(client.projectId);
    client.plans.clear(); client.errors.clear();
    for (const id of client.ids) {
      try { const plan = await loadRuntimeAssetPlan(this.env,client.projectId,id); client.plans.set(id,plan); client.identities.set(id,plan.asset.assetId); }
      catch (reason) { client.errors.set(id,failure(reason)); }
    }
    if (generation === this.version(client.projectId)) { client.generation = generation; return; }
    }
    client.plans.clear(); client.errors.clear(); client.generation = -1;
    throw new AppError(409,"runtime_configuration_busy","Configuration changed repeatedly while subscribing; retry.");
  }
  /** Invalidate synchronously so an old fetch cannot publish while new config is loading. */
  refresh(projectId: string): Promise<void> {
    this.generations.set(projectId,this.version(projectId)+1);
    for (const job of this.jobs.values()) if (job.projectId === projectId) this.stop(job);
    for (const [key,source] of this.continuous) if (source.projectId === projectId) this.continuous.delete(key);
    for (const client of this.clients) if (client.projectId === projectId) {
      client.plans.clear();
      client.connections = Object.fromEntries(Object.entries(client.connections).map(([id,previous]) => [id,{ ...previous,status:"offline",errorCode:"runtime_configuration_changed",errorMessage:"数据配置已更新，正在重新采集。" }]));
      client.sequence++; client.changed(this.frame(client));
    }
    return this.serial(async () => {
      if (this.closed) return;
      for (let attempt = 0; attempt < 4; attempt++) {
        const generation = this.version(projectId),sources = await listContinuousDataSources(this.env,projectId);
        if (generation !== this.version(projectId)) continue;
        for (const source of sources) this.continuous.set(this.key(projectId,source.id),source);
        break;
      }
      for (const client of this.clients) if (client.projectId === projectId) await this.load(client);
      if (this.closed) return;
      this.reconcile(); for (const client of this.clients) if (client.projectId === projectId) this.update(client);
    });
  }
  private reconcile() {
    const wanted = new Map<string,{ projectId:string;source:DataSource }>();
    for (const [key,source] of this.continuous) wanted.set(key,{ projectId:source.projectId,source });
    for (const client of this.clients) if (client.generation === this.version(client.projectId)) for (const plan of client.plans.values()) for (const source of plan.sources) wanted.set(this.key(client.projectId,source.id),{ projectId:client.projectId,source });
    this.unavailable.clear();
    for (const [key,{ source }] of [...wanted].slice(256)) { this.unavailable.set(key,source); wanted.delete(key); }
    for (const job of this.jobs.values()) if (!wanted.has(job.key) || !this.current(job) || JSON.stringify(wanted.get(job.key)?.source) !== JSON.stringify(job.source)) this.stop(job);
    for (const [key,{ projectId,source }] of wanted) if (!this.jobs.has(key)) {
      const job: SourceJob = { generation:this.version(projectId),key,projectId,source,controller:new AbortController(),queued:false,failures:0 };
      this.jobs.set(key,job); this.enqueue(job);
    }
    this.queue = this.queue.filter((job) => this.current(job));
  }
  private stop(job: SourceJob) { job.controller.abort(); clearTimeout(job.timer); this.jobs.delete(job.key); }
  private enqueue(job: SourceJob) {
    if (!this.current(job) || job.queued) return; job.queued = true; this.queue.push(job); queueMicrotask(() => this.drain());
  }
  private drain() {
    while (this.active < 6 && this.queue.length) {
      const job = this.queue.shift()!; job.queued = false; if (!this.current(job)) continue;
      this.active++;
      const task = this.poll(job).finally(() => { this.tasks.delete(task); this.active--; this.drain(); }); this.tasks.add(task);
    }
  }
  private async poll(job: SourceJob) {
    let delay = 2;
    const requestId = crypto.randomUUID(),startedAt = Date.now();
    try {
      const sample = await fetchRuntimeSource(this.env,job.source,requestId,job.controller.signal);
      if (!this.current(job)) return;
      job.sample = sample; job.error = undefined; job.failures = 0;
      delay = "intervalSeconds" in job.source.config ? job.source.config.intervalSeconds : 2;
    } catch (reason) {
      if (!this.current(job)) return;
      job.error = failure(reason); job.failures++; delay = Math.min(2 ** Math.min(job.failures-1,5),30);
    }
    if (!this.current(job)) return;
    console.log(JSON.stringify({ event:"runtime_source_collected",requestId,projectId:job.projectId,dataSourceId:job.source.id,durationMs:Date.now()-startedAt,errorCode:job.error?.code ?? null }));
    for (const client of this.clients) if (client.projectId === job.projectId) this.update(client);
    job.timer = setTimeout(() => this.enqueue(job),Math.max(1,delay)*1000);
  }
  private frame(client: Client): RuntimeFrame { return { epoch:this.epoch,sequence:client.sequence,connections:client.connections }; }
  private update(client: Client) {
    if (client.released || this.closed) return;
    const next: Record<string,CentralConnection> = {};
    for (const id of client.ids) {
      const plan = client.generation === this.version(client.projectId) ? client.plans.get(id) : undefined,key = plan?.asset.assetId ?? client.identities.get(id) ?? id,previous = client.connections[key];
      try {
        const planError = client.errors.get(id); if (planError) throw planError;
        if (!plan) { next[key] = { status:"loading",failureCount:0 }; continue; }
        const samples = new Map<string,SourceSample>();
        for (const source of plan.sources) {
          const job = this.jobs.get(this.key(client.projectId,source.id));
          if (job?.error) throw job.error;
          if (!job && this.unavailable.has(this.key(client.projectId,source.id))) throw new AppError(429,"runtime_source_limit","Runtime source capacity reached.");
          if (job?.sample) samples.set(source.id,job.sample);
        }
        if (samples.size !== plan.sources.length) { next[key] = { status:"loading",failureCount:0 }; continue; }
        const snapshot = normalizeRuntimeAsset(plan,samples);
        if (snapshot.sources.some((source) => Date.now()-Date.parse(source.sourceTimestamp ?? source.collectedAt) > source.staleAfterSeconds*1000)) throw new AppError(502,"data_source_stale","数据超过有效期，正在等待下一次采集。");
        next[key] = { status:"live",snapshot,failureCount:0,lastSuccessAt:snapshot.timestamp };
      } catch (reason) {
        const error = failure(reason);
        next[key] = { status:"offline",snapshot:previous?.snapshot,lastSuccessAt:previous?.lastSuccessAt,failureCount:Math.max(1,...(plan?.sources.map((source) => this.jobs.get(this.key(client.projectId,source.id))?.failures ?? 0) ?? [])),failedAt:previous?.status === "offline" ? previous.failedAt : new Date().toISOString(),errorCode:error.code,errorMessage:publicRuntimeError(error.code) };
      }
    }
    if (JSON.stringify(next) === JSON.stringify(client.connections)) return;
    client.connections = next; client.sequence++; client.changed(this.frame(client));
  }
  async close() {
    this.closed = true; clearInterval(this.freshness);
    for (const client of this.clients) client.released = true; this.clients.clear();
    for (const job of this.jobs.values()) this.stop(job); this.queue = []; this.continuous.clear(); this.unavailable.clear();
    await this.operations; await Promise.allSettled([...this.tasks]);
  }
}

function publicRuntimeError(code: string): string {
  const messages: Record<string,string> = { data_source_stale:"数据已陈旧，旧值不代表当前状态。",metric_type_mismatch:"指标类型与配置不符。",source_path_not_found:"指标映射的字段缺失。",data_source_http_error:"上游返回错误状态。",data_source_timeout:"上游响应超时。",asset_data_binding_required:"设备尚未配置数据绑定。",runtime_polling_disabled:"服务器尚未启用数据采集。" };
  return messages[code] ?? "数据采集失败，请查看连接配置及服务器诊断。";
}
