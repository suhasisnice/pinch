import { DbAdapter } from './types';
import { initSchema } from './schema';
import { createExpoAdapter } from './expoAdapter';

let adapter: DbAdapter | null = null;

/**
 * The single live database handle. Repositories import this rather than
 * receiving an adapter, so call sites stay terse; tests swap the whole handle
 * via initDatabase(customAdapter).
 */
export function getAdapter(): DbAdapter {
  if (!adapter) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return adapter;
}

export function isInitialized(): boolean {
  return adapter !== null;
}

/**
 * Opens the database, runs migrations, and seeds first-run defaults.
 * Call once at app startup. Tests inject a custom adapter (e.g. sql.js)
 * instead of touching the native expo-sqlite module.
 */
export async function initDatabase(
  customAdapter?: DbAdapter,
  databaseName = 'pinch.db'
): Promise<void> {
  adapter = customAdapter ?? (await createExpoAdapter(databaseName));
  await initSchema(adapter);
  await seedMerchantRules(adapter);
}

/** Test-only escape hatch to reset module state between test files. */
export function __resetDatabaseForTests(): void {
  adapter = null;
}

/**
 * Inserts the built-in merchant->category rules once. `INSERT OR IGNORE`
 * against the UNIQUE pattern means a user's own edit to a rule is never
 * clobbered on a later launch.
 */
async function seedMerchantRules(db: DbAdapter): Promise<void> {
  const { DEFAULT_MERCHANT_RULES } = await import('./schema');
  const now = new Date().toISOString();
  for (const rule of DEFAULT_MERCHANT_RULES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO MerchantRules (pattern, category, created_at) VALUES (?, ?, ?);`,
      [rule.pattern, rule.category, now]
    );
  }
}
