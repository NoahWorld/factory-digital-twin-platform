import { readdir,readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipStream,type ZipStreamEntry } from "../../api/src/zip-stream";

const setupScript = `import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('./runtime.env',import.meta.url));
try { await writeFile(path,'BOOTSTRAP_TOKEN='+randomBytes(32).toString('hex')+'\\nSESSION_TTL_HOURS=24\\nRUNTIME_POLLING_ENABLED=false\\nRUNTIME_ALLOWED_HOSTS=\\nSOURCE_ENVIRONMENT_FILE=\\n',{flag:'wx',mode:0o600}); console.log('已创建私有 runtime.env。启动服务后，可使用本机初始化工具创建管理员。'); }
catch(error) { if(error.code!=='EEXIST')throw error; }
`;
const bootstrapScript = `import {readFile} from 'node:fs/promises';
import {parseArgs,parseEnv} from 'node:util';
const {values}=parseArgs({options:{email:{type:'string'},name:{type:'string'},'password-file':{type:'string'},port:{type:'string',default:'8792'}}});
if(!values.email||!values['password-file'])throw new Error('使用 node initialize-admin.mjs --email 邮箱 --password-file 私有密码文件 [--name 昵称] [--port 8792]');
const port=Number(values.port);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口无效');
const config=parseEnv(await readFile(new URL('./runtime.env',import.meta.url),'utf8'));
const password=(await readFile(values['password-file'],'utf8')).replace(/\\r?\\n$/,'');
const response=await fetch('http://127.0.0.1:'+port+'/api/v1/auth/bootstrap',{method:'POST',headers:{'content-type':'application/json','x-bootstrap-token':config.BOOTSTRAP_TOKEN},body:JSON.stringify({email:values.email,password,displayName:values.name||values.email})});
if(!response.ok){const body=await response.json();throw new Error(body.message||'初始化失败');}
console.log('管理员已创建。请在浏览器登录；密码和初始化令牌未输出。');
`;
const readme = `# NewPower 独立运行包

需要 Node.js 24.18 或之后的24系列版本。无需源码目录、Vite、Wrangler、pnpm或node_modules。系统自带的工业数据服务另行配置。

1. 解压到独立目录。在 macOS/Linux 执行 ./start.sh，Windows 执行 start.cmd。也可以执行 node initialize-env.mjs，再执行 node server.mjs --data-dir ./data --config ./runtime.env --port 8792。
2. 首次启动会在本机创建私有runtime.env，数据保存在data，默认仅监听127.0.0.1:8792。环境文件和data目录不得放入public或对外公开。
3. 用私有本地文件保存自选密码，执行 node initialize-admin.mjs --email your@example.com --password-file /私有/密码文件。工具从本机环境读取初始化令牌并调用本机服务，不输出凭据。创建后可移除该临时密码文件；没有默认账户或密码。
4. 浏览器打开 http://127.0.0.1:8792，登录并导入项目ZIP。安装得到冻结版本，尚未激活；可从发布面板检查并恢复为可编辑草稿。
5. 项目ZIP只保存逻辑环境端点。参考sources.example.json，在单独私有sources.json填写实际地址及认证，项目白名单使用安装结果中的目标项目ID。在runtime.env填写SOURCE_ENVIRONMENT_FILE=sources.json、RUNTIME_ALLOWED_HOSTS的精确host:port，并显式启用RUNTIME_POLLING_ENABLED=true；重启生效。MQTT在mqttEndpoints和mqttCredentials中配置地址、项目与精确主题白名单及设备凭据；使用MQTT3.1.1，QoS0/1，要求消息含源时间，TLS证书必须可信。SQLite在sqliteQueries登记固定SQL、位置参数、表列白名单和文件路径；相对路径以sources.json所在目录为基准，数据文件须位于本运行器data目录之外。
6. 发布面板激活前会验证文件和数据。后续项目ZIP安装为同一项目的新版本，当前草稿和发布指针不变；再明确激活或回滚。

启动脚本可追加 --host 0.0.0.0 或 --port 8792。内网通过受信任TLS反向代理保持前端/API同源，并把PUBLIC_ORIGIN设为实际访问源；不需要浏览器直连工业协议。代理需关闭SSE缓冲、保留Cookie并允许长连接。

升级运行程序时停止旧进程，备份现有data和私有环境，再替换程序文件（不要覆盖data/runtime.env/sources.json）。启动时校验迁移历史，有新增迁移先在线备份并验证。项目版本回滚在发布面板进行；较旧程序遇新数据库迁移历史会明确拒绝，需要对应升级前备份恢复，不能把项目回滚误当数据库降级。

同一data目录只能由一个宿主持有，进程异常退出后原生文件锁自动释放。安装日志在data/project-imports内支持崩溃恢复；不要手工删除仍需恢复的日志。项目ZIP与运行包均不包含现有用户、会话、数据库或真实环境凭据。
`;
export function runtimeDistribution(bundleDirectory:string,signal:AbortSignal):Response {
  const encoder = new TextEncoder();
  async function* entries(signal:AbortSignal):AsyncGenerator<ZipStreamEntry> {
    yield { path:"README.md",bytes:encoder.encode(readme) };
    yield { path:"initialize-env.mjs",bytes:encoder.encode(setupScript) };
    yield { path:"initialize-admin.mjs",bytes:encoder.encode(bootstrapScript) };
    yield { path:"start.sh",executable:true,bytes:encoder.encode('#!/bin/sh\nset -eu\ncd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nnode initialize-env.mjs\nexec node server.mjs --data-dir ./data --config ./runtime.env "$@"\n') };
    yield { path:"start.cmd",bytes:encoder.encode('@echo off\r\ncd /d "%~dp0"\r\nnode initialize-env.mjs\r\nif errorlevel 1 exit /b %errorlevel%\r\nnode server.mjs --data-dir .\\data --config .\\runtime.env %*\r\n') };
    yield { path:"sources.example.json",bytes:encoder.encode(JSON.stringify({ version:1,endpoints:{ "example-endpoint":{ projectIds:["replace-with-installed-project-id"],url:"http://127.0.0.1:8790/device/DEVICE-001",credentialRef:"example-auth" } },credentials:{ "example-auth":{ headers:{ authorization:"Bearer replace-with-server-secret" } } },mqttEndpoints:{ "example-broker":{ projectIds:["replace-with-installed-project-id"],url:"mqtts://broker.example.invalid:8883",topics:["factory/device/snapshot"],credentialRef:"example-device" } },mqttCredentials:{ "example-device":{ username:"replace-with-device-username",password:"replace-with-server-secret" } },sqliteQueries:{ "example-equipment":{ projectIds:["replace-with-installed-project-id"],databasePath:"./sources/equipment.sqlite",sql:"SELECT assetId,temperature,observedAt FROM equipment ORDER BY assetId",parameters:[],tables:{ equipment:["assetId","temperature","observedAt"] },rowKey:"assetId",maxRows:1000 } } },null,2)+"\n") };
    yield { path:"server.mjs",bytes:await readFile(join(bundleDirectory,"server.mjs"),{ signal }) };
    yield { path:"sqlite-query-worker.mjs",bytes:await readFile(join(bundleDirectory,"sqlite-query-worker.mjs"),{ signal }) };
    async function* folder(relative:string):AsyncGenerator<ZipStreamEntry> {
      for (const item of (await readdir(join(bundleDirectory,relative),{ withFileTypes:true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) throw new Error("Distribution directory contains an unexpected hidden file or symlink.");
        const path = `${relative}/${item.name}`;
        if (item.isDirectory()) yield* folder(path);
        else if (item.isFile()) yield { path,bytes:await readFile(join(bundleDirectory,path),{ signal }) };
      }
    }
    yield { path:"dependencies.json",bytes:await readFile(join(bundleDirectory,"dependencies.json"),{ signal }) };
    yield* folder("telemetry-migrations"); yield* folder("migrations"); yield* folder("public"); yield* folder("licenses");
  }
  return new Response(zipStream(entries,signal),{ headers:{ "content-type":"application/zip","content-disposition":"attachment; filename=NewPower-runtime.zip","cache-control":"no-store" } });
}
