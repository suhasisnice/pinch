import { DbAdapter } from './types';
import { runMigrations } from './migrations';

export { MIGRATIONS, LATEST_VERSION, runMigrations } from './migrations';

/**
 * Brings the database up to the latest schema version.
 *
 * Structure is defined entirely by the ordered migration list in
 * migrations.ts — a fresh install replays every migration from zero and lands
 * on exactly the same shape an upgraded install reaches, so there is only one
 * schema definition to keep correct.
 */
export async function initSchema(db: DbAdapter): Promise<void> {
  await runMigrations(db);
}

// The categories and everything the categoriser knows about them live in
// src/math/categoryTaxonomy.ts. Re-exported here because this is where the
// rest of the app has always imported them from.
export { CATEGORIES, SUBCATEGORIES } from '../math/categoryTaxonomy';
export type { Category } from '../math/categoryTaxonomy';
