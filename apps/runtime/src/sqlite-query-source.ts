import { spawn } from "node:child_process";
import { resolve,join } from "node:path";
import { AppError,type AppEnv } from "../../api/src/auth";
import type { DataSource } from "../../api/src/data-sources";
import { parseRuntimeSourceSample,type SourceSample } from "../../api/src/runtime-state";
import { parseSqliteQueryEnvironment,type SqliteQueryEnvironment } from "./sqlite-query-contract";
const MAX_BYTES = 256*1024;
const publicCodes = new Set(["sqlite_query_configuration_invalid","sqlite_query_file_not_allowed","sqlite_query_limits_unavailable","sqlite_query_multiple_statements","sqlite_query_columns_invalid","sqlite_query_row_limit","sqlite_query_row_key_invalid","sqlite_query_integer_precision","sqlite_query_value_type_invalid","sqlite_query_output_limit","sqlite_query_not_allowed","sqlite_query_locked","sqlite_query_failed","sqlite_query_memory_limit","sqlite_query_database_invalid","sqlite_query_file_unavailable","sqlite_query_value_limit"]);
export function createSqliteQuerySource(env:AppEnv,environment:SqliteQueryEnvironment,options:{ directory:string;environmentDirectory:string;workerPath:string }) {
  const config = parseSqliteQueryEnvironment(environment as Record<string,unknown>);let active = 0;
  return async (source:DataSource,_requestId:string,signal?:AbortSignal):Promise<SourceSample> => {
    if (source.sourceType !== "sqlite_query" || !("queryRef" in source.config)) throw new AppError(409,"runtime_source_not_supported","A SQLite query source is required.");
    if (env.RUNTIME_POLLING_ENABLED !== "true") throw new AppError(503,"runtime_polling_disabled","Runtime source collection is disabled on this server.");
    if (signal?.aborted) throw new AppError(499,"data_source_cancelled","Query collection cancelled.");
    const definition = config.sqliteQueries?.[source.config.queryRef];
    if (!definition || !definition.projectIds.includes(source.projectId)) throw new AppError(403,"sqlite_query_not_authorized","This private query is unavailable to the project.");
    if (active>=6) throw new AppError(429,"sqlite_query_capacity","Read-only query process capacity is exhausted.");
    const timeoutMs = source.config.timeoutMs,resolved = { ...definition,databasePath:resolve(options.environmentDirectory,definition.databasePath) },started = Date.now();active++;
    try {
      const payload = await new Promise<{ rows?:unknown[];records?:Record<string,unknown> }>((resolve,reject) => {
        const child = spawn(process.execPath,["--max-old-space-size=64",options.workerPath],{ stdio:["pipe","pipe","pipe"],env:{ PATH:process.env.PATH },windowsHide:true });
        let reason:AppError|undefined,settled = false,size = 0,errorSize = 0;const chunks:Buffer[] = [];
        const cleanup = () => { clearTimeout(timer);signal?.removeEventListener("abort",cancel); };
        const fail = (error:AppError) => { if (reason || settled) return;reason = error;child.kill("SIGKILL"); };
        const cancel = () => fail(new AppError(499,"data_source_cancelled","Query collection cancelled."));
        const timer = setTimeout(() => fail(new AppError(504,"sqlite_query_timeout","Private query exceeded its total time budget.")),timeoutMs);
        signal?.addEventListener("abort",cancel,{ once:true });if (signal?.aborted) cancel();
        child.stdout.on("data",(chunk:Buffer) => { size+=chunk.length;if (size>MAX_BYTES+1024) fail(new AppError(502,"sqlite_query_output_limit","Query response exceeded its output budget."));else chunks.push(chunk); });
        child.stderr.on("data",(chunk:Buffer) => { errorSize+=chunk.length;if (errorSize>65536) fail(new AppError(502,"sqlite_query_worker_failed","Query worker failed.")); });
        child.stdin.on("error",() => {});
        child.once("error",() => { if (settled) return;settled = true;cleanup();reject(new AppError(503,"sqlite_query_worker_unavailable","Query worker could not be started.")); });
        child.once("close",(exitCode) => {
          if (settled) return;settled = true;cleanup();if (reason) { reject(reason);return; }
          try {
            const response = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (response?.ok !== true) { const code = publicCodes.has(response?.code) ? response.code:"sqlite_query_worker_failed";throw new AppError(422,code,"Private read-only query failed; inspect the registered query, data types and resource limits."); }
            if (exitCode !== 0 || !response.payload || (definition.rowKey ? !response.payload.records || typeof response.payload.records !== "object" || Array.isArray(response.payload.records):!Array.isArray(response.payload.rows))) throw new AppError(502,"sqlite_query_response_invalid","Query worker returned an invalid response.");resolve(response.payload);
          } catch (error) { reject(error instanceof AppError ? error:new AppError(502,"sqlite_query_response_invalid","Query worker returned an invalid response.")); }
        });
        child.stdin.end(JSON.stringify({ definition:resolved,protectedDirectory:options.directory,protectedFiles:[join(options.directory,"config.sqlite"),join(options.directory,"telemetry.sqlite")] }));
      });
      const sample = parseRuntimeSourceSample(source,source.config,{ databasePath:resolved.databasePath,registeredPath:definition.databasePath,sql:resolved.sql },JSON.stringify(payload));return { ...sample,durationMs:Date.now()-started };
    } finally { active--; }
  };
}
