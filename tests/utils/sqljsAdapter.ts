import initSqlJs, { Database } from 'sql.js';
import { DbAdapter, RunResult } from '../../src/db/types';

/**
 * Real SQLite (compiled to WASM via sql.js) running in Node for tests, so
 * dbService.ts is proven against actual SQL execution rather than a hand
 * rolled mock. Implements the same DbAdapter surface as expoAdapter.ts.
 */
export async function createSqlJsAdapter(): Promise<DbAdapter> {
  const SQL = await initSqlJs();
  const db: Database = new SQL.Database();

  return {
    async execAsync(sql: string): Promise<void> {
      db.run(sql);
    },
    async runAsync(sql: string, params: unknown[] = []): Promise<RunResult> {
      db.run(sql, params as any[]);
      const [row] = db.exec('SELECT last_insert_rowid() as id, changes() as changes;');
      const values = row?.values?.[0] ?? [0, 0];
      return { lastInsertRowId: Number(values[0]), changes: Number(values[1]) };
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(sql);
      stmt.bind(params as any[]);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return rows;
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const stmt = db.prepare(sql);
      stmt.bind(params as any[]);
      const has = stmt.step();
      const result = has ? (stmt.getAsObject() as T) : null;
      stmt.free();
      return result;
    },
  };
}
