import { createRequire } from 'node:module';
const web=createRequire(new URL('../apps/web/package.json',import.meta.url));
const esbuild=createRequire(web.resolve('vite'))('esbuild');
try {
  const result=await esbuild.build({entryPoints:[new URL('../apps/web/tests/room-alarm-data.test.mjs',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',target:'node22',define:{'import.meta.env':'{}'}});
  await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}finally{esbuild.stop()}
