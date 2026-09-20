// Three distinct process layouts, authored in metres. Visual simulation, not CFD.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {T,output,vec,group,mesh,box,cyl,sphere,line,pipe,ring,text,track,rotate,wave,flow,ripple,rails,pump,control,basin,flange,valve,stair,tree,building,jet,curtain,spray,squareStrand,exportModule} from './fluid-geometry-v2.mjs';
const defs=[];
function unit(c,id,label,position,description,build,extra={}){defs.push({caseId:c,id,label,position,description,build,...extra});}
function floorLabel(g,label,x,z,size=.55,mat='white'){text(g,label,[x,.045,z],size,mat,true);}
function supports(g,points,y=2.8){for(const [x,z] of points){box(g,'pipe_support',[.24,y,.24],[x,y/2,z],'dark');box(g,'crosshead',[1.8,.16,.22],[x,y,z],'steel');}}
function pumpLarge(g,x,z,color='blue'){const p=group(g,'pump_package',[x,0,z]);p.scale.setScalar(1.65);pump(p,0,0,color);return p;}
function channel(g,a,b,w,y,mat='water'){
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),ch=group(g,'open_channel',[(a[0]+b[0])/2,0,(a[1]+b[1])/2]);ch.rotation.y=-Math.atan2(dz,dx);
  box(ch,'invert',[length,.15,w],[0,y-.32,0],'concrete');for(const z of [-w/2,w/2])box(ch,'channel_wall',[length,.65,.16],[0,y-.03,z],'concrete');wave(ch,'channel_surface',length,w-.16,y,mat);
}
// STEEL: a long casting hall, elevation changes and four parallel solidifying strands.
unit('steel','site','连铸车间、行车与管廊',[0,0,0],'68 × 34 m 连铸工段；高位钢包和中间包、四流弧形铸机、切割辊道与横向冷床。',g=>{
  box(g,'industrial_foundation',[68,.55,34],[0,-.29,0],'slab');
  for(let x=-32;x<=32;x+=4)box(g,'floor_joint',[.025,.012,33],[x,.002,0],'edge');
  for(let z=-16;z<=16;z+=4)box(g,'floor_joint',[67,.012,.025],[0,.002,z],'edge');
  // Open-roof hall retains its perimeter columns and bridge crane; casting remains visible.
  for(const x of [-30,-20,-10,0,10,20,30])for(const z of [-13.5,12.5]){
    box(g,'column_foot',[1.3,.45,1.3],[x,.225,z],'concrete');box(g,'steel_column',[.5,15,.6],[x,7.5,z],'dark');
    box(g,'column_web',[.72,14.4,.11],[x,7.4,z],'steel');}
  for(const z of [-13.5,12.5]){box(g,'crane_runway',[64,.7,.65],[0,14.1,z],'yellow');box(g,'crane_rail',[64,.12,.18],[0,14.53,z],'steel');}
  // Only rear bracing: foreground stays open for process inspection.
  for(let x=-30;x<30;x+=10){line(g,'wall_brace',[x,.8,-13.5],[x+10,13.5,-13.5],.065,'steel');line(g,'wall_brace',[x+10,.8,-13.5],[x,13.5,-13.5],.065,'steel');}
  for(const x of [-23,-20])box(g,'bridge_crane',[.65,.8,27],[x,15.1,-.5],'yellow');
  box(g,'crane_trolley',[3.8,.7,3],[-21.5,15.75,-3],'dark');
  for(const x of [-22.1,-20.9])line(g,'hoist_wire',[x,15.5,-3],[x,8,-3],.035,'steel');ring(g,'lifting_hook',.38,.08,[-21.5,7.8,-3],'steel',[0,0,0]);
  box(g,'casting_platform',[8,.35,19],[-9,7.15,1],'dark');
  for(const x of [-12.5,-5.5])for(const z of [-7,1,9])box(g,'platform_column',[.35,7,.35],[x,3.5,z],'steel');
  for(const x of [-13,-5])rails(g,[x,0,-8.5],[x,0,10.5],7.35);
  stair(g,[-18,0,9],7.2,1.35);
  for(const [z,mat] of [[-10.4,'blue'],[-11.5,'warm']]){
    pipe(g,'cooling_header',[[-25,1.1,z],[-18,1.1,z],[-16,2.7,z],[8,2.7,z]],.25,mat);
    for(const strandZ of [-5,-1,3,7])pipe(g,'spray_branch',[[0,2.7,z],[0,2.7,strandZ],[1,4.5,strandZ]],.085,mat);
  }
  supports(g,[[-15,-11],[0,-11],[8,-11]],2.65);
  for(let x=-32;x<31;x+=2){box(g,'walkway_dash',[1,.018,.10],[x,.035,15],'yellow');}
  floorLabel(g,'FOUR-STRAND CONTINUOUS CASTING',3,16,.68);
  floorLabel(g,'LADLE / TUNDISH',-21,12,.44);floorLabel(g,'CUTTING / COOLING BED',24,12,.44);
},{background:true});
unit('steel','ladle','钢包回转台与保护浇注',[-8,0,1],'直立钢包通过底部滑动水口和耐火长水口供钢；局部剖口展示连续钢流，其余位置保留耐火保护。',g=>{
  cyl(g,'turret_foundation',2.2,.8,[-4,.4,0],'concrete');cyl(g,'turret_pedestal',1.1,9,[-4,5,0],'dark');
  box(g,'turret_crossarm',[11,.8,1.3],[-4,10.5,0],'steel');
  for(const x of [0,-8]){
    const p=group(g,'upright_ladle',[x,13.3,0]);
    cyl(p,'ladle_shell',1.65,3.8,[0,0,0],'rust',undefined,2.12,true);cyl(p,'refractory_lining',1.40,3.65,[0,.05,0],'refractory',undefined,1.86,true);
    cyl(p,'bottom_plate',1.63,.22,[0,-1.85,0],'charcoal');
    for(const y of [-1.35,.4,1.7])ring(p,'reinforcing_band',1.69+(y+1.4)*.12,.10,[0,y,0],'steel');
    for(const z of [-2,2]){line(p,'trunnion',[0,.2,z-.3],[0,.2,z+.3],.25,'steel');box(g,'support_fork',[1.1,1.7,.38],[x,11.5,z],'dark');}
    if(x===0){wave(p,'steel_free_surface',3.48,3.48,1.15,'molten',0,0,true,.018);
      // Slag islands cover most of the melt, keeping the steel from looking like exposed lava.
      for(let k=0;k<12;k++){const a=k*2.399,r=Math.sqrt((k+.5)/12)*1.43;const s=sphere(p,'slag_raft',.45,[Math.cos(a)*r,1.18,Math.sin(a)*r],'slag');s.scale.set(1,.055,1.25);}
      box(g,'slide_gate',[.8,.28,.7],[0,11.15,0],'refractory');
      // A narrow longitudinal cutaway reveals the stream while preserving a ceramic sleeve.
      mesh(g,'shroud_section',new T.CylinderGeometry(.183,.183,1.65,24,1,true,Math.PI*.3,Math.PI*1.1),'refractory',[0,10.25,0]);
      jet(g,'protected_molten_stream',[0,11.03,.02],[0,9.45,.02],.105,'hot');
    }
  }
  control(g,[-5,.2,2.7]);
});
unit('steel','tundish','中间包、挡坝与四路浸入式水口',[-8,0,1],'中间包分配至四流结晶器；液面低于包沿，挡坝引导钢流，钢液表面保留覆盖渣。',g=>{
  const b=group(g,'tundish_vessel',[0,8.6,0]);
  box(b,'outer_bottom',[3.4,.45,16.5],[0,0,0],'rust');box(b,'refractory_floor',[3,.3,16],[0,.32,0],'refractory');
  for(const x of [-1.6,1.6])box(b,'long_wall',[.36,1.5,16.4],[x,.75,0],'refractory');
  box(b,'rear_end',[3.5,1.5,.38],[0,.75,-8.2],'rust');
  // Front service section exposes refractory thickness and a confined liquid body.
  for(const x of [-1.37,1.37])box(b,'front_section_wall',[.5,1.5,.36],[x,.75,8.2],'refractory');
  box(b,'steel_section',[2.2,.68,.04],[0,.81,8.15],'molten');
  wave(b,'tundish_meniscus',2.8,15.8,1.12,'molten',0,0,false,.025);
  for(const z of [-4,4])box(b,'flow_control_dam',[2.8,.58,.22],[0,.73,z],'refractory');
  for(let z=-7.3;z<=7.4;z+=1.4){const s=sphere(b,'covering_slag',.66,[.4,1.13,z],'slag');s.scale.set(1.5,.04,1.1);}
  for(const z of [-6,-2,2,6]){
    cyl(g,'SEN',.145,1.15,[0,8.0,z],'refractory',undefined,.145,true);
    line(g,'stopper_rod',[.3,9.3,z],[.3,11,z],.07,'refractory');box(g,'stopper_actuator',[.36,.4,.3],[.3,11,z],'steel');
  }
  for(const x of [-1.9,1.9])for(const z of [-6,6])cyl(g,'tundish_car_wheel',.36,.24,[x,7.6,z],'steel',[Math.PI/2,0,0]);
});
function caster(g,index){
  cyl(g,'mould_mount',.8,.35,[0,7.5,0],'dark');
  // Open square copper mould surrounds the rectangular strand.
  for(const x of [-.34,.34])box(g,'copper_mould_wall',[.2,.8,.88],[x,7.9,0],'copper');
  for(const z of [-.34,.34])box(g,'copper_mould_wall',[.48,.8,.2],[0,7.9,z],'copper');
  wave(g,'confined_mould_meniscus',.46,.46,8.04,'molten',0,0,false,.007);
  const points=[[0,7.65,0],[.1,6.7,0],[.8,4.3,0],[2.8,2.2,0],[5.5,1.32,0],[9,1.2,0],[22,1.2,0]];
  const curve=squareStrand(g,points,.38);
  for(let k=0;k<20;k++){
    const t=k/19,pt=curve.getPointAt(t);for(const z of [-.44,.44]){
      cyl(g,'support_roller',.15,.65,[pt.x,pt.y+(k<7?0:-.3),z],'steel',[Math.PI/2,0,0]);
      if(k%3===0)box(g,'roller_stanchion',[.15,Math.max(.2,pt.y-.35),.15],[pt.x,(pt.y-.35)/2,z*1.9],'dark');}
  }
  for(const x of [1.3,2.8,4.6]){
    const y=x<2?4.3:x<4?2.5:1.5;
    for(const z of [-.92,.92]){line(g,'nozzle_supply',[x,.5,z],[x,y+.4,z],.06,'blue');
      cyl(g,'air_mist_nozzle',.09,.16,[x,y+.28,z],'steel',[Math.PI/2,0,0]);
      for(let j=-1;j<=1;j++)spray(g,[x,y+.28,z],[x+j*.16,y-.1,z>0?.18:-.18],4,.018);}
  }
  // Drains collect secondary-cooling runoff under the rollers.
  box(g,'runoff_trench',[7,.12,1.85],[3,.13,0],'dark');wave(g,'runoff_surface',6.7,1.55,.22,'water',3,0,false,.012);
  text(g,`STRAND ${index}`,[9,.045,1.35],.30,'white',true);
}
[-5,-1,3,7].forEach((z,i)=>unit('steel',i===0?'caster':`caster${i+1}`,`第 ${i+1} 流结晶、二冷与拉矫`,[-8,0,z],'方坯在铜结晶器内形成坯壳，沿弧形辊列拉出；两侧喷嘴细雾接触坯面，冷却水进入下方回收沟。',g=>caster(g,i+1)));
unit('steel','finishing','定尺切割、移钢与冷床',[20,0,1],'四流切割辊道汇入横向移钢冷床，展示铸坯由连续成形到定尺输出。',g=>{
  for(const z of [-6,-2,2,6]){
    for(let x=-8;x<=3;x+=.9){cyl(g,'output_roller',.16,1.1,[x,1.02,z],'steel',[Math.PI/2,0,0]);}
    for(const zz of [z-.65,z+.65])box(g,'roller_frame',[12,.24,.14],[-2.6,.75,zz],'dark');
    for(const xx of [-6,-1,3])for(const zz of [z-.65,z+.65])box(g,'table_leg',[.16,.7,.16],[xx,.35,zz],'dark');
    box(g,'cutting_bridge',[.3,1.9,2.2],[-6,1.9,z],'steel');line(g,'torch',[-6,2.5,z],[-6,1.48,z],.07,'copper');
    const billet=box(g,'moving_cut_billet',[4.6,.38,.38],[-2.5,1.22,z],'rust');
    track(billet,'position',[0,11.5,11.7,12],[[-2.5,1.22,z],[2.5,1.22,z],[-2.5,1.22,z],[-2.5,1.22,z]]);
    track(billet,'scale',[0,.2,11.4,11.6,11.7,12],[[0,0,0],[1,1,1],[1,1,1],[0,0,0],[0,0,0],[0,0,0]]);
  }
  for(let x=5;x<12;x+=.8)box(g,'cooling_bed_rail',[.12,.35,15],[x,1.05,0],'steel');
  for(let z=-6;z<=6;z+=1.0)box(g,'stacked_billet',[5.8,.38,.38],[8.3,1.43,z],'charcoal');
  for(const x of [5,11])for(const z of [-7,0,7])box(g,'bed_support',[.3,.85,.3],[x,.42,z],'dark');
  floorLabel(g,'CUT TO LENGTH',-3,9,.45);
});
unit('steel','utilities','二冷回水、沉淀与循环泵',[-25,0,-8],'喷淋回水进入集水和沉淀单元，经泵组回送；供回水管以冷蓝和氧化红区分。',g=>{
  basin(g,{w:8,d:5,h:2.1,level:1.7,mat:'water',x:0,z:0,section:true});
  for(const x of [-1.5,1.5])box(g,'settling_baffle',[.18,1.6,4.6],[x,1.15,0],'concrete');
  for(const z of [-1.4,1.4]){pumpLarge(g,5.6,z);pipe(g,'suction',[[4,1.1,z],[5.1,1.1,z]],.18,'blue');pipe(g,'pump_header',[[6.25,1.9,z],[7.5,1.9,z],[7.5,1.1,-2.4],[0,1.1,-2.4]],.18,'blue');}
  control(g,[5,.2,3]);floorLabel(g,'SECONDARY WATER',0,4,.4);
});
unit('steel','refining','钢包准备与精炼工位',[-24,0,3],'待浇钢包、精炼罩、三电极及除尘管廊构成上游工位；当前演示聚焦后续连铸。',g=>{
  cyl(g,'ladle_car_base',2.4,.45,[0,.55,0],'dark');cyl(g,'refining_ladle',1.6,3.4,[0,2.5,0],'rust',undefined,2,true);
  cyl(g,'furnace_lid',2.15,.35,[0,4.35,0],'steel');for(let k=0;k<3;k++){const a=k/3*Math.PI*2;cyl(g,'electrode',.17,3.7,[Math.cos(a)*.6,6.2,Math.sin(a)*.6],'charcoal');}
  box(g,'electrode_arm',[4,.35,.55],[-.5,7.2,0],'yellow');box(g,'electrode_mast',[.6,7.6,.6],[-3,3.8,0],'dark');
  pipe(g,'fume_duct',[[1.6,4.5,0],[2.8,5.5,0],[2.8,9,-2],[2.8,9,-6]],.65,'steel');
  for(const z of [-2,2])box(g,'ladle_transfer_rail',[8,.10,.12],[0,.10,z],'steel');
  floorLabel(g,'LADLE PREPARATION',0,5,.42);
});
// WATER: a daylight civil-works campus, paired biological lanes, circular settlers and sludge return.
unit('water','site','双列水厂道路、绿化与连接管渠',[0,0,0],'82 × 72 m 厂区；双列生化和双二沉池形成主线，回流污泥、剩余污泥和回用水各有去向。',g=>{
  box(g,'landform',[82,.7,72],[0,-.4,0],'grass');box(g,'service_yard',[75,.18,59],[0,-.01,0],'paving');
  for(const z of [-32,32])box(g,'ring_road',[79,.1,4],[0,.025,z],'slab');for(const x of [-38,38])box(g,'ring_road',[4,.1,64],[x,.025,0],'slab');
  for(let x=-34;x<=34;x+=4)for(const z of [-32,32])box(g,'road_mark',[1.4,.015,.09],[x,.09,z],'white');
  for(let x=-36;x<=36;x+=6)for(const z of [-35,35])tree(g,x,z,.8+(x+36)%3*.05);
  for(const z of [-12,12]){
    pipe(g,'inlet_distribution',[[-25,1.4,0],[-23,1.4,0],[-23,1.4,z],[-19,1.4,z]],.28,'raw');
    pipe(g,'mixed_liquor_to_settler',[[-1,1.25,z],[3,1.25,z],[3,1.25,z-7],[13,1.25,z-7],[13,1.25,z]],.25,'teal');
    pipe(g,'clarified_water',[[20,1.6,z],[24,1.6,z],[25,1.6,z]],.24,'blue');
    // RAS goes around the civil structures, with visible vertical entries at both ends.
    const edge=z<0?-23:23;
    pipe(g,'RAS_return',[[13,.6,z],[13,.6,edge],[-21,.6,edge],[-21,.6,z],[-17,.6,z]],.16,'warm');
    valve(g,[-19,.6,edge],'x',.16);
    pipe(g,'waste_sludge_to_dewatering',[[13,.6,edge],[22,.6,edge],[22,.6,27],[12,.6,27]],.10,'earth');
  }
  pipe(g,'reuse_outlet',[[33,1.0,6],[35.5,1.0,6],[35.5,1.0,22]],.2,'teal');valve(g,[35.5,1,16],'z',.2);
  floorLabel(g,'WATER RECLAMATION CAMPUS',-5,30,.78,'dark');
  floorLabel(g,'INLET',-29,17,.43,'dark');floorLabel(g,'REUSE',30,19,.43,'dark');
  for(const x of [-34,34])for(const z of [-27,0,27]){line(g,'street_light_pole',[x,0,z],[x,4.5,z],.065,'steel');box(g,'lamp',[.65,.1,.28],[x+.2,4.5,z],'white');}
},{background:true});
unit('water','inlet','格栅、提升与配水渠',[-29,0,0],'原水经过粗细格栅和提升井，在高位配水渠分至两列生化池；短跌水水幕落入消能池。',g=>{
  basin(g,{w:7,d:23,h:2.6,level:2.0,mat:'raw',section:true});
  for(const z of [-7,-2]){box(g,'channel_divider',[6.6,1.9,.25],[0,1.25,z],'concrete');
    for(let x=-2.8;x<=2.8;x+=.23){const m=box(g,'inclined_screen',[.07,2.7,.1],[x,2.75,z],'steel');m.rotation.x=-.45;}
    box(g,'screen_rake_beam',[6.6,.35,.6],[0,4.1,z-.5],'teal');}
  box(g,'screenings_conveyor',[1.2,.65,9],[4.1,3,-4],'steel');box(g,'screenings_bin',[2,1.6,2],[4.1,.8,2],'dark');
  box(g,'distribution_trough',[5,.23,3],[0,3.02,8],'concrete');
  wave(g,'headwater',4.7,2.7,3.22,'raw',0,8);curtain(g,0,9.52,3.2,2.12,4.2,'water');
  for(let x=-1.5;x<=1.5;x+=1)ripple(g,x,9.7,2.15,.46,'foam');
  for(const z of [-9,9])rails(g,[-3.8,0,z],[3.8,0,z],2.95);
  control(g,[-4.6,0,7]);
});
function bioTrain(g,id){
  // Same treatment technology in two physical trains; anoxic and aerated zones differ visibly.
  basin(g,{w:18,d:14,h:3.1,level:2.65,mat:'bio',section:true});
  box(g,'anoxic_partition',[.3,2.25,13.7],[-4,1.45,0],'concrete');
  box(g,'internal_baffle',[.25,2.25,11],[2,1.45,-1.2],'concrete');
  box(g,'bridge',[18.9,.18,1.1],[0,3.57,0],'steel');rails(g,[-9.4,0,-.58],[9.4,0,-.58],3.65);rails(g,[-9.4,0,.58],[9.4,0,.58],3.65);
  for(const z of [-4.6,4.6]){
    line(g,'mixer_shaft',[-6.5,3.2,z],[-6.5,1.3,z],.065,'steel');cyl(g,'mixer_motor',.24,.6,[-6.5,3.2,z],'blue');
    const mix=group(g,'submerged_mixer',[-6.5,1.2,z]);for(let k=0;k<3;k++){const blade=box(mix,'mixer_blade',[1.2,.06,.18],[0,0,0],'steel');blade.rotation.y=k*Math.PI/3;}rotate(mix,'y',3);
  }
  for(const z of [-5,-2.4,2.4,5]){
    pipe(g,'air_lateral',[[-2.5,.55,z],[7.5,.55,z]],.065,'steel');
    for(const x of [-1.8,1.2,4.2,7.2]){
      cyl(g,'diffuser',.25,.06,[x,.66,z],'dark');
      // Small submerged bubbles, with surface foam confined to diffuser lanes.
      flow(g,'bubble_column',[[x,.74,z],[x+.08,1.7,z-.03],[x-.04,2.68,z+.08]],{count:4,radius:.028,duration:3,mat:'foam',stretch:1});
      const patch=sphere(g,'aeration_foam',.4,[x,2.69,z],'foam');patch.scale.set(1,.018,.75);ripple(g,x,z,2.7,.42,'foam');
    }
  }
  pipe(g,'air_header',[[8,4,-6.5],[8,4,6.5]],.13,'blue');for(const z of [-5,-2.4,2.4,5])pipe(g,'air_drop',[[8,4,z],[8,.55,z],[7,.55,z]],.065,'blue');
  pipe(g,'internal_nitrate_recycle',[[7,1.2,5.8],[7,1.2,6.4],[-6.3,1.2,6.4],[-6.3,1.2,4.8]],.14,'teal');
  text(g,`TRAIN ${id}    ANOXIC / AERATION`,[0,.045,8.2],.40,'dark',true);
}
unit('water','aeration','A 列缺氧—好氧生化池',[-10,0,-12],'前段缺氧搅拌，后段底部微孔曝气；内回流返回缺氧段，池壁剖口显示水深。',g=>bioTrain(g,'A'));
unit('water','aerationB','B 列缺氧—好氧生化池',[-10,0,12],'与 A 列并行分担水量；曝气气泡、水面小幅波动、检修桥和布气支管均独立建模。',g=>bioTrain(g,'B'));
function clarifier(g,id){
  cyl(g,'settler_raft',7.65,.3,[0,.15,0],'concrete');
  mesh(g,'circular_wall',new T.CylinderGeometry(7.3,7.3,2.8,96,1,true),'concrete',[0,1.7,0]);
  ring(g,'outer_coping',7.32,.18,[0,3.15,0],'cream');ring(g,'effluent_launder',6.9,.16,[0,2.45,0],'concrete');
  wave(g,'clarifier_quiet_surface',13.5,13.5,2.5,'water',0,0,true,.009);
  mesh(g,'feedwell_wall',new T.CylinderGeometry(1.25,1.25,1.0,40,1,true),'steel',[0,2.45,0]);
  wave(g,'feedwell_surface',2.35,2.35,2.57,'bio',0,0,true,.018);
  cyl(g,'centre_pier',.35,3.7,[0,2,0],'concrete');
  const bridge=group(g,'slow_scraper_bridge',[0,3.35,0]);box(bridge,'bridge_deck',[13.7,.16,.85],[0,0,0],'steel');
  for(const z of [-.46,.46])rails(bridge,[-6.7,0,z],[6.7,0,z],.1);
  box(bridge,'drive_motor',[.6,.45,.55],[6.5,.35,0],'blue');
  // Full rotation takes 120 seconds at saved instance speed, matching slow mechanical separation.
  rotate(bridge,'y',12);
  for(const x of [-4,4]){line(bridge,'scraper_hanger',[x,0,0],[x,-2.75,0],.04,'steel');box(bridge,'bottom_scraper',[5,.18,.10],[x,-2.72,0],'sludge');}
  // Effluent is a thin falling sheet in a local observation notch, not a fountain.
  curtain(g,0,6.89,2.51,2.26,1.5,'film');
  pipe(g,'clarified_outlet',[[6.8,2.3,0],[7.7,2.3,0],[7.7,1.6,0],[8,1.6,0]],.22,'blue');
  text(g,`SECONDARY ${id}`,[0,.045,8.7],.4,'dark',true);
}
unit('water','clarifier','A 池辐流二沉与出水堰',[13,0,-12],'中心进水、周边堰出水、低速刮泥桥与底部排泥；水面比曝气池平缓，污泥回到缺氧段。',g=>clarifier(g,'A'),{animationSpeed:.1});
unit('water','clarifierB','B 池辐流二沉与污泥分配',[13,0,12],'第二座辐流沉淀池，与 A 池平行运行；回流污泥和剩余污泥接入不同管线。',g=>clarifier(g,'B'),{animationSpeed:.1});
unit('water','reuse','过滤、紫外消毒与清水回用',[29,0,0],'二沉出水经滤池、浸没式紫外渠、清水池和回用泵送至外部用水点。',g=>{
  basin(g,{w:8,d:25,h:2.2,level:1.77,mat:'clean'});
  for(const z of [-6,0,6])box(g,'process_partition',[7.6,1.55,.2],[0,1.02,z],'concrete');
  for(const x of [-2.5,0,2.5]){box(g,'filter_cell',[1.8,.6,5.3],[x,1.0,-9.3],'earth');
    for(let z=-3.8;z<-1;z+=.5)line(g,'submerged_UV_sleeve',[x-.65,1.3,z],[x+.65,1.3,z],.038,'white');}
  box(g,'UV_service_deck',[8.6,.15,1.4],[0,2.8,-.3],'steel');rails(g,[-4.3,0,.42],[4.3,0,.42],2.88);
  for(const z of [7.5,10.5]){pumpLarge(g,5.3,z,'teal');pipe(g,'reuse_suction',[[3.8,1,z],[4.9,1,z]],.17,'teal');}
  control(g,[5.3,.1,3]);
});
unit('water','sludge','回流泵、浓缩与污泥脱水',[7,0,27],'二沉池回流污泥返回生化段；剩余污泥经浓缩、带式脱水输出泥饼，滤液回前端。',g=>{
  cyl(g,'thickener_base',2.45,.25,[-4,.15,0],'concrete');mesh(g,'thickener_shell',new T.CylinderGeometry(2.2,2.2,2.5,48,1,true),'concrete',[-4,1.55,0]);
  wave(g,'thickener_surface',4.15,4.15,2.37,'raw',-4,0,true,.01);box(g,'thickener_bridge',[4.7,.2,.65],[-4,2.95,0],'steel');
  box(g,'dewater_foundation',[8,.3,5],[3,.15,0],'concrete');
  for(const x of [1,5])box(g,'belt_press_frame',[.22,2,.22],[x,1.1,0],'teal');
  box(g,'dewatering_belt',[5,.12,2.2],[3,1.2,0],'dark');for(const x of [1,2,3,4,5])cyl(g,'press_roller',.24,2.3,[x,1.5,0],'steel',[Math.PI/2,0,0]);
  box(g,'cake_skip',[2.4,1.2,2.8],[7,.7,0],'warm');box(g,'dewatered_cake',[2,.45,2.4],[7,1.12,0],'earth');
  pipe(g,'sludge_transfer',[[-2,1.1,0],[0,1.1,0],[.6,1.6,0]],.12,'earth');
  pipe(g,'filtrate_return',[[3,.6,1.3],[3,.6,3],[-10,.6,3],[-36,.6,3],[-36,.6,-19]],.09,'warm');
});
unit('water','blower','鼓风机房、配电与厂务',[-10,0,-27],'三台鼓风机和供气总管服务两列曝气池；配套值班与配电建筑形成完整厂区。',g=>{
  box(g,'blower_foundation',[17,.3,7],[0,.15,0],'concrete');
  box(g,'rear_wall',[16,4,.25],[0,2,-3],'cream');
  for(const x of [-8,8])box(g,'end_wall',[.25,4,6],[x,2,0],'cream');
  box(g,'section_sill',[16,.65,.25],[0,.4,3],'cream');
  for(const x of [-5,0,5]){box(g,'blower_skid',[3,.3,2],[x,.35,0],'dark');cyl(g,'blower_motor',.5,1.4,[x-.5,1.05,0],'blue',[0,0,Math.PI/2]);cyl(g,'blower_rotor',.75,.8,[x+.5,1.05,0],'steel',[0,0,Math.PI/2]);pipe(g,'blower_discharge',[[x+.5,1.3,0],[x+.5,3.5,0],[x+.5,3.5,2]],.13,'blue');}
  pipe(g,'main_air_manifold',[[-6,3.5,2],[8,3.5,2],[8,4,8]],.22,'blue');
  text(g,'BLOWER / MCC',[0,3.25,3.05],.4,'dark');
  for(const x of [-6,6])control(g,[x,0,-2]);
});
// COOLING: three tall cells with one cutaway, common basin, dual process loops and water balance.
unit('cooling','site','三塔循环水站与双层管廊',[0,0,0],'58 × 48 m 公用工程站；三格冷却塔、四泵、双换热器和旁滤补水系统构成闭路。',g=>{
  box(g,'station_slab',[58,.6,48],[0,-.33,0],'paving');
  for(let x=-27;x<=27;x+=3)box(g,'expansion_joint',[.023,.014,47],[x,.015,0],'slab');
  for(const z of [-22,21]){box(g,'service_lane',[56,.03,3],[0,.02,z],'slab');for(let x=-25;x<=25;x+=3)box(g,'lane_dash',[1.3,.02,.09],[x,.05,z],'yellow');}
  // Common cold basin physically under all three cells.
  basin(g,{w:32,d:10,h:1.6,level:1.2,x:-5,z:-12,mat:'clean'});
  for(const [z,y,mat] of [[-3,3.3,'blue'],[-1.5,4.2,'warm']]){
    pipe(g,'main_header',[[-24,y,z],[-15,y,z],[-5,y,z],[8,y,z],[21,y,z]],.33,mat);
    for(const x of [-16,-5,6])if(mat==='warm')pipe(g,'tower_hot_branch',[[x,y,z],[x,y,-7],[x,9.4,-7],[x,9.4,-12]],.22,mat);
    for(const xx of [1,14]){const px=xx+(mat==='blue'?-4.2:4.2);pipe(g,'exchanger_branch',[[px,y,z],[px,y,5],[px,2,5]],.23,mat);}
  }
  for(const x of [-23,-12,-1,10,21]){box(g,'rack_foot',[1.2,.25,3],[x,.125,-2.25],'concrete');for(const z of [-3.9,-.6])box(g,'rack_column',[.18,5,.18],[x,2.5,z],'steel');for(const y of [3,4.7])box(g,'rack_beam',[.22,.18,3.5],[x,y,-2.25],'dark');}
  pipe(g,'cold_basin_suction',[[-21,1,-12],[-24,1,-12],[-24,1,4]],.38,'blue');
  pipe(g,'makeup_to_basin',[[22,1.2,-14],[20,1.2,-14],[11,1.2,-14]],.12,'teal');
  pipe(g,'blowdown_line',[[-24,.7,-12],[-26,.7,-12],[-26,.7,15],[22,.7,15]],.11,'warm');
  pipe(g,'side_filter_takeoff',[[21,3.3,-3],[25,3.3,-3],[25,3.2,14.2],[22,3.2,14.2]],.11,'blue');
  pipe(g,'side_filter_return',[[22,.85,17.8],[27,.85,17.8],[27,.85,-18],[11,.85,-18],[11,.85,-12]],.11,'teal');
  floorLabel(g,'INDUSTRIAL COOLING / UTILITY ISLAND',0,23,.72,'dark');
  floorLabel(g,'SUPPLY',-16,1.5,.4,'blue');floorLabel(g,'HOT RETURN',1,1.5,.4,'warm');
},{background:true});
function tower(g,cutaway){
  for(const x of [-4,4])for(const z of [-3.8,3.8])box(g,'tower_column',[.32,10,.32],[x,6.5,z],'concrete');
  for(const y of [3.2,7.2,10.4]){for(const z of [-4,4])box(g,'tower_beam',[8.6,.3,.25],[0,y,z],'steel');for(const x of [-4,4])box(g,'tower_beam',[.25,.3,8.6],[x,y,0],'steel');}
  for(const x of [-4,4]){box(g,'tower_side',[.16,7.5,8],[x,6.6,0],'cream');for(let z=-3.6;z<4;z+=.55)box(g,'cladding_seam',[.045,7.3,.06],[x+(x>0?.09:-.09),6.6,z],'steel');}
  box(g,'back_cladding',[8,7.5,.16],[0,6.6,-4],'cream');
  if(!cutaway)box(g,'front_cladding',[8,5.6,.16],[0,7.35,4],'cream');
  else{box(g,'section_cut_edge',[.09,7.5,.22],[-4,6.6,4],'yellow');box(g,'section_cut_edge',[.09,7.5,.22],[4,6.6,4],'yellow');}
  for(const z of [-4.1,4.1])for(let y=2.1;y<4.1;y+=.26){const l=box(g,'air_inlet_louver',[7.4,.06,.45],[0,y,z],'steel');l.rotation.x=.4;}
  // Fill pack has visible corrugated layers and water films, not a solid luminous block.
  for(let x=-3.6;x<=3.6;x+=.36){box(g,'fill_pack',[.07,2.5,7.4],[x,5.25,0],'charcoal');}
  pipe(g,'hot_water_riser',[[0,9.4,0],[0,8.6,0]],.22,'warm');
  pipe(g,'distribution_header',[[-3,8.6,0],[3,8.6,0]],.18,'steel');
  for(const x of [-3,-1,1,3]){
    pipe(g,'spray_lateral',[[x,8.6,-3.2],[x,8.6,3.2]],.09,'steel');
    for(const z of [-2.5,0,2.5]){cyl(g,'distribution_nozzle',.12,.15,[x,8.48,z],'steel');
      for(const dx of [-.45,0,.45])spray(g,[x,8.4,z],[x+dx,6.6,z+.35],4,.022);}
  }
  if(cutaway)for(const x of [-2.6,0,2.6]){curtain(g,x,3.35,6.4,4.05,1.65);curtain(g,x,3.5,3.95,1.28,1.35);}
  for(const z of [-2,1])for(const x of [-2,2])jet(g,'fill_runoff',[x,3.4,z],[x,1.24,z],.07,'film');
  box(g,'fan_deck',[8.5,.23,8.5],[0,10.6,0],'steel');
  mesh(g,'fan_stack',new T.CylinderGeometry(2.8,3.0,1.45,64,1,true),'cream',[0,11.4,0]);
  ring(g,'fan_stack_rim',2.8,.10,[0,12.12,0],'steel');
  const fan=group(g,'axial_fan',[0,11.25,0]);cyl(fan,'hub',.4,.32,[0,0,0],'steel');
  for(let k=0;k<6;k++){const blade=box(fan,'fan_blade',[2.4,.07,.48],[0,0,0],'dark');blade.geometry=blade.geometry.clone();blade.geometry.translate(1.3,0,0);blade.rotation.y=k*Math.PI/3;blade.rotation.z=.08;}rotate(fan,'y',3);
  for(const z of [-4,4])rails(g,[-4.1,0,z],[4.1,0,z],10.72);
  for(const x of [-4.1,4.1])rails(g,[x,0,-4],[x,0,4],10.72);
}
[-16,-5,6].forEach((x,i)=>unit('cooling',i===0?'tower':`tower${i+1}`,`${i+1} 号逆流冷却塔${i===2?' · 剖面':''}`,[x,0,-12],'热水从顶部喷嘴洒向填料，在填料表面成膜并落入共用集水池；风机和下部百叶对应逆流通风。',g=>tower(g,i===2)));
unit('cooling','pumps','四泵并联供水机组',[-20,0,6],'四台循环泵的吸水支管连接共用冷水池，止回及隔离阀接入供水总管；示例运行策略为三用一备。',g=>{
  box(g,'pump_pad',[9,.25,13],[0,.15,0],'concrete');
  for(const z of [-4.5,-1.5,1.5,4.5]){
    const pp=group(g,'circulation_pump',[0,.12,z]);pp.scale.setScalar(2.3);pump(pp,0,0,'blue');
    pipe(g,'suction_branch',[[-4,1.05,z],[-.8,1.05,z]],.22,'blue');flange(g,[-1.8,1.05,z],'x',.22);valve(g,[-2.8,1.05,z],'x',.22);
    pipe(g,'discharge_branch',[[.92,2.7,z],[3,2.7,z],[3,3.3,-9],[0,3.3,-9]],.22,'blue');valve(g,[2.4,2.7,z],'x',.22);
  }
  pipe(g,'common_suction',[[-4,1.05,-6],[-4,1.05,4.5]],.38,'blue');
  for(const z of [-3,3])control(g,[4,.15,z]);floorLabel(g,'P-101 A / B / C / D',0,8.1,.47,'dark');
});
function exchanger(g,label){
  box(g,'exchanger_plinth',[10,.35,6],[0,.2,0],'concrete');
  for(const x of [-3,3]){box(g,'saddle',[.6,1.3,2.9],[x,1,0],'steel');}
  // Rear shell is intact; front half is explicitly sectioned to expose separate fluid circuits.
  mesh(g,'shell_section',new T.CylinderGeometry(1.2,1.2,7.4,48,1,true,Math.PI*.05,Math.PI*1.05),'steel',[0,2,0],[0,0,Math.PI/2]);
  for(const x of [-3.7,3.7]){cyl(g,'tube_sheet',1.24,.2,[x,2,0],'steel',[0,0,Math.PI/2]);cyl(g,'waterbox',1.1,.8,[x*1.1,2,0],'blue',[0,0,Math.PI/2]);flange(g,[x,2,0],'x',.88);}
  for(const y of [-.65,-.3,.05,.4,.75])for(const z of [-.65,-.3,.05,.4,.75])if(y*y+z*z<.88){line(g,'copper_tube',[-3.58,2+y,z],[3.58,2+y,z],.055,'copper');}
  for(const x of [-2,-.8,.8,2])mesh(g,'segmental_baffle',new T.CircleGeometry(1.08,40,0,Math.PI*1.45),'steel',[x,2,0],[0,Math.PI/2,0]);
  // Small section arrows are physically contained within the open shell volume.
  flow(g,'shell_side_section_flow',[[-3.1,1.4,.55],[-1.8,2.5,.55],[0,1.4,.55],[1.8,2.5,.55],[3.1,1.5,.55]],{count:12,radius:.035,duration:4,mat:'water',stretch:3});
  for(const x of [-4.2,4.2])pipe(g,'waterbox_connection',[[x,2,0],[x,2,-3]],.21,'blue');
  for(const x of [-2.6,2.6])pipe(g,'process_nozzle',[[x,2.8,0],[x,4,0],[x,4,5]],.18,'warm');
  floorLabel(g,label,0,4,.44,'dark');
}
unit('cooling','exchanger','A 线管壳式换热单元',[1,0,8],'管程冷却水与壳程工艺流体由管壁隔开；壳体局部剖开显示管束、折流板和流向。',g=>exchanger(g,'HX-A / PROCESS 01'));
unit('cooling','exchangerB','B 线管壳式换热单元',[14,0,8],'第二组独立负载，与 A 线共享循环供回水总管；两个回路通过金属换热面交换热量。',g=>exchanger(g,'HX-B / PROCESS 02'));
unit('cooling','makeup','补水箱、加药及计量',[22,0,-14],'补水箱和水表接入塔池，药剂由独立计量泵注入；补水弥补蒸发、排污和少量飘水损失。',g=>{
  cyl(g,'storage_foot',2.3,.3,[0,.15,0],'concrete');cyl(g,'makeup_tank_shell',2,5,[0,2.8,0],'cream',undefined,2,true);ring(g,'top_ring',2,.10,[0,5.3,0],'steel');
  wave(g,'tank_level',3.78,3.78,3.75,'clean',0,0,true,.015);
  for(const z of [-2.5,2.5])line(g,'tank_hoop_support',[-2.1,0,z],[2.1,0,z],.04,'steel');
  pipe(g,'sight_gauge',[[2.1,.7,0],[2.1,4.8,0]],.07,'glass');
  for(const z of [-2,1]){cyl(g,'chemical_tank',.68,1.6,[-3,.95,z],'teal');box(g,'dosing_pump',[.65,.6,.5],[-3,.65,z+1],'yellow');pipe(g,'dose_line',[[-3,1.8,z],[-3,2.1,z],[0,2.1,z],[0,1.2,0]],.025,'teal');}
  pipe(g,'metered_makeup',[[0,1.2,0],[-2.3,1.2,0]],.12,'teal');valve(g,[-1.2,1.2,0],'x',.12);
  control(g,[2.7,.1,1.5]);
});
unit('cooling','filter','旁流过滤、排污与水质控制',[22,0,16],'旁滤器从循环管取水并回送，电导率控制排污；排污去向为处理管线。',g=>{
  for(const x of [-2,1.5]){
    cyl(g,'pressure_filter',1.1,3,[x,2,0],'teal');const top=sphere(g,'dished_head',1.1,[x,3.5,0],'teal');top.scale.y=.4;const bottom=sphere(g,'lower_head',1.1,[x,.5,0],'teal');bottom.scale.y=.3;
    for(const z of [-.65,.65])box(g,'filter_leg',[.12,.6,.12],[x,.3,z],'steel');
    pipe(g,'filter_inlet',[[x,3.2,0],[x,3.2,-1.8],[0,3.2,-1.8]],.11,'blue');pipe(g,'filter_outlet',[[x,.85,0],[x,.85,1.8],[0,.85,1.8]],.11,'teal');
  }
  box(g,'sampling_panel',[1.3,1.7,.3],[-.2,.9,2.4],'cream');
  pipe(g,'blowdown_outfall',[[0,.7,-1],[3.4,.7,-1],[3.4,.7,3.5]],.11,'warm');valve(g,[2.4,.7,-1],'x',.11);
  floorLabel(g,'FILTRATION / BLOWDOWN',0,4.7,.35,'dark');
});
unit('cooling','process','双工艺负载与检修区域',[6,0,18],'两条工艺热负载经独立供回管接入 A、B 换热器，构成热源—换热—冷却塔的完整业务循环。',g=>{
  for(const x of [-5,8]){
    box(g,'process_skid',[8,.25,5],[x,.15,0],'concrete');
    cyl(g,'process_vessel',1.35,3.8,[x,2.3,0],'steel',undefined,1.35,true);cyl(g,'vessel_cap',1.4,.17,[x,4.25,0],'steel');
    for(const dx of [-2.6,2.6])pipe(g,'process_loop',[[x+dx,4,-5],[x+dx,4,0],[x+(dx>0?1:-1),3.2,0]],.18,'warm');
    control(g,[x+2,.1,1.8]);
  }
});
const cases=[
  {id:'steel',title:'四流方坯连铸生产区',accent:'#e8a54e',theme:'steel-orange',footprint:[68,34],flow:'钢包准备 → 底注保护浇注 → 四流结晶与二冷 → 拉矫切割 → 横移冷床',summary:'高位浇注、四流弧形铸机和低位出坯组成纵深生产线；工业灰、耐火褐和克制的钢液橙构成材质层次。',settings:{backgroundColor:'#242a30',cameraView:'isometric',cameraFov:35,modelScale:1.24,environmentLightIntensity:.65,keyLightIntensity:2.8,keyLightColor:'#ffe6c7',environmentLightColor:'#c3d3e3'}},
  {id:'water',title:'双列生化污水处理与再生水厂',accent:'#28746b',theme:'light-industrial',footprint:[82,72],flow:'格栅配水 → 双列缺氧/好氧 → 双二沉池 → 过滤消毒 → 回用 / 污泥处理',summary:'开放式土建厂区，以双列矩形池、双圆形二沉池、道路绿化和厂务建筑组织空间；主水线、回流污泥及泥线分开表达。',settings:{backgroundColor:'#dce1d5',cameraView:'isometric',cameraFov:35,modelScale:1.26,environmentLightIntensity:.75,keyLightIntensity:2.65,keyLightColor:'#fff2d9',environmentLightColor:'#e1ecf0'}},
  {id:'cooling',title:'三塔双回路工业循环水站',accent:'#bd623f',theme:'command-gold',footprint:[58,48],flow:'三塔集水 → 四泵供水 → 双换热负载 → 热水回塔 / 旁滤、补水、排污',summary:'高塔、低位泵列和双层管廊组成公用工程站；一格塔体和换热器局部剖切，供回水与水量损失去向清晰。',settings:{backgroundColor:'#d7dcdf',cameraView:'isometric',cameraFov:36,modelScale:1.23,environmentLightIntensity:.65,keyLightIntensity:2.8,keyLightColor:'#fff4e0',environmentLightColor:'#d5e3f1'}},
];
const manifest={version:2,units:'meters',dataLabel:'虚构行业案例 / 模拟数据',simulation:'Process visualization with authored glTF animation; not CFD, engineering design or telemetry-driven fluid simulation.',cases:[]};
for(const c of cases){const record={...c,modules:[]};for(const def of defs.filter(d=>d.caseId===c.id))record.modules.push(await exportModule(c.id,def));
  assert.ok(record.modules.length<=24);assert.ok(record.modules.reduce((sum,m)=>sum+m.bytes,0)<150*1024*1024);manifest.cases.push(record);}
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(`Generated ${defs.length} v2 modules in ${output}`);
