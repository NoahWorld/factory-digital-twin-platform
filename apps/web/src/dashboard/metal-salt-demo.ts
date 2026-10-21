import { UserFacingError } from "../errors";
import type { StandaloneSceneInstance } from "../../../../shared/standalone-3d";

export type DemoMetric = { label: string; unit: string; base: number; amplitude: number; digits: number };
export type DemoDevice = { key: string; label: string; stage: string; description: string; metrics: DemoMetric[] };
const metric = (label: string, unit: string, base: number, amplitude: number, digits = 1): DemoMetric => ({ label, unit, base, amplitude, digits });

/** Presentation-only profile. Never written to IoT telemetry or used as a failed-request fallback. */
export const metalSaltDemo = {
  title: "xxx金属盐看板",
  devices: [
    { key: "reaction-c", label: "反应釜 C", stage: "反应", description: "物料进入反应工序，通过搅拌与温度控制展示均匀反应过程。", metrics: [metric("釜内温度", "°C", 78.4, 1.2), metric("搅拌转速", "rpm", 120, 4, 0), metric("液位", "%", 68, 2), metric("釜内压力", "MPa", .12, .008, 3)] },
    { key: "wash-a", label: "清洗釜 A", stage: "一级清洗", description: "模拟第一阶段清洗，展示洗液流量、温度与物料液位。", metrics: [metric("洗液流量", "m³/h", 3.6, .12), metric("液位", "%", 64, 2), metric("清洗温度", "°C", 42, .8), metric("搅拌转速", "rpm", 85, 3, 0)] },
    { key: "wash-b", label: "清洗釜 B", stage: "二级清洗", description: "模拟第二阶段清洗，衔接后续固液分离工序。", metrics: [metric("洗液流量", "m³/h", 3.2, .1), metric("液位", "%", 61, 2), metric("清洗温度", "°C", 38, .7), metric("搅拌转速", "rpm", 80, 3, 0)] },
    { key: "separation-a", label: "固液分离器 A", stage: "一级分离", description: "演示混合物料的固液分离，观察处理流量与过滤压差。", metrics: [metric("处理流量", "m³/h", 2.8, .1), metric("过滤压差", "MPa", .18, .008, 3), metric("驱动电流", "A", 12.6, .4), metric("出液温度", "°C", 35, .5)] },
    { key: "separation-b", label: "固液分离器 B", stage: "二级分离", description: "演示后续分离阶段，管道沿直角转向分散区。", metrics: [metric("处理流量", "m³/h", 2.5, .09), metric("过滤压差", "MPa", .16, .007, 3), metric("驱动电流", "A", 11.8, .4), metric("出液温度", "°C", 33, .5)] },
    { key: "dispersion-a", label: "分散机 A", stage: "一级分散", description: "通过高速分散演示物料均匀化，展示转速、负载和温度。", metrics: [metric("分散转速", "rpm", 1450, 20, 0), metric("电机负载", "%", 63, 2), metric("物料温度", "°C", 31, .5), metric("运行功率", "kW", 8.5, .3)] },
    { key: "dispersion-b", label: "分散机 B", stage: "二级分散", description: "展示最终分散工序，完成从反应、清洗到分离、分散的流程讲解。", metrics: [metric("分散转速", "rpm", 1380, 18, 0), metric("电机负载", "%", 59, 2), metric("物料温度", "°C", 29, .5), metric("运行功率", "kW", 7.8, .25)] },
  ] satisfies DemoDevice[],
};

export function demoValue(metric: DemoMetric, tick: number, phase: number): number {
  return Number((metric.base + metric.amplitude * (Math.sin(tick * .37 + phase) * .7 + Math.cos(tick * .19 + phase) * .3)).toFixed(metric.digits));
}

export function bindDemoDevices(instances: StandaloneSceneInstance[]): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const device of metalSaltDemo.devices) {
    const matches = instances.filter(instance => instance.visible && instance.label.replace(/\s/g, "") === device.label.replace(/\s/g, ""));
    if (matches.length !== 1) throw new UserFacingError(`看板设备“${device.label}”需对应一个可见场景模型，目前匹配 ${matches.length} 个。请在场景中检查名称和显隐。`);
    bindings.set(device.key, matches[0].id);
  }
  return bindings;
}
