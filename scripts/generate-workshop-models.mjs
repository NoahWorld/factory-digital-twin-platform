// Original, procedural workshop kit. No third-party model or texture assets.
// Run: node scripts/generate-workshop-models.mjs
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorkshopFloor } from './workshop-floor.mjs';
import { embedSurfaceTextures } from './workshop-surface-textures.mjs';
import { checkWorkshopMotion } from './workshop-motion-check.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'apps/web/package.json'));
const THREE = require('three');
const threeRoot = dirname(dirname(require.resolve('three')));
const { GLTFExporter } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/exporters/GLTFExporter.js')));
const { RoundedBoxGeometry } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/geometries/RoundedBoxGeometry.js')));
// GLTFExporter uses FileReader for Blob serialization; Node supplies Blob only.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }, error => this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }, error => this.onerror?.(error)); }
};
const out = join(root, 'apps/web/public/models/workshop');
mkdirSync(out, { recursive: true });
const palette = {
  ivory: '#9babb0', dark: '#1c242a', steel: '#7b8588', orange: '#b9510b', blue: '#294959',
  rubber: '#151719', carton: '#956d43', tape: '#b99c66', yellow: '#d49c19', green: '#38554a',
  red: '#c72d20', screen: '#297d85', floor: '#586166', white: '#bfc7c4', glass: '#182e39',
};
const materials = Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, new THREE.MeshStandardMaterial({
  name: key, color, roughness: key === 'steel' ? .32 : key === 'glass' ? .16 : .66,
  metalness: key === 'steel' ? .86 : ['blue', 'dark', 'orange', 'ivory'].includes(key) ? .28 : 0,
  ...(key === 'screen' ? { emissive: color, emissiveIntensity: .12 } : {}),
})]));
const geometries = new Map();
const geo = (key, build) => { if (!geometries.has(key)) geometries.set(key, build()); return geometries.get(key); };
let serial = 0;
function group(parent, name, p = [0, 0, 0]) {
  const object = new THREE.Group(); object.name = name; object.position.set(...p); parent?.add(object); return object;
}
function mesh(parent, name, geometry, material, p, r = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, materials[material]);
  object.name = `${name}_${String(++serial).padStart(4, '0')}`; object.position.set(...p); object.rotation.set(...r);
  parent.add(object); return object;
}
function box(parent, name, size, p, material = 'ivory', r) {
  const rounded = Math.min(...size) > .045 && Math.max(...size) < 5;
  return mesh(parent, name, geo(`box:${size}`, () => rounded
    ? new RoundedBoxGeometry(...size, 2, Math.min(.025, Math.min(...size) * .12))
    : new THREE.BoxGeometry(...size)), material, p, r);
}
function cylinder(parent, name, radius, length, p, material = 'steel', r, top = radius) {
  return mesh(parent, name, geo(`cyl:${radius}:${top}:${length}`, () => new THREE.CylinderGeometry(top, radius, length, 32)), material, p, r);
}
function hose(parent, name, points, radius = .025, material = 'rubber') {
  return mesh(parent, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 24, radius, 8, false), material, [0,0,0]);
}
function jointDetail(parent, p, radius) {
  for (let i = 0; i < 8; i++) cylinder(parent, 'joint_bolt', .022, .023,
    [p[0] + Math.cos(i * Math.PI / 4) * radius, p[1] + Math.sin(i * Math.PI / 4) * radius, p[2]], 'steel', [Math.PI/2,0,0]);
}
function labelPlate(parent, p, size = [.22, .13, .012]) {
  box(parent, 'identification_plate', size, p, 'white');
  for (let i = 0; i < 5; i++) box(parent, 'barcode', [.012 + i % 2 * .006, size[1] * .6, .004], [p[0] - size[0] * .32 + i * size[0] * .13, p[1], p[2] + .009], 'dark');
}
function crate(parent, p = [0, 0, 0]) {
  const g = group(parent, `carton_${++serial}`, p);
  box(g, 'corrugated_cardboard', [.68, .5, .48], [0, .25, 0], 'carton');
  box(g, 'packing_tape_top', [.085, .006, .486], [0, .504, 0], 'tape');
  box(g, 'packing_tape_front', [.085, .5, .006], [0, .25, .244], 'tape');
  labelPlate(g, [.18, .3, .246], [.18, .12, .01]); return g;
}
function beacon(parent, p = [0, 0, 0]) {
  const g = group(parent, `beacon_${++serial}`, p);
  cylinder(g, 'mount', .10, .055, [0, .028, 0], 'dark');
  cylinder(g, 'pole', .025, .24, [0, .16, 0]);
  for (const [i, color] of ['green', 'yellow', 'red'].entries()) {
    cylinder(g, 'signal', .069, .09, [0, .33 + i * .115, 0], color);
    cylinder(g, 'separator', .074, .025, [0, .39 + i * .115, 0], 'dark');
  }
  return g;
}
const definitions = [
  ['robot-arm', '工业机械臂', '橙色关节机械臂，带夹爪、基座和摆臂循环。', g => {
    box(g, 'anchored_base', [.85, .14, .85], [0, .07, 0], 'dark');
    for (const x of [-.34, .34]) for (const z of [-.34, .34]) cylinder(g, 'anchor_bolt', .035, .035, [x, .155, z]);
    cylinder(g, 'pedestal', .27, .44, [0, .35, 0], 'orange');
    const pivot = group(g, 'robot_turret', [0, .57, 0]);
    cylinder(pivot, 'shoulder', .23, .38, [0, .12, 0], 'dark', [Math.PI / 2, 0, 0]);
    jointDetail(pivot, [0,.12,.204], .17);
    const upper = group(pivot, 'robot_upper_arm', [0, .13, 0]); upper.rotation.z = -.45;
    box(upper, 'upper_link', [.26, .86, .25], [0, .43, 0], 'orange');
    cylinder(upper, 'elbow_joint', .18, .34, [0, .89, 0], 'dark', [Math.PI / 2, 0, 0]);
    jointDetail(upper, [0,.89,.182], .125);
    box(upper, 'arm_cover', [.20,.60,.02], [0,.44,.139], 'steel');
    hose(upper, 'arm_cable', [[-.17,.04,-.2],[-.24,.32,-.21],[-.22,.72,-.2],[0,.89,-.20]]);
    const fore = group(upper, 'robot_forearm', [0, .89, 0]); fore.rotation.z = -1.25;
    box(fore, 'fore_link', [.19, .72, .20], [0, .36, 0], 'orange');
    hose(fore, 'tool_supply_hose', [[-.12,0,-.12],[-.19,.30,-.17],[-.15,.66,-.17],[0,.83,-.12]], .021);
    labelPlate(fore, [0,.40,.11], [.13,.22,.012]);
    cylinder(fore, 'wrist', .115, .22, [0, .79, 0], 'steel');
    box(fore, 'gripper_mount', [.34, .10, .18], [0, .94, 0], 'dark');
    for (const x of [-.13, .13]) box(fore, 'gripper_finger', [.05, .22, .14], [x, 1.09, 0], 'steel');
    const q = angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle).toArray();
    return [new THREE.AnimationClip('robot_pick_and_place', 8, [new THREE.QuaternionKeyframeTrack('robot_turret.quaternion', [0, 2, 4, 6, 8], [q(-.45), q(.45), q(.45), q(-.45), q(-.45)].flat())])];
  }],
  ['agv', '移动 AGV', '双向移动运输车，轮组、激光雷达、货台与 16 秒往返动画。', g => {
    const body = group(g, 'agv_motion');
    box(body, 'underbody', [1.05, .18, 1.4], [0, .21, 0], 'dark');
    box(body, 'chassis', [1.1, .27, 1.45], [0, .43, 0], 'orange');
    box(body, 'deck', [1.03, .07, 1.37], [0, .61, 0], 'steel');
    for (const x of [-.52, .52]) for (const z of [-.43, .43]) cylinder(body, 'wheel', .16, .10, [x, .17, z], 'rubber', [0, 0, Math.PI / 2]);
    for (const z of [-.74, .74]) {
      box(body, 'bumper', [1.06, .11, .065], [0, .31, z], 'rubber');
      box(body, 'status_strip', [.54, .035, .014], [0, .5, z], 'green');
    }
    cylinder(body, 'lidar_base', .10, .05, [0, .68, -.56], 'dark');
    cylinder(body, 'lidar_sensor', .07, .065, [0, .735, -.56], 'screen');
    crate(body, [0, .65, .07]);
    return [new THREE.AnimationClip('agv_bidirectional_shuttle', 16, [new THREE.VectorKeyframeTrack('agv_motion.position', [0, 2, 7, 9, 14, 16], [0,0,0, 0,0,0, 0,0,5.5, 0,0,5.5, 0,0,0, 0,0,0])])];
  }],
  ['rack', '仓储货架', '蓝色立柱、橙色横梁的三层货架，可单独摆放箱子。', g => {
    for (const x of [-1.38, 1.38]) for (const z of [-.48, .48]) {
      box(g, 'rack_post', [.095, 2.65, .095], [x, 1.325, z], 'blue');
      box(g, 'foot', [.22, .045, .22], [x, .025, z], 'dark');
    }
    for (const y of [.18, 1.05, 1.92]) {
      for (const z of [-.48, .48]) box(g, 'load_beam', [2.82, .13, .09], [0, y, z], 'orange');
      box(g, 'shelf', [2.74, .06, 1], [0, y + .09, 0], 'steel');
    }
    for (const x of [-1.38, 1.38]) box(g, 'cross_brace', [.04, 2.5, .04], [x, 1.32, 0], 'steel', [.33, 0, 0]);
  }],
  ['box', '包装箱', '带封箱胶带和条码的纸箱，0.68 × 0.48 × 0.5 米。', g => { crate(g); }],
  ['workbench', '生产长桌', '钢制长工作台，带下层板、脚垫和操作面板。', g => {
    box(g, 'worktop', [3.6, .09, 1.05], [0, .91, 0], 'steel');
    for (const x of [-1.55, 1.55]) for (const z of [-.38, .38]) {
      box(g, 'leg', [.10, .86, .10], [x, .43, z], 'blue');
      box(g, 'foot_pad', [.16, .04, .16], [x, .02, z], 'rubber');
    }
    box(g, 'bottom_shelf', [3.2, .055, .8], [0, .29, 0], 'steel');
    box(g, 'control_panel', [.42, .33, .12], [1.25, 1.11, -.36], 'dark', [-.2, 0, 0]);
    box(g, 'display', [.32, .21, .015], [1.25, 1.12, -.28], 'screen');
    for (const x of [-.7, 0, .7]) box(g, 'work_tray', [.44, .04, .40], [x, .98, 0], 'green');
  }],
  ['partition', '车间隔间', '三米宽铝框隔断，下部墙板、上部蓝灰观察窗。', g => {
    box(g, 'lower_panel', [3, 1.05, .10], [0, .525, 0], 'ivory');
    box(g, 'glazing', [2.83, 1.40, .045], [0, 1.80, 0], 'glass');
    for (const x of [-1.5, 0, 1.5]) box(g, 'mullion', [.065, 2.55, .13], [x, 1.275, 0], 'steel');
    for (const y of [.04, 1.04, 2.53]) box(g, 'crossbar', [3.06, .065, .13], [0, y, 0], 'steel');
  }],
  ['door', '工业门', '带观察窗、门框与把手的单扇工业门。', g => {
    for (const x of [-.67, .67]) box(g, 'jamb', [.10, 2.5, .22], [x, 1.25, 0], 'steel');
    box(g, 'lintel', [1.44, .1, .22], [0, 2.5, 0], 'steel');
    box(g, 'door_leaf', [1.20, 2.4, .08], [0, 1.2, 0], 'blue');
    box(g, 'window_frame', [.80, .78, .025], [0, 1.72, .058], 'dark');
    box(g, 'window', [.68, .66, .026], [0, 1.72, .075], 'glass');
    cylinder(g, 'handle', .025, .28, [.43, 1.04, .13], 'steel');
    for (const y of [.35, 1.2, 2.05]) cylinder(g, 'hinge', .035, .14, [-.6, y, .06], 'steel');
  }],
  ['column', '厂房立柱', '带底座、黄色防撞保护和柱帽的钢结构柱。', g => {
    box(g, 'baseplate', [.62, .10, .62], [0, .05, 0], 'dark');
    box(g, 'column', [.38, 3.8, .38], [0, 1.95, 0], 'ivory');
    box(g, 'impact_guard', [.46, .65, .46], [0, .425, 0], 'yellow');
    for (const y of [.22, .44, .66]) box(g, 'guard_band', [.47, .07, .47], [0, y, 0], 'dark');
    box(g, 'capital', [.65, .16, .65], [0, 3.85, 0], 'steel');
  }],
  ['wall', '模块墙体', '三米宽、三米高的浅色墙板，含踢脚线和顶部压条。', g => {
    box(g, 'wall_panel', [3, 3, .18], [0, 1.5, 0], 'ivory');
    box(g, 'skirting', [3, .15, .20], [0, .075, 0], 'blue');
    box(g, 'top_trim', [3, .065, .20], [0, 2.97, 0], 'steel');
  }],
  ['alarm-light', '三色报警灯', '红黄绿塔灯，带安装底座与金属支杆。', g => { beacon(g); }],
  ['wall-camera', '墙壁监控摄像头', '枪式摄像头，带墙壁支架、遮雨罩和镜头。', g => {
    box(g, 'wall_mount', [.16, .24, .055], [0, .12, 0], 'steel');
    box(g, 'bracket', [.065, .065, .32], [0, .08, .17], 'steel');
    cylinder(g, 'swivel', .055, .12, [0, .14, .30], 'dark');
    const head = group(g, 'camera_head', [0, .23, .32]); head.rotation.x = .18;
    box(head, 'housing', [.19, .15, .38], [0, 0, 0]);
    box(head, 'rain_hood', [.23, .025, .46], [0, .09, .025]);
    cylinder(head, 'lens_body', .067, .035, [0, 0, .21], 'dark', [Math.PI / 2, 0, 0]);
    cylinder(head, 'lens_glass', .043, .037, [0, 0, .216], 'screen', [Math.PI / 2, 0, 0]);
  }],
  ['production-machine', '自动加工设备', '封闭式生产设备，带检视窗、触屏、通风格栅和输送入口。', g => {
    box(g, 'base', [2.05, .22, 1.25], [0, .16, 0], 'dark');
    box(g, 'machine_body', [2.0, 1.32, 1.18], [0, .90, 0]);
    box(g, 'inspection_window_frame', [1.18, .66, .04], [-.2, 1.10, .61], 'dark');
    box(g, 'inspection_window', [1.03, .52, .045], [-.2, 1.10, .638], 'glass');
    box(g, 'display_frame', [.32, .42, .075], [.72, 1.16, .65], 'dark');
    box(g, 'display', [.24, .25, .02], [.72, 1.20, .70], 'screen');
    box(g, 'door_seam', [.018,1.16,.014], [.42,.94,.615], 'dark');
    cylinder(g, 'door_handle', .025, .35, [.34,1.08,.70]);
    for (const x of [-.93,.93]) for (const y of [.32,1.46]) cylinder(g, 'panel_fastener', .016,.023,[x,y,.612],'steel',[Math.PI/2,0,0]);
    box(g, 'service_panel', [.70,.42,.025], [-.28,.46,-.603], 'dark');
    for (let i=0;i<5;i++) box(g, 'screen_readout', [.14-i*.016,.012,.009], [.72,1.27-i*.036,.714], 'white');
    labelPlate(g,[-.76,1.39,.62],[.18,.10,.012]);
    cylinder(g, 'emergency_stop', .042, .035, [.72, .93, .71], 'red', [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 7; i++) box(g, 'vent', [.06, .32, .02], [-.75 + i * .13, .49, .61], 'dark');
    for (const x of [-1.22, 1.22]) box(g, 'conveyor', [.50, .09, .65], [x, .79, 0], 'green');
    beacon(g, [.78, 1.58, -.36]);
  }],
  ['floor', '车间地坪与通道', '28 × 20 米地坪，含区域底色、黄色 AGV 通道线与停车位。', g => {
    g.add(createWorkshopFloor(THREE, materials));
  }],
  ['conveyor', '滚筒输送线', '金属滚筒、侧梁、电机、支撑腿与末端挡块。', g => {
    for (const x of [-.44,.44]) box(g,'side_rail',[.10,.18,2.6],[x,.84,0],'blue');
    for (let z=-1.12;z<1.2;z+=.16) cylinder(g,'roller',.065,.78,[0,.87,z],'steel',[0,0,Math.PI/2]);
    for (const x of [-.38,.38]) for (const z of [-.95,.95]) {
      box(g,'leg',[.08,.75,.08],[x,.375,z],'steel');
      box(g,'foot',[.16,.04,.16],[x,.02,z],'dark');
    }
    cylinder(g,'drive_motor',.13,.30,[.63,.70,-.90],'dark',[0,0,Math.PI/2]);
    box(g,'guard',[.07,.27,2.6],[-.51,.94,0],'yellow');
  }],
  ['tool-cabinet', '工位工具柜', '多层抽屉、金属把手、锁孔、脚轮与台面。', g => {
    box(g,'housing',[.92,1.0,.65],[0,.62,0],'blue');
    box(g,'top',[1,.045,.71],[0,1.15,0],'steel');
    for (let y=.33;y<1.1;y+=.19) {
      box(g,'drawer',[.82,.16,.025],[0,y,.34],'dark');
      box(g,'pull',[.52,.025,.04],[0,y+.045,.38],'steel');
    }
    for (const x of [-.33,.33]) for (const z of [-.23,.23]) cylinder(g,'caster',.075,.06,[x,.075,z],'rubber',[0,0,Math.PI/2]);
    labelPlate(g, [.24,1.04,.354],[.16,.09,.013]);
  }],
  ['safety-fence', '机械臂安全围栏', '钢框防护网、立柱、防撞黄边与独立底座。', g => {
    for (const x of [-1.1,1.1]) {
      box(g,'post',[.07,1.65,.07],[x,.825,0],'yellow');
      box(g,'foot',[.22,.035,.25],[x,.018,0],'steel');
    }
    for (const y of [.20,1.56]) box(g,'rail',[2.2,.05,.055],[0,y,0],'dark');
    for(let x=-1.04;x<1.1;x+=.13) box(g,'vertical_mesh',[.009,1.33,.009],[x,.88,0],'dark');
    for(let y=.27;y<1.55;y+=.13) box(g,'horizontal_mesh',[2.1,.009,.009],[0,y,0],'dark');
    box(g,'warning_plate',[.22,.20,.025],[0,1.25,.022],'yellow');
    box(g,'warning_mark',[.026,.11,.01],[0,1.28,.04],'dark');
  }],
  ['pallet', '木托盘与周转物料', '木托盘、支撑墩、绑带及低矮物料箱。', g => {
    for(const x of [-.48,0,.48]) for(const z of [-.4,0,.4]) box(g,'block',[.16,.11,.14],[x,.075,z],'carton');
    for(const z of [-.4,0,.4]) box(g,'base_slat',[1.2,.028,.13],[0,.014,z],'carton');
    for(let z=-.44;z<.5;z+=.18) box(g,'deck_slat',[1.2,.028,.14],[0,.144,z],'carton');
    box(g,'shipping_case',[1.0,.64,.74],[0,.485,0],'carton');
    for(const x of [-.3,.3]) {
      box(g,'strap_top',[.035,.008,.75],[x,.809,0],'dark');
      box(g,'strap_front',[.035,.64,.009],[x,.485,.375],'dark');
    }
    labelPlate(g,[0,.53,.38],[.24,.18,.012]);
  }],
  ['electrical-cabinet', '配电控制柜', '双门控制柜、风扇格栅、操作按钮和安全标牌。', g => {
    box(g,'plinth',[1.35,.12,.57],[0,.06,0],'dark');
    box(g,'enclosure',[1.30,2.05,.50],[0,1.145,0],'ivory');
    for(const x of [-.32,.32]) {
      box(g,'door',[.61,1.94,.022],[x,1.145,.267],'steel');
      cylinder(g,'latch',.018,.19,[x+.19,1.15,.30]);
      for(let y=.35;y<.63;y+=.045) box(g,'vent',[.36,.012,.015],[x,y,.286],'dark');
      box(g,'danger_label',[.12,.14,.012],[x,1.66,.288],'yellow');
    }
    box(g,'hmi',[.27,.19,.025],[-.31,1.90,.30],'dark');
    box(g,'hmi_screen',[.21,.13,.01],[-.31,1.90,.319],'screen');
  }],
  ['air-compressor', '压缩空气机组', '储气罐、压缩机、电机、压力表与软管。', g => {
    cylinder(g,'air_receiver',.34,1.45,[0,.60,0],'blue',[0,0,Math.PI/2]);
    for(const x of [-.57,.57]) box(g,'saddle',[.20,.30,.50],[x,.15,0],'dark');
    box(g,'motor_platform',[1.1,.07,.45],[0,.99,0],'steel');
    cylinder(g,'motor',.19,.5,[-.25,1.23,0],'dark',[0,0,Math.PI/2]);
    for(let x=.06;x<.5;x+=.06) box(g,'cooling_fin',[.025,.28,.38],[x,1.20,0],'steel');
    cylinder(g,'gauge',.10,.06,[.54,1.22,.27],'steel',[Math.PI/2,0,0]);
    cylinder(g,'gauge_face',.08,.065,[.54,1.22,.274],'white',[Math.PI/2,0,0]);
    hose(g,'air_line',[[.65,.65,.2],[.88,.72,.15],[.90,1.12,.08],[.45,1.13,.08]],.025);
  }],
  ['fire-station', '消防与清洁站', '红色消防箱、灭火器、管线卷盘和警示牌。', g => {
    box(g,'cabinet',[.74,1.28,.25],[0,.68,0],'red');
    box(g,'glass_front',[.58,.94,.025],[0,.74,.145],'glass');
    cylinder(g,'hose_reel',.25,.12,[0,.83,.03],'red',[Math.PI/2,0,0]);
    cylinder(g,'extinguisher',.09,.49,[.55,.27,.03],'red');
    hose(g,'hose',[[.55,.53,.03],[.71,.60,.03],[.72,.30,.02]],.015);
    box(g,'notice',[.48,.19,.02],[0,1.47,0],'red');
    box(g,'notice_cross',[.05,.13,.015],[0,1.47,.022],'white');
    box(g,'notice_cross',[.13,.05,.015],[0,1.47,.023],'white');
  }],
  ['utility-gantry', '架空管线与工位照明', '开放式钢构架、桥架、压缩空气主管与条形灯具。', g => {
    for (const x of [-3.25,3.25]) box(g,'upright',[.10,3.25,.10],[x,1.625,0],'dark');
    box(g,'crossbeam',[6.6,.14,.12],[0,3.24,0],'steel');
    for(const z of [-.14,.14]) box(g,'cable_tray',[6.6,.08,.04],[0,3.34,z],'dark');
    for(let x=-3.1;x<3.2;x+=.35) box(g,'tray_rung',[.04,.025,.30],[x,3.31,0],'steel');
    cylinder(g,'air_main',.037,6.65,[0,3.51,0],'blue',[0,0,Math.PI/2]);
    for(const x of [-1.8,1.8]) {
      box(g,'luminaire',[1.3,.075,.16],[x,3.10,.16],'dark');
      box(g,'diffuser',[1.22,.018,.13],[x,3.054,.16],'white');
    }
  }],
];

// Geometry-derived SVG previews: same meshes/materials as GLB, no stock imagery.
function thumbnail(scene) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene), center = bounds.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 1000);
  camera.position.copy(center).add(new THREE.Vector3(1.5, 1.1, 1.8).normalize().multiplyScalar(bounds.getSize(new THREE.Vector3()).length() * 1.8));
  camera.lookAt(center); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const faces = [], points = [];
  const light = new THREE.Vector3(-.4, 1, .7).normalize();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const a = o.geometry.attributes.position, idx = o.geometry.index;
    for (let i = 0; i < (idx?.count ?? a.count); i += 3) {
      const v = [0,1,2].map(k => new THREE.Vector3().fromBufferAttribute(a, idx ? idx.getX(i+k) : i+k).applyMatrix4(o.matrixWorld));
      const normal = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
      if (normal.dot(camera.position.clone().sub(v[0])) <= 0) continue;
      const shade = .55 + .45 * Math.max(0, normal.dot(light));
      const material = Array.isArray(o.material)
        ? o.material[o.geometry.groups.find(group => i >= group.start && i < group.start + group.count)?.materialIndex]
        : o.material;
      if (!material?.color) throw new Error(`Thumbnail material missing for ${o.name}, triangle ${i / 3}`);
      const color = material.color.clone().multiplyScalar(shade).getHexString();
      const projected = v.map(p => p.clone().project(camera)); points.push(...projected);
      faces.push({ p: projected, color, depth: v.reduce((s,p) => s+p.distanceToSquared(camera.position),0)/3 });
    }
  });
  const minX=Math.min(...points.map(p=>p.x)), maxX=Math.max(...points.map(p=>p.x));
  const minY=Math.min(...points.map(p=>p.y)), maxY=Math.max(...points.map(p=>p.y));
  const scale=Math.min(250/(maxX-minX),235/(maxY-minY));
  const polygons=faces.sort((a,b)=>b.depth-a.depth).map(f=>`<polygon points="${f.p.map(p=>`${(160+(p.x-(minX+maxX)/2)*scale).toFixed(2)},${(145-(p.y-(minY+maxY)/2)*scale).toFixed(2)}`).join(' ')}" fill="#${f.color}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 290"><rect width="320" height="290" rx="12" fill="#e6edf0"/>${polygons}</svg>`;
}
const versionFor = slug => slug === 'floor' ? 3 : 2;
const catalog = [], generatedFiles = [], modelSources = new Map();
for (const [slug, name, description, build] of definitions) {
  serial = 0;
  const scene = group(null, `workshop_${slug.replaceAll('-', '_')}`);
  scene.userData = { label: name, units: 'meters', upAxis: 'Y', origin: 'floor-center', proceduralVersion: versionFor(slug) };
  const animations = build(scene) ?? [];
  const bytes = embedSurfaceTextures(Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true, animations, onlyVisible: true })));
  modelSources.set(slug, { scene, animations });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const filename = `${slug}.${sha256.slice(0,12)}.glb`;
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const names = document.nodes.map(n=>n.name);
  if (!names.every(Boolean) || new Set(names).size !== names.length) throw new Error(`${slug}: duplicate/unnamed nodes`);
  generatedFiles.push([join(out, filename), bytes], [join(out, `${slug}-v${versionFor(slug)}.svg`), thumbnail(scene)]);
  catalog.push({ id: `builtin:workshop-${slug}-v${versionFor(slug)}`, name, description, contentPath: `/models/workshop/${filename}`,
    thumbnailPath: `/models/workshop/${slug}-v${versionFor(slug)}.svg`, originalFilename: `${name}.glb`, format: 'glb', contentType: 'model/gltf-binary',
    byteSize: bytes.length, sha256, createdAt: '2026-09-09T00:00:00.000Z',
    inspection: { format:'glb', gltfVersion:'2.0', sceneCount:1, nodeCount:document.nodes.length, meshCount:document.meshes.length,
      materialCount:document.materials.length, textureCount:document.textures.length, imageCount:document.images.length, animationCount:animations.length,
      namedNodeCount:names.length, duplicateNodeNames:[], externalResourceCount:0 },
    defaults: { backgroundColor:'#142332', backgroundOpacity:1, environmentLightColor:'#e4efff', environmentLightIntensity:1.5,
      keyLightColor:'#fff3db', keyLightIntensity:2.5, cameraFov:38, cameraView:'isometric', modelScale:1,
      autoRotate:false, playAnimations:true, animationSpeed:1,
      presentation:{ lighting:'studio', shellMode:'original', showFlow:true, explosion:0 } },
  });
}
// Never change the bytes under an already registered versioned ID.
const manifest = join(root, 'shared/workshop-models.ts');
if (existsSync(manifest)) {
  const previous = JSON.parse(readFileSync(manifest,'utf8').split(' = ')[1].split(' as const;')[0]);
  for (const item of catalog) {
    const old = previous.find(m=>m.id===item.id);
    if (old && old.sha256 !== item.sha256) throw new Error(`${item.id}: content changed; bump model version before replacing catalog`);
  }
}

const instances = [];
function place(slug, label, position, rotation=[0,0,0], scale=[1,1,1], background=false) {
  instances.push({ id:`workshop-${String(instances.length+1).padStart(3,'0')}`, modelAssetId:`builtin:workshop-${slug}-v${versionFor(slug)}`,
    label, assetId:null, visible:true, renderMode:background?'background':'interactive', sortOrder:instances.length,
    transform:{position,rotation,scale} });
}
place('floor','车间地坪 · 28 × 20 m',[0,0,0],undefined,undefined,true);
for (let x=-12.5; x<=12.5; x+=2.5) place('wall',`北侧墙 ${x}`,[x,0,-10],undefined,[2.5/3,1,1],true);
for (const x of [-14,14]) for (const z of [-7.5,-2.5,2.5,7.5]) place('wall',`侧墙 ${x}/${z}`,[x,0,z],[0,90,0],[5/3,.58,1],true);
for (const x of [-12,12]) for (const z of [-8,0,8]) place('column',`结构柱 ${x}/${z}`,[x,0,z],undefined,undefined,true);
for (const x of [-10,-5,0,5]) {
  place('rack',`仓储货架 ${x}`,[x,0,-8.4]);
  for (const [i,y] of [.31,1.18,2.05].entries()) for (const dx of [-.85,.85]) place('box',`货架箱 ${x}/${i}/${dx}`,[x+dx,y,-8.4]);
}
for (const [i,x] of [-5.3,5.3].entries()) for (const [j,z] of [-2.8,3.4].entries()) {
  place('production-machine',`产线 ${i+1}-${j+1} · 自动设备`,[x-1.35,0,z-.50]);
  place('robot-arm',`产线 ${i+1}-${j+1} · 机械臂`,[x+1.0,0,z], [0,0,0]);
  place('workbench',`产线 ${i+1}-${j+1} · 工作台`,[x-1.0,0,z+1.55]);
}
place('agv','AGV-01 · 中央运输通道',[0,0,-4.8]);
place('agv','AGV-02 · 东侧运输通道',[11,0,-4.8]);
place('partition','检验室 · 前隔断',[8.9,0,-6.0],undefined,[.95,1,1],true);
place('partition','检验室 · 左隔断',[7.45,0,-8],[0,90,0],[1.33,1,1],true);
place('door','检验室 · 工业门',[11.25,0,-6],undefined,undefined,true);
place('workbench','检验室 · 检验长桌',[10.7,0,-8.3],undefined,[.8,1,1]);
place('alarm-light','入口三色报警灯',[-12,1.8,7.7]);
for (const x of [-9,3,12]) place('wall-camera',`北墙监控 ${x}`,[x,2.55,-9.86]);
place('wall-camera','西墙监控',[-13.84,1.7,2],[0,90,0]);
for (const x of [-5.3,5.3]) for (const z of [-2.8,3.4]) {
  place('conveyor',`滚筒输送线 ${x}/${z}`,[x+2.70,0,z+1.10]);
  place('tool-cabinet',`工具柜 ${x}/${z}`,[x-3.05,0,z-.20]);
  place('safety-fence',`机械臂后侧围栏 ${x}/${z}`,[x+1.55,0,z-1.20]);
}
for(const x of [-10.8,-8.7,-6.6]) place('pallet',`入库待检物料 ${x}`,[x,0,7.5]);
for(const x of [-12.5,-10.7]) place('electrical-cabinet',`动力控制柜 ${x}`,[x,0,-5.45]);
place('air-compressor','压缩空气供应站',[-11.5,0,4.4]);
place('fire-station','西墙消防站',[-13.80,0,-1.2],[0,90,0]);
for(const x of [-5.3,5.3]) place('utility-gantry',`架空管线 ${x}`,[x,0,.20],undefined,undefined,true);
if (instances.length > 100) throw new Error(`Preset exceeds one-patch limit: ${instances.length}`);
const motionCheck = checkWorkshopMotion(THREE, instances, modelSources);
for (const [path, content] of generatedFiles) writeFileSync(path, content);
writeFileSync(manifest, `// Generated by scripts/generate-workshop-models.mjs; original procedural assets.\nexport const workshopModels = ${JSON.stringify(catalog,null,2)} as const;\n`);
const settings = { animationSpeed:1, autoRotate:false, backgroundColor:'#152431', backgroundOpacity:1, cameraFov:38,
  cameraView:'isometric', environmentLightColor:'#e0ecf5', environmentLightIntensity:.62,
  keyLightColor:'#fff2db', keyLightIntensity:2.1, modelScale:1.7, playAnimations:true, rotationSpeed:.35, showGrid:false };
writeFileSync(join(root,'shared/workshop-layout.ts'), `// Generated by scripts/generate-workshop-models.mjs. Editable instances, meters / Y-up.\nimport type { StandaloneSceneInstance, StandaloneSceneSettings } from './standalone-3d';\nexport const workshopSettings = ${JSON.stringify(settings,null,2)} satisfies StandaloneSceneSettings;\nexport const workshopInstances = ${JSON.stringify(instances,null,2)} satisfies StandaloneSceneInstance[];\n`);
const cost = { instances:instances.length, resources:catalog.length, uniqueBytes:catalog.reduce((s,m)=>s+m.byteSize,0),
  estimatedMeshInstances:instances.reduce((s,i)=>s+catalog.find(m=>m.id===i.modelAssetId).inspection.meshCount,0),
  animatedInstances:instances.filter(i=>catalog.find(m=>m.id===i.modelAssetId).inspection.animationCount>0).length };
writeFileSync(join(root,'demo-assets/workshop-kit-report.json'),JSON.stringify({units:'meters',upAxis:'Y',cost,motionCheck,models:catalog.map(m=>({id:m.id,path:m.contentPath,sha256:m.sha256,bytes:m.byteSize}))},null,2)+'\n');
console.log(JSON.stringify(cost,null,2));
