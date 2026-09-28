import { DbAdapter, RunResult } from './types';

/**
 * The on-device database, encrypted with SQLCipher (0.9.17).
 *
 * The key is 32 random bytes kept in expo-secure-store, which on Android
 * lives in the hardware-backed Keystore. The key never leaves the phone and
 * is never shown; clearing the app's data removes both key and database
 * together, and allowBackup is off so neither is copied anywhere.
 *
 * Phones that ran an earlier build have a plaintext `pinch.db`. The first
 * launch copies it into the encrypted `pinch-secure.db` with
 * `sqlcipher_export` and deletes the plaintext file, so no finance data is
 * left unencrypted on disk.
 *
 * Imported lazily by dbService so Jest (Node, no native module) never loads
 * expo-sqlite; `expoAdapter.web.ts` stands in for the browser preview.
 */

const LEGACY_NAME = 'pinch.db';
const SECURE_NAME = 'pinch-secure.db';
const KEY_ITEM = 'pinch.databaseKey';

/**
 * One open database per JS runtime (0.9.22).
 *
 * expo-sqlite hands back the handle it already has when the same file is
 * opened twice, and the two JS objects then share one native connection:
 * whichever is closed or garbage-collected first frees it under the other,
 * and every later call fails with a bare NullPointerException. Android can
 * keep the process (and this runtime) alive after the app is swiped away,
 * so reopening it, or tapping Retry, ran initDatabase a second time and hit
 * exactly that. So the open is done once and every later call gets it.
 */
const opened = new Map<string, Promise<DbAdapter>>();

export function createExpoAdapter(databaseName: string): Promise<DbAdapter> {
  let adapter = opened.get(databaseName);
  if (!adapter) {
    adapter = openExpoAdapter(databaseName);
    // A failed open must not be remembered, or Retry could never succeed.
    adapter.catch(() => opened.delete(databaseName));
    opened.set(databaseName, adapter);
  }
  return adapter;
}

async function openExpoAdapter(databaseName: string): Promise<DbAdapter> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SQLite = require('expo-sqlite');
  const name = databaseName === LEGACY_NAME ? SECURE_NAME : databaseName;
  const key = await databaseKey();

  await moveLegacyIntoSecure(SQLite, name, key);

  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync(keyPragma(key));

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

/** A raw 256-bit key, so SQLCipher skips its password-stretching step. */
function keyPragma(hexKey: string): string {
  return `PRAGMA key = "x'${hexKey}'";`;
}

async function databaseKey(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SecureStore = require('expo-secure-store');
  const existing: string | null = await SecureStore.getItemAsync(KEY_ITEM);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Crypto = require('expo-crypto');
  const bytes: Uint8Array = Crypto.getRandomBytes(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_ITEM, hex);
  return hex;
}

async function tableCount(db: {
  getFirstAsync: (sql: string) => Promise<unknown>;
}): Promise<number> {
  const row = (await db.getFirstAsync(`SELECT count(*) AS n FROM sqlite_master;`)) as {
    n: number;
  } | null;
  return row?.n ?? 0;
}

/**
 * One-time: encrypt an existing plaintext database. Runs only while the
 * secure database is still empty, so a finished move is never repeated and a
 * half-finished one (app killed mid-export) simply runs again.
 */
async function moveLegacyIntoSecure(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SQLite: any,
  secureName: string,
  key: string
): Promise<void> {
  // Its own connection, never the shared cached one: closing this probe must
  // not close a handle the rest of the app is using (see createExpoAdapter).
  const secure = await SQLite.openDatabaseAsync(secureName, { useNewConnection: true });
  await secure.execAsync(keyPragma(key));
  const secureTables = await tableCount(secure);
  await secure.closeAsync();
  if (secureTables > 0) return;

  const legacy = await SQLite.openDatabaseAsync(LEGACY_NAME, { useNewConnection: true });
  let legacyTables = 0;
  try {
    legacyTables = await tableCount(legacy);
  } catch {
    // Not a readable plaintext database — nothing to move.
  }

  if (legacyTables > 0) {
    const version = (await legacy.getFirstAsync(`PRAGMA user_version;`)) as {
      user_version: number;
    } | null;
    const path = `${SQLite.defaultDatabaseDirectory}/${secureName}`.replace(/'/g, "''");
    await legacy.execAsync(
      `ATTACH DATABASE '${path}' AS secure KEY "x'${key}'";
       SELECT sqlcipher_export('secure');
       PRAGMA secure.user_version = ${Number(version?.user_version ?? 0)};
       DETACH DATABASE secure;`
    );
  }
  await legacy.closeAsync();
  await SQLite.deleteDatabaseAsync(LEGACY_NAME);
}
