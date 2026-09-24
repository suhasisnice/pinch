import { DbAdapter, RunResult } from './types';

/**
 * Web build of the adapter, for the design preview only (`npm run preview`).
 *
 * The app ships on Android, where `expoAdapter.ts` talks to expo-sqlite.
 * Metro picks this file instead when bundling for the browser, so the real
 * screens and the real SQL can run in a desktop browser — which is the only
 * way to look at the UI without a phone. Same sql.js engine the tests use.
 * Nothing persists: every page load starts from the demo seed.
 */
export async function createExpoAdapter(_databaseName: string): Promise<DbAdapter> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js/dist/sql-wasm.js');
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const db = new SQL.Database();

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
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      stmt.free();
      return rows;
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const stmt = db.prepare(sql);
      stmt.bind(params as any[]);
      const result = stmt.step() ? (stmt.getAsObject() as T) : null;
      stmt.free();
      return result;
    },
  };
}
