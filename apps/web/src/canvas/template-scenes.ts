import { ornamentDefaults, type CardTitleProps } from "../../../../shared/canvas-ornaments";
import type { IconId } from "../../../../shared/icon-catalog";
import type { CanvasNode, CanvasNodeType, DashboardBaseProps, DecorationProps, PanelFrameProps } from "./types";

type Box = { x: number; y: number; width: number; height: number };
type SceneKind = "production" | "support" | "park" | "warehouse" | "water" | "energy" | "datacenter";
type Station = { name: string; icon: IconId; value: string; detail: string; state: string; warning?: boolean };
type Scene = { title: string; subtitle: string; route: string; stations: Station[]; flow: boolean };

const scenes: Record<SceneKind, Scene> = {
  production: {
    title: "总装一线 · 工艺与设备全景", subtitle: "工单 MO-0923-016 / 精密执行器 / A 班", route: "上料 → 精加工 → 机器人装配 → 在线检测 → 包装 → 成品入库", flow: true,
    stations: [
      { name: "01 自动上料", icon: "forklift", value: "126 件 / h", detail: "缓存 24 件 · 送料 39 s", state: "● 运行中" },
      { name: "02 CNC 精加工", icon: "cog", value: "6,800 rpm", detail: "主轴 46.2 ℃ · 负载 68%", state: "● 加工中" },
      { name: "03 机器人装配", icon: "settings", value: "43 s / 件", detail: "R03 · 夹具寿命剩余 8%", state: "● 维护预警", warning: true },
      { name: "04 视觉检测", icon: "search", value: "99.1% 合格", detail: "Q02 · 待检工件 18 件", state: "● 待料" , warning: true },
      { name: "05 自动包装", icon: "package", value: "16:10 恢复", detail: "P02 · 更换热封组件", state: "● 计划保养" },
      { name: "06 成品入库", icon: "warehouse", value: "2,438 箱", detail: "L01 · 4 个托盘待转运", state: "● 输送正常" },
    ],
  },
  support: {
    title: "装备保障场 · 车辆与工位分布", subtitle: "场区平面示意 / 总车位 40 / 在位车辆 34", route: "西门核验 → 待检区 → 维护工位 → 停放区 → 南门出场", flow: false,
    stations: [
      { name: "A 区 · 运输保障", icon: "truck", value: "8 / 10 在位", detail: "车辆 T01—T10 · 2 辆任务中", state: "● 正常" },
      { name: "B 区 · 工程装备", icon: "forklift", value: "10 / 12 在位", detail: "装备 E01—E12 · 1 辆待检", state: "● 正常" },
      { name: "C 区 · 特种装备", icon: "container", value: "8 / 8 在位", detail: "装备 S01—S08 · 1 台保养", state: "● 正常" },
      { name: "D 区 · 机动保障", icon: "truck", value: "8 / 10 在位", detail: "车位 P18 采集器离线", state: "● 检查采集器", warning: true },
      { name: "检修工位", icon: "wrench", value: "3 台在修", detail: "EQ-017 · 液压系统检修", state: "● 维修作业" },
      { name: "南门核验区", icon: "shield-check", value: "2 辆待核验", detail: "临时通行证 · 人工复核", state: "● 等待放行", warning: true },
    ],
  },
  park: {
    title: "智造园区 · 楼宇与公共设施分布", subtitle: "园区功能分区示意 / 六个重点区域 / 模拟数据", route: "东门 · 访客入口 ───── 园区主干道 ───── 南门 · 物流入口", flow: false,
    stations: [
      { name: "A1 · 智造厂房", icon: "factory", value: "86% 使用率", detail: "6 栋厂房 · 当班 648 人", state: "● 生产正常" },
      { name: "A2 · 智慧仓储", icon: "warehouse", value: "74% 库容", detail: "4 座仓库 · 在线车辆 26", state: "● 作业正常" },
      { name: "B1 · 研发中心", icon: "cpu", value: "68% 入驻率", detail: "研发企业 32 家 · 访客 86 人", state: "● 通行正常" },
      { name: "B2 · 配套办公", icon: "users", value: "1,280 人", detail: "当日能耗 12.8 MWh", state: "● 运行正常" },
      { name: "C1 · 动力中心", icon: "zap", value: "0.82 MPa", detail: "出口压力高于演示阈值", state: "● 压力预警", warning: true },
      { name: "P1 · 车辆服务", icon: "truck", value: "328 个空位", detail: "南门排队 9 辆 · 已增开通道", state: "● 通行繁忙", warning: true },
    ],
  },
  warehouse: {
    title: "宁波配送中心 · 库区作业全景", subtitle: "功能区示意 / 今日 87 车次 / 波次 WV-0923-08", route: "收货月台 → 质检暂存 → 原料库 → 拣选复核 → 集货区 → 发货月台", flow: true,
    stations: [
      { name: "01 收货月台", icon: "truck", value: "42 车已入库", detail: "D02 卸货中 · 剩余 18 min", state: "● 正在卸货" },
      { name: "02 原料库 A", icon: "boxes", value: "82% 使用率", detail: "库位 1,480 · 托盘 1,214", state: "● 上架作业" },
      { name: "03 成品库 C", icon: "warehouse", value: "91% 使用率", detail: "库存 62,480 件 · 库容预警", state: "● 接近满仓", warning: true },
      { name: "04 拣选复核", icon: "search", value: "68 / 76 单", detail: "拣选 12 人 · 差异 2 单", state: "● 波次执行" },
      { name: "05 自动搬运", icon: "forklift", value: "26 台 AGV", detail: "在线 26 / 28 · 任务 36 单", state: "● 搬运中" },
      { name: "06 发货月台", icon: "package", value: "45 车已发运", detail: "D01 装货中 · 目的地杭州", state: "● 正在装货" },
    ],
  },
  water: {
    title: "污水处理 · 工艺运行示意", subtitle: "设计能力 60,000 m³/d / A²O 工艺 / 模拟数据", route: "进水 → 预处理 → 生物处理 → 二沉 → 消毒 → 达标排放", flow: true,
    stations: [
      { name: "01 格栅提升", icon: "settings", value: "2,026 m³/h", detail: "提升泵 P01 / P02 运行", state: "● 液位 3.2 m" },
      { name: "02 沉砂预处理", icon: "droplets", value: "COD 286 mg/L", detail: "进水 pH 7.2 · 温度 23.6 ℃", state: "● 运行正常" },
      { name: "03 生化反应池", icon: "activity", value: "DO 2.4 mg/L", detail: "MLSS 3,280 mg/L · 回流 80%", state: "● 曝气正常" },
      { name: "04 二次沉淀", icon: "database", value: "液位 4.6 m", detail: "LT-07 · 接近高液位阈值", state: "● 液位预警", warning: true },
      { name: "05 紫外消毒", icon: "zap", value: "UV 96.8%", detail: "灯组 24 / 24 · 浊度 0.8 NTU", state: "● 消毒正常" },
      { name: "06 出水监测", icon: "leaf", value: "COD 23.6 mg/L", detail: "氨氮 1.42 · 总磷 0.28 mg/L", state: "● 演示限值内" },
    ],
  },
  energy: {
    title: "工厂能源 · 供用能网络", subtitle: "电 / 气 / 水 三类介质 / 当日累计值 / 模拟数据", route: "能源入口 → 计量与变配 → 动力站 → 生产车间 → 分区用能核算", flow: true,
    stations: [
      { name: "01 市电进线", icon: "plug", value: "10.2 kV", detail: "A 路供电 · 功率因数 0.96", state: "● 供电正常" },
      { name: "02 变配电站", icon: "zap", value: "2,846 kW", detail: "T01 负载 68% · T02 负载 54%", state: "● 计量在线" },
      { name: "03 压缩空气", icon: "gauge", value: "0.78 MPa", detail: "P02 出口压力连续波动", state: "● 压力预警", warning: true },
      { name: "04 熔炼车间", icon: "flame", value: "82 MWh / 月", detail: "炉壁温度 T03 · 286 ℃", state: "● 温度预警", warning: true },
      { name: "05 成型车间", icon: "factory", value: "71 MWh / 月", detail: "单位产品电耗 2.24 kWh", state: "● 用能正常" },
      { name: "06 循环水站", icon: "droplets", value: "128 m³/h", detail: "供水 0.42 MPa · 回水 31 ℃", state: "● 水泵正常" },
    ],
  },
  datacenter: {
    title: "机房分区 · 容量与环境分布", subtitle: "A / B / C 三个机房 / 500 个机柜 / 模拟数据", route: "双路市电 → UPS 冗余供电 → 列头配电 → IT 机柜 / 冷通道监控", flow: false,
    stations: [
      { name: "A1 · 计算机房", icon: "server", value: "82% 容量", detail: "24.1 ℃ · 湿度 45% · 86 柜", state: "● 运行正常" },
      { name: "A2 · 计算机房", icon: "server", value: "76% 容量", detail: "A2-17 冷通道 29.4 ℃", state: "● 温度预警", warning: true },
      { name: "B1 · 存储机房", icon: "database", value: "69% 容量", detail: "23.6 ℃ · 湿度 46% · 72 柜", state: "● 运行正常" },
      { name: "B2 · 网络机房", icon: "network", value: "88% 容量", detail: "24.8 ℃ · 湿度 44% · 58 柜", state: "● 运行正常" },
      { name: "C1 · 算力机房", icon: "cpu", value: "64% 容量", detail: "22.9 ℃ · 湿度 47% · 96 柜", state: "● 运行正常" },
      { name: "C2 · 备用机房", icon: "hard-drive", value: "72% 容量", detail: "列头柜 P07 · 通信中断", state: "● 网关失联", warning: true },
    ],
  },
};

/** All scene elements are ordinary editable canvas nodes; previews never substitute an illustration. */
export function templateScene(kind: SceneKind, box: Box, palette: DashboardBaseProps): CanvasNode[] {
  const scene = scenes[kind];
  const make = (type: CanvasNodeType, bounds: Box, props: Record<string, unknown>, zIndex: number): CanvasNode => ({
    id: crypto.randomUUID(), type, ...bounds, props, zIndex, resourceRefs: [], dataBindingRefs: [],
  });
  const decoration = (accent = palette.accentColor): DecorationProps => ({
    text: "", subtitle: "", textColor: palette.textColor, accentColor: accent, fillColor: palette.fillColor,
    borderColor: palette.borderColor, opacity: 1, align: "left", showDate: false, showSeconds: false,
  });
  const label = (bounds: Box, text: string, fontSize: number, color = palette.textColor, align: "left" | "center" = "left") => make("card-title", bounds, {
    ...ornamentDefaults["card-title"], icon: "none", text, fontSize, textColor: color, align, padding: 0,
    variant: "plain", fontFamily: "inherit", italic: false, underline: false, gap: 0, backgroundOpacity: 0,
    letterSpacing: 0, fontWeight: 500, accentColor: palette.accentColor, fillColor: palette.fillColor,
  } satisfies CardTitleProps, 24);
  const nodes = [make("panel-frame", box, {
    title: scene.title, subtitle: scene.subtitle, showHeader: true, style: "corners", textColor: palette.textColor,
    accentColor: palette.accentColor, fillColor: palette.fillColor, borderColor: palette.borderColor,
    opacity: 1, glowStrength: 0.35, headerHeight: 64, cornerSize: 22,
  } satisfies PanelFrameProps, 8)];
  const cellWidth = (box.width - 100) / 3;
  const cellHeight = (box.height - 148) / 2;
  scene.stations.forEach((station, index) => {
    const row = Math.floor(index / 3);
    const column = row === 1 && scene.flow ? 2 - index % 3 : index % 3;
    const x = box.x + 26 + column * (cellWidth + 24);
    const y = box.y + 78 + row * (cellHeight + 36);
    const accent = station.warning ? "#ffbd59" : palette.accentColor;
    nodes.push(
      make("card-background", { x, y, width: cellWidth, height: cellHeight }, decoration(accent), 18),
      make("vector-icon", { x: x + 15, y: y + 52, width: 62, height: 62 }, {
        ...ornamentDefaults["vector-icon"], icon: station.icon, iconSize: 56, iconColor: accent, strokeWidth: 1.35,
      }, 24),
      label({ x: x + 13, y: y + 6, width: cellWidth - 26, height: 32 }, station.name, 20),
      label({ x: x + 88, y: y + 46, width: cellWidth - 98, height: 36 }, station.value, 22, accent),
      label({ x: x + 88, y: y + 81, width: cellWidth - 98, height: 32 }, station.state, 16, accent),
      label({ x: x + 13, y: y + cellHeight - 39, width: cellWidth - 26, height: 32 }, station.detail, 15),
    );
    if (scene.flow && index % 3 !== 2) {
      const direction = row === 0 ? "→" : "←";
      const arrowX = row === 0 ? x + cellWidth - 48 : x - 72;
      nodes.push(label({ x: arrowX, y: y + cellHeight / 2 - 16, width: 120, height: 32 }, direction, 26, palette.accentColor, "center"));
    }
  });
  nodes.push(label({ x: box.x + 26, y: box.y + 78 + cellHeight + 2, width: box.width - 52, height: 32 }, scene.route, 15, palette.accentColor, "center"));
  return nodes;
}
