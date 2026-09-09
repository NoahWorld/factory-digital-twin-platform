export type ProjectType = "2d" | "3d";

export const STANDALONE_3D_LIMITS = {
  maximumInstances: 128,
  maximumUniqueModelAssets: 24,
  maximumUniqueModelBytes: 150 * 1024 * 1024,
  maximumEstimatedMeshInstances: 6_000,
  maximumAnimatedInstances: 24,
  maximumPatchInstances: 100,
} as const;

export type StandaloneSceneRenderMode = "background" | "interactive";

export type StandaloneSceneSettings = {
  animationSpeed: number;
  autoRotate: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  cameraFov: number;
  cameraView: "isometric" | "isometric-left" | "front" | "top";
  environmentLightColor: string;
  environmentLightIntensity: number;
  keyLightColor: string;
  keyLightIntensity: number;
  modelScale: number;
  playAnimations: boolean;
  rotationSpeed: number;
  showGrid: boolean;
};

export type StandaloneSceneInstance = {
  assetId: string | null;
  id: string;
  label: string;
  modelAssetId: string;
  renderMode: StandaloneSceneRenderMode;
  sortOrder: number;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  visible: boolean;
};

export type StandaloneSceneDocument = {
  instances: StandaloneSceneInstance[];
  linked2dProjectId: string | null;
  projectId: string;
  revision: number;
  settings: StandaloneSceneSettings;
  updatedAt: string;
};

export type TwinInteractionEventType =
  | "asset-selected"
  | "asset-focus-requested"
  | "asset-data-updated";

export type TwinInteractionEvent = {
  assetId: string;
  correlationId: string;
  originProjectId: string;
  targetProjectId: string;
  timestamp: string;
  type: TwinInteractionEventType;
};

export const isProjectType = (value: unknown): value is ProjectType =>
  value === "2d" || value === "3d";

export const standaloneScenePath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/scene`;

export const standaloneSceneRoutePath = (
  projectId: string,
  mode: "edit" | "preview",
): string => `#/projects/${encodeURIComponent(projectId)}/${mode === "preview" ? "scene-preview" : "scene"}`;
