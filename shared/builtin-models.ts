/** Bundled, public demonstration assets. IDs and content hashes are immutable per version. */
export const builtinModels = [
  {
    "id": "builtin:aqua-helix-hd-v1",
    "name": "AQUA HELIX · 水冷机组",
    "description": "双回路水冷机组，独立零部件、铜管束、转子与 12 秒循环水流动画。",
    "contentPath": "/models/aqua-helix-hd.c7f39acdb954.glb",
    "thumbnailPath": "/models/aqua-helix-preview.jpg",
    "originalFilename": "aqua-helix-hd.glb",
    "format": "glb",
    "contentType": "model/gltf-binary",
    "byteSize": 10912656,
    "sha256": "c7f39acdb954c2862328382589dafb08990a228913a26876ee4e318ac84f9db0",
    "createdAt": "2026-09-08T00:00:00.000Z",
    "inspection": {
      "format": "glb",
      "gltfVersion": "2.0",
      "sceneCount": 1,
      "nodeCount": 2742,
      "meshCount": 491,
      "materialCount": 15,
      "textureCount": 4,
      "imageCount": 1,
      "animationCount": 1,
      "namedNodeCount": 2742,
      "duplicateNodeNames": [],
      "externalResourceCount": 0
    },
    "defaults": {
      "backgroundColor": "#070f18",
      "backgroundOpacity": 1,
      "environmentLightColor": "#daf4ff",
      "environmentLightIntensity": 0.65,
      "keyLightColor": "#ffffff",
      "keyLightIntensity": 1.8,
      "cameraFov": 36,
      "cameraView": "isometric-left",
      "modelScale": 1.4,
      "autoRotate": false,
      "playAnimations": true,
      "animationSpeed": 1,
      "presentation": {
        "lighting": "studio",
        "shellMode": "original",
        "showFlow": true,
        "explosion": 0
      }
    }
  }
] as const;

export const findBuiltinModel = (id: string) => builtinModels.find((model) => model.id === id);
