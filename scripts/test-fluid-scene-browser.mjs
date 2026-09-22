import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'fluid-scene-browser-'));
// This test creates and deletes only its own project against the existing local services.
const base='http://127.0.0.1:18080', web='http://127.0.0.1:5173';
const admin=JSON.parse(await readFile(root+'/deploy/local/.local/admin.json','utf8'));
let cookie='',projectId,browser,page; const errors=[];
async function api(path,method='GET',body,status=200){
 const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const value=await r.json(); assert.equal(r.status,status,JSON.stringify(value));return {value,r};
}
try {
 const login=await api('/auth/login','POST',admin);cookie=login.r.headers.get('set-cookie').split(';')[0];
 projectId=(await api('/projects','POST',{name:'临时流体组件浏览器验收',projectType:'3d'},201)).value.project.id;
 const scene=(await api(`/projects/${projectId}/scene`)).value.scene;
 assert.ok(Array.isArray(scene.fluids),'local backend must include new fluids contract');
 const settings={...scene.settings,autoRotate:false,playAnimations:true,backgroundColor:'#172033',backgroundOpacity:1};
 await api(`/projects/${projectId}/scene`,'PATCH',{expectedRevision:scene.revision,settings});
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
 const context=await browser.newContext({viewport:{width:1512,height:982}});
 const separator=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),domain:'127.0.0.1',path:'/'}]);
 page=await context.newPage();page.setDefaultTimeout(10000);
 // Isolate the browser's optional icon fetch from the scene regression.
 await page.route(web+'/favicon.ico',route=>route.fulfill({status:204,body:''}));
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
 await page.goto(web+`/#/projects/${projectId}/scene`);
 await page.getByRole('button',{name:/^图层/}).click();
 const canvas=page.locator('.model-3d-renderer canvas');await canvas.waitFor();
 const choose=async(name,option)=>{await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('listbox').getByRole('option',{name:option}).click();};
 const layer=page.getByRole('region',{name:'流体图层'});
 for (const [kind,index] of [['液体',0],['气体',1],['熔融体',2]]) {
   await page.getByRole('button',{name:'＋ '+kind,exact:true}).click();
   const box=await canvas.boundingBox();
   for(const [rx,ry] of [[.30,.59],[.49,.48],[.70,.60]]) await page.mouse.click(box.x+box.width*rx,box.y+box.height*(ry-index*.06));
   assert.equal(await page.getByRole('list',{name:'流体路径点'}).locator('li').count(),3);
   // A camera drag must not append a path point.
   if(index===0){await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.62,box.y+box.height*.41,{steps:5});await page.mouse.up();assert.equal(await page.getByRole('list',{name:'流体路径点'}).locator('li').count(),3);}
   await page.getByLabel('流体颜色',{exact:true}).fill(['#00aaff','#ccddff','#ff5511'][index]);
   if(index>0) await choose('表现形态','扩散流 · 沿流向扩散');
   if(index===2) await choose('流动方向','反向：末点 → 首点');
   await page.getByRole('button',{name:'应用流体',exact:true}).click();
   await page.waitForFunction(n=>JSON.parse(document.querySelector('.model-3d-renderer').dataset.sceneDiagnostics||'null')?.fluids.fluidCount===n,index+1);
 }
 await page.getByRole('button',{name:'保存场景',exact:true}).click();
 await page.getByText(/场景已保存为修订版/).waitFor();
 const saved=(await api(`/projects/${projectId}/scene`)).value.scene;
 assert.equal(saved.fluids.length,3);assert.deepEqual(saved.fluids.map(f=>f.kind),['liquid','gas','molten']);assert.equal(saved.fluids[2].direction,'reverse');assert.equal(saved.fluids[2].mode,'diffuse');assert.equal(saved.fluids[0].color,'#00aaff');assert.ok(saved.fluids.every(f=>f.points.length===3));
 await page.reload();await page.getByRole('button',{name:/^图层/}).click();
 await page.waitForFunction(()=>JSON.parse(document.querySelector('.model-3d-renderer')?.dataset.sceneDiagnostics||'null')?.fluids.fluidCount===3);
 assert.equal(await layer.locator('article').count(),3);
 // Click the visible midpoint of the first fluid using the actual shared camera diagnostic.
 const pixel=await page.evaluate(async points=>{
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const el=document.querySelector('.model-3d-renderer'), rect=el.querySelector('canvas').getBoundingClientRect(), d=JSON.parse(el.dataset.sceneDiagnostics);
  const camera=new THREE.PerspectiveCamera(45,rect.width/rect.height,.01,10000);camera.position.fromArray(d.cameraPosition);camera.lookAt(...d.cameraTarget);camera.updateMatrixWorld();
  const point=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))).getPointAt(.4).project(camera);
  return {x:rect.x+(point.x+1)*rect.width/2,y:rect.y+(1-point.y)*rect.height/2};
 },saved.fluids[0].points);
 await page.mouse.click(pixel.x,pixel.y);
 await page.getByRole('button',{name:'流体属性',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'流体属性',exact:true}).getAttribute('aria-pressed'),'true','clicking a fluid must preserve the fluid selection');
 await page.screenshot({path:join(artifacts,'editor.png')});
 await page.getByRole('link',{name:'预览',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(document.querySelector('.model-3d-renderer')?.dataset.sceneDiagnostics||'null')?.fluids.fluidCount===3);
 assert.equal(await page.locator('.fluid-editor').count(),0);
 const capture=await page.evaluate(async()=>{const {captureCoverSurface}=await import('/src/covers/render-surfaces.ts');return captureCoverSurface(document.querySelector('.model-3d-renderer canvas'));});
 await writeFile(join(artifacts,'cover.png'),Buffer.from(capture.split(',')[1],'base64'));
 await page.screenshot({path:join(artifacts,'preview.png')});
 assert.deepEqual(errors,[]);
 console.log('Browser captures:',artifacts);
 console.log('PASS real editor: mouse 3D paths, camera drag separation, three kinds and colors, reverse diffusion, save/reload, object selection, preview, registered cover capture.');
} catch(error) {
 console.error('FAILED',error);if(page){await page.screenshot({path:join(artifacts,'failure.png')});console.error((await page.locator('body').innerText()).slice(-7000));}process.exitCode=1;
} finally {
 try { await browser?.close(); } finally { if(projectId)await api(`/projects/${projectId}`,'DELETE'); }
}
