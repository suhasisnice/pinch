import { DbAdapter } from './types';

// Exact table structures per the Phase 1 contract. Phase 2 code relies on
// these names and columns — do not rename.
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS Transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    merchant TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT'))
  );`,
  `CREATE TABLE IF NOT EXISTS Contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_ghost INTEGER NOT NULL DEFAULT 0
  );`,
  `CREATE TABLE IF NOT EXISTS IOUs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES Transactions(id),
    contact_id INTEGER NOT NULL REFERENCES Contacts(id),
    split_amount REAL NOT NULL,
    is_settled INTEGER NOT NULL DEFAULT 0
  );`,
];

export async function initSchema(db: DbAdapter): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execAsync(statement);
  }
  await ensureContactsPhoneColumn(db);
}

/**
 * Additive migration: Contacts didn't originally have a phone number (the
 * Phase 1 contract locked id/name/is_ghost). The Nudge feature needs one to
 * deep-link WhatsApp, so add it as a nullable column. Existing DBs created
 * before this migration get it retrofitted; the ALTER throws "duplicate
 * column name" on DBs that already have it, which we swallow.
 */
async function ensureContactsPhoneColumn(db: DbAdapter): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE Contacts ADD COLUMN phone TEXT;`);
  } catch {
    // Column already exists.
  }
}
