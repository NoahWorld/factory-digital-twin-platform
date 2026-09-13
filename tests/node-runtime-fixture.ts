import { spawn,type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp,mkdir,writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join,resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { TestInfo } from "@playwright/test";

export async function nodeRuntimeFixture(testInfo: TestInfo) {
  const root = testInfo.outputPath("standalone"),bundle = join(root,"bundle"),data = join(root,"data"),config = join(root,"runtime.env");
  const bootstrap = randomBytes(24).toString("hex");
  const mock = new URL(process.env.NEWPOWER_MOCK_URL ?? "http://127.0.0.1:8790");
  if (mock.protocol !== "http:" || !["127.0.0.1","localhost"].includes(mock.hostname)) throw new Error("Node runtime fixtures require a local mock source.");
  await mkdir(root,{ recursive: true,mode: 0o700 });
  await cp(resolve("apps/runtime/dist"),bundle,{ recursive: true });
  await writeFile(config,`BOOTSTRAP_TOKEN=${bootstrap}\nRUNTIME_POLLING_ENABLED=true\nRUNTIME_ALLOWED_HOSTS=${mock.host}\n`,{ mode: 0o600 });
  const log = createWriteStream(join(root,"runtime.log"),{ flags: "a",mode: 0o600 });
  let child: ChildProcessWithoutNullStreams | null = null;
  const start = async () => {
    child = spawn(process.execPath,[join(bundle,"server.mjs"),"--data-dir",data,"--config",config,"--port","0"],{ cwd: root,stdio: "pipe" });
    const process_ = child;
    process_.stderr.on("data",(chunk) => log.write(chunk));
    return new Promise<string>((resolve,reject) => {
      const timeout = setTimeout(() => { process_.kill("SIGKILL"); reject(new Error("Node runtime did not start; inspect its private runtime.log.")); },15000);
      let buffer = "";
      process_.once("error",(error) => { clearTimeout(timeout); reject(error); });
      process_.once("exit",(code) => { clearTimeout(timeout); reject(new Error(`Node runtime exited before ready (code ${code}); inspect runtime.log.`)); });
      process_.stdout.on("data",(chunk) => {
        log.write(chunk); buffer += String(chunk);
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
          try { const value = JSON.parse(line); if (value.event === "runtime_listening") { clearTimeout(timeout); resolve(value.url); } } catch { /* Non-JSON dependency startup output remains in the log. */ }
        }
      });
    });
  };
  const stop = async () => {
    const current = child; child = null; if (!current || current.exitCode !== null) return;
    await new Promise<void>((resolve,reject) => {
      const timeout = setTimeout(() => { current.kill("SIGKILL"); reject(new Error("Node runtime did not shut down within five seconds.")); },5000);
      current.once("close",(code,signal) => { clearTimeout(timeout); if (code === 0 || signal === "SIGTERM") resolve(); else reject(new Error(`Runtime exit ${code}/${signal}`)); });
      current.kill("SIGTERM");
    });
  };
  try { const url = await start(); return { url,bootstrap,dataDirectory: data,bundleDirectory: bundle,databasePath: join(data,"config.sqlite"),restart: async () => { await stop(); return start(); },dispose: async () => { try { await stop(); } finally { log.end(); } } }; }
  catch (reason) { try { await stop(); } finally { log.end(); } throw reason; }
}
