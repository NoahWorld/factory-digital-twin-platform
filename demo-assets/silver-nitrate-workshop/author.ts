/** Native project authoring only. The saved board uses the existing platform runtime. */
import { createCanvasNode, minimumNodeSizes, type CanvasNode } from '../../apps/web/src/canvas/types';
import { canvasThemePresets } from '../../apps/web/src/canvas/themes';
import type { TwinAction } from '../../shared/twin-actions';
import manifest from './models/manifest.json';
import { composeConfiguration, configurationGroup, sceneFluidBindings } from './process-configuration';
import { createSceneDecoration } from '../../shared/scene-decorations';

// Case values are authored presentation data, not an IoT measurement source.
// Photo/model provenance stays here and in README; the delivered board shows the production information only.
export const equipment = [
  { id:'neutral', name:'中和罐', tag:'V10202B', stage:'中和', state:'运行中',
    metrics:'电流        12.6 A\n电压        380 V\n搅拌转速    15 rpm\n介质温度    35.0 ℃',
    process:'液位        62 %\npH          6.8\n工作压力    0.02 MPa',
    description:'接收上游物料与去离子水，经中和后送往蒸发釜。',
    evidence:'参考：中和罐.jpg\n照片为同类 C 罐，顶部与支撑按轮廓补全。' },
  { id:'evaporator', name:'蒸发釜', tag:'R10201B', stage:'蒸发浓缩', state:'运行中',
    metrics:'电流        18.4 A\n电压        380 V\n搅拌转速    15 rpm\n介质温度    78.0 ℃',
    process:'液位        48 %\n蒸汽压力    0.30 MPa\n真空度      −0.06 MPa',
    description:'夹套加热浓缩；蒸气进入冷凝支路，浓缩液送结晶罐。',
    evidence:'参考：91.浓缩釜.jpg\n借用同类釜外形，具体尺寸与接口待现场核对。' },
  { id:'crystallizer', name:'结晶罐', tag:'R10202B', stage:'冷却结晶', state:'运行中',
    metrics:'电流        10.2 A\n电压        380 V\n搅拌转速    15 rpm\n介质温度    18.0 ℃',
    process:'液位        56 %\n冷却水温    7.0 ℃\n冷却流量    2.4 m³/h',
    description:'接收浓缩液，使用 7℃ 水冷却；晶浆送往固液分离器。',
    evidence:'轮廓示意 · 待补拍\n尚无可确认属于硝酸银线的结晶罐完整照片。' },
  { id:'separator', name:'固液分离器', tag:'V10201B', stage:'固液分离', state:'运行中',
    metrics:'控制电流    1.2 A\n控制电压    24 V\n介质温度    22.0 ℃\n过滤压差    0.12 MPa',
    process:'进料流量    1.6 m³/h\n母液流量    0.8 m³/h\n分离方式    压力过滤',
    description:'接收晶浆完成固液分离，母液经泵返回上游。',
    evidence:'参考：12.固液分离罐.jpg\n按立式圆罐、平盖和支腿建模。' },
  { id:'condenser', name:'冷凝器', tag:'冷凝支路', stage:'蒸气冷凝', state:'运行中',
    metrics:'控制电流    0.8 A\n控制电压    24 V\n入口温度    68.0 ℃\n出口温度    28.0 ℃',
    process:'冷却流量    3.2 m³/h\n冷凝液流量  0.6 m³/h\n工作压力    0.03 MPa',
    description:'蒸气降温后，冷凝液进入收集罐。',
    evidence:'参考：9.冷凝器.jpg\n形态参考现场照片，图中未明确独立设备位号。' },
  { id:'collector', name:'冷凝收集罐', tag:'V10203B', stage:'冷凝液收集', state:'运行中',
    metrics:'控制电流    0.6 A\n控制电压    24 V\n介质温度    28.0 ℃\n液位        36 %',
    process:'收集流量    0.6 m³/h\n出液去向    V10204\n真空度      −0.04 MPa',
    description:'收集冷凝液，保留去下游储罐及真空支路的接口。',
    evidence:'参考：冷凝器收集罐.jpg\n依据可见罐体和顶部接管补全底部。' },
  { id:'pump', name:'加热循环泵', tag:'P10206B', stage:'加热循环', state:'运行中',
    metrics:'电流        6.8 A\n电压        380 V\n电机转速    1450 rpm\n轴承温度    42.0 ℃',
    process:'出口压力    0.28 MPa\n循环流量    3.2 m³/h\n运行频率    50 Hz',
    description:'蒸发釜加热循环支路，与工艺物料管线分开。',
    evidence:'通用泵轮廓示意\n需补拍该位号的泵体、驱动与接管。' },
  { id:'returnpump', name:'母液回流泵', tag:'P10201', stage:'母液回流', state:'运行中',
    metrics:'电流        4.2 A\n电压        380 V\n电机转速    1450 rpm\n轴承温度    38.0 ℃',
    process:'出口压力    0.18 MPa\n回流流量    0.8 m³/h\n运行频率    50 Hz',
    description:'固液分离后的母液返回上游接口。',
    evidence:'通用泵轮廓示意\n位号后缀和实际泵型仍需现场确认。' },
];

export function actionsFor(id: string): TwinAction[] {
  const device = equipment.find(item => item.id === id);
  if (!device) throw new Error('Unknown equipment ' + id);
  return [
    ['detail-title', device.name],
    ['detail-tag', device.tag + '  ·  ' + device.stage],
    ['detail-state', device.state],
    ['detail-metrics', device.metrics],
    ['detail-role', device.process],
  ].map(([nodeId, text]) => ({ type:'set-text', nodeId:'silver-' + nodeId, text }));
}

export function composeCanvas(sceneId: string) {
  const nodes: CanvasNode[] = [];
  function add(id: string, type: CanvasNode['type'], x: number, y: number, width: number, height: number, props: Record<string, unknown> = {}) {
    if (width < minimumNodeSizes[type].width || height < minimumNodeSizes[type].height || x < 0 || y < 0 || x + width > 1920 || y + height > 1080) {
      throw new Error('Invalid canvas bounds ' + id);
    }
    const node = createCanvasNode(type, x, y, nodes.length);
    Object.assign(node, { id:'silver-' + id, width, height });
    Object.assign(node.props, props);
    nodes.push(node);
    return node;
  }
  const colors = { textColor:'#deedf4', accentColor:'#57cfc6', fillColor:'#0b202d', borderColor:'#28596b' };
  const text = (id: string, x: number, y: number, width: number, height: number, value: string, size = 18, extra = {}) =>
    add(id, 'plain-text', x, y, width, height, { ...colors, borderRadius:0, fillColor:'#0b202d', borderColor:'#0b202d', text:value, fontSize:size, fontWeight:400, align:'left', ...extra });
  const panel = (id: string, x: number, y: number, width: number, height: number, title: string) =>
    add(id, 'panel-frame', x, y, width, height, { ...colors, title, subtitle:'', style:'corners', opacity:.94, glowStrength:.12, headerHeight:44, cornerSize:12 });
  const button = (id: string, x: number, y: number, width: number, label: string, actions: TwinAction[]) => {
    const node = add(id, 'button', x, y, width, 48, { ...colors, borderRadius:4, text:label, fontSize:17, fontWeight:500, href:'', disabled:false });
    node.interaction = { hiddenInPreview:false, clickActions:actions };
    return node;
  };
  const select = (id: string): TwinAction[] => [...actionsFor(id), { type:'focus-model', projectId:sceneId, instanceId:'silver-' + id }];

  // The same document is the full scene's overlay and the standalone combined-board preview.
  add('scene', 'scene-3d', 0, 0, 1920, 1080, { sceneProjectId:sceneId, interactionEnabled:true, playbackBindings:sceneFluidBindings() });
  add('header-bg', 'card-background', 24, 16, 1872, 104, { ...colors, opacity:.96 });
  button('view-3d', 40, 44, 128, '3D 车间', [{ type:'panel-group', groupId:configurationGroup, operation:'hide' }]);
  button('view-2d', 180, 44, 128, '2D 组态', [{ type:'panel-group', groupId:configurationGroup, operation:'show' }]);
  add('title', 'screen-title', 600, 28, 720, 80, { ...colors, text:'xxxx贵金属 · 产线综合看板', subtitle:'', align:'center', opacity:1 });
  text('subtitle', 332, 44, 236, 48, '硝酸银 B 线', 17, { textColor:'#a9c7d6' });
  button('playback', 1338, 44, 168, '暂停数字孪生', [{ type:'scene-playback', projectId:sceneId, target:'scene', operation:'toggle' }]);
  add('clock', 'datetime', 1518, 24, 220, 80, { ...colors, text:'当前时间', subtitle:'', align:'right', opacity:1, showDate:true, showSeconds:true });
  add('fullscreen', 'fullscreen-toggle', 1756, 44, 120, 48, { ...colors, enterText:'全屏', exitText:'退出', fontSize:17, fontWeight:500, borderRadius:4, disabled:false });

  panel('production', 24, 140, 300, 224, '生产概况');
  text('production-output', 40, 190, 268, 80, '今日产量      2.48 吨\n计划完成      82.7 %', 20, { textColor:'#9de7df', fontWeight:500 });
  text('production-batch', 40, 274, 268, 72, '当前批次      B-1023\n产品合格率    99.6 %', 17);
  panel('consumption', 24, 380, 300, 264, '今日物料与能源');
  text('consumption-data', 40, 436, 268, 184, '原料投入      2.75 吨\n去离子水      4.80 吨\n蒸汽消耗      1.65 吨\n今日用电      486 kWh', 18);
  panel('environment', 24, 660, 300, 224, '车间环境');
  text('environment-data', 40, 716, 268, 144, '室内温度      26.4 ℃\n相对湿度      54.0 %\n排风量        18000 m³/h', 18);

  panel('utilities', 1608, 140, 288, 224, '公用工程');
  text('utilities-data', 1624, 194, 256, 100, '冷却供水      7.0 ℃\n蒸汽压力      0.30 MPa', 18);
  text('mode', 1624, 304, 256, 48, '运行中', 17, { textColor:'#75e1c8' });
  add('detail-bg', 'card-background', 1608, 380, 288, 504, { ...colors, opacity:.96 });
  text('detail-label', 1624, 388, 256, 48, '设备运行参数', 18, { fontWeight:600, textColor:'#a9dce9' });
  text('detail-title', 1624, 436, 256, 48, '选择设备', 23, { fontWeight:600 });
  text('detail-tag', 1624, 480, 256, 48, '—', 15, { textColor:'#a9c7d6' });
  text('detail-state', 1624, 524, 256, 48, '请选择设备', 16, { textColor:'#75e1c8' });
  text('detail-metrics', 1624, 576, 256, 124, '电流        —\n电压        —\n转速        —\n温度        —', 17);
  text('detail-role', 1624, 704, 256, 104, '工艺参数    —', 16, { textColor:'#bcd4e0' });
  button('device-playback', 1624, 820, 256, '先选择设备', [{ type:'scene-playback', projectId:sceneId, target:'selected', operation:'toggle' }]);
  for (const [id, target] of [['mode', 'scene'], ['detail-state', 'selected']] as const) {
    nodes.find(node => node.id === 'silver-' + id)!.interaction = { hiddenInPreview:false, clickActions:[], playbackBinding:{ projectId:sceneId, target } };
  }

  add('flow-bg', 'card-background', 24, 912, 1872, 144, { ...colors, opacity:.96 });
  text('flow-title', 40, 920, 268, 48, '工序与设备', 18, { fontWeight:600 });
  text('flow-route', 340, 920, 1528, 48, '中和 → 蒸发浓缩 → 冷却结晶 → 固液分离  /  冷凝收集与母液回流', 16, { textColor:'#a9c7d6', align:'right' });
  for (const [index, device] of equipment.entries()) button('step-' + device.id, 40 + index * 230, 984, 218, device.name, select(device.id));
  nodes.push(...composeConfiguration(sceneId, select));
  return { nodes, theme:{ ...canvasThemePresets['deep-blue'], backgroundPattern:'none', fontFamily:'system', glowIntensity:.06, panelRadius:4 } };
}
export function composeScene(assetIds:Record<string,string>,withActions:boolean){
 const instances=[...equipment.map((e,i)=>({id:'silver-'+e.id,label:e.name+' '+e.tag,modelAssetId:assetIds[e.id==='returnpump'?'pump':e.id],assetId:null,renderMode:'interactive',sortOrder:i+1,visible:true,transform:{position:manifest.positions[e.id as keyof typeof manifest.positions],rotation:[0,0,0],scale:[1,1,1]},animation:{enabled:true,speed:1},appearance:{color:null,opacity:1},...(withActions?{clickActions:actionsFor(e.id)}:{})})),{id:'silver-workshop',label:'化工车间 · 管廊与阀门',modelAssetId:assetIds.workshop,assetId:null,renderMode:'background',sortOrder:0,visible:true,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},animation:{enabled:false,speed:1},appearance:{color:null,opacity:1}}];
 const fluids=manifest.routes.map(r=>({...r,id:'silver-'+r.id,kind:r.id==='vapor'||r.id==='vacuum'?'gas':'liquid',mode:'stream',radius:.048,speed:.65,spread:0,opacity:.8,direction:'forward',visible:true,playing:true}));
 const decorations=[[-8,4.8,-9.45,0],[8,4.8,-9.45,0],[-13.45,4.8,3,90]].map(([x,y,z,heading],i)=>({...createSceneDecoration('silver-camera-'+(i+1),'security-camera'),label:'车间摄像头 '+(i+1),accentColor:'#738795',transform:{position:[x,y,z] as [number,number,number],rotation:[0,heading,0] as [number,number,number],scale:[1.55,1.55,1.55] as [number,number,number]}}));
 return {instances,fluids,decorations};
}
