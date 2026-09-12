import { test, expect } from "@playwright/test";
import { ResourcePool } from "../shared/resource-pool";

test("resource leases share one load and dispose exactly at the last release", async () => {
  let loads = 0; let disposals = 0;
  const resource = { geometry: "shared" };
  const pool = new ResourcePool(async () => { loads++; return resource; }, () => { disposals++; });
  const a = pool.acquire("model-v1"), b = pool.acquire("model-v1");
  expect(await a.ready).toBe(resource); expect(await b.ready).toBe(resource);
  expect(loads).toBe(1);
  a.release(); a.release(); expect(disposals).toBe(0);
  expect(pool.snapshot().leases).toBe(1);
  b.release(); expect(disposals).toBe(1);
  expect(pool.snapshot()).toMatchObject({ resources: 0, pending: 0, leases: 0 });
  const fresh = pool.acquire("model-v1"); await fresh.ready; fresh.release();
  expect(loads).toBe(2); expect(disposals).toBe(2);
});

test("cancelled late parse is disposed without poisoning a new lease", async () => {
  const pending: Array<(value: { id: number }) => void> = []; const signals: AbortSignal[] = []; const disposed: number[] = [];
  const pool = new ResourcePool<{ id: number }>((_, signal) => { signals.push(signal); return new Promise((resolve) => pending.push(resolve)); }, (value) => disposed.push(value.id));
  const old = pool.acquire("model"); const cancelled = old.ready.catch((error) => error.name);
  await Promise.resolve(); old.release(); expect(signals[0].aborted).toBe(true);
  const next = pool.acquire("model"); await Promise.resolve();
  pending[0]({ id: 1 }); expect(await cancelled).toBe("AbortError");
  expect(disposed).toEqual([1]); expect(pool.snapshot().resources).toBe(1);
  pending[1]({ id: 2 }); expect((await next.ready).id).toBe(2);
  next.release(); expect(disposed).toEqual([1, 2]);
  expect(pool.snapshot()).toMatchObject({ resources: 0, pending: 0, leases: 0 });
});

test("failed loads can retry while the failed consumer still holds its lease", async () => {
  let attempt = 0;
  const pool = new ResourcePool(async () => { if (++attempt === 1) throw new Error("upstream offline"); return "recovered"; }, () => {});
  const failed = pool.acquire("model"); await expect(failed.ready).rejects.toThrow("upstream offline");
  const retry = pool.acquire("model"); expect(await retry.ready).toBe("recovered");
  failed.release(); expect(pool.snapshot().resources).toBe(1);
  retry.release(); expect(pool.snapshot()).toMatchObject({ resources: 0, pending: 0, leases: 0 });
});
