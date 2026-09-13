import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes,randomUUID } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { SqliteDatabase } from "../apps/runtime/src/sqlite-database";
import { createUser } from "../apps/api/src/auth";
import { validateComponentBinding,validateBindingCatalog,validateLocalComponentReferences } from "../shared/component-bindings";
import { decodeHistorySeries } from "../shared/history-series";
import { decodeAlarmSnapshot } from "../shared/alarms";

test("persistent widget contracts reject incompatible targets, metrics, ranges and foreign assets",() => {
  const history = { id:"history",version:2,target:"history",selection:"fixed",assetIds:["DEVICE"],metrics:[{ metricKey:"temperature",valueType:"number" }],history:{ windowMinutes:60,points:120,aggregation:"avg" } };
  const alarms = { id:"alarms",version:2,target:"alarms",selection:"fixed",assetIds:["DEVICE"],metrics:[],alarm:{ mode:"active",limit:10,windowMinutes:1440 } };
  expect(validateComponentBinding(history)).toEqual(history);expect(validateComponentBinding(alarms)).toEqual(alarms);
  for (const bad of [{ ...history,version:1 },{ ...history,assetIds:["DEVICE","OTHER"] },{ ...history,metrics:[{ metricKey:"status",valueType:"string" }] },{ ...history,history:{ ...history.history,windowMinutes:0 } },{ ...alarms,metrics:history.metrics },{ ...alarms,alarm:{ ...alarms.alarm,limit:1000 } }]) expect(() => validateComponentBinding(bad)).toThrow();
  expect(validateBindingCatalog(validateComponentBinding(alarms),[],new Set(["OTHER"])) ).toContain("不属于");
  expect(() => validateLocalComponentReferences([{ id:"wrong",type:"metric-card",dataBindingRefs:["history"] }],[validateComponentBinding(history)])).toThrow("不支持");
});

test("history series and alarm summaries enforce project, version and selected-asset boundaries",async ({},testInfo) => {
  const runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL:runtime.url });let viewer:typeof api|undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"widget-api@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Widget API" } })).status()).toBe(201);
    const demo = await createDemo(api,false,false),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await api.get(`${base}/data-sources`)).json()).dataSources;
    for (const source of sources) expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,collectionMode:"continuous",intervalSeconds:1 } } })).status()).toBe(200);
    const config = (await (await api.get(`${base}/alarm-rules`)).json());expect((await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:config.runtimeRevision,rules:demo.assets.map((asset) => ({ id:`rule-${asset.assetId}`,name:asset.assetId,assetId:asset.assetId,enabled:true,severity:"warning",message:"Device metric positive",condition:{ op:"gt",left:{ kind:"metric",assetId:asset.assetId,metricKey:"temperature" },right:{ kind:"literal",value:0 } },recoveryCondition:null })) } })).status()).toBe(200);
    await expect.poll(async () => (await (await api.get(`${base}/alarms`)).json()).active.length).toBe(2);
    const response = await api.get(`${base}/alarms?assetId=DEVICE-001&summary=1`);expect(response.status()).toBe(200);const subset = decodeAlarmSnapshot(await response.json());expect(subset.active).toHaveLength(1);expect(subset.ruleStates).toHaveLength(1);expect([...subset.active,...subset.records,...subset.ruleStates].every((row) => row.assetId === "DEVICE-001")).toBe(true);expect(subset.records.every((row) => row.valuesOmitted && row.values.length === 0)).toBe(true);
    const full = decodeAlarmSnapshot(await (await api.get(`${base}/alarms?assetId=DEVICE-001`)).json());expect(full.records[0].values.length).toBeGreaterThan(0);
    const seriesPath = () => { const to = new Date(),params = new URLSearchParams({ assetId:"DEVICE-001",metricKey:"temperature",points:"60",from:new Date(to.getTime()-60000).toISOString(),to:to.toISOString() });return `${base}/telemetry/series?${params}`; };
    await expect.poll(async () => decodeHistorySeries(await (await api.get(seriesPath())).json()).points.some((point) => point.quality === "good")).toBe(true);
    const path = seriesPath(),series = decodeHistorySeries(await (await api.get(path)).json());expect(series.scopeId).toBe("draft");expect(series.projectId).toBe(demo.projectId);
    expect((await api.get(`${base}/versions/${randomUUID()}/telemetry/series?assetId=DEVICE-001&metricKey=temperature`)).status()).toBe(404);
    const db = new SqliteDatabase(runtime.databasePath),password = randomBytes(24).toString("hex"),email = "widget-viewer@example.invalid";
    try { const user = await createUser({ DB:db },{ email,password,displayName:"Widget viewer",roles:["viewer"] }),now = new Date().toISOString();await db.prepare("INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'viewer',?,?)").bind(demo.projectId,user.id,now,now).run();viewer = await apiRequest.newContext({ baseURL:runtime.url });expect((await viewer.post("/api/v1/auth/login",{ data:{ email,password } })).status()).toBe(200);expect((await viewer.get(path)).status()).toBe(200);expect((await viewer.get(`${base}/alarms?assetId=DEVICE-001&summary=1`)).status()).toBe(200);await db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").bind(demo.projectId,user.id).run();expect((await viewer.get(path)).status()).toBe(404);expect((await viewer.get(`${base}/alarms`)).status()).toBe(404); } finally { db.close(); }
  } finally { await viewer?.dispose();await api.dispose();await runtime.dispose(); }
});
