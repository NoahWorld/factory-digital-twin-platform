import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(web.resolve('vite'));
// Isolated UI/iframe fixture; no application credentials, data or API calls.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cacheDir = await mkdtemp(join(tmpdir(), 'iot-embed-browser-'));
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useIotEmbed} from '/src/canvas/useIotEmbed.ts';
import {IotBindingInspector} from '/src/canvas/IotBindingInspector.tsx';
import {IotPointUnavailable} from '/src/canvas/IotPointUnavailable.tsx';
import {createCanvasNode} from '/src/canvas/types.ts';
import '/src/styles.css';
import '/src/canvas/iot-embed.css';
import '/src/theme/theme-palette.css';
const h=React.createElement;
const base={...createCanvasNode('metric-card',0,0,1),id:'temperature-widget'};
base.props.value='987654321';
const bound={...base,iotBinding:{pointKey:'temperature',valueType:'number',staleAfterSeconds:60}};
const invalid=new URLSearchParams(location.search).has('invalid');
if(invalid) bound.iotBinding.valueType='invalid';
if(new URLSearchParams(location.search).has('unbound')) delete bound.iotBinding;
const documentModel={projectId:'fixture',revision:1,nodes:[bound]};
function Preview(){
  const runtime=useIotEmbed(documentModel,true);
  const item=runtime.nodes[bound.id];
  return h('main',{id:'point',style:{width:320,height:150}},item?.unavailable?h(IotPointUnavailable,{node:bound,message:item.unavailable}):h('output',null,item?.node.props.value??'not rendered'));
}
function Editor(){
 const [node,setNode]=useState(base);
 const [error,setError]=useState(null);
 return h('main',null,h(IotBindingInspector,{node,document:{...documentModel,nodes:[node]},editable:true,onNodeChange:setNode,onValidationChange:setError}),h('output',{id:'binding'},JSON.stringify(node.iotBinding??null)),h('output',{id:'error'},error));
}
function App(){const [mounted,setMounted]=useState(true);return h(React.Fragment,null,h('button',{id:'unmount',onClick:()=>setMounted(value=>!value)},mounted?'Unmount':'Mount'),mounted?h(location.pathname.endsWith('editor')?Editor:Preview):null,h('div',{id:'compact-point',style:{width:160,height:48}},h(IotPointUnavailable,{node:createCanvasNode('plain-text',0,0,1),message:'数据已过期'})))}
document.documentElement.dataset.uiTheme='dark';
createRoot(document.getElementById('root')).render(h(React.StrictMode,null,h(App)));
`;
const server = await createServer({
  configFile: false, cacheDir, root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(process.env.IOT_EMBED_TEST_PORT || 5206), strictPort: true },
  plugins: [{ name: 'iot-embed-fixture',
    resolveId(id) { if (id === '/__iot_entry.js') return '\0iot-entry'; },
    load(id) { if (id === '\0iot-entry') return fixture; },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0];
      if (path === '/__iot_parent') {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><body><iframe id="frame" style="width:700px;height:420px"></iframe><script>
          window.messages=[];addEventListener('message',e=>messages.push(e.data));
          document.querySelector('iframe').src='/__iot_child?iotEmbed=1&parentOrigin='+encodeURIComponent(location.origin)+'#/share/fixture';
          window.send=data=>document.querySelector('iframe').contentWindow.postMessage(data,location.origin);
        </script></body></html>`); return;
      }
      if (path !== '/__iot_child' && path !== '/__iot_editor') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__iot_entry.js"></script></body></html>');
    }); },
  }],
});
let browser;
let deadline;
const envelope = { channel: 'kingdom.iot.points', version: 1, sessionId: 'browser-session' };
const msg = (type, fields = {}) => ({ ...envelope, type, ...fields });
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.setDefaultTimeout(10000);
  deadline = setTimeout(() => { console.error('IoT embed browser test exceeded 60 seconds'); void browser.close(); }, 60000);
  deadline.unref();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  await page.goto(`${origin}/__iot_parent`);
  const frame = page.frameLocator('#frame');
  await frame.locator('#point').waitFor();
  const child = page.frames().find(f => f.url().includes('/__iot_child'));
  const send = data => page.evaluate(data => window.send(data), data);
  const expectPoint = async value => { await frame.locator('#point').getByText(value, {exact:false}).waitFor(); };
  await expectPoint('等待 IoT 连接');
  await page.waitForFunction(()=>window.messages.some(m=>m.type==='request-hello'));
  assert.deepEqual(await page.evaluate(()=>window.messages.find(m=>m.type==='request-hello')),{channel:envelope.channel,version:envelope.version,type:'request-hello'});
  assert.equal(await frame.locator('#compact-point').evaluate(el=>{const content=el.querySelector('span').getBoundingClientRect();const bounds=el.getBoundingClientRect();return content.top>=bounds.top&&content.bottom<=bounds.bottom&&content.left>=bounds.left&&content.right<=bounds.right}),true,'minimum-height text nodes must keep their status visible');
  assert.doesNotMatch(await frame.locator('#point').innerText(), /987654321/);
  await child.evaluate(({ data, origin }) => {
    window.dispatchEvent(new MessageEvent('message', {source:window,origin,data}));
    window.dispatchEvent(new MessageEvent('message', {source:window.parent,origin:'https://wrong-origin.test',data}));
  }, { data:msg('hello'), origin });
  assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.type==='ready').length), 0);
  await send(msg('hello'));
  await page.waitForFunction(()=>window.messages.some(m=>m.type==='ready'));
  const ready = await page.evaluate(()=>window.messages.find(m=>m.type==='ready'));
  assert.deepEqual(ready, {...envelope,type:'ready',points:[{key:'temperature',valueType:'number',staleAfterSeconds:60}]});
  await send(msg('status',{status:'connected',retryCount:0}));
  await send(msg('snapshot',{values:[{key:'temperature',value:null,timestamp:0,quality:'unknown'}]}));
  await expectPoint('点位数据未知');
  await send(msg('updates',{values:[{key:'temperature',value:42,timestamp:Date.now(),quality:'good'}]}));
  await expectPoint('42');
  await send(msg('updates',{sessionId:'old-device',values:[{key:'temperature',value:999,timestamp:Date.now(),quality:'good'}]}));
  await send(msg('hello'));
  await page.waitForFunction(()=>window.messages.filter(m=>m.type==='ready').length===2);
  assert.equal(await frame.locator('#point output').innerText(),'42');
  await send(msg('status',{status:'reconnecting',retryCount:3,error:'socket closed'}));
  await expectPoint('网络异常／正在重连（第 3 次）');
  assert.doesNotMatch(await frame.locator('#point').innerText(), /987654321|42/);
  await send(msg('status',{status:'connected',retryCount:0}));
  await send(msg('snapshot',{values:[{key:'temperature',value:9,timestamp:Date.now()-61000,quality:'good'}]}));
  await expectPoint('数据已过期');
  await send(msg('updates',{values:[{key:'temperature',value:12,timestamp:0,quality:'good'}]}));
  await expectPoint('源时间戳无效');
  await send(msg('hello',{sessionId:'new-device'}));
  await expectPoint('等待 IoT 连接');
  await frame.locator('#unmount').click();
  const prior = await page.evaluate(()=>window.messages.length);
  await send(msg('hello',{sessionId:'after-unmount'}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>window.messages.length),prior);
  const requestsBeforeRemount=await page.evaluate(()=>window.messages.filter(m=>m.type==='request-hello').length);
  await child.evaluate(()=>{location.hash='#/projects/p/publications/v/run'});
  await frame.locator('#unmount').click();
  await page.waitForFunction(count=>window.messages.filter(m=>m.type==='request-hello').length>count,requestsBeforeRemount);
  await send(msg('hello',{sessionId:'remounted-scene'}));
  await page.waitForFunction(()=>window.messages.some(m=>m.type==='ready'&&m.sessionId==='remounted-scene'));
  await send(msg('status',{sessionId:'remounted-scene',status:'connected',retryCount:0}));
  await send(msg('updates',{sessionId:'remounted-scene',values:[{key:'temperature',value:64,timestamp:Date.now(),quality:'good'}]}));
  await expectPoint('64');
  await page.locator('#frame').evaluate((el, origin)=>{ el.src=`/__iot_child?iotEmbed=1&parentOrigin=${encodeURIComponent(origin)}&invalid=1#/projects/p/publications/v/run`; },origin);
  await frame.locator('#point').waitFor();
  await send(msg('hello'));
  await page.waitForFunction(()=>window.messages.some(m=>m.type==='ready'&&m.error));
  assert.match(await page.evaluate(()=>window.messages.find(m=>m.type==='ready'&&m.error).error),/点位类型/);
  for(const search of [`?iotEmbed=1&parentOrigin=${encodeURIComponent(origin)}&unbound=1`,'']) {
    await page.locator('#frame').evaluate((el, search)=>{window.messages=[];el.src='/__iot_child'+search+'#/share/fixture'},search);
    await frame.locator('#point').waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>window.messages.length),0,'unbound or standalone previews must not initiate IoT messages');
  }
  const editor = await browser.newPage();
  await editor.goto(`${origin}/__iot_editor`);
  await editor.getByLabel('使用 IoT 实时数据').check();
  await editor.locator('#error').getByText('点位名称须为').waitFor();
  await editor.getByLabel('画面点位名称').fill('inletTemperature');
  await editor.waitForFunction(()=>document.querySelector('#binding').textContent.includes('inletTemperature')&&document.querySelector('#error').textContent==='');
  assert.equal(await editor.locator('#error').innerText(),'');
  await editor.getByLabel('数据过期时间（秒）').fill('0');
  await editor.locator('#error').getByText('数据过期时间须为').waitFor();
  await editor.getByLabel('使用 IoT 实时数据').uncheck();
  await editor.waitForFunction(()=>document.querySelector('#binding').textContent==='null'&&document.querySelector('#error').textContent==='');
  assert.equal(await editor.locator('#error').innerText(),'');
  assert.deepEqual(errors,[]);
  console.log('IoT iframe handshake/remount, opt-in/source/origin/session isolation, live/stale/error states, cleanup and editor validation passed.');
} finally {
  if(deadline)clearTimeout(deadline);
  await browser?.close();
  await server.close();
  await rm(cacheDir,{recursive:true,force:true});
}
