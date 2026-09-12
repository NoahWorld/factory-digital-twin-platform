import { motionChannel, motionTracksConflict, sampleMotionTrack, validateSceneMotions, type SceneMotion, type SceneMotionTrack, type MotionValue } from "./scene-motion";

export type MotionAdapter = {
  read: (track: SceneMotionTrack) => MotionValue;
  write: (track: SceneMotionTrack, value: MotionValue) => void;
  restore: (entries: Array<{ track: SceneMotionTrack; initial: MotionValue }>) => void;
};
type Sample = { motionId: string; track: SceneMotionTrack; initial: MotionValue; value: MotionValue };
type Job = { motion: SceneMotion; elapsed: number; samples: Sample[]; resolve: () => void; reject: (reason: Error) => void; detach: () => void };
const cancelled = () => Object.assign(new Error("动画已取消或被同目标动画替代。"), { name: "AbortError" });

/** A deterministic player, driven by the viewport's existing frame loop. No timers or RAF of its own. */
export class SceneMotionPlayer {
  private jobs = new Map<string, Job>();
  private held = new Map<string, Sample>();
  private disposed = false;
  constructor(private adapter: MotionAdapter) {}
  snapshot() { return { active: this.jobs.size, heldChannels: this.held.size }; }
  ownsCamera() { return [...this.jobs.values()].some((job) => job.samples.some((sample) => sample.track.type === "camera")) || [...this.held.values()].some((sample) => sample.track.type === "camera"); }
  cancelCamera() {
    const ids = new Set([...this.jobs.values()].filter((job) => job.samples.some((sample) => sample.track.type === "camera")).map((job) => job.motion.id));
    for (const sample of this.held.values()) if (sample.track.type === "camera") ids.add(sample.motionId);
    const objectSamples = [...this.jobs.values()].filter((job) => ids.has(job.motion.id)).flatMap((job) => job.samples).concat([...this.held.values()].filter((sample) => ids.has(sample.motionId))).filter((sample) => sample.track.type !== "camera");
    ids.forEach((id) => this.cancel(id,false));
    if (objectSamples.length) this.adapter.restore(objectSamples);
    this.reapply();
  }
  play(input: SceneMotion, signal: AbortSignal): Promise<void> {
    if (this.disposed || signal.aborted) return Promise.reject(cancelled());
    const motion = validateSceneMotions([input])[0];
    // Resolve all targets before cancelling another valid animation.
    motion.tracks.forEach((track) => this.adapter.read(track));
    for (const [id, job] of this.jobs) if (id === motion.id || job.samples.some((sample) => motion.tracks.some((track) => motionTracksConflict(track,sample.track)))) this.cancel(id);
    const previous = [...this.held].filter(([,sample]) => motion.tracks.some((track) => motionTracksConflict(track,sample.track)));
    for (const [key] of previous) this.held.delete(key);
    if (previous.length) this.adapter.restore(previous.map(([, sample]) => sample));
    this.reapply();
    const samples = motion.tracks.map((track) => ({ motionId: motion.id, track, initial: structuredClone(this.adapter.read(track)), value: sampleMotionTrack(track,0) }));
    return new Promise((resolve,reject) => {
      const abort = () => this.cancel(motion.id);
      const job: Job = { motion, elapsed: 0, samples, resolve, reject, detach: () => signal.removeEventListener("abort", abort) };
      signal.addEventListener("abort", abort, { once: true }); this.jobs.set(motion.id, job);
      try { this.reapply(); } catch (reason) { this.fail(job, reason); }
    });
  }
  tick(deltaMs: number) {
    if (this.disposed) return;
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error("动画帧间隔必须为非负有限数值。");
    for (const job of [...this.jobs.values()]) {
      try {
        job.elapsed = Math.min(job.elapsed + deltaMs, job.motion.durationMs * job.motion.repeat);
        const complete = job.elapsed >= job.motion.durationMs * job.motion.repeat;
        const localTime = complete ? job.motion.durationMs : job.elapsed % job.motion.durationMs;
        job.samples.forEach((sample) => { sample.value = sampleMotionTrack(sample.track, localTime); });
        if (complete) {
          this.jobs.delete(job.motion.id); job.detach();
          if (job.motion.fill === "hold") job.samples.forEach((sample) => this.held.set(motionChannel(sample.track), sample));
          else this.adapter.restore(job.samples);
          this.reapply(); job.resolve();
        }
      } catch (reason) { this.fail(job,reason); }
    }
    this.reapply();
  }
  reapply() {
    if (this.disposed) return;
    for (const [key,sample] of this.held) {
      try { this.adapter.write(sample.track,sample.value); }
      catch (reason) { this.held.delete(key); throw reason; }
    }
    for (const job of [...this.jobs.values()]) {
      try { for (const sample of job.samples) this.adapter.write(sample.track,sample.value); }
      catch (reason) { this.fail(job,reason); }
    }
  }
  private fail(job: Job, reason: unknown) {
    this.jobs.delete(job.motion.id); job.detach();
    for (const [key,sample] of this.held) if (sample.motionId === job.motion.id) this.held.delete(key);
    let message = reason instanceof Error ? reason.message : String(reason);
    try { this.adapter.restore(job.samples); }
    catch (restoreError) { message += `；恢复失败：${String(restoreError)}`; }
    job.reject(new Error(message));
  }
  cancel(id?: string, restore = true) {
    const restores: Sample[] = [];
    for (const [key, job] of this.jobs) if (!id || key === id) {
      this.jobs.delete(key); job.detach(); if (restore) restores.push(...job.samples);
      job.reject(cancelled());
    }
    for (const [key, sample] of this.held) if (!id || sample.motionId === id) { if (restore) restores.push(sample); this.held.delete(key); }
    if (restores.length) this.adapter.restore(restores);
    this.reapply();
  }
  dispose() { if (this.disposed) return; this.cancel(); this.disposed = true; }
}
