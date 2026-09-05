import {
  isBasicNodeType,
  isChartNodeType,
  isDashboardNodeType,
  isDecorationNodeType,
  isModel3DNodeType,
  isPanelFrameNodeType,
  isShapeNodeType,
  type CanvasThemePresetId,
  type CanvasNode,
  type CanvasTheme,
} from "./types";

export type BuiltInCanvasThemePresetId = Exclude<CanvasThemePresetId, "custom">;

export const canvasThemePresets: Record<BuiltInCanvasThemePresetId, CanvasTheme> = {
  "deep-blue": {
    mode: "dark",
    presetId: "deep-blue",
    backgroundPattern: "circuit",
    fontFamily: "industrial",
    glowIntensity: 0.65,
    panelRadius: 6,
    backgroundColor: "#04131f",
    surfaceColor: "#08273b",
    textColor: "#e9f8ff",
    accentColor: "#55d8ff",
    borderColor: "#276f8d",
  },
  "steel-orange": {
    mode: "dark",
    presetId: "steel-orange",
    backgroundPattern: "grid",
    fontFamily: "industrial",
    glowIntensity: 0.42,
    panelRadius: 2,
    backgroundColor: "#10151b",
    surfaceColor: "#1a222b",
    textColor: "#f3f5f7",
    accentColor: "#ff9f43",
    borderColor: "#5a6470",
  },
  "energy-green": {
    mode: "dark",
    presetId: "energy-green",
    backgroundPattern: "dots",
    fontFamily: "data",
    glowIntensity: 0.58,
    panelRadius: 8,
    backgroundColor: "#061813",
    surfaceColor: "#0b2a20",
    textColor: "#eafff6",
    accentColor: "#49e0a5",
    borderColor: "#2c8068",
  },
  "command-gold": {
    mode: "dark",
    presetId: "command-gold",
    backgroundPattern: "circuit",
    fontFamily: "data",
    glowIntensity: 0.5,
    panelRadius: 0,
    backgroundColor: "#17130b",
    surfaceColor: "#282115",
    textColor: "#fff8e6",
    accentColor: "#ffc45c",
    borderColor: "#806332",
  },
  "light-industrial": {
    mode: "light",
    presetId: "light-industrial",
    backgroundPattern: "grid",
    fontFamily: "system",
    glowIntensity: 0.18,
    panelRadius: 10,
    backgroundColor: "#dcecf0",
    surfaceColor: "#f2fafb",
    textColor: "#203542",
    accentColor: "#167e99",
    borderColor: "#8ab6c1",
  },
};

export const canvasThemePresetLabels: Record<CanvasThemePresetId, string> = {
  "deep-blue": "深海科技蓝",
  "steel-orange": "钢铁警示橙",
  "energy-green": "能源监控绿",
  "command-gold": "指挥中心金",
  "light-industrial": "浅色工业",
  custom: "自定义",
};

export const asCustomCanvasTheme = (theme: CanvasTheme): CanvasTheme => ({
  ...theme,
  mode: "custom",
  presetId: "custom",
});

export const applyCanvasThemeToNode = (
  node: CanvasNode,
  theme: CanvasTheme,
): CanvasNode => {
  if (isModel3DNodeType(node.type)) return node;

  if (isChartNodeType(node.type)) {
    return { ...node, props: { ...node.props, color: theme.accentColor } };
  }

  if (isShapeNodeType(node.type)) {
    const isCanvasBackground = node.type === "rectangle"
      && node.x === 0
      && node.y === 0
      && node.zIndex === 0
      && node.width >= 1920
      && node.height >= 1080;
    return {
      ...node,
      props: {
        ...node.props,
        fillColor: isCanvasBackground ? theme.backgroundColor : theme.surfaceColor,
        borderColor: isCanvasBackground ? theme.backgroundColor : theme.borderColor,
      },
    };
  }

  if (isDecorationNodeType(node.type) || isDashboardNodeType(node.type) || isPanelFrameNodeType(node.type)) {
    return {
      ...node,
      props: {
        ...node.props,
        textColor: theme.textColor,
        accentColor: theme.accentColor,
        fillColor: theme.surfaceColor,
        borderColor: theme.borderColor,
      },
    };
  }

  if (isBasicNodeType(node.type)) {
    if (node.type === "image" || node.type === "carousel") {
      return {
        ...node,
        props: {
          ...node.props,
          backgroundColor: theme.surfaceColor,
          borderColor: theme.borderColor,
        },
      };
    }
    return {
      ...node,
      props: {
        ...node.props,
        textColor: theme.textColor,
        accentColor: theme.accentColor,
        fillColor: theme.surfaceColor,
        borderColor: theme.borderColor,
      },
    };
  }

  const exhaustiveCheck: never = node.type;
  throw new Error(`Unsupported canvas node theme target: ${exhaustiveCheck}`);
};

export const applyCanvasThemeToNodes = (
  nodes: CanvasNode[],
  theme: CanvasTheme,
): CanvasNode[] => nodes.map((node) => applyCanvasThemeToNode(node, theme));
