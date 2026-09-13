import { AppError,type AppEnv } from "./auth";
import type { RuntimeFrame,RuntimeSubscription } from "../../../shared/runtime-stream";

export async function runtimeStream(env: AppEnv,request: Request,projectId: string,authorize: () => Promise<unknown>): Promise<Response> {
  if (!env.CENTRAL_RUNTIME) throw new AppError(503,"central_runtime_unavailable","Central collection is unavailable on this host.");
  const raw = new URL(request.url).searchParams.get("assets") ?? "";
  if (raw.length > 10000) throw new AppError(400,"runtime_demand_invalid","Asset demand is too large.");
  const ids = raw.split(",");
  if (ids.some((id) => !/^[a-zA-Z0-9-]{1,100}$/.test(id)) || ids.length > 100) throw new AppError(400,"runtime_demand_invalid","Use 1–100 asset record IDs.");
  let subscription: RuntimeSubscription | undefined,controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let oversized = false;
  let pending: Uint8Array | undefined,closed = false,heartbeat: ReturnType<typeof setInterval> | undefined,recheck: ReturnType<typeof setInterval> | undefined,checking = false;
  const encoder = new TextEncoder();
  const stop = () => { if (closed) return; closed = true; clearInterval(heartbeat); clearInterval(recheck); request.signal.removeEventListener("abort",stop); subscription?.release(); pending = undefined; try { controller?.close(); } catch { /* Consumer already cancelled. */ } };
  const flush = () => { if (!closed && pending && controller && (controller.desiredSize ?? 0) > 0) { controller.enqueue(pending); pending = undefined; } };
  const publish = (frame: RuntimeFrame) => {
    if (closed) return;
    const bytes = encoder.encode(`event: runtime\nid: ${frame.epoch}:${frame.sequence}\ndata: ${JSON.stringify(frame)}\n\n`);
    if (bytes.byteLength > 1024*1024) { oversized = true; stop(); return; }
    pending = bytes; flush(); // At most one queued frame and the newest pending full snapshot.
  };
  subscription = await env.CENTRAL_RUNTIME.subscribe(projectId,ids,publish);
  if (request.signal.aborted || closed) { subscription.release(); throw new AppError(oversized ? 413 : 499,oversized ? "runtime_snapshot_too_large" : "runtime_subscription_cancelled",oversized ? "Reduce the subscription asset demand." : "Subscription cancelled."); }
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; publish(subscription!.snapshot()); },
    pull() { flush(); },cancel() { stop(); },
  },{ highWaterMark:1 });
  if (closed) throw new AppError(413,"runtime_snapshot_too_large","Reduce the subscription asset demand.");
  request.signal.addEventListener("abort",stop,{ once:true });
  heartbeat = setInterval(() => { if (!closed && !pending && controller && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": heartbeat\n\n")); },15000);
  recheck = setInterval(() => {
    if (checking || closed) return; checking = true;
    void authorize().catch(() => stop()).finally(() => { checking = false; });
  },15000);
  return new Response(body,{ headers:{ "content-type":"text/event-stream; charset=utf-8","cache-control":"no-store","x-accel-buffering":"no" } });
}
