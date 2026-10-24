/** Session-only playback gates. These never send commands to physical devices. */
export type PlaybackTarget = "scene" | "selected" | string[];
export type PlaybackBinding = { projectId: string; target: PlaybackTarget };
export type SceneFluidBinding = { instanceId: string; fluidIds: string[] };
export type PlaybackState = Record<string, { playing: boolean; instances: Record<string, boolean> }>;
export type PlaybackSelection = Record<string, string>;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}(?![\s\S])/.test(v);
export const validPlaybackTarget = (v: unknown): v is PlaybackTarget => v === "scene" || v === "selected" || (Array.isArray(v) && v.length > 0 && v.length <= 128 && v.every(id) && new Set(v).size === v.length);
export const validPlaybackBinding = (v: unknown): v is PlaybackBinding => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 2 && id((v as PlaybackBinding).projectId) && validPlaybackTarget((v as PlaybackBinding).target);
export const validFluidBindings = (v: unknown): v is SceneFluidBinding[] => Array.isArray(v) && v.length <= 128 && v.every(b => b && typeof b === "object" && Object.keys(b).length === 2 && id(b.instanceId) && Array.isArray(b.fluidIds) && b.fluidIds.length <= 128 && b.fluidIds.every(id) && new Set(b.fluidIds).size === b.fluidIds.length) && new Set(v.map(b => b.instanceId)).size === v.length;
export function playbackIds(binding: PlaybackBinding, selection: PlaybackSelection): string[] {
  return binding.target === "scene" ? [] : binding.target === "selected" ? (selection[binding.projectId] ? [selection[binding.projectId]] : []) : binding.target;
}
export function playbackRunning(binding: PlaybackBinding, state: PlaybackState, selection: PlaybackSelection): boolean {
  const scene = state[binding.projectId];
  return scene?.playing !== false && playbackIds(binding, selection).every(id => scene?.instances[id] !== false);
}
