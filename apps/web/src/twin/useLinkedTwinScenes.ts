import { useEffect, useMemo, useState } from "react";
import { standaloneScenePath, type StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { errorMessage, request } from "../api";
import { parseScene3DProps, type CanvasDocument } from "../canvas/types";
import type { TwinActionScene } from "./TwinActionEditor";

/** Load only configuration metadata, never model resources or WebGL previews. */
export function useLinkedTwinScenes(projectId: string, document: CanvasDocument | null) {
  const [scenes, setScenes] = useState<TwinActionScene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const referencedIds = useMemo(() => [...new Set(document?.nodes.flatMap((node) => {
    if (node.type !== "scene-3d") return [];
    const parsed = parseScene3DProps(node.props);
    return parsed.ok && parsed.value.sceneProjectId ? [parsed.value.sceneProjectId] : [];
  }) ?? [])].sort().join("|"), [document?.nodes]);

  useEffect(() => {
    if (!document) {
      setScenes([]);
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    setScenes([]);
    setLoading(true);
    setError(null);
    void (async () => {
      const response = await request<{ projects: { id: string; name: string; projectType: "2d" | "3d" }[] }>("/api/v1/projects");
      const candidates = response.projects.filter((project) => project.projectType === "3d");
      const references = new Set(referencedIds.split("|").filter(Boolean));
      const result: TwinActionScene[] = [];
      const errors: string[] = [];
      let cursor = 0;
      const worker = async () => {
        while (active && cursor < candidates.length) {
          const project = candidates[cursor++];
          try {
            const loaded = await request<{ scene: StandaloneSceneDocument }>(standaloneScenePath(project.id));
            if (loaded.scene.linked2dProjectId === projectId || references.has(project.id)) {
              result.push({ projectId: project.id, name: project.name, instances: loaded.scene.instances });
            }
          } catch (reason) {
            console.error("[twin-actions] Failed to load scene action targets.", { projectId, sceneProjectId: project.id, reason });
            errors.push(`${project.name}：${errorMessage(reason)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
      if (!active) return;
      setScenes(result.sort((a, b) => a.name.localeCompare(b.name)));
      setError(errors.length ? `联动场景目录加载失败：${errors.join("；")}` : null);
    })().catch((reason) => {
      if (active) setError(`联动场景目录加载失败：${errorMessage(reason)}`);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [projectId, referencedIds, document !== null]);

  return { scenes, loading, error };
}
