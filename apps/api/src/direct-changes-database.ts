import type { Database,DatabaseStatement,DatabaseResult } from "./auth";

class Statement implements DatabaseStatement {
  constructor(readonly owner:DirectChangesDatabase,readonly raw:DatabaseStatement) {}
  bind(...values:unknown[]) { return new Statement(this.owner,this.raw.bind(...values)); }
  first<T>() { return this.raw.first<T>(); }
  all<T>() { return this.raw.all<T>(); }
  async run() { return (await this.owner.batch([this]))[0]; }
}
/** D1 meta.changes includes trigger writes. Read SQLite changes() immediately in
 * the same batch transaction, before any other request can affect the connection. */
class DirectChangesDatabase implements Database {
  readonly directChanges = true;
  constructor(private raw:Database) {}
  prepare(query:string) { return new Statement(this,this.raw.prepare(query)); }
  async batch(statements:DatabaseStatement[]):Promise<DatabaseResult[]> {
    if (!statements.length) return [];
    const expanded:DatabaseStatement[] = [];
    for (const statement of statements) {
      if (!(statement instanceof Statement) || statement.owner !== this) throw new Error("Statements must belong to the same database adapter.");
      expanded.push(statement.raw,this.raw.prepare("SELECT changes() AS direct_changes"));
    }
    const result = await this.raw.batch(expanded) as Array<DatabaseResult & { results?:Array<{ direct_changes:number }> }>;
    return statements.map((_,index) => {
      const changes = result[index*2+1]?.results?.[0]?.direct_changes;
      if (!Number.isSafeInteger(changes) || changes! < 0) throw new Error("Database did not report direct changes in the transaction.");
      return { ...result[index*2],meta:{ ...result[index*2].meta,changes } };
    });
  }
}
export const directChangesDatabase = (database:Database):Database => database.directChanges ? database : new DirectChangesDatabase(database);
