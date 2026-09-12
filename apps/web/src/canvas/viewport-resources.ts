import { type BufferGeometry, type Material, type Object3D, type Texture } from "three";

type Disposable = { dispose: () => void };
class OwnedResources<T extends Disposable> {
  private entries = new Map<T, { value: T; refs: number; release?: () => void }>();
  constructor(private clone: (source: T) => { value: T; release?: () => void }) {}
  acquire(source: T) {
    let entry = this.entries.get(source);
    if (!entry) { entry = { ...this.clone(source), refs: 0 }; this.entries.set(source, entry); }
    entry.refs++;
    return entry.value;
  }
  release(source: T) {
    const entry = this.entries.get(source); if (!entry) return;
    if (--entry.refs === 0) { entry.value.dispose(); entry.release?.(); this.entries.delete(source); }
  }
  size() { return this.entries.size; }
}

/** Three attaches renderer-specific listeners to GPU resources. A viewport owns
 * its GPU-facing copies; instances in it share them, and decoded files/images
 * remain owned by the global model pool. This avoids retaining dead renderers. */
export class ViewportResources {
  private textures = new OwnedResources<Texture>((source) => ({ value: source.clone() }));
  private geometries = new OwnedResources<BufferGeometry>((source) => ({ value: source.clone() }));
  private materials = new OwnedResources<Material>((source) => {
    const textureSources = new Map<Texture, Texture>();
    const value = source.clone();
    const replace = (original: unknown, copy: unknown): unknown => {
      if (!original || typeof original !== "object") return copy;
      if ((original as Texture).isTexture) {
        const texture = original as Texture;
        if (!textureSources.has(texture)) textureSources.set(texture, this.textures.acquire(texture));
        return textureSources.get(texture);
      }
      if (Array.isArray(original)) return original.map((item, index) => replace(item, Array.isArray(copy) ? copy[index] : item));
      if (Object.getPrototypeOf(original) === Object.prototype) {
        const target = (copy && typeof copy === "object" ? copy : { ...original }) as Record<string, unknown>;
        for (const [key, item] of Object.entries(original)) target[key] = replace(item, target[key]); return target;
      }
      return copy;
    };
    const hasTexture = (item: unknown): boolean => !!item && typeof item === "object" && ((item as Texture).isTexture || (Array.isArray(item) ? item.some(hasTexture) : Object.getPrototypeOf(item) === Object.prototype && Object.values(item).some(hasTexture)));
    try { for (const [key, original] of Object.entries(source)) if (hasTexture(original)) (value as unknown as Record<string, unknown>)[key] = replace(original, (value as unknown as Record<string, unknown>)[key]); }
    catch (error) { value.dispose(); textureSources.forEach((_, texture) => this.textures.release(texture)); throw error; }
    return { value, release: () => textureSources.forEach((_, texture) => this.textures.release(texture)) };
  });

  acquire(root: Object3D) {
    const geometries = new Map<BufferGeometry, BufferGeometry>(); const materials = new Map<Material, Material>();
    const restore: Array<() => void> = [];
    let released = false;
    const release = () => {
      if (released) return; released = true;
      restore.forEach((restore) => restore());
      materials.forEach((_, source) => this.materials.release(source)); geometries.forEach((_, source) => this.geometries.release(source));
    };
    try {
      root.traverse((object) => {
        const owner = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
        if (owner.geometry) {
          const source = owner.geometry;
          if (!geometries.has(source)) geometries.set(source, this.geometries.acquire(source));
          owner.geometry = geometries.get(source); restore.push(() => { owner.geometry = source; });
        }
        if (owner.material) {
          const source = owner.material;
          const copies = (Array.isArray(source) ? source : [source]).map((material) => {
            if (!materials.has(material)) materials.set(material, this.materials.acquire(material)); return materials.get(material)!;
          });
          owner.material = Array.isArray(source) ? copies : copies[0]; restore.push(() => { owner.material = source; });
        }
      });
      return release;
    } catch (error) { release(); throw error; }
  }
  snapshot() { return { geometries: this.geometries.size(), materials: this.materials.size(), textures: this.textures.size() }; }
}
