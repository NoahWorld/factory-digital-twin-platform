import type { DecorationKind } from "../../../../shared/scene-decorations";
import type { ModelAsset } from "../canvas/model-assets";

export type ModelLibraryCategory = "all" | "industrial" | "plants" | "water" | "military" | "uploaded" | "background";

export const modelLibraryCategories: { id: ModelLibraryCategory; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "industrial", label: "工业模型" },
  { id: "plants", label: "植物" },
  { id: "water", label: "水景" },
  { id: "military", label: "军事模型" },
  { id: "uploaded", label: "上传模型" },
  { id: "background", label: "背景模型" },
];

export const decorationLibraryItems: { kind: DecorationKind; name: string; category: ModelLibraryCategory; description: string; icon: string }[] = [
  { kind: "tree", name: "乔木", category: "plants", description: "可调整颜色与树形", icon: "♠" },
  { kind: "shrub", name: "灌木", category: "plants", description: "可调整颜色与冠形", icon: "♣" },
  { kind: "river", name: "河流", category: "water", description: "可编辑路径与水流", icon: "≋" },
  { kind: "military-truck", name: "运输车", category: "military", description: "轻量运输车辆外形", icon: "▰" },
  { kind: "military-tent", name: "帐篷", category: "military", description: "轻量营地帐篷外形", icon: "△" },
  { kind: "military-radar", name: "雷达", category: "military", description: "轻量雷达设备外形", icon: "◴" },
  { kind: "military-armored", name: "装甲车", category: "military", description: "轻量装甲车辆外形", icon: "▱" },
];

export const modelAssetCategory = (asset: ModelAsset): ModelLibraryCategory =>
  asset.source === "system" ? "industrial" : asset.source === "scene-background" ? "background" : "uploaded";
