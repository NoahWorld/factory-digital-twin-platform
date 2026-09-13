import { test,expect } from "@playwright/test";
import { PersistedQueryStore,PersistedQueryError,type PersistedQuery,type PersistedQueryData } from "../apps/web/src/persisted-query-store";
const query = (assetId="DEVICE"):PersistedQuery => ({ kind:"history",assetId,metricKey:"temperature",options:{ windowMinutes:1,points:20,aggregation:"avg" } });
const data = ():PersistedQueryData => ({ kind:"history",value:{ projectId:"p",scopeId:"draft",assetId:"DEVICE",metricKey:"temperature",from:new Date(Date.now()-60000).toISOString(),to:new Date().toISOString(),aggregation:"avg",bucketMs:3000,points:[],diagnostics:{ state:"ready",pending:0,dropped:0,lastPersistedAt:null,errorCode:null,retentionDays:7,maxRows:1000000 } } });

test("equal persisted queries share an in-flight request and idempotent last release ignores late responses",async () => {
  const signals:AbortSignal[] = [],releases:Array<(data:PersistedQueryData) => void> = [];
  const store = new PersistedQueryStore((_,signal) => { signals.push(signal);return new Promise((resolve) => releases.push(resolve)); },1000,5000);
  try {
    const listener = () => {};const first = store.subscribe(query(),listener),second = store.subscribe(query(),listener);await expect.poll(() => signals.length).toBe(1);first();expect(signals[0].aborted).toBe(false);
    releases[0](data());await expect.poll(() => store.getSnapshot(query()).status).toBe("ready");store.refresh(query());await expect.poll(() => signals.length).toBe(2);second();expect(signals[1].aborted).toBe(true);
    const newer = store.subscribe(query(),() => {});second();await expect.poll(() => signals.length).toBe(3);releases[1](data());await Promise.resolve();expect(store.getSnapshot(query()).status).toBe("loading");releases[2](data());await expect.poll(() => store.getSnapshot(query()).status).toBe("ready");newer();
  } finally { store.dispose();releases.forEach((release) => release(data())); }
});

test("persisted query admission and concurrency recover after release; terminal denials require explicit retry",async () => {
  const calls:string[] = [],finish:Array<() => void> = [];
  const store = new PersistedQueryStore((query_,signal) => new Promise((resolve,reject) => { calls.push(query_.kind === "history" ? query_.assetId:"");finish.push(() => resolve(data()));signal.addEventListener("abort",() => reject(new Error("cancelled")),{ once:true }); }),1000,5000,2,1);
  try {
    const a = store.subscribe(query("A"),() => {}),b = store.subscribe(query("B"),() => {}),c = store.subscribe(query("C"),() => {});await expect.poll(() => calls).toEqual(["A"]);expect(store.getSnapshot(query("C")).status).toBe("error");a();await expect.poll(() => calls).toEqual(["A","B"]);expect(store.getSnapshot(query("C")).status).toBe("loading");finish[1]();await expect.poll(() => calls).toEqual(["A","B","C"]);b();c();
  } finally { store.dispose();finish.forEach((complete) => complete()); }
  let attempts = 0;const denied = new PersistedQueryStore(async () => { attempts++;if (attempts === 1) throw new PersistedQueryError("Permission denied",true);return data(); },20,100);
  try { const release = denied.subscribe(query(),() => {});await expect.poll(() => denied.getSnapshot(query()).status).toBe("error");await new Promise((resolve) => setTimeout(resolve,80));expect(attempts).toBe(1);denied.refresh(query());await expect.poll(() => denied.getSnapshot(query()).status).toBe("ready");release(); } finally { denied.dispose(); }
});

test("alarm decoder refuses contradictory active state instead of rendering a false all-clear",async () => {
  const { decodeAlarmSnapshot } = await import("../shared/alarms");
  const empty = { projectId:"p",scopeId:"draft",configured:true,active:[],activeTruncated:false,ruleStates:[{ ruleId:"rule",assetId:"DEVICE",activeEpisodeId:"missing-episode",confirmation:"known" }],records:[],nextCursor:null,retentionDays:30,maxEvents:200000,diagnostics:{ state:"ready",pending:0,dropped:0,errorCode:null,lastPersistedAt:null,retentionDays:7,maxRows:1000000 } };
  expect(() => decodeAlarmSnapshot(empty)).toThrow("遗漏");expect(() => decodeAlarmSnapshot({ ...empty,ruleStates:[] })).not.toThrow();
});

test("a timed-out persisted query aborts its request, reports the failure and retries within the live subscription",async () => {
  let attempts = 0,firstSignal:AbortSignal|undefined;const states:string[] = [];
  const store = new PersistedQueryStore(async (_,signal) => { attempts++;if (attempts>1) return data();firstSignal = signal;return new Promise((_,reject) => signal.addEventListener("abort",() => reject(new Error("Aborted")),{ once:true })); },20,40);
  try { const release = store.subscribe(query(),() => states.push(store.getSnapshot(query()).status));await expect.poll(() => attempts).toBeGreaterThanOrEqual(2);expect(firstSignal?.aborted).toBe(true);expect(states).toContain("error");await expect.poll(() => store.getSnapshot(query()).status).toBe("ready");release(); } finally { store.dispose(); }
});
