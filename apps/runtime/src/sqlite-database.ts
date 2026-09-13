import { DatabaseSync,type StatementSync,type SQLInputValue } from "node:sqlite";
import type { Database,DatabaseStatement,DatabaseResult } from "../../api/src/auth";

function inputValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  throw new Error("Unsupported SQLite binding value.");
}

class Prepared implements DatabaseStatement {
  constructor(readonly owner: SqliteDatabase,private query: string,private values: SQLInputValue[] = []) {}
  bind(...values: unknown[]): DatabaseStatement { return new Prepared(this.owner,this.query,values.map(inputValue)); }
  async first<T>(): Promise<T | null> { return (this.owner.statement(this.query).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.owner.statement(this.query).all(...this.values) as T[] }; }
  runSync(): DatabaseResult {
    const result = this.owner.statement(this.query).run(...this.values), changes = Number(result.changes);
    if (!Number.isSafeInteger(changes) || changes < 0) throw new Error("SQLite did not return a valid changes count.");
    return { meta: { changes } };
  }
  async run(): Promise<DatabaseResult> { return this.runSync(); }
}

/** The same asynchronous interface as D1, with one synchronous atomic batch. */
export class SqliteDatabase implements Database {
  readonly connection: DatabaseSync;
  private statements = new Map<string,StatementSync>();
  private closed = false;
  constructor(path: string) {
    this.connection = new DatabaseSync(path,{ enableForeignKeyConstraints: true,allowExtension: false,enableDoubleQuotedStringLiterals: false,timeout: 5000 });
    this.connection.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  }
  statement(query: string): StatementSync {
    if (this.closed) throw new Error("Database is closed.");
    const existing = this.statements.get(query);
    if (existing) { this.statements.delete(query); this.statements.set(query,existing); return existing; }
    const statement = this.connection.prepare(query); this.statements.set(query,statement);
    // Node 24.18 has no StatementSync.close; bound retained handles and let
    // evicted handles be collected. Closing the database releases its connection.
    if (this.statements.size > 128) this.statements.delete(this.statements.keys().next().value!);
    return statement;
  }
  prepare(query: string): DatabaseStatement { return new Prepared(this,query); }
  async batch(statements: DatabaseStatement[]): Promise<DatabaseResult[]> {
    if (this.closed) throw new Error("Database is closed.");
    if (statements.some((statement) => !(statement instanceof Prepared) || statement.owner !== this)) throw new Error("Batch statements must belong to this database.");
    if (!statements.length) return [];
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => (statement as Prepared).runSync());
      this.connection.exec("COMMIT"); return results;
    } catch (reason) {
      try { this.connection.exec("ROLLBACK"); } catch (rollback) { throw new AggregateError([reason,rollback],"Database transaction and rollback failed."); }
      throw reason;
    }
  }
  close() { if (this.closed) return; this.closed = true; this.statements.clear(); this.connection.close(); }
}
