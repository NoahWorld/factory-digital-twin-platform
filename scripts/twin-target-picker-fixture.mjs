// Self-contained glTF fixtures. Numeric node names deliberately represent an
// imported model whose internal identifiers are unsuitable for a user interface.
const rectangle = (left, right, bottom, top) => new Float32Array([
  left, bottom, 0, right, bottom, 0, right, top, 0,
  left, bottom, 0, right, top, 0, left, top, 0,
]);
function gltf(nodes, rectangles, colors) {
  const chunks = rectangles.map(values => Buffer.from(values.buffer));
  let offset = 0;
  const bufferViews = chunks.map(bytes => {
    const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    offset += bytes.length;
    return view;
  });
  const bytes = Buffer.concat(chunks);
  return JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ name: 'fixture_scene', nodes: [0] }], nodes,
    meshes: rectangles.map((_, index) => ({ primitives: [{ attributes: { POSITION: index }, material: index }] })),
    materials: colors.map(color => ({ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 1 } })),
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews,
    accessors: rectangles.map((values, index) => ({ bufferView: index, componentType: 5126, count: values.length / 3, type: 'VEC3',
      min: [Math.min(...values.filter((_, i) => i % 3 === 0)), Math.min(...values.filter((_, i) => i % 3 === 1)), 0],
      max: [Math.max(...values.filter((_, i) => i % 3 === 0)), Math.max(...values.filter((_, i) => i % 3 === 1)), 0] })),
  });
}

export const projectId = 'twin-target-picker-browser-fixture';
export const modelFixture = gltf([
  { name: 'parent_7', extras: { label: '升降部件组' }, children: Array.from({ length: 212 }, (_, i) => i + 1) },
  { name: '007', mesh: 0 },
  { name: '008', mesh: 1 },
  ...Array.from({ length: 210 }, (_, i) => ({ name: String(1000 + i) })),
], [rectangle(-0.9, -0.05, -0.9, 0.9), rectangle(0.05, 0.9, -0.9, 0.9)], [[0.05, 0.6, 0.95, 1], [0.95, 0.4, 0.08, 1]]);
export const wallFixture = gltf([{ name: '遮挡墙', mesh: 0 }], [rectangle(-1.4, 1.4, -1.4, 1.4)], [[0.55, 0.6, 0.65, 1]]);

const instance = (id, label, modelAssetId, position, sortOrder, visible = true) => ({
  id, label, modelAssetId, sortOrder, assetId: '', visible, renderMode: 'interactive',
  animation: { enabled: false, speed: 1 },
  transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
});
export const scene = {
  projectId, revision: 1, linked2dProjectId: null, updatedAt: '2026-10-09T00:00:00.000Z',
  instances: [
    instance('first', '第一台设备', 'picker-model', [-2, 0, 0], 0),
    instance('second', '第二台设备', 'picker-model', [2, 0, 0], 1),
    instance('wall', '遮挡墙模型', 'picker-wall', [2, 0, 1], 2, false),
  ],
  settings: { animationSpeed: 1, autoRotate: false, backgroundColor: '#eaf2f8', backgroundOpacity: 1,
    cameraFov: 45, cameraView: 'front', preventBottomView: true,
    environmentLightColor: '#ffffff', environmentLightIntensity: 1,
    keyLightColor: '#ffffff', keyLightIntensity: 1, modelScale: 1,
    playAnimations: false, rotationSpeed: 1, showGrid: false },
};
export const config = {
  version: 1, enabled: false, source: 'api',
  connection: { protocol: 'rest', url: '/api/v1/test-business/handling-cell/state', timestampPath: 'timestamp', intervalMs: 500, timeoutMs: 5000 },
  points: [{ id: 'position', label: '设备位置', assetId: '', metricKey: 'position', sourcePath: 'position', unit: 'm',
    min: 0, max: 1, initialValue: 0, maxSpeed: 1, staleAfterMs: 3000 }],
  bindings: [{ id: 'move', label: '设备移动', pointId: 'position',
    target: { instanceId: 'first', modelAssetId: 'picker-model', nodeName: '007' },
    parentBindingId: null, useNodeRestPose: true, kind: 'translation', axis: [0, 1, 0],
    pivot: [0, 0, 0], valueScale: 1, valueOffset: 0, poses: [] }],
  colliders: [], collisionRules: [], procedures: [],
};

export function targetPickerFixtureEntry() {
  return `
import React, { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PerspectiveCamera, Vector3 } from 'three';
import { Model3DNode } from '/src/canvas/Model3DNode.tsx';
import { standaloneRendererNode } from '/src/canvas/standalone-renderer-node.ts';
import { TwinDriveEditor } from '/src/twin/TwinDriveEditor.tsx';
import { ThemeProvider } from '/src/theme/ThemeProvider.tsx';
import { NotificationProvider } from '/src/components/NotificationProvider.tsx';
import '/src/styles.css';
import '/src/theme/theme-palette.css';
const h = React.createElement;
const initialScene = ${JSON.stringify(scene)};
const config = ${JSON.stringify(config)};
const params = new URLSearchParams(location.search);
if (params.has('hidden')) initialScene.instances[0].visible = false;
if (params.has('missing')) config.bindings[0].target.instanceId = 'deleted-model';
const source = { getState: () => ({connected:false,snapshot:null}), subscribe: () => () => {} };
function App() {
  const [scene, setScene] = useState(initialScene);
  const [catalog, setCatalog] = useState([]);
  const [picker, setPicker] = useState(null);
  const [open, setOpen] = useState(true);
  const [document, setDocument] = useState({projectId:initialScene.projectId,revision:1,editable:!new URLSearchParams(location.search).has('readonly'),config});
  const node = useMemo(() => standaloneRendererNode(scene, 'picker-scene'), [scene]);
  const attachment = useMemo(() => ({config,source,onCatalog:setCatalog}), []);
  const onPick = useCallback(targets => { window.fixtureLastPick = targets; picker?.onPick(targets); }, [picker?.onPick]);
  const stageStyle = picker ? {left:picker.viewport.left,top:picker.viewport.top,width:picker.viewport.width,height:picker.viewport.height} : {position:'absolute',inset:0};
  window.fixtureCatalog = catalog;
  window.fixtureDocument = document;
  window.fixturePickerTarget = picker?.target ?? null;
  window.fixturePickerFocus = picker?.focusRequest ?? null;
  window.fixtureWallVisible = scene.instances.find(item => item.id === 'wall').visible;
  window.fixtureSetWall = visible => setScene(current => ({...current,instances:current.instances.map(item => item.id === 'wall' ? {...item,visible} : item)}));
  window.fixtureProject = coordinates => {
    const canvas = documentGlobal.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const diagnostics = JSON.parse(documentGlobal.querySelector('[data-scene-diagnostics]').dataset.sceneDiagnostics);
    const camera = new PerspectiveCamera(45, rect.width/rect.height, .01, 10000);
    camera.position.fromArray(diagnostics.cameraPosition);
    camera.lookAt(new Vector3(...diagnostics.cameraTarget));
    camera.updateMatrixWorld();
    const point = new Vector3(...coordinates).project(camera);
    return {x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};
  };
  return h('main',{className:'standalone-3d-editor'+(open?' is-configuring-twin':'')},
    h('section',{className:'standalone-3d-stage'+(picker?' is-twin-target-picking':''),style:stageStyle,'data-testid':'retained-stage'},
      h(Model3DNode,{node,projectId:initialScene.projectId,editable:true,interactive:true,
        maximumModelInstances:128,cameraControlsEnabled:!!picker,selectedSceneNodePath:null,
        onSceneNodeSelect:() => {window.fixtureOrdinaryPicks=(window.fixtureOrdinaryPicks||0)+1;},
        twinDrive:attachment,twinTargetSelection:picker?.target.nodeName ? picker.target : null,onTwinTargetPick:picker?onPick:undefined,
        modelFocusRequest:picker?.focusRequest ?? null}),
      h('button',{type:'button','data-testid':'underlying-tool'},'底层编辑工具')),
    open ? h(TwinDriveEditor,{document,scene,catalog,onSaved:setDocument,onClose:()=>setOpen(false),onTestChange:()=>{},
      onTargetPickerChange:setPicker,connectionTest:h('p',null,'隔离测试，不建立业务连接')}) : h('button',{type:'button',onClick:()=>setOpen(true)},'重新打开配置'));
}
const documentGlobal = document;
document.documentElement.dataset.uiTheme = 'light';
createRoot(document.getElementById('root')).render(h(ThemeProvider,{initialState:{preference:'light',systemTheme:'light',storageIssue:null}},h(NotificationProvider,null,h(App))));
`;
}
