/** One-time project composition using only the existing canvas contract. No runtime page or editor. */
import { createCanvasNode, minimumNodeSizes, type CanvasNode } from '../../apps/web/src/canvas/types';
import { canvasThemePresets } from '../../apps/web/src/canvas/themes';
import { bindDemoDevices, deviceOperation, type DemoMetric } from '../../apps/web/src/dashboard/metal-salt-demo';
import type { DashboardConfig } from '../../apps/web/src/dashboard/dashboard-project';
import type { StandaloneSceneDocument } from '../../shared/standalone-3d';
export function composeMetalSaltCanvas(config: DashboardConfig, scene: StandaloneSceneDocument) {
  const bindings = bindDemoDevices(scene.instances, config.devices);
  const nodes: CanvasNode[] = [];
  const add = (id:string,type:CanvasNode['type'],x:number,y:number,width:number,height:number,props:Record<string,unknown>) => {
    if(width<minimumNodeSizes[type].width||height<minimumNodeSizes[type].height||x+width>1920||y+height>1080)throw Error(`Invalid bounds for ${id}`);
    const node=createCanvasNode(type,x,y,nodes.length);Object.assign(node,{id:`salt-${id}`,width,height});
    Object.assign(node.props,props);nodes.push(node);return node;
  };
  const appearance={textColor:'#eafaff',accentColor:'#55d8ff',fillColor:'#0b2638',borderColor:'#286783',sample:true};
  const table=(id:string,title:string,x:number,y:number,width:number,height:number,rows:string[][])=>add(id,'data-table',x,y,width,height,{...appearance,title,columns:['参数','模拟值'],rows,highlightColumn:1});
  const rows=(metrics:DemoMetric[])=>metrics.map(m=>[m.label,`${m.base.toFixed(m.digits)} ${m.unit}`]);
  add('scene','scene-3d',0,0,1920,1080,{sceneProjectId:config.sourceProjectId,interactionEnabled:true});
  add('title','screen-title',0,0,1920,88,{text:'xxx金属盐看板',subtitle:config.subtitle+' · 模拟参数展示',showDate:true});
  const p=config.production;
  add('order','metric-card',400,102,360,120,{...appearance,title:'当前订单',value:p.order,unit:'',subtitle:`${p.product} · ${p.shift}`,icon:''});
  add('output','metric-card',780,102,360,120,{...appearance,title:'本批产出 / 计划',value:`${p.completedKg} / ${p.plannedKg}`,unit:'kg',subtitle:`${p.line} · ${p.startedAt}—${p.dueAt}`,icon:''});
  add('batch','metric-card',1160,102,360,120,{...appearance,title:'生产批次',value:p.batch,unit:'',subtitle:'模拟工况 · 非现场采集',icon:''});
  config.devices.forEach((d,i)=>{
    const op=deviceOperation(d,i),x=i<3?20:1540,y=102+(i<3?i:i-3)*236;
    const metrics=rows(d.metrics).map((r,j)=>op.started?r:[r[0],['rpm','kW','A','%'].includes(d.metrics[j].unit)?`0 ${d.metrics[j].unit}`:r[1]]);
    const node=table(d.key,d.label,x,y,360,220,[['状态',`${op.state} · ${op.mode}`],...metrics]);
    node.interaction={hiddenInPreview:false,clickActions:[{type:'focus-model',projectId:config.sourceProjectId,instanceId:bindings.get(d.key)!},{type:'message',title:d.label+' · 模拟详情',text:`${d.description}\n工序：${d.stage}\n设备：${op.tag}\n启停：${op.started?'启动':'停止'}\n联锁：${op.interlock}\n${metrics.map(r=>r.join('：')).join('\n')}`} ]};
  });
  table('quality','批次与质量',20,810,360,220,[['抽检单号',p.sample],['产品纯度',p.purity],['金属回收率',p.recovery],['质量判定',p.inspection]]);
  table('environment','车间环境',400,832,550,220,rows(config.environment));
  table('utilities','公用工程',970,832,550,220,rows(config.utilities));

  return {nodes,theme:{...canvasThemePresets['deep-blue'],backgroundPattern:'none',fontFamily:'system',glowIntensity:.2,panelRadius:4}};
}
