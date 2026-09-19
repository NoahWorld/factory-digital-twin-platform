import {verifyModelCompression} from "./model-compression";
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {AppError,requireCurrentProjectEditor,type AppEnv} from '../../api/src/auth';
import {getModelAssetRow,modelAssetContentResponse,uploadModelAsset} from '../../api/src/model-assets';
export function createModelOptimizer(env:AppEnv,workerPath:string) {
  let active=false;
  return async(request:Request,projectId:string,assetId:string,userId:string) => {
    if(active) throw new AppError(429,'model_optimization_busy','另一个模型正在压缩，请稍后重试。');active=true;
    try {
      await requireCurrentProjectEditor(env,userId,projectId);request.signal.throwIfAborted();const source=await getModelAssetRow(env,projectId,assetId),response=await modelAssetContentResponse(request,env,projectId,assetId),bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length!==source.byte_size || createHash('sha256').update(bytes).digest('hex')!==source.sha256) throw new AppError(409,'model_source_integrity_failed','原模型内容校验失败。');
      const output=await new Promise<Buffer>((resolve,reject)=>{
        const child=spawn(process.execPath,['--max-old-space-size=256',workerPath],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH},windowsHide:true});let reason:AppError|undefined,settled=false,size=0,errorSize=0;const chunks:Buffer[]=[],errors:Buffer[]=[];
        const fail=(error:AppError)=>{if(reason || settled)return;reason=error;child.kill('SIGKILL');};const cancel=()=>fail(new AppError(499,'model_optimization_cancelled','模型压缩已取消。'));
        const timeout=setTimeout(()=>fail(new AppError(504,'model_optimization_timeout','模型压缩超过30秒预算。')),30000),cleanup=()=>{clearTimeout(timeout);request.signal.removeEventListener('abort',cancel);};request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel();
        child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>25*1024*1024)fail(new AppError(413,'model_compression_output_limit','压缩产物超过25MiB限制。'));else chunks.push(chunk);});child.stderr.on('data',(chunk:Buffer)=>{errorSize+=chunk.length;if(errorSize>65536)fail(new AppError(502,'model_compression_failed','模型压缩进程异常。'));else errors.push(chunk);});child.stdin.on('error',()=>{});
        child.once('error',()=>{if(settled)return;settled=true;cleanup();reject(new AppError(503,'model_optimizer_unavailable','模型压缩进程不可用。'));});child.once('close',(code)=>{if(settled)return;settled=true;cleanup();if(reason)return reject(reason);if(code!==0){let errorCode='model_compression_failed';try{const message=JSON.parse(Buffer.concat(errors).toString('utf8'));if(/^model_compression_[a-z_]+$/.test(message.code))errorCode=message.code;}catch{}return reject(new AppError(422,errorCode,'无法压缩此模型，请检查扩展、缓冲布局或资源预算。'));}resolve(Buffer.concat(chunks));});child.stdin.end(bytes);
      });
      request.signal.throwIfAborted();await verifyModelCompression(bytes,output);await requireCurrentProjectEditor(env,userId,projectId);
      const derived=new Request('http://localhost/internal-model-version',{method:'POST',body:Uint8Array.from(output).buffer,signal:request.signal}),filename=source.original_filename.replace(/\.(?:gltf|glb)$/i,'').slice(0,210)+'-meshopt.glb';
      return await uploadModelAsset(derived,env,projectId,userId,filename,assetId,{sourceSha256:source.sha256});
    }finally{active=false;}
  };
}
