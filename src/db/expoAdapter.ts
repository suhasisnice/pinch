import { DbAdapter, RunResult } from './types';

// Thin passthrough onto expo-sqlite's async API (SDK 51+: execAsync /
// runAsync / getAllAsync / getFirstAsync). Imported lazily by dbService so
// that Jest (Node, no native module) never has to load expo-sqlite.
export async function createExpoAdapter(databaseName: string): Promise<DbAdapter> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SQLite = require('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(databaseName);

  return {
    async execAsync(sql: string): Promise<void> {
      await db.execAsync(sql);
    },
    async runAsync(sql: string, params: unknown[] = []): Promise<RunResult> {
      const result = await db.runAsync(sql, ...params);
      return { lastInsertRowId: result.lastInsertRowId, changes: result.changes };
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.getAllAsync(sql, ...params) as Promise<T[]>;
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const row = await db.getFirstAsync(sql, ...params);
      return (row ?? null) as T | null;
    },
  };
}
