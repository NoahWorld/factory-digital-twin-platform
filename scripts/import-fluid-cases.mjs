// Additive, journaled import through the existing authenticated local API.
// Models go to private object storage; projects/assets/documents go to PostgreSQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fluidMetrics} from './fluid-demo-metrics.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const base='http://127.0.0.1:18080';
const dir=join(root,'demo-assets/fluid-cases');
const manifestBytes=readFileSync(join(dir,'manifest.json'));
const manifest=JSON.parse(manifestBytes);
const digest=createHash('sha256').update(manifestBytes).digest('hex');
const journalFile=join(root,'deploy/local/.local/fluid-cases-v1.json');
const verifyOnly=process.argv.includes('--verify-only');
const journal=existsSync(journalFile)?JSON.parse(readFileSync(journalFile)):{version:1,manifestSha256:digest,cases:{}};
assert.equal(journal.manifestSha256,digest,'Generated manifest differs from imported version. Do not overwrite edited projects; import a new version explicitly.');
function save(){mkdirSync(join(root,'deploy/local/.local'),{recursive:true});writeFileSync(journalFile,JSON.stringify(journal,null,2)+'\n',{mode:0o600});}
for(const c of manifest.cases)for(const m of c.modules){
  const bytes=readFileSync(join(dir,m.filename));assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256,`Local hash mismatch ${m.filename}`);
}
let cookie='';
async function api(path,{method='GET',body,status=200,raw=false}={}){
  const response=await fetch(base+'/api/v1'+path,{method,redirect:'manual',signal:AbortSignal.timeout(60000),
    headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':raw?'model/gltf-binary':'application/json'}:{})},
    body:body?(raw?body:JSON.stringify(body)):undefined});
  const value=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
  assert.equal(response.status,status,`${method} ${path} requestId=${response.headers.get('x-request-id')}: ${JSON.stringify(value)}`);
  return {value,response};
}
assert.equal((await fetch(base+'/health')).status,200,'Local backend is unhealthy');
const admin=JSON.parse(readFileSync(join(root,'deploy/local/.local/admin.json')));
const login=await api('/auth/login',{method:'POST',body:admin});cookie=login.response.headers.get('set-cookie').split(';')[0];
const temp=mkdtempSync(join(tmpdir(),'fluid-contracts-'));
try{
  execFileSync(process.execPath,[join(root,'apps/web/node_modules/typescript/bin/tsc'),'--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--rootDir',root,'--outDir',temp,join(root,'apps/web/src/canvas/themes.ts')],{stdio:'inherit'});
  const require=createRequire(import.meta.url);
  const {createCanvasNode}=require(join(temp,'apps/web/src/canvas/types.js'));
  const {canvasThemePresets}=require(join(temp,'apps/web/src/canvas/themes.js'));
  for(const c of manifest.cases){
    const record=journal.cases[c.id]??={models:{},assets:{}};
    if(!verifyOnly){
      for(const [key,type,suffix] of [['sceneId','3d','3D 场景'],['dashboardId','2d','工艺看板']]){
        if(record[key])continue;
        const name=`行业案例｜${c.title}｜${suffix}（模拟）`;
        const existing=(await api('/projects')).value.projects.find(p=>p.name===name);
        assert.ok(!existing,`Project ${name} already exists without an import journal; resolve ownership before retrying.`);
        record[key]=(await api('/projects',{method:'POST',status:201,body:{name,projectType:type}})).value.project.id;save();
        console.log(`Created ${c.id}/${type}: ${record[key]}`);
      }
      for(const m of c.modules){
        if(!record.models[m.id]){
          const uploaded=(await api(`/projects/${record.sceneId}/model-assets?filename=${encodeURIComponent(m.filename)}`,{method:'POST',status:201,raw:true,body:readFileSync(join(dir,m.filename))})).value.modelAsset;
          assert.equal(uploaded.sha256,m.sha256);assert.equal(uploaded.state,'ready');
          record.models[m.id]={id:uploaded.id,sha256:m.sha256};save();
          console.log(`Stored ${c.id}/${m.id}: ${uploaded.id} (${m.bytes} bytes)`);
        }
        if(!m.background&&!record.assets[m.id]){
          const assetId=`fluid-${c.id}-${m.id}`;
          const asset=(await api(`/projects/${record.dashboardId}/assets`,{method:'POST',status:201,body:{assetId,name:m.label,assetType:m.type,modelNode:null,
            metadata:{dataLabel:'模拟数据',simulation:true,industryCase:c.id,description:m.description,sampleMetrics:m.metrics}}})).value.asset;
          record.assets[m.id]={id:asset.id,assetId};save();
        }
      }
      if(!record.sceneRevision){
        const current=(await api(`/projects/${record.sceneId}/scene`)).value.scene;
        assert.equal(current.revision,0,'Refusing to overwrite an existing scene revision');
        const settings={animationSpeed:1,autoRotate:false,backgroundColor:'#081523',backgroundOpacity:1,cameraFov:38,cameraView:'isometric',environmentLightColor:'#dcefff',environmentLightIntensity:2.1,keyLightColor:'#fff4df',keyLightIntensity:2.8,modelScale:1.04,playAnimations:true,rotationSpeed:.15,showGrid:false};
        const instances=c.modules.map((m,i)=>({id:`fluid-${c.id}-${m.id}`,assetId:m.background?null:record.assets[m.id].assetId,label:m.label,
          modelAssetId:record.models[m.id].id,renderMode:m.background?'background':'interactive',sortOrder:i,
          transform:{position:m.position,rotation:[0,0,0],scale:[1,1,1]},visible:true,animation:{enabled:true,speed:1},appearance:{color:null,opacity:1}}));
        const saved=(await api(`/projects/${record.sceneId}/scene`,{method:'PATCH',body:{expectedRevision:0,upsertInstances:instances,deleteInstanceIds:[],settings,linked2dProjectId:record.dashboardId}})).value.scene;
        assert.equal(saved.instances.length,c.modules.length);record.sceneRevision=saved.revision;save();
      }
      if(!record.dashboardRevision){
        const current=(await api(`/projects/${record.dashboardId}/canvas`)).value.canvas;
        assert.equal(current.revision,0,'Refusing to overwrite an existing canvas revision');
        const theme={...canvasThemePresets[c.theme],backgroundColor:'#08121f',surfaceColor:'#102434',borderColor:'#284757',accentColor:c.accent,glowIntensity:.2,backgroundPattern:'none',fontFamily:'system',panelRadius:8};
        const nodes=[];
        function add(id,type,x,y,width,height,props){
          const n=createCanvasNode(type,x,y,nodes.length+1);Object.assign(n,{id:`fluid-${c.id}-${id}`,width,height});
          for(const [key,value] of Object.entries({textColor:'#e9f5fa',accentColor:c.accent,fillColor:'#102434',borderColor:'#284757'}))if(key in n.props)n.props[key]=value;
          Object.assign(n.props,props);nodes.push(n);return n;
        }
        add('title','screen-title',24,18,1872,96,{text:c.title,subtitle:`行业案例 · 虚构演示 / 模拟数据 · ${c.flow}`,align:'left'});
        add('scene','scene-3d',24,132,1352,724,{sceneProjectId:record.sceneId,interactionEnabled:true});
        c.kpis.forEach(([title,value,unit],i)=>add(`kpi-${i}`,'metric-card',1396,132+i*140,500,124,{title,value,unit,subtitle:'工况示例 · 非现场采集值',sample:true,icon:['◈','↗','≈'][i]}));
        add('trend','line-chart',1396,560,500,236,{title:c.trend.title,categories:['01','02','03','04','05','06'],values:c.trend.values,unit:c.trend.unit,color:c.accent});
        add('observations','data-table',1396,814,500,240,{title:'流体观察点 · 演示',columns:['序号','可观察效果'],rows:c.controls.map((s,i)=>[String(i+1).padStart(2,'0'),s]),highlightColumn:-1,sample:true});
        c.steps.forEach(([number,title,detail],i)=>add(`step-${number}`,'metric-card',24+i*340,880,332,174,{title:`工序 ${number}`,value:title,unit:'',subtitle:detail,icon:number,sample:true}));
        const saved=(await api(`/projects/${record.dashboardId}/canvas`,{method:'PATCH',body:{expectedRevision:0,upsertNodes:nodes,deleteNodeIds:[],theme}})).value.canvas;
        assert.equal(saved.nodes.length,nodes.length);record.dashboardRevision=saved.revision;save();
      }
      if(!record.dataSourceId){
        const source=(await api(`/projects/${record.dashboardId}/data-sources`,{method:'POST',status:201,body:{
          name:`${c.title} · 本地模拟数据`,sourceType:'rest_polling',config:{url:`http://host.docker.internal:8790/fluid/${c.id}`,intervalSeconds:2,timeoutMs:2000,timestampPath:'$.timestamp',credentialRef:null},
        }})).value.dataSource;
        record.dataSourceId=source.id;save();
      }
      for(const [moduleId,definitions] of Object.entries(fluidMetrics[c.id])){
        const assetRecord=record.assets[moduleId];
        assetRecord.bindings??={};
        const prefix=`/projects/${record.dashboardId}/assets/${assetRecord.id}`;
        const descriptors={...definitions,status:['运行状态',null],alarmLevel:['告警等级',null]};
        for(const [metricKey,[label,unit]] of Object.entries(descriptors)){
          if(assetRecord.bindings[metricKey])continue;
          const binding=(await api(`${prefix}/data-bindings`,{method:'POST',status:201,body:{dataSourceId:record.dataSourceId,metricKey,sourcePath:`$.assets.${moduleId}.${metricKey}`,valueType:metricKey==='status'?'string':'number',unit,staleAfterSeconds:10}})).value.dataBinding;
          assetRecord.bindings[metricKey]=binding.id;save();
        }
        if(!assetRecord.runtimeMetadata){
          const asset=(await api(`/projects/${record.dashboardId}/assets`)).value.assets.find(a=>a.id===assetRecord.id);
          await api(prefix,{method:'PATCH',body:{metadata:{...asset.metadata,runtimeMode:'simulation',metricLabels:Object.fromEntries(Object.entries(descriptors).map(([key,[label]])=>[key,label]))}}});
          assetRecord.runtimeMetadata=true;save();
        }
      }
    }
    assert.ok(record.sceneId&&record.dashboardId,`Missing imported IDs for ${c.id}`);
    const scene=(await api(`/projects/${record.sceneId}/scene`)).value.scene;
    const canvas=(await api(`/projects/${record.dashboardId}/canvas`)).value.canvas;
    assert.equal(scene.instances.length,c.modules.length);assert.equal(scene.linked2dProjectId,record.dashboardId);
    assert.equal(canvas.nodes.find(n=>n.type==='scene-3d').props.sceneProjectId,record.sceneId);
    const models=(await api(`/projects/${record.sceneId}/model-assets`)).value.modelAssets;
    for(const m of c.modules){
      const resource=models.find(r=>r.id===record.models[m.id].id);assert.ok(resource,`Missing model ${m.id}`);assert.equal(resource.sha256,m.sha256);
      assert.equal(resource.inspection.animationCount,m.animationCount);assert.equal(resource.inspection.duplicateNodeNames.length,0);
      const content=await api(`/projects/${record.sceneId}/model-assets/${resource.id}/content`,{status:302});
      const download=await fetch(content.response.headers.get('location'));assert.equal(download.status,200);
      assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'),m.sha256,`Object download integrity: ${m.id}`);
    }
    const assets=(await api(`/projects/${record.dashboardId}/assets`)).value.assets;
    assert.equal(assets.length,c.modules.filter(m=>!m.background).length);
    for(const instance of scene.instances.filter(i=>i.assetId))assert.ok(assets.some(a=>a.assetId===instance.assetId));
    for(const asset of assets){
      let runtime;
      for(let attempt=0;attempt<15;attempt++){
        const response=await fetch(`${base}/api/v1/projects/${record.dashboardId}/assets/${asset.id}/runtime-state`,{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
        const value=await response.json();
        if(response.ok){runtime=value.runtimeState;break;}
        assert.ok(response.status===503&&attempt<14,`Collector ${asset.assetId}: ${JSON.stringify(value)}`);
        console.log(`Waiting for collector first sample ${asset.assetId}: attempt ${attempt+1}`);
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      assert.equal(runtime.values.status,'running');assert.equal(runtime.values.alarmLevel,0);
      assert.ok(runtime.metrics.length>=4);assert.ok(Date.now()-Date.parse(runtime.timestamp)<10000);
      assert.equal(asset.metadata.runtimeMode,'simulation');
    }
    for(const id of [record.sceneId,record.dashboardId]){
      const cover=await api(`/projects/${id}/cover.svg`);assert.match(cover.response.headers.get('content-type'),/svg/);
    }
    console.log(`VERIFIED ${c.title}: ${models.filter(m=>m.source==='upload').length} models, ${scene.instances.length} instances, ${assets.length} assets, ${canvas.nodes.length} dashboard nodes`);
  }
  journal.verifiedAt=new Date().toISOString();save();
  const links=manifest.cases.map(c=>({name:c.title,sceneUrl:`http://127.0.0.1:5173/#/projects/${journal.cases[c.id].sceneId}/scene-preview`,dashboardUrl:`http://127.0.0.1:5173/#/projects/${journal.cases[c.id].dashboardId}/preview`}));
  writeFileSync(join(dir,'local-projects.json'),JSON.stringify(links,null,2)+'\n');
  console.log(JSON.stringify(links,null,2));
}finally{rmSync(temp,{recursive:true,force:true});}
