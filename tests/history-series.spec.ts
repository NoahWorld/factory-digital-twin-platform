import { test,expect } from "@playwright/test";
import { resolve } from "node:path";
import { migrateRuntimeDatabase } from "../apps/runtime/src/migrations";
import { TelemetryStore } from "../apps/runtime/src/telemetry-store";
import { parseHistorySeriesQuery,decodeHistorySeries } from "../shared/history-series";
import type { TelemetryRecord } from "../shared/telemetry";

test("history buckets cover the requested time range and never average invalid values, mixed configurations or units into apparently valid data",async ({},testInfo) => {
  const path = testInfo.outputPath("telemetry.sqlite");await migrateRuntimeDatabase(path,resolve("apps/runtime/telemetry-migrations"));const store = new TelemetryStore(path),start = Math.floor(Date.now()/1000)*1000-60000;
  let sequence = 0;const row = (offset:number,value:TelemetryRecord["value"],patch:Partial<TelemetryRecord>={}):TelemetryRecord => ({ projectId:"p",scopeId:"draft",configRevision:1,sampleId:`epoch/job/${sequence++}`,assetId:"DEVICE",assetRecordId:"a",metricKey:"temperature",sourceId:"s",bindingId:"b",value,valueType:"number",unit:"C",sourceTimestamp:null,collectedAt:new Date(start+offset).toISOString(),quality:"good",errorCode:null,...patch });
  try {
    store.enqueue([row(100,10),row(1100,20),row(4100,30),row(4200,null,{ quality:"stale",errorCode:"data_source_stale" }),row(6100,40),row(7100,50,{ configRevision:2 }),row(9100,60),row(9200,70,{ unit:"F" }),row(12100,80),row(14900,90),row(16100,"bad-number"),row(100,999,{ projectId:"other" }),row(100,888,{ scopeId:"version" })]);store.flush();
    const params = new URLSearchParams({ assetId:"DEVICE",metricKey:"temperature",from:new Date(start).toISOString(),to:new Date(start+60000).toISOString(),points:"20" });
    const query = parseHistorySeriesQuery(params,"draft"),result = store.querySeries("p",query),decoded = decodeHistorySeries({ ...result,diagnostics:store.diagnostics("p") });
    expect(decoded.points).toHaveLength(20);expect(decoded.points[0]).toMatchObject({ count:2,value:15,quality:"good",unit:"C",configRevision:1 });expect(decoded.points[1]).toMatchObject({ value:null,quality:"invalid" });expect(decoded.points[2]).toMatchObject({ value:null,quality:"mixed",configRevision:null });expect(decoded.points[3]).toMatchObject({ value:null,quality:"mixed",unit:null });expect(decoded.points[4].value).toBe(85);expect(decoded.points[5]).toMatchObject({ value:null,quality:"invalid" });expect(decoded.points[6]).toMatchObject({ value:null,count:0,quality:"empty" });
    expect(store.querySeries("p",{ ...query,aggregation:"min" }).points[0].value).toBe(10);expect(store.querySeries("p",{ ...query,aggregation:"max" }).points[0].value).toBe(20);expect(store.querySeries("p",{ ...query,aggregation:"last" }).points[0].value).toBe(20);
    expect(store.querySeries("p",{ ...query,scopeId:"version" }).points[0].value).toBe(888);expect(store.querySeries("other",query).points[0].value).toBe(999);
    const short = store.querySeries("p",{ ...query,to:new Date(start+1001).toISOString(),points:200 });expect(() => decodeHistorySeries({ ...short,diagnostics:store.diagnostics("p") })).not.toThrow();expect(Date.parse(short.points.at(-1)!.at)).toBeLessThan(start+1001);
    expect(() => decodeHistorySeries({ ...decoded,points:[{ ...decoded.points[0],value:null,quality:"good" }] })).toThrow();expect(() => parseHistorySeriesQuery(new URLSearchParams({ assetId:"DEVICE",metricKey:"temperature",points:"10000" }),"draft")).toThrow();
  } finally { store.close(); }
});
