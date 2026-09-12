import { test, expect } from "@playwright/test";
import { validateSceneMotions, sampleMotionTrack } from "../shared/scene-motion";
import { SceneMotionPlayer } from "../shared/scene-motion-player";

test("motion paths sample positions, rotation, linear-light color and step visibility with bounded valid keyframes", () => {
  const input = { id: "path", name: "设备路径", version: 1, durationMs: 2000, repeat: 1, fill: "restore", tracks: [
    { id: "move", type: "object", target: { instanceId: "pump", objectId: null }, property: "position", easing: "linear", keyframes: [{ timeMs: 0, value: [0,0,0] }, { timeMs: 1000, value: [2,4,6] }, { timeMs: 2000, value: [4,0,0] }] },
    { id: "color", type: "object", target: { instanceId: "pump", objectId: null }, property: "color", easing: "linear", keyframes: [{ timeMs: 0, value: "#000000" }, { timeMs: 2000, value: "#ffffff" }] },
    { id: "visible", type: "object", target: { instanceId: "pump", objectId: null }, property: "visible", easing: "linear", keyframes: [{ timeMs: 0, value: false }, { timeMs: 2000, value: true }] },
  ] };
  const motion = validateSceneMotions([input])[0];
  expect(sampleMotionTrack(motion.tracks[0],500)).toEqual([1,2,3]); expect(sampleMotionTrack(motion.tracks[0],1500)).toEqual([3,2,3]);
  expect(sampleMotionTrack(motion.tracks[1],1000)).toBe("#bcbcbc"); expect(sampleMotionTrack(motion.tracks[2],1999)).toBe(false); expect(sampleMotionTrack(motion.tracks[2],2000)).toBe(true);
  expect(() => validateSceneMotions([{ ...input, repeat: 100 }])).toThrow("最多60秒");
  expect(() => validateSceneMotions([{ ...input, tracks: [...input.tracks,input.tracks[0]] }])).toThrow("重复");
  expect(() => validateSceneMotions([{ ...input, tracks: [{ ...input.tracks[0], property: "scale", keyframes: [{ timeMs: 0, value: [1,1,1] }, { timeMs: 2000, value: [-1,1,1] }] }] }])).toThrow("跨越零");
  expect(() => validateSceneMotions([{ ...input, tracks: [{ ...input.tracks[0], keyframes: [{ timeMs: 1000, value: [1,1,1] }, { timeMs: 2000, value: [2,2,2] }] }] }])).toThrow("覆盖0");
});

test("a failed final frame rejects the motion and leaves no retained poisoned channel", async () => {
  let restores = 0;
  const player = new SceneMotionPlayer({ read: () => 0,write: (_,value) => { if (value === 1) throw new Error("渲染写入失败"); },restore: () => { restores++; } });
  const [motion] = validateSceneMotions([{ id: "fade",name: "Fade",version: 1,durationMs: 10,repeat: 1,fill: "hold",tracks: [{ id: "t",type: "object",target: { instanceId: "i",objectId: null },property: "opacity",easing: "linear",keyframes: [{ timeMs: 0,value: 0 },{ timeMs: 10,value: 1 }] }] }]);
  const outcome = player.play(motion,new AbortController().signal).catch((reason) => reason.message); player.tick(10);
  expect(await outcome).toBe("渲染写入失败"); expect(player.snapshot()).toEqual({ active: 0,heldChannels: 0 }); expect(restores).toBe(1); expect(() => player.tick(10)).not.toThrow(); player.dispose();
});

test("one frame-driven player handles independent channels, replacement cancellation, repeats and retained effects", async () => {
  let position = [9,9,9], latestBase = [9,9,9];
  const player = new SceneMotionPlayer({ read: () => [...position] as [number,number,number], write: (_,value) => { position = [...value as number[]]; }, restore: () => { position = [...latestBase]; } });
  const [motion] = validateSceneMotions([{ id: "path", name: "Path", version: 1, durationMs: 1000, repeat: 2, fill: "hold", tracks: [{ id: "t", type: "object", target: { instanceId: "pump", objectId: null }, property: "position", easing: "linear", keyframes: [{ timeMs: 0, value: [0,0,0] }, { timeMs: 1000, value: [0,2,0] }] }] }]);
  const firstController = new AbortController();
  const first = player.play(motion,firstController.signal).catch((reason) => reason.name);
  player.tick(500); expect(position).toEqual([0,1,0]); player.tick(500); expect(position).toEqual([0,0,0]);
  const next = player.play({ ...motion,id: "next",repeat: 1 },new AbortController().signal);
  expect(await first).toBe("AbortError"); player.tick(1000); await next; expect(position).toEqual([0,2,0]); expect(player.snapshot()).toEqual({ active: 0,heldChannels: 1 });
  latestBase = [0,5,0]; player.cancel("next"); expect(position).toEqual([0,5,0]); expect(player.snapshot().heldChannels).toBe(0);
  const stop = new AbortController(); const running = player.play(motion,stop.signal).catch((reason) => reason.name); player.tick(200); stop.abort();
  expect(await running).toBe("AbortError"); expect(position).toEqual([0,5,0]); expect(player.snapshot().active).toBe(0); player.dispose();
});
