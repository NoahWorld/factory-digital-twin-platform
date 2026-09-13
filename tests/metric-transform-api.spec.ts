import { test,expect,request as apiRequest } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("metric transforms persist, preserve omitted patches, run in all collection paths and remain isolated from source time format",async ({},testInfo) => {
  test.setTimeout(60000);let temperature:unknown = "140",offset = 0;
  const upstream = createServer((_,response) => { response.end(JSON.stringify({ timestamp:(Date.now()+offset)/1000,observedAt:1000,mode:1,values:{ temperature,pressure:24,status:"running",alarmLevel:0 } })); });upstream.listen(0,"127.0.0.1");await once(upstream,"listening");const host = `127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`;
  const runtime = await nodeRuntimeFixture(testInfo,[host]),api = await apiRequest.newContext({ baseURL:runtime.url });
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"transform-api@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Transform API" } })).status()).toBe(201);
    const demo = await createDemo(api,false,false),base = `/api/v1/projects/${demo.projectId}`,assetPath = `${base}/assets/${demo.assets[0].id}`,bindings = (await (await api.get(`${assetPath}/data-bindings`)).json()).dataBindings,binding = bindings.find((binding:{ metricKey:string }) => binding.metricKey === "temperature"),source = (await (await api.get(`${base}/data-sources`)).json()).dataSources.find((source:{ id:string }) => source.id === binding.dataSourceId);
    expect(binding).not.toHaveProperty("transform");expect((await api.patch(`${base}/data-sources/${source.id}`,{ data:{ config:{ ...source.config,url:`http://${host}/state`,timestampFormat:"unix_seconds",collectionMode:"continuous",intervalSeconds:1 } } })).status()).toBe(200);
    const transform = { version:1,steps:[{ type:"number",coerceString:true,scale:1,offset:-32 },{ type:"number",coerceString:false,scale:5/9,offset:0 }] };
    const saved = await api.patch(`${assetPath}/data-bindings/${binding.id}`,{ data:{ transform } });expect(saved.status(),await saved.text()).toBe(200);expect((await saved.json()).dataBinding.transform).toEqual(transform);
    const state = await api.get(`${assetPath}/runtime-state`);expect(state.status(),await state.text()).toBe(200);const actual = (await state.json()).runtimeState;expect(actual.values.temperature).toBe(60);expect(Math.abs(Date.now()-Date.parse(actual.sources[0].sourceTimestamp))).toBeLessThan(6000);
    expect((await api.patch(`${assetPath}/data-bindings/${binding.id}`,{ data:{ unit:"Celsius" } })).status()).toBe(200);expect((await (await api.get(`${assetPath}/data-bindings`)).json()).dataBindings.find((row:{ id:string }) => row.id === binding.id).transform).toEqual(transform);
    for (const [metricKey,sourcePath,valueType,transform] of [["modeText","$.mode","string",{ version:1,steps:[{ type:"enum",entries:[{ from:1,to:"running" }],unmapped:"error" }] }],["reportedAt","$.observedAt","timestamp",{ version:1,steps:[{ type:"timestamp",format:"unix_ms" }] }]] as const) {
      const created = await api.post(`${assetPath}/data-bindings`,{ data:{ dataSourceId:source.id,metricKey,sourcePath,valueType,unit:null,staleAfterSeconds:6,transform } });expect(created.status(),await created.text()).toBe(201);
    }
    const values = (await (await api.get(`${assetPath}/runtime-state`)).json()).runtimeState.values;expect(values.modeText).toBe("running");expect(values.reportedAt).toBe("1970-01-01T00:00:01.000Z");
    await expect.poll(async () => (await (await api.get(`${base}/telemetry/history?assetId=DEVICE-001&metricKey=temperature`)).json()).records.some((row:{ value:number;quality:string }) => row.quality === "good" && row.value === 60)).toBe(true);
    const alarmConfig = (await (await api.get(`${base}/alarm-rules`)).json());
    expect((await api.put(`${base}/alarm-rules`,{ data:{ expectedRuntimeRevision:alarmConfig.runtimeRevision,rules:[{ id:"converted-temperature",name:"Converted temperature high",assetId:"DEVICE-001",enabled:true,severity:"warning",message:"Converted value over 50",recoveryCondition:null,condition:{ op:"gt",left:{ kind:"metric",assetId:"DEVICE-001",metricKey:"temperature" },right:{ kind:"literal",value:50 } } }] } })).status()).toBe(200);
    await expect.poll(async () => (await (await api.get(`${base}/alarms`)).json()).active.length).toBe(1);
    expect((await (await api.get(`${base}/alarms`)).json()).records.find((event:{kind:string}) => event.kind === "triggered").values).toContainEqual(expect.objectContaining({ metricKey:"temperature",value:60,quality:"good" }));
    temperature = null;expect((await (await api.get(`${assetPath}/runtime-state`)).json()).runtimeState.values.temperature).toBeNull();temperature = "secret-raw-unmatched-value";const failed = await api.get(`${assetPath}/runtime-state`);expect(failed.status()).toBe(422);expect(await failed.text()).not.toContain("secret-raw-unmatched-value");temperature = "140";
    offset = -60000;expect((await (await api.get(`${assetPath}/runtime-state`)).json()).error).toBe("data_source_stale");offset = 600000;expect((await (await api.get(`${assetPath}/runtime-state`)).json()).error).toBe("data_source_timestamp_in_future");offset = 0;
    expect((await api.patch(`${assetPath}/data-bindings/${binding.id}`,{ data:{ transform:null } })).status()).toBe(200);expect((await (await api.get(`${assetPath}/data-bindings`)).json()).dataBindings.find((row:{ id:string }) => row.id === binding.id)).not.toHaveProperty("transform");expect((await (await api.get(`${assetPath}/runtime-state`)).json()).error).toBe("metric_type_mismatch");
    await expect.poll(async () => (await (await api.get(`${base}/alarms`)).json()).records.some((event:{kind:string}) => event.kind === "retired")).toBe(true);
    expect((await (await api.get(`${base}/alarms`)).json()).records.some((event:{kind:string}) => event.kind === "recovered")).toBe(false);
  } finally { await api.dispose();await runtime.dispose();upstream.closeAllConnections();await new Promise<void>((resolve) => upstream.close(() => resolve())); }
});
