export type SqliteQueryDefinition = { projectIds:string[];databasePath:string;sql:string;parameters:Array<string|number|null>;tables:Record<string,string[]>;maxRows:number;rowKey?:string };
export type SqliteQueryEnvironment = { sqliteQueries?:Record<string,SqliteQueryDefinition> };
const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = ():never => { throw new Error("Invalid private SQLite query configuration."); };
const name = (value:unknown):value is string => typeof value === "string" && value.length>=1 && value.length<=128 && !/[\u0000-\u001f\u007f]/.test(value);
export function validateSqliteQuery(input:unknown):SqliteQueryDefinition {
  if (!record(input) || Object.keys(input).some((key) => !["projectIds","databasePath","sql","parameters","tables","maxRows","rowKey"].includes(key)) || !Array.isArray(input.projectIds) || input.projectIds.length<1 || input.projectIds.length>256 || !input.projectIds.every((id) => typeof id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(id)) || typeof input.databasePath !== "string" || !input.databasePath || input.databasePath.length>4096 || input.databasePath.includes("\0") || typeof input.sql !== "string" || !input.sql.trim() || input.sql.length>16384 || input.sql.includes("\0") || !Number.isInteger(input.maxRows) || (input.maxRows as number)<1 || (input.maxRows as number)>1000 || !record(input.tables) || !Object.keys(input.tables).length || Object.keys(input.tables).length>16) return invalid();
  if (input.rowKey !== undefined && !name(input.rowKey)) return invalid();
  const parameters = input.parameters ?? [];
  if (!Array.isArray(parameters) || parameters.length>32 || parameters.some((value) => !(value === null || typeof value === "string" && value.length<=1024 || typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))))) return invalid();
  const tables:Record<string,string[]> = Object.create(null);
  for (const [table,columns] of Object.entries(input.tables)) {
    if (!name(table) || table.toLowerCase().startsWith("sqlite_") || table.toLowerCase().startsWith("pragma_") || !Array.isArray(columns) || columns.length<1 || columns.length>128 || !columns.every(name) || new Set(columns).size !== columns.length) return invalid();
    tables[table] = [...columns];
  }
  const result = { projectIds:[...new Set(input.projectIds)] as string[],databasePath:input.databasePath,sql:input.sql,parameters:parameters as Array<string|number|null>,tables,maxRows:input.maxRows as number,...(input.rowKey !== undefined ? { rowKey:input.rowKey as string }:{}) };
  if (Buffer.byteLength(JSON.stringify(result))>240*1024) return invalid();return result;
}
export function parseSqliteQueryEnvironment(value:Record<string,unknown>):SqliteQueryEnvironment {
  if (value.sqliteQueries === undefined) return {};
  if (!record(value.sqliteQueries) || Object.keys(value.sqliteQueries).length>256) return invalid();
  const sqliteQueries:Record<string,SqliteQueryDefinition> = Object.create(null);
  for (const [id,input] of Object.entries(value.sqliteQueries)) { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id)) return invalid();sqliteQueries[id] = validateSqliteQuery(input); }
  return { sqliteQueries };
}
