import { zipStream } from "./zip-stream";
import { AppError,type AppEnv } from "./auth";
import { readPublicationVersion,verifyPublicationResource } from "./publications";
import { createPackageManifest,MAX_PACKAGE_BYTES } from "../../../shared/project-package";

export async function exportProjectPackage(env:AppEnv,projectId:string,versionId:string,signal:AbortSignal):Promise<Response> {
  const { version,snapshot } = await readPublicationVersion(env,projectId,versionId),manifest = createPackageManifest(snapshot,version);
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  if (metadata.byteLength+manifest.files.reduce((total,file) => total+file.byteSize,0)+manifest.files.length*512 > MAX_PACKAGE_BYTES) throw new AppError(413,"project_package_too_large","Project package exceeds the 512 MiB budget.");
  const stream = zipStream(async function* (signal) {
    yield { path:"manifest.json",bytes:metadata };
    for (const file of manifest.files) yield { path:file.path,bytes:await verifyPublicationResource(env,projectId,file.kind,file.id,file,signal) };
  },signal);
  return new Response(stream,{ headers:{ "content-type":"application/zip","content-disposition":`attachment; filename="newpower-${projectId}-v${version.versionNumber}.zip"`,"cache-control":"no-store","x-content-type-options":"nosniff" } });
}
