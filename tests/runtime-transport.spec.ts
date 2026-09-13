import { test,expect } from "@playwright/test";
import { decodeRuntimeFrame } from "../shared/runtime-stream";

test("malformed live frames cannot announce online devices",() => {
  expect(() => decodeRuntimeFrame({ epoch:"test",sequence:1,connections:{ DEVICE:{ status:"live",failureCount:0 } } })).toThrow("设备采集状态无效");
  expect(() => decodeRuntimeFrame({ epoch:"test",sequence:-1,connections:{} })).toThrow();
});

test("a terminal SSE connection retries and a disposed generation cannot revive",async ({ page }) => {
  await page.goto("/"); await page.clock.install();
  await page.evaluate(async () => {
    const original = window.fetch;
    window.fetch = async (...args) => String(args[0]).endsWith("/runtime/capabilities") ? Response.json({ collection:"central" }) : original(...args);
    const events:MockEvents[] = [];
    class MockEvents {
      static CLOSED = 2; readyState = 1; onerror:(() => void) | null = null; listeners = new Map<string,(event:MessageEvent) => void>();
      constructor() { events.push(this); }
      addEventListener(name:string,callback:(event:MessageEvent) => void) { this.listeners.set(name,callback); }
      close() { this.readyState = 2; }
    }
    window.EventSource = MockEvents as unknown as typeof EventSource;
    const module = await import(/* @vite-ignore */ "/src/project-runtime-transport.ts");
    const store = new module.ProjectRuntimeTransport("project");
    (window as any).transportFixture = { store,events };
    store.setDemand([{ id:"record",assetId:"DEVICE" }]);
  });
  await expect.poll(() => page.evaluate(() => (window as any).transportFixture.events.length)).toBe(1);
  await page.evaluate(() => { const event = (window as any).transportFixture.events[0]; event.readyState = 2; event.onerror(); });
  await page.clock.runFor(3100);
  await expect.poll(() => page.evaluate(() => (window as any).transportFixture.events.length)).toBe(2);
  await page.evaluate(() => { const { store,events } = (window as any).transportFixture; events[1].listeners.get("runtime")({ data:JSON.stringify({ epoch:"test",sequence:1,connections:{ DEVICE:{ status:"live",failureCount:0 } } }) }); if (store.getSnapshot().DEVICE.status !== "offline") throw new Error("Malformed frame became live"); store.dispose(); events[0].onerror(); });
  await page.clock.runFor(40000);
  expect(await page.evaluate(() => (window as any).transportFixture.events.length)).toBe(2);
});
