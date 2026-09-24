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
  // No merchant rules are seeded any more: MerchantRules holds only what the
  // user taught, and the built-in knowledge is the whole-word brand
  // dictionary in src/math/categoryTaxonomy.ts (see migration v20).
}

/** Test-only escape hatch to reset module state between test files. */
export function __resetDatabaseForTests(): void {
  adapter = null;
}
