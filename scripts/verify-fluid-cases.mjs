// Validate actual saved pages and the GLB animation targets; no project writes.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const dir=join(root,'demo-assets/fluid-cases'),qa=join(dir,'qa');mkdirSync(qa,{recursive:true});
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'))),links=JSON.parse(readFileSync(join(dir,'local-projects.json')));
const require=createRequire(join(root,'apps/web/package.json')),T=require('three');
const three=dirname(dirname(require.resolve('three')));
const {GLTFLoader}=await import(pathToFileURL(join(three,'examples/jsm/loaders/GLTFLoader.js')));
const report={models:[],pages:[]};
for(const c of manifest.cases)for(const m of c.modules){
  const data=readFileSync(join(dir,m.filename));
  const model=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
  assert.equal(model.animations.length,m.animationCount);
  const mixer=new T.AnimationMixer(model.scene);for(const clip of model.animations)mixer.clipAction(clip).play();
  const state=()=>{const result=[];model.scene.traverse(n=>{result.push(...n.position.toArray(),...n.scale.toArray(),...n.quaternion.toArray(),...(n.morphTargetInfluences??[]));});return result;};
  mixer.setTime(0);const start=state();mixer.setTime(1.37);const middle=state();mixer.setTime(12);const end=state();
  assert.ok(middle.every(Number.isFinite),`${m.filename}: nonfinite animation`);
  assert.ok(start.every((v,i)=>Math.abs(v-end[i])<1e-5),`${m.filename}: loop seam`);
  if(model.animations.length)assert.ok(start.some((v,i)=>Math.abs(v-middle[i])>1e-4),`${m.filename}: animation does not change the scene`);
  let meshes=0,triangles=0;model.scene.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;}});
  report.models.push({case:c.id,module:m.id,meshInstances:meshes,triangles,animated:!!model.animations.length,loopVerified:true});mixer.stopAllAction();
}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
try{
  const context=await browser.newContext({viewport:{width:1680,height:1050},deviceScaleFactor:1});
  const admin=JSON.parse(readFileSync(join(root,'deploy/local/.local/admin.json')));
  const login=await context.request.post('http://127.0.0.1:18080/api/v1/auth/login',{data:admin,headers:{Origin:'http://127.0.0.1:18080'}});assert.equal(login.status(),200);
  const page=await context.newPage();
  for(const [i,entry] of links.entries()){
    const id=manifest.cases[i].id;
    for(const mode of ['scene','dashboard']){
      const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
      await page.goto(entry[`${mode}Url`]);await page.locator('canvas').first().waitFor({state:'visible',timeout:30000});
      await page.waitForTimeout(3500);
      if(mode==='scene')await page.getByText(`🟢 在线 ${manifest.cases[i].modules.filter(m=>!m.background).length} 台 · 字段映射与 3D 状态已生效`,{exact:true}).waitFor({timeout:20000});
      assert.equal(await page.locator('canvas').count(),1,'Each view must use one shared renderer');
      const body=await page.locator('body').innerText();
      assert.ok(body.includes(entry.name));assert.ok(!/项目加载失败|模型加载失败|图形上下文已丢失|数据失联|数据陈旧|正在重连/.test(body));assert.deepEqual(errors,[]);
      await page.screenshot({path:join(qa,`${id}-${mode}.png`),fullPage:true});
      if(mode==='scene'){
        const first=await page.locator('canvas').screenshot();await page.waitForTimeout(900);const second=await page.locator('canvas').screenshot();
        assert.notDeepEqual(first,second,`${id}: animated frame must change while camera is fixed`);
        await page.locator('.twin-asset-row').first().click();
        await page.locator('.runtime-metric-card').first().waitFor({timeout:10000});
        assert.ok((await page.locator('.runtime-detail-panel').innerText()).includes('模拟数据 · 非真实生产数据'));
        await page.screenshot({path:join(qa,`${id}-device-detail.png`),fullPage:true});
      }
      report.pages.push({case:id,mode,url:entry[`${mode}Url`],canvasCount:1,errors,animationVisible:mode==='scene'});
      page.off('pageerror',onError);console.log(`Verified browser ${id}/${mode}`);
    }
  }
  writeFileSync(join(qa,'verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.models.reduce((summary,m)=>{const row=summary[m.case]??={meshes:0,triangles:0};row.meshes+=m.meshInstances;row.triangles+=m.triangles;return summary;},{})));
}finally{await browser.close();}
