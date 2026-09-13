import { test,expect } from "@playwright/test";
import { applyMetricTransform,validateMetricTransform,timestampToIso } from "../shared/metric-transforms";

test("metric transforms preserve NULL, explicit types and finite arithmetic without a scripting path",() => {
  const convert = validateMetricTransform({ version:1,steps:[{ type:"number",coerceString:true,scale:1,offset:-32 },{ type:"number",coerceString:false,scale:5/9,offset:0 }] });
  expect(applyMetricTransform("140",convert,"temperature")).toBe(60);expect(applyMetricTransform(null,convert,"temperature")).toBeNull();expect(applyMetricTransform(32,convert,"temperature")).toBe(0);
  for (const bad of ["","   ","0x10",true,{},"9007199254740993","1e999"]) expect(() => applyMetricTransform(bad,convert,"temperature")).toThrow();
  expect(() => applyMetricTransform(1e308,validateMetricTransform({ version:1,steps:[{ type:"number",coerceString:false,scale:100,offset:0 }] }),"overflow")).toThrow("overflow");
  const enumeration = validateMetricTransform({ version:1,steps:[{ type:"enum",entries:[{ from:1,to:"running" },{ from:"1",to:"text-code" },{ from:true,to:"enabled" }],unmapped:"error" }] });
  expect(applyMetricTransform(1,enumeration,"state")).toBe("running");expect(applyMetricTransform("1",enumeration,"state")).toBe("text-code");expect(applyMetricTransform(true,enumeration,"state")).toBe("enabled");expect(() => applyMetricTransform(2,enumeration,"state")).toThrow("step 1");
  const nullable = validateMetricTransform({ version:1,steps:[{ type:"enum",entries:[{ from:1,to:null }],unmapped:"null" },{ type:"number",coerceString:false,scale:10,offset:100 }] });expect(applyMetricTransform(2,nullable,"state")).toBeNull();expect(applyMetricTransform(1,nullable,"state")).toBeNull();
  expect(() => validateMetricTransform({ version:1,steps:[{ type:"script",code:"return 0" }] })).toThrow();expect(() => validateMetricTransform({ version:1,steps:[] })).toThrow();expect(() => validateMetricTransform({ version:1,steps:Array(5).fill(convert.steps[0]) })).toThrow();
});

test("Unix timestamp units and fractional milliseconds are explicit and invalid inputs never fall back to now",() => {
  expect(timestampToIso(0,"unix_seconds")).toBe("1970-01-01T00:00:00.000Z");expect(timestampToIso(1.9999,"unix_seconds")).toBe("1970-01-01T00:00:01.999Z");expect(timestampToIso(-0.5,"unix_ms")).toBe("1970-01-01T00:00:00.000Z");
  const transform = validateMetricTransform({ version:1,steps:[{ type:"number",coerceString:true,scale:1,offset:0 },{ type:"timestamp",format:"unix_ms" }] });expect(applyMetricTransform("1000",transform,"time")).toBe("1970-01-01T00:00:01.000Z");
  for (const value of [null,undefined,"1000",NaN,Infinity,1e300]) expect(() => timestampToIso(value,"unix_ms")).toThrow();
});
