import type { StandaloneSceneDocument } from '../../../../shared/standalone-3d';
import { chemicalWorkshopModel } from '../../../../shared/chemical-workshop-model';

/** Dashboard environment preset: replace the old bundled workshop kit only.
 * Uploaded equipment, pipework, IDs and transforms remain sourced from IoT.
 * This is a presentation projection, never a persisted scene migration.
 */
export function chemicalWorkshopScene(scene: StandaloneSceneDocument): StandaloneSceneDocument {
  return { ...scene, instances: [
    ...scene.instances.filter(instance => !instance.modelAssetId.startsWith('builtin:workshop-')),
    { id: 'metal-salt-chemical-environment', label: chemicalWorkshopModel.name,
      modelAssetId: chemicalWorkshopModel.id, assetId: null, renderMode: 'background', sortOrder: -1,
      visible: true, transform: {position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]} },
  ] };
}
