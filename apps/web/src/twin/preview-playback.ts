import type { FluidDefinition } from "../../../../shared/fluids";
import type { PlaybackState, SceneFluidBinding } from "../../../../shared/scene-playback";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { parseScene3DProps, type CanvasDocument } from "../canvas/types";
import { playbackSceneError, projectPlaybackScene } from "./playback-projection";

/** A standalone preview uses the bindings authored on its linked 2D scene views. */
export function linkedPlaybackBindings(scene: StandaloneSceneDocument, canvas: CanvasDocument | null):
  { ok: true; value: SceneFluidBinding[] } | { ok: false; message: string } {
  const bindings = new Map<string, Set<string>>();
  for (const node of canvas?.nodes ?? []) {
    if (node.type !== "scene-3d" || node.props.sceneProjectId !== scene.projectId) continue;
    const parsed = parseScene3DProps(node.props);
    if (!parsed.ok) return { ok: false, message: `2D 组件 ${node.id}：${parsed.message}` };
    const error = playbackSceneError(scene, parsed.value.playbackBindings);
    if (error) return { ok: false, message: `2D 组件 ${node.id}：${error}` };
    // Repeated views of one scene contribute the union of their explicit bindings.
    for (const binding of parsed.value.playbackBindings ?? []) {
      const fluids = bindings.get(binding.instanceId) ?? new Set<string>();
      for (const id of binding.fluidIds) fluids.add(id);
      bindings.set(binding.instanceId, fluids);
    }
  }
  return { ok: true, value: [...bindings].map(([instanceId, fluids]) => ({ instanceId, fluidIds: [...fluids] })) };
}

/** IoT owns fluid properties; local playback may only additionally stop their flow. */
export function projectRuntimePlayback(scene: StandaloneSceneDocument, runtimeFluids: FluidDefinition[], playback: PlaybackState = {}, bindings: SceneFluidBinding[] = []): StandaloneSceneDocument {
  return projectPlaybackScene({ ...scene, fluids: runtimeFluids }, playback, bindings);
}
