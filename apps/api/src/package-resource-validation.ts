import type { AppEnv } from "./auth";
import { inspectModelBytes,type ModelAsset } from "./model-assets";
import { detectFormat,type ImageAsset } from "./image-assets";
import { inspectLegacyModelNames } from "./legacy-model-names";
import { modelObjectLocator } from "../../../shared/model-inspection";
import type { LegacyModelNames } from "../../../shared/runtime-project";

export function canonicalJson(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return "{"+Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")+"}";
  return JSON.stringify(value);
}
export async function verifyPackagedModel(bytes:Uint8Array,expected:ModelAsset,legacy?:LegacyModelNames,codecs?:AppEnv["MODEL_CODECS"]):Promise<void> {
  const actual = await inspectModelBytes(bytes,expected.format,expected.id,codecs),expectedLocators = new Map(expected.inspection.objects!.map((object) => [modelObjectLocator(object),object]));
  if (actual.objects?.length !== expectedLocators.size) throw new Error("Model report object count does not match its file.");
  const retained = new Map(actual.objects!.map((object) => {
    const old = expectedLocators.get(modelObjectLocator(object)); if (!old) throw new Error("Model report locator does not match its file.");
    return [object.objectId,old.objectId];
  }));
  actual.objects = actual.objects!.map((object) => ({ ...object,objectId:retained.get(object.objectId)!,parentObjectId:object.parentObjectId ? retained.get(object.parentObjectId)! : null }));
  actual.clips = actual.clips!.map((clip) => {
    const saved = expected.inspection.clips!.find((item) => item.animationIndex === clip.animationIndex); if (!saved) throw new Error("Model clip report does not match its file.");
    return { ...clip,clipId:saved.clipId,channels:clip.channels.map((channel) => ({ ...channel,objectId:retained.get(channel.objectId)! })) };
  });
  if (canonicalJson(actual) !== canonicalJson(expected.inspection)) throw new Error("Model inspection report does not match the actual geometry, objects or clips.");
  if (legacy && canonicalJson(await inspectLegacyModelNames(bytes,codecs)) !== canonicalJson(legacy)) throw new Error("Legacy model name manifest does not match its file.");
}
export function verifyPackagedImage(bytes:Uint8Array,expected:ImageAsset):void {
  if (detectFormat(bytes) !== expected.format) throw new Error("Image signature does not match its declared format.");
}
