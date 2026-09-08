import { initSchema } from './schema';
import { createExpoAdapter } from './expoAdapter';
import { ContactRow, DbAdapter, IOURow, OpenIOUDetail, TransactionRow } from './types';

let adapter: DbAdapter | null = null;

function getAdapter(): DbAdapter {
  if (!adapter) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return adapter;
}

/**
 * Initializes the database and creates tables if they do not exist.
 * Call once at app startup. Tests inject a custom adapter (e.g. sql.js)
 * instead of touching the native expo-sqlite module.
 */
export async function initDatabase(customAdapter?: DbAdapter, databaseName = 'pinch.db'): Promise<void> {
  adapter = customAdapter ?? (await createExpoAdapter(databaseName));
  await initSchema(adapter);
}

/** Test-only escape hatch to reset module state between test files. */
export function __resetDatabaseForTests(): void {
  adapter = null;
}

// ---------------------------------------------------------------------------
// Required core API (exact names/signatures per Phase 1 contract)
// ---------------------------------------------------------------------------

export async function addTransaction(
  amount: number,
  merchant: string,
  type: 'DEBIT' | 'CREDIT'
): Promise<number> {
  const db = getAdapter();
  const timestamp = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO Transactions (amount, merchant, timestamp, type) VALUES (?, ?, ?, ?);`,
    [amount, merchant, timestamp, type]
  );
  return result.lastInsertRowId;
}

export async function createIOU(
  transactionId: number,
  contactId: number,
  splitAmount: number
): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `INSERT INTO IOUs (transaction_id, contact_id, split_amount, is_settled) VALUES (?, ?, ?, 0);`,
    [transactionId, contactId, splitAmount]
  );
}

export async function getOpenIOUs(): Promise<IOURow[]> {
  const db = getAdapter();
  return db.getAllAsync<IOURow>(`SELECT * FROM IOUs WHERE is_settled = 0;`);
}

/**
 * Finds the open IOU whose split_amount is closest to creditAmount (within
 * a small tolerance, to absorb floating point rounding) and marks it
 * settled. Returns true if a match was found and settled, false otherwise.
 */
export async function resolveIOUByAmount(creditAmount: number): Promise<boolean> {
  const db = getAdapter();
  const openIOUs = await db.getAllAsync<IOURow>(`SELECT * FROM IOUs WHERE is_settled = 0;`);

  const TOLERANCE = 0.01;
  let best: IOURow | null = null;
  let bestDiff = Infinity;

  for (const iou of openIOUs) {
    const diff = Math.abs(iou.split_amount - creditAmount);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = iou;
    }
  }

  if (!best || bestDiff > TOLERANCE) {
    return false;
  }

  await db.runAsync(`UPDATE IOUs SET is_settled = 1 WHERE id = ?;`, [best.id]);
  return true;
}

// ---------------------------------------------------------------------------
// Supporting helpers (additive — do not replace the required API above).
// Used by src/math/safeToSpend.ts and by tests.
// ---------------------------------------------------------------------------

export async function addContact(
  name: string,
  isGhost: boolean = false,
  phone?: string
): Promise<number> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO Contacts (name, is_ghost, phone) VALUES (?, ?, ?);`,
    [name, isGhost ? 1 : 0, phone?.trim() || null]
  );
  return result.lastInsertRowId;
}

export async function getContacts(): Promise<ContactRow[]> {
  const db = getAdapter();
  return db.getAllAsync<ContactRow>(`SELECT * FROM Contacts;`);
}

/** Open IOUs joined with contact name/phone and the originating transaction's merchant. */
export async function getOpenIOUsWithDetails(): Promise<OpenIOUDetail[]> {
  const db = getAdapter();
  return db.getAllAsync<OpenIOUDetail>(
    `SELECT
       IOUs.id as id,
       IOUs.contact_id as contactId,
       Contacts.name as contactName,
       Contacts.phone as contactPhone,
       IOUs.transaction_id as transactionId,
       Transactions.merchant as merchant,
       IOUs.split_amount as splitAmount
     FROM IOUs
     JOIN Contacts ON Contacts.id = IOUs.contact_id
     JOIN Transactions ON Transactions.id = IOUs.transaction_id
     WHERE IOUs.is_settled = 0
     ORDER BY Transactions.timestamp DESC;`
  );
}

/**
 * Looks up a contact by exact name (case-insensitive) and returns its id,
 * creating a new Contacts row if none exists yet. Lets callers that only
 * have a name (e.g. an SMS sender) resolve it to the contact_id createIOU
 * requires without duplicating a contact on every call.
 */
export async function findOrCreateContactByName(name: string): Promise<number> {
  const db = getAdapter();
  const trimmed = name.trim();
  const existing = await db.getFirstAsync<ContactRow>(
    `SELECT * FROM Contacts WHERE lower(name) = lower(?);`,
    [trimmed]
  );
  if (existing) {
    return existing.id;
  }
  return addContact(trimmed);
}

export async function getTransactionById(id: number): Promise<TransactionRow | null> {
  const db = getAdapter();
  return db.getFirstAsync<TransactionRow>(`SELECT * FROM Transactions WHERE id = ?;`, [id]);
}

export async function getAllTransactions(): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(`SELECT * FROM Transactions ORDER BY timestamp ASC;`);
}

/**
 * Sum of DEBIT transactions whose timestamp falls in the given calendar
 * month (UTC, "YYYY-MM" prefix match against the ISO timestamp).
 */
export async function getMonthlyDebitTotal(yearMonth: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM Transactions WHERE type = 'DEBIT' AND substr(timestamp, 1, 7) = ?;`,
    [yearMonth]
  );
  return row?.total ?? 0;
}

/**
 * Sum of split_amount for still-open IOUs whose underlying transaction
 * falls in the given calendar month. This is the amount to back out of
 * monthly expenses because it is owed back to the user, not truly spent.
 */
export async function getOpenIOUTotalForMonth(yearMonth: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(IOUs.split_amount) as total
     FROM IOUs
     JOIN Transactions ON Transactions.id = IOUs.transaction_id
     WHERE IOUs.is_settled = 0 AND substr(Transactions.timestamp, 1, 7) = ?;`,
    [yearMonth]
  );
  return row?.total ?? 0;
}

/**
 * Sum of DEBIT transactions logged at or after the given ISO timestamp.
 * Used for Mid-Month Calibration, where the user supplies a fresh starting
 * balance "as of today" and only spending after that point should count
 * against it (spending before it is already baked into the balance they
 * typed in).
 */
export async function getDebitTotalSince(isoTimestamp: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM Transactions WHERE type = 'DEBIT' AND timestamp >= ?;`,
    [isoTimestamp]
  );
  return row?.total ?? 0;
}

/**
 * Sum of split_amount for still-open IOUs whose underlying transaction was
 * logged at or after the given ISO timestamp. Calibration counterpart to
 * getOpenIOUTotalForMonth.
 */
export async function getOpenIOUTotalSince(isoTimestamp: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(IOUs.split_amount) as total
     FROM IOUs
     JOIN Transactions ON Transactions.id = IOUs.transaction_id
     WHERE IOUs.is_settled = 0 AND Transactions.timestamp >= ?;`,
    [isoTimestamp]
  );
  return row?.total ?? 0;
}
