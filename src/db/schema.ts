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

/**
 * Spend categories. `null` on a transaction means "not yet categorised" (shown
 * as "Needs Review" in the UI).
 *
 * Groceries, 'Bills & Utilities', Travel and Finance were added alongside
 * payment-method/subcategory support (schema v9). They are pure additions —
 * nothing existing was renamed or removed, so no already-categorised
 * transaction on any install changes category by this update alone.
 */
export const CATEGORIES = [
  'Food',
  'Outing',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Academics',
  'Health',
  'Other',
  'Groceries',
  'Bills & Utilities',
  'Travel',
  'Finance',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Seed merchant -> category (+ optional subcategory) rules. Deliberately
 * skewed to what actually shows up on an Indian student's statement. Users
 * can override any of these, and a correction upserts into MerchantRules so
 * the fix sticks.
 *
 * `INSERT OR IGNORE` (see connection.ts's seedMerchantRules) means an existing
 * install that already has a pattern keeps whatever it was first seeded with
 * — a later edit to an *existing* entry here only ever affects fresh installs.
 * For that reason no existing pattern's `category` is ever changed, and a
 * subcategory added here to an already-shipped pattern needs the matching
 * backfill UPDATE in migrations.ts v9 to actually reach existing users too.
 *
 * New categories only claim keywords nothing here already claims — e.g.
 * Groceries gets bigbasket/dmart/jiomart, not zepto/blinkit/instamart, which
 * stay Food from the original seed. See migrations.ts v9 for why.
 */
export const DEFAULT_MERCHANT_RULES: ReadonlyArray<{
  pattern: string;
  category: Category;
  subcategory?: string;
}> = [
  { pattern: 'swiggy', category: 'Food', subcategory: 'Food Delivery' },
  { pattern: 'zomato', category: 'Food', subcategory: 'Food Delivery' },
  { pattern: 'zepto', category: 'Food' },
  { pattern: 'blinkit', category: 'Food' },
  { pattern: 'instamart', category: 'Food' },
  { pattern: 'dominos', category: 'Food', subcategory: 'Fast Food' },
  { pattern: 'mcdonald', category: 'Food', subcategory: 'Fast Food' },
  { pattern: 'kfc', category: 'Food', subcategory: 'Fast Food' },
  { pattern: 'starbucks', category: 'Food', subcategory: 'Cafe' },
  { pattern: 'cafe', category: 'Food', subcategory: 'Cafe' },
  { pattern: 'canteen', category: 'Food', subcategory: 'Other Food' },
  { pattern: 'mess', category: 'Food', subcategory: 'Other Food' },
  { pattern: 'uber', category: 'Transport', subcategory: 'Cab' },
  { pattern: 'ola', category: 'Transport', subcategory: 'Cab' },
  { pattern: 'rapido', category: 'Transport', subcategory: 'Auto' },
  { pattern: 'irctc', category: 'Transport', subcategory: 'Public Transport' },
  { pattern: 'redbus', category: 'Transport', subcategory: 'Public Transport' },
  { pattern: 'metro', category: 'Transport', subcategory: 'Public Transport' },
  { pattern: 'petrol', category: 'Transport', subcategory: 'Fuel' },
  { pattern: 'amazon', category: 'Shopping', subcategory: 'Online Shopping' },
  { pattern: 'flipkart', category: 'Shopping', subcategory: 'Online Shopping' },
  { pattern: 'myntra', category: 'Shopping', subcategory: 'Clothing' },
  { pattern: 'ajio', category: 'Shopping', subcategory: 'Clothing' },
  { pattern: 'decathlon', category: 'Shopping', subcategory: 'Other Shopping' },
  { pattern: 'netflix', category: 'Subscriptions', subcategory: 'Streaming' },
  { pattern: 'spotify', category: 'Subscriptions', subcategory: 'Music' },
  { pattern: 'prime', category: 'Subscriptions', subcategory: 'Streaming' },
  { pattern: 'hotstar', category: 'Subscriptions', subcategory: 'Streaming' },
  { pattern: 'youtube', category: 'Subscriptions', subcategory: 'Streaming' },
  { pattern: 'jio', category: 'Subscriptions', subcategory: 'Mobile Recharge' },
  { pattern: 'airtel', category: 'Subscriptions', subcategory: 'Mobile Recharge' },
  { pattern: 'bookmyshow', category: 'Outing', subcategory: 'Movies' },
  { pattern: 'pvr', category: 'Outing', subcategory: 'Movies' },
  { pattern: 'inox', category: 'Outing', subcategory: 'Movies' },
  { pattern: 'cinepolis', category: 'Outing', subcategory: 'Movies' },
  { pattern: 'bar', category: 'Outing' },
  { pattern: 'brewery', category: 'Outing' },
  { pattern: 'pharmacy', category: 'Health', subcategory: 'Pharmacy' },
  { pattern: 'apollo', category: 'Health', subcategory: 'Pharmacy' },
  { pattern: 'pharmeasy', category: 'Health', subcategory: 'Pharmacy' },
  { pattern: 'hospital', category: 'Health', subcategory: 'Hospital' },
  { pattern: 'medical', category: 'Health', subcategory: 'Medical' },
  { pattern: 'book', category: 'Academics', subcategory: 'Books' },
  { pattern: 'stationery', category: 'Academics', subcategory: 'Books' },
  { pattern: 'xerox', category: 'Academics', subcategory: 'Books' },
  { pattern: 'udemy', category: 'Academics', subcategory: 'Courses' },
  { pattern: 'coursera', category: 'Academics', subcategory: 'Courses' },

  // -- Groceries (new, v9) — genuinely unclaimed patterns only; zepto/
  // blinkit/instamart above stay Food, see the note at the top of this file.
  { pattern: 'bigbasket', category: 'Groceries', subcategory: 'Online Grocery' },
  { pattern: 'jiomart', category: 'Groceries', subcategory: 'Online Grocery' },
  { pattern: 'dmart', category: 'Groceries', subcategory: 'Supermarket' },
  { pattern: 'reliance fresh', category: 'Groceries', subcategory: 'Supermarket' },
  { pattern: 'more supermarket', category: 'Groceries', subcategory: 'Supermarket' },
  { pattern: 'grocery', category: 'Groceries', subcategory: 'Daily Essentials' },
  { pattern: 'groceries', category: 'Groceries', subcategory: 'Daily Essentials' },

  // -- Bills & Utilities (new, v9) — 'jio'/'airtel' recharge already seeded
  // to Subscriptions above; utility-provider names are unclaimed.
  { pattern: 'bescom', category: 'Bills & Utilities', subcategory: 'Electricity' },
  { pattern: 'electricity bill', category: 'Bills & Utilities', subcategory: 'Electricity' },
  { pattern: 'water bill', category: 'Bills & Utilities', subcategory: 'Water' },
  { pattern: 'gas bill', category: 'Bills & Utilities', subcategory: 'Gas' },
  { pattern: 'indane', category: 'Bills & Utilities', subcategory: 'Gas' },
  { pattern: 'broadband bill', category: 'Bills & Utilities', subcategory: 'Internet' },
  { pattern: 'tata play', category: 'Bills & Utilities', subcategory: 'DTH' },

  // -- Travel (new, v9) — irctc/redbus/metro already seeded to Transport
  // above and left as-is; these are unclaimed booking-platform names.
  { pattern: 'makemytrip', category: 'Travel', subcategory: 'Travel Booking' },
  { pattern: 'goibibo', category: 'Travel', subcategory: 'Travel Booking' },
  { pattern: 'ixigo', category: 'Travel', subcategory: 'Travel Booking' },
  { pattern: 'cleartrip', category: 'Travel', subcategory: 'Travel Booking' },
  { pattern: 'airbnb', category: 'Travel', subcategory: 'Hotel' },
  { pattern: 'oyo', category: 'Travel', subcategory: 'Hotel' },
  { pattern: 'indigo', category: 'Travel', subcategory: 'Flight' },
  { pattern: 'spicejet', category: 'Travel', subcategory: 'Flight' },
  { pattern: 'air india', category: 'Travel', subcategory: 'Flight' },

  // -- Finance (new, v9) — EMI/loan/insurance/investment.
  { pattern: 'emi', category: 'Finance', subcategory: 'EMI' },
  { pattern: 'lic', category: 'Finance', subcategory: 'Insurance' },
  { pattern: 'policybazaar', category: 'Finance', subcategory: 'Insurance' },
  { pattern: 'zerodha', category: 'Finance', subcategory: 'Investments' },
  { pattern: 'groww', category: 'Finance', subcategory: 'Investments' },
  { pattern: 'mutual fund', category: 'Finance', subcategory: 'Investments' },
];
