// Three authored 1920 × 1080 compositions using the platform's existing node contract.
export function buildFluidDashboard(c,sceneId,createCanvasNode,canvasThemePresets){
  const palettes={
    steel:{backgroundColor:'#171c22',surfaceColor:'#222a32',textColor:'#ece7dd',accentColor:'#e8a54e',borderColor:'#4b5156',panelRadius:2,fontFamily:'industrial'},
    water:{backgroundColor:'#edf0e5',surfaceColor:'#fafbf6',textColor:'#29453f',accentColor:'#28746b',borderColor:'#c1cbb8',panelRadius:14,fontFamily:'system'},
    cooling:{backgroundColor:'#152c36',surfaceColor:'#203c46',textColor:'#f0e8d9',accentColor:'#d99465',borderColor:'#4f6870',panelRadius:0,fontFamily:'data'},
  };
  const p=palettes[c.id],theme={...canvasThemePresets[c.theme],...p,mode:'custom',presetId:'custom',backgroundPattern:'none',glowIntensity:0};
  const nodes=[];
  function add(id,type,x,y,width,height,props){
    const n=createCanvasNode(type,x,y,nodes.length+1);Object.assign(n,{id:`fluid-v2-${c.id}-${id}`,width,height});
    for(const [key,value] of Object.entries({textColor:p.textColor,accentColor:p.accentColor,fillColor:p.surfaceColor,borderColor:p.borderColor,borderRadius:p.panelRadius,color:p.accentColor}))if(key in n.props)n.props[key]=value;
    Object.assign(n.props,props);nodes.push(n);return n;
  }
  function title(id,x,y,w,h,heading,subtitle){return add(id,'screen-title',x,y,w,h,{text:heading,subtitle,align:'left',showDate:false,showSeconds:false});}
  function note(id,x,y,w,h,text,options={}){return add(id,'plain-text',x,y,w,h,{text,fontSize:20,fontWeight:400,align:'left',scrollMode:'none',...options});}
  function detail(x,y,w,h){return add('live-equipment','asset-detail',x,y,w,h,{title:'设备运行数据 · 模拟源',emptyText:'选择场景设备，查看对应工艺参数',showMetadata:true,maximumMetrics:6});}
  if(c.id==='steel'){
    title('masthead',24,20,1400,104,'四流方坯连铸生产区','CASTING OPERATIONS  /  钢包准备—保护浇注—凝固拉矫—定尺出坯');
    add('shift','metric-card',1448,16,448,120,{title:'演示生产组织',value:'4 流连浇',unit:'',subtitle:'80 t 级炉次 · 参数为模拟工况',icon:'▥',sample:true});
    add('scene','scene-3d',24,152,1400,604,{sceneProjectId:sceneId,interactionEnabled:true});
    add('strands','status-grid',1448,152,448,216,{title:'四流工况示例',columns:2,sample:true,items:[{label:'1# 结晶器',value:'保护浇注',tone:'normal'},{label:'2# 结晶器',value:'二冷喷淋',tone:'normal'},{label:'3# 结晶器',value:'拉矫运行',tone:'normal'},{label:'4# 结晶器',value:'定尺输出',tone:'normal'}]});
    detail(1448,392,448,364);
    add('casting-recipe','data-table',24,780,848,276,{title:'从钢液到铸坯 · 工艺边界',columns:['生产区域','关键结构','观察重点'],rows:[['高位浇注','直立钢包 / 底部水口','长水口局部剖面'],['钢流分配','中间包 / 挡坝 / 浸入式水口','液面与包沿留出安全余量'],['凝固拉矫','四流铜结晶器 / 弧形辊列','方形坯壳与细雾二冷'],['成品输出','火切辊道 / 横向冷床','定尺铸坯与移钢路径']],highlightColumn:0,sample:true});
    add('temperature-profile','bar-chart',896,780,528,276,{title:'模拟温度剖面 · °C',categories:['钢包','中间包','入冷床'],values:[1565,1542,780],unit:'°C',color:'#d98a48'});
    note('reading',1448,780,448,276,'浇注观察\n钢液走底部水口，不从包沿倾倒。\n\n二冷观察\n喷嘴朝向坯壳，回水进入下方集水沟。\n\n虚构行业案例 · 流体视觉动画', {fontSize:19});
  }
  if(c.id==='water'){
    note('masthead',32,24,708,72,'再生水厂 · 双列处理',{fontSize:36,fontWeight:600,fillColor:p.backgroundColor,borderColor:p.backgroundColor});
    note('masthead-caption',32,96,708,48,'WATER RECLAMATION  /  主水线 · 回流污泥 · 泥线',{fontSize:18,fillColor:p.backgroundColor,borderColor:p.backgroundColor});
    [['设计演示水量','8,640','m³/d','双列分担进水'],['生化配置','A / B','双列','缺氧搅拌 + 好氧曝气'],['处理终点','回用水','＋泥饼','过滤消毒 + 污泥脱水']].forEach(([t,v,u,s],i)=>add(`overview-${i}`,'metric-card',764+i*380,24,356,120,{title:t,value:v,unit:u,subtitle:s,icon:['≈','Ⅱ','↗'][i],sample:true}));
    add('scene','scene-3d',24,176,1328,714,{sceneProjectId:sceneId,interactionEnabled:true});
    add('quality','bar-chart',1376,176,520,356,{title:'模拟 COD 沿程变化 · mg/L',categories:['原水','生化出水','二沉出水','回用水'],values:[280,58,38,32],unit:'mg/L',color:'#347d70'});
    note('quality-caption',1376,548,520,64,'工况示例曲线 · 设备参数见下方模拟源', {fontSize:18,fillColor:'#e0e8d8',borderColor:'#e0e8d8'});
    detail(1376,636,520,420);
    note('main-line',24,914,660,142,'01  水线有始有终\n格栅配水 → 双列生化 → 双池沉淀 → 过滤 / UV → 回用。\n池壁、检修桥和液位按不同功能组织。',{fontSize:19,fillColor:'#dfe9da',borderColor:'#dfe9da'});
    note('sludge-line',708,914,644,142,'02  污泥有独立去向\n回流污泥返回缺氧段；剩余污泥浓缩、脱水，滤液回前端。\n虚构行业案例 · 数据与工况均为模拟。',{fontSize:19,fillColor:'#f6f2e6',borderColor:'#e2dbc7'});
  }
  if(c.id==='cooling'){
    note('masthead',24,24,456,76,'循环水公用工程',{fontSize:32,fontWeight:600,fillColor:p.backgroundColor,borderColor:p.backgroundColor});
    note('masthead-caption',24,104,456,52,'UTILITY ISLAND / 三塔 · 四泵 · 双回路',{fontSize:18,fillColor:p.backgroundColor,borderColor:p.backgroundColor});
    note('brief',24,180,456,124,'一格冷却塔打开剖面，显示布水、填料水膜和落水区；两组换热器保留独立工艺回路。',{fontSize:22,fillColor:'#284650',borderColor:'#284650'});
    add('recirculation','radial-gauge',24,328,456,248,{title:'循环配置 · 三用一备',value:3,maximum:4,unit:'台',subtitle:'900 m³/h 循环量 · 模拟基准',sample:true});
    add('water-balance','data-table',24,600,456,304,{title:'水量平衡 · 模拟基准',columns:['去向','流量 m³/h'],rows:[['补水 M','16.45'],['蒸发 E','12.33'],['排污 B','4.07'],['飘水 D','0.045']],highlightColumn:1,sample:true});
    note('balance-rule',24,928,456,128,'M = E + B + D\n补水覆盖蒸发、排污和飘水损失。\n实时模拟值随负载同步变化。',{fontSize:20,accentColor:'#93b8b8'});
    add('scene','scene-3d',504,24,1392,728,{sceneProjectId:sceneId,interactionEnabled:true});
    detail(504,776,524,280);
    add('heat-load','progress-list',1052,776,512,280,{title:'双工艺回路 · 基准热负荷',items:[{label:'A 线工艺换热',value:4.60,maximum:8.36,unit:'MW'},{label:'B 线工艺换热',value:3.76,maximum:8.36,unit:'MW'},{label:'合计排热',value:8.36,maximum:8.36,unit:'MW'}],sample:true});
    note('circuit-key',1588,776,308,280,'管线与剖面\n\n蓝色 · 冷却供水\n氧化红 · 热水回塔\n青绿 · 旁滤 / 补水\n\n虚构案例 · 模拟数据\n动画按预设工况循环',{fontSize:18});
  }
  return {theme,nodes};
}
