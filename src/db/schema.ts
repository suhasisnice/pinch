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

/** Spend categories. `null` on a transaction means "not yet categorised". */
export const CATEGORIES = [
  'Food',
  'Outing',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Academics',
  'Health',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Seed merchant -> category rules. Deliberately skewed to what actually shows
 * up on an Indian student's statement. Users can override any of these, and a
 * correction upserts into MerchantRules so the fix sticks.
 */
export const DEFAULT_MERCHANT_RULES: ReadonlyArray<{ pattern: string; category: Category }> = [
  { pattern: 'swiggy', category: 'Food' },
  { pattern: 'zomato', category: 'Food' },
  { pattern: 'zepto', category: 'Food' },
  { pattern: 'blinkit', category: 'Food' },
  { pattern: 'instamart', category: 'Food' },
  { pattern: 'dominos', category: 'Food' },
  { pattern: 'mcdonald', category: 'Food' },
  { pattern: 'starbucks', category: 'Food' },
  { pattern: 'cafe', category: 'Food' },
  { pattern: 'canteen', category: 'Food' },
  { pattern: 'mess', category: 'Food' },
  { pattern: 'uber', category: 'Transport' },
  { pattern: 'ola', category: 'Transport' },
  { pattern: 'rapido', category: 'Transport' },
  { pattern: 'irctc', category: 'Transport' },
  { pattern: 'redbus', category: 'Transport' },
  { pattern: 'metro', category: 'Transport' },
  { pattern: 'petrol', category: 'Transport' },
  { pattern: 'amazon', category: 'Shopping' },
  { pattern: 'flipkart', category: 'Shopping' },
  { pattern: 'myntra', category: 'Shopping' },
  { pattern: 'ajio', category: 'Shopping' },
  { pattern: 'decathlon', category: 'Shopping' },
  { pattern: 'netflix', category: 'Subscriptions' },
  { pattern: 'spotify', category: 'Subscriptions' },
  { pattern: 'prime', category: 'Subscriptions' },
  { pattern: 'hotstar', category: 'Subscriptions' },
  { pattern: 'youtube', category: 'Subscriptions' },
  { pattern: 'jio', category: 'Subscriptions' },
  { pattern: 'airtel', category: 'Subscriptions' },
  { pattern: 'bookmyshow', category: 'Outing' },
  { pattern: 'pvr', category: 'Outing' },
  { pattern: 'inox', category: 'Outing' },
  { pattern: 'cinepolis', category: 'Outing' },
  { pattern: 'bar', category: 'Outing' },
  { pattern: 'brewery', category: 'Outing' },
  { pattern: 'pharmacy', category: 'Health' },
  { pattern: 'apollo', category: 'Health' },
  { pattern: 'pharmeasy', category: 'Health' },
  { pattern: 'hospital', category: 'Health' },
  { pattern: 'medical', category: 'Health' },
  { pattern: 'book', category: 'Academics' },
  { pattern: 'stationery', category: 'Academics' },
  { pattern: 'xerox', category: 'Academics' },
  { pattern: 'udemy', category: 'Academics' },
  { pattern: 'coursera', category: 'Academics' },
];
