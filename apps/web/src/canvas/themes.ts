import {
  isChartNodeType,
  isDashboardNodeType,
  isDecorationNodeType,
  isModel3DNodeType,
  isShapeNodeType,
  type CanvasNode,
  type CanvasTheme,
  type CanvasThemeMode,
} from "./types";

export const darkCanvasTheme: CanvasTheme = {
  mode: "dark",
  backgroundColor: "#071525",
  surfaceColor: "#0b2638",
  textColor: "#eafaff",
  accentColor: "#55d8ff",
  borderColor: "#286783",
};

export const lightCanvasTheme: CanvasTheme = {
  mode: "light",
  backgroundColor: "#dceef1",
  surfaceColor: "#edf8fa",
  textColor: "#253b4b",
  accentColor: "#16839a",
  borderColor: "#8cbec9",
};

export const canvasThemeLabels: Record<CanvasThemeMode, string> = {
  dark: "深色",
  light: "浅色",
  custom: "自选色",
};

export const asCustomCanvasTheme = (theme: CanvasTheme): CanvasTheme => ({
  ...theme,
  mode: "custom",
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

  if (isDecorationNodeType(node.type) || isDashboardNodeType(node.type)) {
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
