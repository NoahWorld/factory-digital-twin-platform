import { IOT_EMBED_CHANNEL, IOT_EMBED_VERSION, IOT_MAX_POINTS, parseIotParentMessage, type IotPoint, type IotResult, type IotReadyMessage, type IotRequestHelloMessage } from "../../../../shared/iot-embed";
import { initialIotRuntimeState, isTrustedIotEvent, receiveIotMessage, type IotRuntimeState } from "./iot-runtime";

type Listener = (state: IotRuntimeState) => void;
type Host = Pick<Window, "parent" | "addEventListener" | "removeEventListener" | "requestAnimationFrame" | "cancelAnimationFrame">;

/** One host session per iframe, including every visible canvas and embedded 3D scene. */
export class IotEmbedSession {
  private readonly consumers = new Map<symbol, { manifest: IotResult<IotPoint[]>; listener: Listener }>();
  private manifest: IotResult<IotPoint[]> = { ok: true, value: [] };
  private state = initialIotRuntimeState();
  private scheduled: number | null = null;
  private revision = 0;
  constructor(private readonly host: Host, private readonly parentOrigin: string) {}

  subscribe(manifest: IotResult<IotPoint[]>, listener: Listener): () => void {
    const id = Symbol();
    if (!this.consumers.size) this.host.addEventListener("message", this.onMessage);
    this.consumers.set(id, { manifest, listener });
    this.rebuild();
    return () => {
      this.consumers.delete(id);
      if (this.consumers.size) this.rebuild();
      else {
        this.revision++;
        this.host.removeEventListener("message", this.onMessage);
        if (this.scheduled !== null) this.host.cancelAnimationFrame(this.scheduled);
        this.scheduled = null;
        this.state = initialIotRuntimeState();
      }
    };
  }

  private rebuild() {
    const points = new Map<string, IotPoint>();
    let error: string | null = null;
    for (const { manifest } of this.consumers.values()) {
      if (!manifest.ok) { error = manifest.message; break; }
      for (const point of manifest.value) {
        const previous = points.get(point.key);
        if (previous && previous.valueType !== point.valueType) { error = `点位 ${point.key} 在画布与场景中的数据类型不一致。`; break; }
        points.set(point.key, { ...point, staleAfterSeconds: Math.min(previous?.staleAfterSeconds ?? point.staleAfterSeconds, point.staleAfterSeconds) });
        if (points.size > IOT_MAX_POINTS) { error = `当前画面和嵌入场景合计最多绑定 ${IOT_MAX_POINTS} 个不同点位。`; break; }
      }
      if (error) break;
    }
    this.manifest = error ? { ok: false, message: error } : { ok: true, value: [...points.values()] };
    this.state = error ? { ...initialIotRuntimeState(), status: "error", error } : initialIotRuntimeState();
    for (const { listener } of this.consumers.values()) listener(this.state);
    const revision = ++this.revision;
    // Batch mounts and updates so the parent receives one complete union, not competing manifests.
    queueMicrotask(() => {
      if (revision !== this.revision || !this.consumers.size) return;
      const request: IotRequestHelloMessage = { channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, type: "request-hello" };
      this.host.parent.postMessage(request, this.parentOrigin);
    });
  }

  private publish() {
    if (this.scheduled !== null) return;
    this.scheduled = this.host.requestAnimationFrame(() => {
      this.scheduled = null;
      for (const { listener } of this.consumers.values()) listener(this.state);
    });
  }

  private onMessage = (event: MessageEvent) => {
    if (!isTrustedIotEvent(event, this.host.parent, this.parentOrigin) || event.data?.channel !== IOT_EMBED_CHANNEL) return;
    if (event.data?.type !== "hello" && event.data?.sessionId !== this.state.sessionId) return;
    const parsed = parseIotParentMessage(event.data);
    if (!parsed.ok) {
      console.error("[iot-embed] Invalid parent message", { sessionId: this.state.sessionId, error: parsed.message });
      this.state = { ...this.state, status: "error", error: parsed.message, values: Object.create(null) };
      this.publish();
      return;
    }
    const message = parsed.value;
    if (message.type === "hello") {
      const ready: IotReadyMessage = { channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, type: "ready", sessionId: message.sessionId, points: this.manifest.ok ? this.manifest.value : [], ...(!this.manifest.ok ? { error: this.manifest.message } : {}) };
      this.host.parent.postMessage(ready, this.parentOrigin);
    }
    if (!this.manifest.ok) return;
    const previous = this.state;
    this.state = receiveIotMessage(previous, message, this.manifest.value, Date.now());
    if (this.state.error && this.state.error !== previous.error) console.error("[iot-embed] Point input rejected", { sessionId: message.sessionId, error: this.state.error });
    this.publish();
  };
}

let browserSession: { origin: string; session: IotEmbedSession } | undefined;
export function getIotEmbedSession(parentOrigin: string): IotEmbedSession {
  if (!browserSession) browserSession = { origin: parentOrigin, session: new IotEmbedSession(window, parentOrigin) };
  if (browserSession.origin !== parentOrigin) throw new Error("同一页面的 IoT 宿主来源不能改变，请重新加载页面。");
  return browserSession.session;
}
