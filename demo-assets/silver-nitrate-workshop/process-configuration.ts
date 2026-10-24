/** Editable platform components, traced from the supplied B-line process diagram. */
import { createCanvasNode, type CanvasNode } from '../../apps/web/src/canvas/types';
import type { TwinAction } from '../../shared/twin-actions';
import type { PipeEndpoint, PipePoint } from '../../shared/process-control';
export const configurationGroup = 'silver-process-view';
export const fluidDevices: Record<string, string[]> = {
  feed:['neutral'], 'di-water':['neutral'], 'n-e':['neutral','evaporator'],
  'e-c':['evaporator','crystallizer'], 'c-s':['crystallizer','separator'],
  vapor:['evaporator','condenser'], condensate:['condenser','collector'],
  cooling:['crystallizer'], return:['separator','returnpump'],
  'heat-in':['evaporator','pump'], 'heat-out':['pump','evaporator'],
  'return-out':['returnpump'], vacuum:['collector'], 'collect-out':['collector'],
};
export const sceneFluidBindings = () => [...new Set(Object.values(fluidDevices).flat())].map(id => ({
  instanceId:`silver-${id}`, fluidIds:Object.entries(fluidDevices).filter(([,ids])=>ids.includes(id)).map(([id])=>`silver-${id}`),
}));
export function composeConfiguration(sceneId:string, actionsFor:(id:string)=>TwinAction[]):CanvasNode[] {
  const nodes:CanvasNode[]=[];
  const add=(id:string,type:CanvasNode['type'],x:number,y:number,width:number,height:number,props:Record<string,unknown>,z=120)=>{
    const base=createCanvasNode(type,x,y,z);
    const n:CanvasNode & {interaction:NonNullable<CanvasNode['interaction']>}={...base,id:`silver-pid-${id}`,width,height,zIndex:z,props:{...base.props,...props},interaction:{clickActions:[],hiddenInPreview:true,visibilityGroup:configurationGroup}};
    nodes.push(n);return n;
  };
  const ink='#cde5ee',surface='#091b28',material='#57cfc6',vapor='#e3b778',water='#72a7ff',condense='#8fc9ef',returnColor='#d19df5';
  const text=(id:string,x:number,y:number,w:number,label:string,color=ink,size=17)=>add(id,'plain-text',x,y,w,48,{text:label,fontSize:size,fontWeight:400,align:'left',fillColor:surface,borderColor:surface,textColor:color},220);
  add('surface','rectangle',24,144,1568,744,{fillColor:surface,borderColor:'#244756',borderWidth:1,borderRadius:4,opacity:1},100);
  text('title',48,156,560,'硝酸银 B 线 · 工艺组态',ink,21);
  text('legend-material',650,156,170,'物料',material,16);text('legend-heat',820,156,170,'蒸气 / 加热',vapor,16);
  text('legend-water',1010,156,220,'水 / 冷凝液',water,16);text('legend-return',1280,156,240,'母液回流',returnColor,16);
  function equipment(id:string,icon:string,x:number,y:number,size:number,label:string,lx:number,ly:number,lw=238){
    const n=add(id,'vector-icon',x-size/2,y-size/2,size,size,{icon,iconSize:size,strokeWidth:1,iconColor:ink,rotation:0,opacity:1},180);n.interaction.clickActions=actionsFor(id);
    const b=add(`${id}-label`,'button',lx,ly,lw,48,{text:label,fontSize:17,fontWeight:500,fillColor:'#102a39',borderColor:'#285264',textColor:ink,accentColor:material,href:'',disabled:false,borderRadius:4},220);b.interaction.clickActions=actionsFor(id);
    return n;
  }
  const neutral=equipment('neutral','process-reactor',240,650,144,'中和罐  V10202B',122,744);
  const evaporator=equipment('evaporator','process-reactor',690,370,160,'蒸发釜  R10201B',572,222);
  const crystallizer=equipment('crystallizer','process-reactor',1010,640,144,'结晶罐  R10202B',892,492);
  const separator=equipment('separator','process-separator',1330,670,128,'固液分离器  V10201B',1204,550,260);
  const condenser=equipment('condenser','process-condenser',950,310,100,'冷凝器 · 示意',852,392,196);
  const collector=equipment('collector','process-tank',1240,325,112,'收集罐  V10203B',1122,222);
  const pump=equipment('pump','process-pump',460,370,72,'循环泵  P10206B',344,430,232);
  const returnpump=equipment('returnpump','process-pump',1460,750,64,'回流泵 P10201',1380,826,188);
  const end=(node:CanvasNode,port:PipeEndpoint['port']):PipeEndpoint=>({nodeId:node.id,port,x:0,y:0});
  const free=(x:number,y:number):PipeEndpoint=>({nodeId:null,port:'right',x,y});
  function pipe(id:string,label:string,source:PipeEndpoint,target:PipeEndpoint,color:string,waypoints:PipePoint[]=[]){
    const n=add('pipe-'+id,'process-pipe',32,210,1530,660,{label,source,target,waypoints,routing:'horizontal',color,width:4,flowing:true,direction:'forward',speed:1},130);
    n.interaction={...n.interaction,playbackBinding:{projectId:sceneId,target:fluidDevices[id].map(id=>`silver-${id}`)}};
  }
  text('feed-source',48,590,180,'自 R10103B',material,15);
  pipe('feed','进料',free(58,650),end(neutral,'left'),material);
  pipe('di-water','去离子水',free(72,250),end(neutral,'top'),water,[{x:240,y:250}]);
  pipe('n-e','中和液',end(neutral,'right'),end(evaporator,'left'),material,[{x:352,y:650},{x:352,y:276},{x:570,y:276},{x:570,y:350},{x:610,y:350}]);
  pipe('e-c','浓缩液',end(evaporator,'bottom'),end(crystallizer,'left'),material,[{x:690,y:640}]);
  pipe('c-s','晶浆',end(crystallizer,'bottom'),end(separator,'left'),material,[{x:1010,y:800},{x:1180,y:800},{x:1180,y:670}]);
  pipe('vapor','蒸气',end(evaporator,'right'),end(condenser,'left'),vapor,[{x:832,y:370},{x:832,y:310}]);
  pipe('condensate','冷凝液',end(condenser,'right'),end(collector,'left'),condense);
  pipe('heat-in','加热循环',end(evaporator,'left'),end(pump,'right'),vapor);
  pipe('heat-out','循环回釜',end(pump,'top'),end(evaporator,'top'),vapor,[{x:460,y:280},{x:690,y:280}]);
  pipe('cooling','7℃ 水',free(1550,472),end(crystallizer,'right'),water,[{x:1128,y:472},{x:1128,y:640}]);
  pipe('return','母液',end(separator,'right'),end(returnpump,'top'),returnColor,[{x:1460,y:670}]);
  pipe('return-out','至 R10103B',end(returnpump,'right'),free(1250,800),returnColor,[{x:1508,y:750},{x:1508,y:800}]);
  pipe('vacuum','真空 / 脱酸塔',end(collector,'right'),free(1548,325),'#a9bed4');
  pipe('collect-out','至 V10204',end(collector,'bottom'),free(1548,436),condense,[{x:1240,y:436}]);
  // Native valve symbols retain independently editable geometry.
  for(const [id,x,y,color] of [['feed',124,650,material],['water',240,468,water],['cooling',1128,574,water],['vapor',832,338,vapor]] as const){
    add('valve-'+id,'vector-icon',x-14,y-14,28,28,{icon:'process-valve',iconSize:28,iconColor:color,strokeWidth:1.3,rotation:id==='feed'?0:90,opacity:1},190);
  }
  text('source',48,830,860,'依据现场「20.自动化控制系统」 · 点击设备查看与启停', '#91adbc',15);
  return nodes;
}
