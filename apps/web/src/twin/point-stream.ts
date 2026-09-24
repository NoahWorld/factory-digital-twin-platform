import type { TwinDriveCommand, TwinDriveSnapshot, TwinPoint } from "../../../../shared/twin-drive";

export type TwinDriveLiveSource = {
  getState(): { connected: boolean; snapshot: TwinDriveSnapshot | null };
  subscribe(listener: () => void): () => void;
};

export type TwinStreamState = {
  connected: boolean;
  snapshot: TwinDriveSnapshot | null;
  phase: "idle" | "connecting" | "live" | "reconnecting" | "error";
  retryCount: number;
  error: string | null;
};

export type TwinCommandInput = Omit<TwinDriveCommand, "type" | "commandId">;
const MAX_RETRIES = 6;
const ACK_TIMEOUT_MS = 10000;

/** Validate transport data before it can reach the render loop. Never invent missing samples. */
export function readTwinSnapshot(value: unknown, projectId: string, topics?: ReadonlyMap<string, string>): TwinDriveSnapshot {
  const data = value as TwinDriveSnapshot;
  if (!data || data.type !== "snapshot" || data.projectId !== projectId || data.source !== "simulator"
    || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Number.isSafeInteger(data.sequence) || data.sequence < 0
    || !Number.isFinite(Date.parse(data.timestamp)) || !["idle", "running", "paused", "error"].includes(data.status)
    || !data.points || typeof data.points !== "object" || Array.isArray(data.points)) {
    throw new Error("点位快照格式无效，已停止接收该连接的数据。");
  }
  for (const [id, sample] of Object.entries(data.points)) {
    if (!sample || !Number.isFinite(sample.value) || !Number.isFinite(sample.target)
      || !Number.isFinite(Date.parse(sample.timestamp)) || !["good", "stale", "error"].includes(sample.quality)) {
      throw new Error(`点位 ${id} 的数值、时间或质量无效。`);
    }
    if (topics?.has(id) && sample.topic !== topics.get(id)) throw new Error(`点位 ${id} 的 topic 与已保存订阅不一致，已拒绝该快照。`);
    if (sample.topic !== undefined && (typeof sample.topic !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(sample.topic))) throw new Error(`点位 ${id} 的 topic 无效。`);
  }
  if (data.procedure !== null && (!data.procedure || typeof data.procedure.id !== "string"
    || !Number.isSafeInteger(data.procedure.stepIndex) || data.procedure.stepIndex < 0
    || !["running", "completed", "error"].includes(data.procedure.status) || typeof data.procedure.message !== "string")) {
    throw new Error("点位快照的联动流程状态无效。");
  }
  return data;
}

/** One connection per scene; render subscribers see each packet, React views sample at 5 Hz. */
export class TwinPointStream implements TwinDriveLiveSource {
  private state: TwinStreamState = { connected: false, snapshot: null, phase: "idle", retryCount: 0, error: null };
  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private stopped = true;
  private revision: number | null = null;
  private topics = new Map<string, string>();
  private subscriptionRequested = false;
  private subscriptionReady = false;
  private subscriptionTimeout: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();

  constructor(private readonly url: string, private readonly projectId: string, private readonly onConfigChanged: () => void) {}
  getState = (): TwinStreamState => this.state;
  setRevision = (revision: number) => { this.revision = revision; };
  setConfiguration = (revision: number, points: TwinPoint[]) => {
    this.revision = revision;
    this.topics = new Map(points.filter((point) => point.topic !== undefined).map((point) => [point.id, point.topic!]));
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<TwinStreamState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  connect = () => {
    if (!this.stopped) return;
    this.stopped = false;
    this.update({ snapshot: null, retryCount: 0, error: null });
    this.open();
  };
  private rejectPending(message: string) {
    this.pending.forEach(({ reject, timeout }) => { clearTimeout(timeout); reject(new Error(message)); });
    this.pending.clear();
  }
  private open() {
    if (this.stopped) return;
    this.update({ connected: false, phase: this.state.retryCount ? "reconnecting" : "connecting" });
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.subscriptionRequested = false;
    this.subscriptionReady = false;
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      this.lastMessageAt = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessageAt > 45000) {
          this.update({ connected: false, error: "🔴 点位连接超过 45 秒没有消息，正在重连。" });
          socket.close(4000, "heartbeat timeout");
        } else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 10000);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.stopped) return;
      this.lastMessageAt = Date.now();
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.type === "hello") {
          if (this.revision === null) throw new Error("订阅前尚未加载点位配置。");
          if (!this.subscriptionRequested) {
            socket.send(JSON.stringify({ type: "subscribe", expectedRevision: this.revision, topics: [...this.topics.values()] }));
            this.subscriptionRequested = true;
            this.subscriptionTimeout = setTimeout(() => {
              this.update({ connected: false, error: "Topic 订阅在 10 秒内未确认，正在重新连接。" });
              socket.close(4000, "subscription timeout");
            }, ACK_TIMEOUT_MS);
          }
        } else if (message.type === "subscribed") {
          const topics = message.topics;
          if (!this.subscriptionRequested || message.revision !== this.revision || !Array.isArray(topics)
            || topics.length !== this.topics.size || new Set(topics).size !== topics.length
            || topics.some((topic) => typeof topic !== "string" || ![...this.topics.values()].includes(topic))) {
            throw new Error("服务端确认的 topic 或配置与本次订阅不一致。");
          }
          this.subscriptionReady = true;
          if (this.subscriptionTimeout) clearTimeout(this.subscriptionTimeout);
          this.subscriptionTimeout = null;
        } else if (message.type === "snapshot") {
          if (this.topics.size && !this.subscriptionReady) throw new Error("服务端在 topic 订阅确认前发送了数据，已拒绝该快照。");
          const snapshot = readTwinSnapshot(message, this.projectId, this.topics);
          if (snapshot.revision !== this.revision) {
            console.error("Twin point snapshot configuration mismatch", {
              projectId: this.projectId,
              snapshotRevision: snapshot.revision,
              loadedRevision: this.revision,
            });
            this.close();
            this.update({ phase: "error", error: "点位快照与已加载配置不一致，正在重新加载配置。" });
            this.onConfigChanged();
            return;
          }
          const previous = this.state.snapshot;
          if (previous && !this.state.connected && snapshot.revision === previous.revision && snapshot.sequence < previous.sequence) {
            this.close();
            this.update({ phase: "error", error: "服务端点位序号发生回退，可能已重启。已暂停同步；请核对数据后点击重新连接。" });
            return;
          }
          if (previous && this.state.connected && snapshot.revision === previous.revision && snapshot.sequence <= previous.sequence) return;
          this.update({ snapshot, connected: true, phase: "live", retryCount: 0, error: null });
        } else if (message.type === "command_ack") {
          const pending = this.pending.get(String(message.commandId));
          if (pending) { clearTimeout(pending.timeout); this.pending.delete(String(message.commandId)); pending.resolve(); }
        } else if (message.type === "error") {
          const detail = `${String(message.message ?? "点位服务返回错误")}${message.error ? `（${String(message.error)}）` : ""}`;
          const pending = this.pending.get(String(message.commandId));
          if (pending) { clearTimeout(pending.timeout); this.pending.delete(String(message.commandId)); pending.reject(new Error(detail)); }
          if (message.error === "twin_revision_conflict") {
            this.close();
            this.update({ phase: "error", error: `${detail}；正在重新加载已保存配置。` });
            this.onConfigChanged();
            return;
          }
          this.update({ error: detail });
        } else if (message.type === "config_changed") {
          this.close();
          this.update({ error: "点位配置已变化，正在重新加载；未确认命令不会自动重发。" });
          this.onConfigChanged();
        } else if (!["heartbeat", "pong"].includes(String(message.type))) {
          throw new Error(`未知点位消息类型：${String(message.type)}`);
        }
      } catch (reason) {
        this.update({ connected: false, phase: "error", error: reason instanceof Error ? reason.message : String(reason) });
        socket.close(4002, "invalid point message");
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) this.update({ connected: false, error: "🔴 网络异常／正在重连" });
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.subscriptionTimeout) clearTimeout(this.subscriptionTimeout);
      this.subscriptionTimeout = null;
      this.rejectPending("连接已断开；命令执行结果未知，不会自动重发。请连接后核对点位。");
      if (this.stopped) return;
      const retry = this.state.retryCount < MAX_RETRIES;
      const retryCount = retry ? this.state.retryCount + 1 : this.state.retryCount;
      const error = this.state.error ?? `🔴 点位连接已断开（${event.code}${event.reason ? `：${event.reason}` : ""}）`;
      this.update({ connected: false, retryCount, phase: retry ? "reconnecting" : "error", error });
      if (retry) this.retryTimer = setTimeout(() => this.open(), Math.min(1000 * 2 ** (retryCount - 1), 16000));
    };
  }
  close = () => {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.subscriptionTimeout) clearTimeout(this.subscriptionTimeout);
    this.retryTimer = null;
    this.heartbeat = null;
    this.subscriptionTimeout = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "scene detached");
    this.rejectPending("点位连接已关闭，未自动重发命令。");
    this.update({ connected: false, snapshot: null, phase: "idle" });
  };
  reconnect = () => { this.close(); this.connect(); };
  command = (input: TwinCommandInput): Promise<void> => {
    if (!this.state.connected || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("点位连接尚未就绪，命令未发送。"));
    if (input.expectedRevision !== this.state.snapshot?.revision) return Promise.reject(new Error("点位配置已变化，请重新加载配置后操作。"));
    const socket = this.socket;
    const commandId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error(`命令 ${commandId} 在 10 秒内未确认，执行结果未知；不会自动重发。`));
      }, ACK_TIMEOUT_MS);
      this.pending.set(commandId, { resolve, reject, timeout });
      try { socket.send(JSON.stringify({ ...input, type: "command", commandId } satisfies TwinDriveCommand)); }
      catch (reason) {
        clearTimeout(timeout);
        this.pending.delete(commandId);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
  };
}
