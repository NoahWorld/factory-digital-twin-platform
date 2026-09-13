import { DatabaseSync,constants } from "node:sqlite";
import { realpathSync,statSync } from "node:fs";
import { sep } from "node:path";
import { validateSqliteQuery } from "./sqlite-query-contract";
const MAX_BYTES = 256*1024;
const fail = (code:string):never => { throw Object.assign(new Error(code),{ queryCode:code }); };
const functions = new Set(["abs","round","coalesce","ifnull","nullif","lower","upper","length","substr","substring","trim","ltrim","rtrim","min","max","avg","sum","total","count","date","time","datetime","julianday","unixepoch","strftime","json_extract","json_valid"]);
function query(input:unknown) {
  const value = input as { definition:unknown;protectedDirectory:string;protectedFiles:string[] };
  const definition = validateSqliteQuery(value.definition);
  if (typeof value.protectedDirectory !== "string" || !Array.isArray(value.protectedFiles) || value.protectedFiles.some((path) => typeof path !== "string")) fail("sqlite_query_configuration_invalid");
  const filename = realpathSync(definition.databasePath),file = statSync(filename),protectedDirectory = realpathSync(value.protectedDirectory);
  if (!file.isFile() || filename === protectedDirectory || filename.startsWith(protectedDirectory+sep)) fail("sqlite_query_file_not_allowed");
  for (const path of value.protectedFiles) { const protectedFile = statSync(path);if (file.dev === protectedFile.dev && file.ino === protectedFile.ino) fail("sqlite_query_file_not_allowed"); }
  let authorizationDenied = false;
  const db = new DatabaseSync(filename,{ readOnly:true,allowExtension:false,timeout:500 });
  try {
    const heap = db.prepare("PRAGMA hard_heap_limit=67108864").get();if (heap?.hard_heap_limit !== 67108864) fail("sqlite_query_limits_unavailable");
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;");
    const native = db as DatabaseSync & { limits:Record<string,number>;setAuthorizer(callback:(action:number,a:string|null,b:string|null,database:string|null,view:string|null) => number):void };
    if (!native.limits || typeof native.setAuthorizer !== "function") fail("sqlite_query_limits_unavailable");
    Object.assign(native.limits,{ length:MAX_BYTES,sqlLength:65536,column:2000,exprDepth:100,compoundSelect:20,vdbeOp:250000,functionArg:32,attach:0,likePatternLength:1024,variableNumber:32,triggerDepth:0 });
    for (const table of db.prepare("PRAGMA table_list").iterate()) if (table.schema === "main" && typeof table.name === "string" && Object.hasOwn(definition.tables,table.name) && table.type !== "table" && table.type !== "view") fail("sqlite_query_not_allowed");
    const codes = constants as typeof constants & Record<string,number>;
    native.setAuthorizer((action,a,b,database) => {
      if (action === codes.SQLITE_SELECT || action === codes.SQLITE_RECURSIVE) return codes.SQLITE_OK;
      if (action === codes.SQLITE_READ && a && Object.hasOwn(definition.tables,a) && (database === "main" || database === null && b === "") && (b === "" || b !== null && definition.tables[a].includes(b))) return codes.SQLITE_OK;
      if (action === codes.SQLITE_FUNCTION && b && functions.has(b.toLowerCase())) return codes.SQLITE_OK;
      authorizationDenied = true;return codes.SQLITE_DENY;
    });
    const statement = db.prepare(definition.sql);
    if (!definition.sql.startsWith(statement.sourceSQL) || definition.sql.slice(statement.sourceSQL.length).trim()) fail("sqlite_query_multiple_statements");
    const columns = statement.columns().map((column) => column.name);
    if (!columns.length || columns.length>128 || columns.some((column) => !column || column.length>128) || new Set(columns).size !== columns.length) fail("sqlite_query_columns_invalid");
    if (definition.rowKey && !columns.includes(definition.rowKey)) fail("sqlite_query_row_key_invalid");
    statement.setReadBigInts(true);const rows:Array<Record<string,string|number|null>> = [],records:Record<string,Record<string,string|number|null>> = Object.create(null),iterator = statement.iterate(...definition.parameters);let bytes = 16,count = 0;
    try {
      for (const input of iterator) {
        if (count>=definition.maxRows) fail("sqlite_query_row_limit");
        const row:Record<string,string|number|null> = Object.create(null);
        for (const column of columns) {
          let value = input[column];if (typeof value === "bigint") { if (value>BigInt(Number.MAX_SAFE_INTEGER) || value<BigInt(Number.MIN_SAFE_INTEGER)) fail("sqlite_query_integer_precision");value = Number(value); }
          if (value !== null && typeof value !== "string" && typeof value !== "number" || typeof value === "number" && !Number.isFinite(value)) fail("sqlite_query_value_type_invalid");
          row[column] = value as string|number|null;
        }
        let key:string|undefined;
        if (definition.rowKey) { const value = row[definition.rowKey];if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value) || Object.hasOwn(records,value)) fail("sqlite_query_row_key_invalid");key = value as string; }
        bytes+=Buffer.byteLength(JSON.stringify(row))+1+(key ? Buffer.byteLength(JSON.stringify(key))+1:0);if (bytes>MAX_BYTES) fail("sqlite_query_output_limit");if (key) records[key] = row;else rows.push(row);count++;
      }
    } finally { iterator.return?.(); }
    return definition.rowKey ? { records }:{ rows };
  } catch (error) { if (authorizationDenied) fail("sqlite_query_not_allowed");throw error; } finally { db.close(); }
}
let size = 0;const chunks:Buffer[] = [];
try {
  for await (const chunk of process.stdin) { size+=chunk.length;if (size>MAX_BYTES) fail("sqlite_query_configuration_invalid");chunks.push(chunk); }
  const result = query(JSON.parse(Buffer.concat(chunks).toString("utf8")));process.stdout.write(JSON.stringify({ ok:true,payload:result }));
} catch (error) {
  const value = error as {queryCode?:string;errcode?:number;code?:string},nativeCodes:Record<number,string> = { 5:"sqlite_query_locked",6:"sqlite_query_locked",7:"sqlite_query_memory_limit",8:"sqlite_query_not_allowed",11:"sqlite_query_database_invalid",14:"sqlite_query_file_unavailable",18:"sqlite_query_value_limit",23:"sqlite_query_not_allowed",26:"sqlite_query_database_invalid" },code = value.queryCode ?? nativeCodes[value.errcode ?? 0] ?? (["ENOENT","EACCES","EPERM"].includes(value.code ?? "") ? "sqlite_query_file_unavailable":"sqlite_query_failed");
  process.stdout.write(JSON.stringify({ ok:false,code }));process.exitCode = 1;
}
