// Synthetic operating points: [display label, unit, centre, amplitude].
// Process education only. Cooling heat/water balances are calculated below; no CFD is claimed.
export const fluidMetrics={
  steel:{
    ladle:{temperature:['钢液温度','°C',1565,3],flow:['底注流量','t/min',4.15,.05],mass:['包内钢量','t',68,1.5]},
    tundish:{level:['中间包液位','mm',720,9],temperature:['钢液温度','°C',1542,2],outlets:['浇注流数','流',4,0]},
    caster:{speed:['拉坯速度','m/min',1.1,.02],flow:['二冷水量','m³/h',92,1.6],mouldLevel:['结晶器液位','mm',115,2]},
    caster2:{speed:['拉坯速度','m/min',1.1,.02],flow:['二冷水量','m³/h',92,1.6],mouldLevel:['结晶器液位','mm',116,2]},
    caster3:{speed:['拉坯速度','m/min',1.1,.02],flow:['二冷水量','m³/h',92,1.6],mouldLevel:['结晶器液位','mm',114,2]},
    caster4:{speed:['拉坯速度','m/min',1.1,.02],flow:['二冷水量','m³/h',92,1.6],mouldLevel:['结晶器液位','mm',115,2]},
    utilities:{supplyTemperature:['供水温度','°C',28,.3],returnTemperature:['回水温度','°C',36,.4],flow:['循环水量','m³/h',368,4]},
    finishing:{length:['定尺长度','m',6,0],surfaceTemperature:['入冷床表温','°C',780,8],pieces:['本班铸坯','根',128,0]},
    refining:{temperature:['精炼终点温度','°C',1577,2],mass:['准备炉次钢量','t',80,0],power:['精炼功率','MW',18,.3]},
  },
  water:{
    inlet:{flow:['进水流量','m³/h',360,6],cod:['进水 COD','mg/L',280,8],level:['提升井液位','m',2,.025]},
    aeration:{oxygen:['溶解氧','mg/L',2.1,.08],airFlow:['曝气风量','m³/h',1050,18],temperature:['水温','°C',24,.2],flow:['A 列进水','m³/h',180,3]},
    aerationB:{oxygen:['溶解氧','mg/L',2.3,.08],airFlow:['曝气风量','m³/h',1080,18],temperature:['水温','°C',24,.2],flow:['B 列进水','m³/h',180,3]},
    clarifier:{load:['表面水力负荷','m³/(m²·h)',1.26,.02],level:['泥位','m',.55,.015],returnFlow:['回流污泥量','m³/h',90,1.5]},
    clarifierB:{load:['表面水力负荷','m³/(m²·h)',1.26,.02],level:['泥位','m',.56,.015],returnFlow:['回流污泥量','m³/h',90,1.5]},
    sludge:{returnRatio:['污泥回流比','%',50,0],flow:['外运湿泥示例','m³/d',36,0],drySolids:['泥饼含固率','%',20,.2]},
    reuse:{turbidity:['出水浊度','NTU',1.2,.06],flow:['回用水量','m³/h',358.5,6],cod:['出水 COD','mg/L',32,1],uvDose:['UV 剂量示例','mJ/cm²',40,.5]},
    blower:{airFlow:['供气总量','m³/h',2130,20],pressure:['供气压力','kPa',48,.5],power:['机组功率','kW',72,1]},
  },
  cooling:{
    tower:{inletTemperature:['进塔温度','°C',37,.3],outletTemperature:['出塔温度','°C',29,.2],flow:['分塔水量','m³/h',300,2]},
    tower2:{inletTemperature:['进塔温度','°C',37,.3],outletTemperature:['出塔温度','°C',29,.2],flow:['分塔水量','m³/h',300,2]},
    tower3:{inletTemperature:['进塔温度','°C',37,.3],outletTemperature:['出塔温度','°C',29,.2],flow:['分塔水量','m³/h',300,2]},
    pumps:{flow:['循环流量','m³/h',900,8],pressure:['出口压力','MPa',.32,.004],runningPumps:['运行台数','台',3,0]},
    exchanger:{inletTemperature:['工艺入口','°C',62,.4],outletTemperature:['工艺出口','°C',45,.3],load:['A 线换热负荷','MW',4.6,.04],flow:['A 线冷却水','m³/h',495,4]},
    exchangerB:{inletTemperature:['工艺入口','°C',58,.4],outletTemperature:['工艺出口','°C',43,.3],load:['B 线换热负荷','MW',3.76,.04],flow:['B 线冷却水','m³/h',405,4]},
    makeup:{flow:['补水量','m³/h',16.45,.2],conductivity:['循环电导率','μS/cm',1000,8],level:['补水液位','%',72,1],evaporation:['蒸发估算量','m³/h',12.34,.15]},
    filter:{sideFlow:['旁滤水量','m³/h',45,.5],blowdown:['排污量','m³/h',4.07,.05],cycles:['浓缩倍数','倍',4,0],drift:['飘水估算量','m³/h',.045,.001]},
    process:{load:['两线总热负荷','MW',8.36,.08],deltaTemperature:['循环供回温差','°C',8,.1],coolingFlow:['循环总水量','m³/h',900,8]},
  },
};
export function simulatedSnapshot(caseId,now=Date.now()){
  const definition=fluidMetrics[caseId];if(!definition)throw new Error(`Unknown fluid case: ${caseId}`);
  const assets={};let phase=0;
  for(const [id,metrics] of Object.entries(definition)){
    const values=assets[id]={status:'running',alarmLevel:0};
    for(const [key,[,,centre,amplitude]] of Object.entries(metrics))values[key]=centre+amplitude*Math.sin(now/18000+phase++);
  }
  if(caseId==='steel'){
    assets.utilities.flow=['caster','caster2','caster3','caster4'].reduce((sum,id)=>sum+assets[id].flow,0);
    assets.ladle.flow=['caster','caster2','caster3','caster4'].reduce((sum,id)=>sum+assets[id].speed*.38*.38*7.1,0);
  }
  if(caseId==='water'){
    assets.aeration.flow=assets.inlet.flow/2;assets.aerationB.flow=assets.inlet.flow/2;
    assets.clarifier.returnFlow=assets.aeration.flow*.5;assets.clarifierB.returnFlow=assets.aerationB.flow*.5;
    // Net forward flow / model's 13.5 m water-surface area, excluding the wall thickness.
    assets.clarifier.load=assets.aeration.flow/(Math.PI*6.75**2);assets.clarifierB.load=assets.aerationB.flow/(Math.PI*6.75**2);
    assets.blower.airFlow=assets.aeration.airFlow+assets.aerationB.airFlow;assets.reuse.flow=assets.inlet.flow-assets.sludge.flow/24;
  }
  if(caseId==='cooling'){
    const q=assets.pumps.flow,cold=29+.2*Math.sin(now/21000),delta=8+.1*Math.sin(now/17000),heat=q/3600*1000*4180*delta/1e6;
    const evaporation=heat*1e6/2440000*3.6,drift=q*.00005,cycles=4,blowdown=evaporation/(cycles-1)-drift;
    for(const id of ['tower','tower2','tower3'])Object.assign(assets[id],{inletTemperature:cold+delta,outletTemperature:cold,flow:q/3});
    Object.assign(assets.exchanger,{load:heat*.55,flow:q*.55});Object.assign(assets.exchangerB,{load:heat*.45,flow:q*.45});
    Object.assign(assets.process,{load:heat,deltaTemperature:delta,coolingFlow:q});
    Object.assign(assets.makeup,{flow:evaporation+blowdown+drift,evaporation,conductivity:1000});
    Object.assign(assets.filter,{sideFlow:q*.05,blowdown,cycles,drift});
  }
  for(const metrics of Object.values(assets))for(const [key,value] of Object.entries(metrics))if(typeof value==='number')metrics[key]=Number(value.toFixed(3));
  return {timestamp:new Date(now).toISOString(),simulation:true,dataLabel:'模拟数据 · 非真实生产数据',caseId,assets};
}
