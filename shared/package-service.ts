export type PackageInspection = {
  id:string;expiresAt:string;projectName:string;sourceProjectId:string;sourceVersionId:string;sourceVersionNumber:number;
  pages:number;models:number;images:number;assets:number;alarms:number;bytes:number;
  requiredEndpoints:Array<{ endpointRef:string;sourceIds:string[] }>;
};
export type PackageInstallRequest = { inspectionId:string;targetProjectId?:string;projectName?:string;expectedRuntimeRevision?:number };
export type PackageInstallResult = { projectId:string;versionId:string;versionNumber:number;alreadyInstalled:boolean;activated:false;requiredEndpoints:string[] };
export type PackageService = {
  inspect(request:Request,userId:string):Promise<PackageInspection>;
  install(input:PackageInstallRequest,userId:string,signal:AbortSignal):Promise<PackageInstallResult>;
  discard(inspectionId:string,userId:string):Promise<void>;
};
