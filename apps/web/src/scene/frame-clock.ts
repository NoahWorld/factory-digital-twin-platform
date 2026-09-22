/** Animation time is measured only between renderer callback timestamps. */
export class SceneFrameClock {
  private previousTimestamp: number | null = null;

  reset(): void {
    this.previousTimestamp = null;
  }

  tick(timestamp: number): { frameMs: number; deltaSeconds: number } {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`场景帧时钟需要非负有限时间戳（当前 ${timestamp}，上一帧 ${this.previousTimestamp}）`);
    }
    if (this.previousTimestamp !== null && timestamp < this.previousTimestamp) {
      throw new Error(`场景帧时钟不能倒退（当前 ${timestamp}，上一帧 ${this.previousTimestamp}）`);
    }
    // RAF timestamps may precede performance.now() sampled while starting the loop.
    // The first callback after every start/resume establishes its own baseline.
    const frameMs = this.previousTimestamp === null ? 0 : timestamp - this.previousTimestamp;
    this.previousTimestamp = timestamp;
    return { frameMs, deltaSeconds: Math.min(frameMs / 1000, 0.1) };
  }
}
