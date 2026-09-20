import {createServer} from 'node:http';
import {fluidMetrics,simulatedSnapshot} from './fluid-demo-metrics.mjs';

const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost:8790');
  const caseId=url.pathname.match(/^\/fluid\/(steel|water|cooling)$/)?.[1];
  const status=request.method!=='GET'?405:caseId||url.pathname==='/health'?200:404;
  const body=status!==200?{code:status===405?'method_not_allowed':'case_not_found',path:url.pathname}
    :caseId?simulatedSnapshot(caseId):{status:'ok',simulation:true,cases:Object.keys(fluidMetrics)};
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  response.end(JSON.stringify(body));
  console.log(JSON.stringify({at:new Date().toISOString(),method:request.method,path:url.pathname,status,simulation:true}));
});
server.on('error',error=>{console.error('Fluid demo source failed:',error);process.exitCode=1;});
server.listen(8790,'0.0.0.0',()=>console.log('Fluid demo source listening on :8790; synthetic data only.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());
