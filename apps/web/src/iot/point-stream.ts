import { request } from "../api";
import { ApiRequestError, errorMessage, reportError, UserFacingError } from "../errors";
import { readTwinSnapshot, type TwinDriveLiveSource, type TwinStreamState } from "../twin/point-stream";
import type { TwinDriveSnapshot, TwinPoint } from "../../../../shared/twin-drive";

/** One authenticated, abortable request at a time. The IoT session never enters a URL. */
export class IotPointStream implements TwinDriveLiveSource {
  private state: TwinStreamState = { connected: false, snapshot: null, phase: "idle", retryCount: 0, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: AbortController | null = null;
  private stopped = true;
  private generation = 0;
  private revision = 0;
  private interval = 500;
  private timeout = 5000;
  constructor(private projectId: string, private onConfigChanged: () => void) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setConfiguration(revision: number, _points: TwinPoint[], _source: "api" | "simulator", interval = 500, timeout = 5000) {
    this.revision = revision; this.interval = interval; this.timeout = timeout;
  }
  private update(patch: Partial<TwinStreamState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  connect = () => { if (!this.stopped) return; this.stopped = false; this.generation++; this.update({ phase: "connecting", snapshot: null, retryCount: 0, error: null }); void this.poll(this.generation); };
  close = () => { this.stopped = true; this.generation++; this.active?.abort(); if (this.timer) clearTimeout(this.timer); this.timer = null; this.update({ connected: false, phase: "idle" }); };
  private async poll(generation: number) {
    if (this.stopped || generation !== this.generation) return;
    const controller = new AbortController(); this.active = controller;
    const deadline = setTimeout(() => controller.abort(new Error("IoT snapshot request timed out")), this.timeout);
    let delay = this.interval;
    try {
      const response = await request<unknown>(`/api/v1/projects/${encodeURIComponent(this.projectId)}/twin-drive/snapshot`, { signal: controller.signal });
      if (this.stopped || generation !== this.generation) return;
      const snapshot: TwinDriveSnapshot = readTwinSnapshot(response, this.projectId);
      if (snapshot.source !== "api") throw new UserFacingError("IoT 返回了不受支持的数据来源。");
      if (snapshot.revision !== this.revision) {
        this.close(); this.update({ phase: "error", error: "数据配置已变化，正在重新加载。" }); this.onConfigChanged(); return;
      }
      if (this.state.snapshot && snapshot.sequence <= this.state.snapshot.sequence) throw new UserFacingError("IoT 数据序号回退，已停止同步，请重新连接。");
      this.update({ connected: true, snapshot, phase: "live", error: null, retryCount: 0 });
    } catch (reason) {
      if (this.stopped || generation !== this.generation) return;
      const retries = this.state.retryCount + 1;
      const retryable = controller.signal.aborted || reason instanceof ApiRequestError &&
        (reason.code === "network_error" || (reason.context.status ?? 0) >= 500 || reason.code === "iot_device_data_pending");
      reportError(reason, { operation: "iot.points", projectId: this.projectId });
      const retry = retryable && retries <= 6;
      this.update({ connected: false, phase: retry ? "reconnecting" : "error", retryCount: retries,
        error: controller.signal.aborted ? "🔴 IoT 数据请求超时。" : errorMessage(reason) });
      if (!retry) { this.stopped = true; return; }
      delay = Math.min(30000, 1000 * 2 ** (retries - 1));
    } finally { clearTimeout(deadline); if (this.active === controller) this.active = null; }
    if (!this.stopped && generation === this.generation) this.timer = setTimeout(() => void this.poll(generation), delay);
  }
}
