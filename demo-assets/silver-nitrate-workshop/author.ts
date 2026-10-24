/** Native project authoring only. The saved board uses the existing platform runtime. */
import {createCanvasNode, minimumNodeSizes, type CanvasNode} from '../../apps/web/src/canvas/types';
import {canvasThemePresets} from '../../apps/web/src/canvas/themes';
import type {TwinAction} from '../../shared/twin-actions';
import manifest from './models/manifest.json';
import { composeConfiguration, configurationGroup, sceneFluidBindings, fluidDevices } from './process-configuration';
import { createSceneDecoration } from '../../shared/scene-decorations';
export const equipment = [
 {id:'neutral',name:'中和罐',tag:'V10202B',stage:'01 / 中和',state:'搅拌演示中',metrics:'温度  35.0 ℃\n液位  62 %\n演示转速  15 rpm',description:'接收上游物料与去离子水，经中和后送往蒸发釜。',evidence:'参考：中和罐.jpg\n照片为同类 C 罐，顶部与支撑按轮廓补全。'},
 {id:'evaporator',name:'蒸发釜',tag:'R10201B',stage:'02 / 蒸发浓缩',state:'加热 · 搅拌演示',metrics:'温度  78.0 ℃\n液位  48 %\n演示转速  15 rpm',description:'夹套加热浓缩；蒸气进入冷凝支路，浓缩液送结晶罐。',evidence:'参考：91.浓缩釜.jpg\n借用同类釜外形，具体尺寸与接口待现场核对。'},
 {id:'crystallizer',name:'结晶罐',tag:'R10202B',stage:'03 / 冷却结晶',state:'冷却 · 搅拌演示',metrics:'温度  18.0 ℃\n冷却水  7 ℃\n演示转速  15 rpm',description:'接收浓缩液，使用 7℃ 水冷却；晶浆送往固液分离器。',evidence:'轮廓示意 · 待补拍\n尚无可确认属于硝酸银线的结晶罐完整照片。'},
 {id:'separator',name:'固液分离器',tag:'V10201B',stage:'04 / 固液分离',state:'分离工序演示',metrics:'进料状态  演示开启\n母液回流  演示开启\n设备形式  立式罐体',description:'接收晶浆完成固液分离，母液经泵返回上游。',evidence:'参考：12.固液分离罐.jpg\n按立式圆罐、平盖和支腿建模。'},
 {id:'condenser',name:'冷凝器',tag:'冷凝支路 / 结构示意',stage:'05 / 蒸气冷凝',state:'冷凝支路演示',metrics:'冷却侧  演示通流\n蒸气侧  演示通流\n设备形式  立式换热器',description:'展示蒸气降温与冷凝液收集路径，布置为结构示意。',evidence:'参考：9.冷凝器.jpg\n形态参考现场照片，图中未明确独立设备位号。'},
 {id:'collector',name:'冷凝收集罐',tag:'V10203B',stage:'06 / 冷凝液收集',state:'收集演示中',metrics:'液位  36 %\n出液去向  V10204\n气相去向  真空／脱酸塔',description:'收集冷凝液，保留去下游储罐及真空支路的接口。',evidence:'参考：冷凝器收集罐.jpg\n依据可见罐体和顶部接管补全底部。'},
 {id:'pump',name:'加热循环泵',tag:'P10206B',stage:'公用工程 / 加热循环',state:'循环通流演示',metrics:'工况  模拟运行\n介质回路  夹套循环\n驱动  不下发现场指令',description:'展示蒸发釜加热循环支路，与工艺物料管线分开。',evidence:'通用泵轮廓示意\n需补拍该位号的泵体、驱动与接管。'},
 {id:'returnpump',name:'母液回流泵',tag:'P10201',stage:'回流 / 返回上游',state:'回流通流演示',metrics:'工况  模拟运行\n入口  固液分离器\n出口  R10103B',description:'展示固液分离后的母液回流，终点为上游接口。',evidence:'通用泵轮廓示意\n位号后缀和实际泵型仍需现场确认。'}
];
export function actionsFor(id:string):TwinAction[] {
 const d=equipment.find(d=>d.id===id); if(!d)throw Error('Unknown equipment '+id);
 return [['detail-title',d.name],['detail-tag',d.tag+'  ·  '+d.stage],['detail-state',d.state+'  /  模拟'],['detail-metrics',d.metrics],['detail-role',d.description],['detail-source',d.evidence]].map(([nodeId,text])=>({type:'set-text',nodeId:'silver-'+nodeId,text}));
}
export function composeCanvas(sceneId:string){
 const nodes:CanvasNode[]=[];
 function add(id:string,type:CanvasNode['type'],x:number,y:number,width:number,height:number,props:Record<string,unknown>={}){
  if(width<minimumNodeSizes[type].width||height<minimumNodeSizes[type].height||x+width>1920||y+height>1080)throw Error('Invalid canvas bounds '+id);
  const n=createCanvasNode(type,x,y,nodes.length);Object.assign(n,{id:'silver-'+id,width,height});Object.assign(n.props,props);nodes.push(n);return n;
 }
 const colors={textColor:'#deedf4',accentColor:'#57cfc6',fillColor:'#0b202d',borderColor:'#244756'};
 // Native text blocks share a flat surface instead of each becoming another card.
 const text=(id:string,x:number,y:number,w:number,h:number,value:string,size=17,extra={})=>add(id,'plain-text',x,y,w,h,{...colors,borderRadius:4,borderColor:colors.fillColor,text:value,fontSize:size,fontWeight:400,align:'left',...extra});
 const button=(id:string,x:number,y:number,w:number,label:string,actions:TwinAction[])=>{
  const n=add(id,'button',x,y,w,48,{...colors,borderRadius:4,text:label,fontSize:17,fontWeight:500,href:'',disabled:false});n.interaction={hiddenInPreview:false,clickActions:actions};return n;
 };
 // The scene gains area on both axes; details remain outside the orbit viewport.
 add('scene','scene-3d',0,72,1604,854,{sceneProjectId:sceneId,interactionEnabled:true,playbackBindings:sceneFluidBindings()});
 text('title',24,12,470,48,'xxxx贵金属看板',26,{fillColor:'#071525',borderColor:'#071525',fontWeight:600});
 text('subtitle',530,12,510,48,'硝酸银 B 线  /  化工车间',17,{fillColor:'#071525',borderColor:'#071525',textColor:'#9fbac8'});
 text('mode',1616,88,280,48,'模拟运行  ·  演示数据',16,{fillColor:'#071525',borderColor:'#071525',textColor:'#63d6c3',align:'right'});
 text('hint',24,870,500,48,'点击设备查看  ·  拖动旋转 / 滚轮缩放',15,{fillColor:'#071525',borderColor:'#071525',textColor:'#a2bbc8'});
 add('detail-bg','card-background',1616,152,280,660,{...colors,opacity:1});
 text('detail-label',1632,164,248,48,'选中设备',15,{textColor:'#9fbac8'});
 text('detail-title',1632,210,248,48,'选择设备',25,{fontWeight:600});
 text('detail-tag',1632,258,248,58,'车间模型 / 工艺组态',16,{textColor:'#b1c9d5'});
 text('detail-state',1632,324,248,48,'请选择设备',16,{textColor:'#63d6c3'});
 text('detail-metrics',1632,388,248,112,'—',18,{fillColor:'#102b39',borderColor:'#102b39'});
 text('detail-role',1632,520,248,112,'点击模型或工艺设备，查看信息并控制模拟运行。',17,{textColor:'#c5d9e4'});
 text('detail-source',1632,652,248,132,'演示数据 · 非现场实时数据',15,{textColor:'#9fbac8'});
 // Preserve the four-step material line and its actual condensation branch.
 add('flow-bg','card-background',24,934,1872,124,{...colors,fillColor:'#0b202d',opacity:1});
 text('flow-title',36,944,190,48,'工艺导航',20,{fontWeight:500});
 text('flow-note',36,994,190,48,'物料 / 冷凝支路',14,{textColor:'#9fbac8'});
 const select=(id:string):TwinAction[]=>[...actionsFor(id),{type:'focus-model',projectId:sceneId,instanceId:'silver-'+id}];
 const stages=[['neutral',250],['evaporator',558],['crystallizer',866],['separator',1174]] as const;
 for(const [id,x] of stages){const e=equipment.find(d=>d.id===id)!;button('step-'+id,x,946,238,e.name+'  '+e.tag,select(id));}
 for(let i=0;i<3;i++){
  const x=stages[i][1]+238,tx=stages[i+1][1];
  add('pipe-'+i,'process-pipe',x,960,tx-x,20,{label:'物料',source:{nodeId:null,port:'right',x,y:970},target:{nodeId:null,port:'left',x:tx,y:970},waypoints:[],routing:'horizontal',color:'#57cfc6',width:3,flowing:true,direction:'forward',speed:1});
 }
 button('step-condenser',558,1004,238,'冷凝器',select('condenser'));
 button('step-collector',866,1004,290,'冷凝收集罐 V10203B',select('collector'));
 add('pipe-vapor','process-pipe',652,994,20,20,{label:'蒸气',source:{nodeId:null,port:'bottom',x:662,y:994},target:{nodeId:null,port:'top',x:662,y:1004},waypoints:[],routing:'vertical',color:'#e3b778',width:3,flowing:true,direction:'forward',speed:1});
 add('pipe-condense','process-pipe',796,1018,70,20,{label:'冷凝液',source:{nodeId:null,port:'right',x:796,y:1028},target:{nodeId:null,port:'left',x:866,y:1028},waypoints:[],routing:'horizontal',color:'#8fc9ef',width:3,flowing:true,direction:'forward',speed:1});
 text('boundary',1200,1004,670,48,'布局与尺寸为示意 · 非现场实时数据',15,{textColor:'#9fbac8',align:'right'});
 text('source',1460,946,416,48,'依据 20.自动化控制系统 · 硝酸银 B 线',15,{textColor:'#9fbac8',align:'right'});
 button('view-3d',1098,12,148,'3D 车间',[{type:'panel-group',groupId:configurationGroup,operation:'hide'}]);
 button('view-2d',1258,12,148,'2D 组态',[{type:'panel-group',groupId:configurationGroup,operation:'show'}]);
 button('playback',1420,12,230,'暂停数字孪生',[{type:'scene-playback',projectId:sceneId,target:'scene',operation:'toggle'}]);
 button('device-playback',1632,824,248,'先选择设备',[{type:'scene-playback',projectId:sceneId,target:'selected',operation:'toggle'}]);
 for(const [id,target] of [['mode','scene'],['detail-state','selected']] as const){
   const node=nodes.find(n=>n.id==='silver-'+id)!;
   node.interaction={hiddenInPreview:false,clickActions:[],playbackBinding:{projectId:sceneId,target}};
 }
 const navigationFlows=[['pipe-0','n-e'],['pipe-1','e-c'],['pipe-2','c-s'],['pipe-vapor','vapor'],['pipe-condense','condensate']];
 for(const [id,route] of navigationFlows){const n=nodes.find(n=>n.id==='silver-'+id)!;n.interaction={hiddenInPreview:false,clickActions:[],playbackBinding:{projectId:sceneId,target:fluidDevices[route].map(id=>'silver-'+id)}};}
 nodes.push(...composeConfiguration(sceneId,select));
 return {nodes,theme:{...canvasThemePresets['deep-blue'],backgroundPattern:'none',fontFamily:'system',glowIntensity:.06,panelRadius:4}};
}
export function composeScene(assetIds:Record<string,string>,withActions:boolean){
 const instances=[...equipment.map((e,i)=>({id:'silver-'+e.id,label:e.name+' '+e.tag,modelAssetId:assetIds[e.id==='returnpump'?'pump':e.id],assetId:null,renderMode:'interactive',sortOrder:i+1,visible:true,transform:{position:manifest.positions[e.id as keyof typeof manifest.positions],rotation:[0,0,0],scale:[1,1,1]},animation:{enabled:true,speed:1},appearance:{color:null,opacity:1},...(withActions?{clickActions:actionsFor(e.id)}:{})})),{id:'silver-workshop',label:'化工车间 · 管廊与阀门',modelAssetId:assetIds.workshop,assetId:null,renderMode:'background',sortOrder:0,visible:true,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},animation:{enabled:false,speed:1},appearance:{color:null,opacity:1}}];
 const fluids=manifest.routes.map(r=>({...r,id:'silver-'+r.id,kind:r.id==='vapor'||r.id==='vacuum'?'gas':'liquid',mode:'stream',radius:.048,speed:.65,spread:0,opacity:.8,direction:'forward',visible:true,playing:true}));
 const decorations=[[-8,4.8,-9.45,0],[8,4.8,-9.45,0],[-13.45,4.8,3,90]].map(([x,y,z,heading],i)=>({...createSceneDecoration('silver-camera-'+(i+1),'security-camera'),label:'车间摄像头 '+(i+1),accentColor:'#738795',transform:{position:[x,y,z] as [number,number,number],rotation:[0,heading,0] as [number,number,number],scale:[1.55,1.55,1.55] as [number,number,number]}}));
 return {instances,fluids,decorations};
}
