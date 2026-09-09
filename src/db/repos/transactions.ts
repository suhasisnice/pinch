import { getAdapter } from '../connection';
import { CaptureSource, Direction, TransactionKind, TransactionRow } from '../types';

export interface NewTransaction {
  amount: number;
  direction: Direction;
  kind: TransactionKind;
  merchant: string;
  category?: string | null;
  occurredAt?: string;
  source?: CaptureSource;
  rawText?: string | null;
  externalRef?: string | null;
  dedupKey?: string | null;
  outingId?: number | null;
  note?: string | null;
}

/**
 * Inserts a transaction, returning the new row id — or the id of the existing
 * row when `dedupKey` has already been seen.
 *
 * Deduplication is enforced by a UNIQUE index rather than a read-then-write
 * check, because SMS and the notification listener frequently deliver the same
 * payment within milliseconds of each other and a check-then-insert races.
 */
export async function addTransaction(input: NewTransaction): Promise<number> {
  const db = getAdapter();
  const now = new Date().toISOString();
  const occurredAt = input.occurredAt ?? now;

  if (input.dedupKey) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM Transactions WHERE dedup_key = ?;`,
      [input.dedupKey]
    );
    if (existing) return existing.id;
  }

  const result = await db.runAsync(
    `INSERT INTO Transactions
       (amount, direction, kind, merchant, category, occurred_at, source,
        raw_text, external_ref, dedup_key, outing_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      Math.abs(input.amount),
      input.direction,
      input.kind,
      input.merchant.trim(),
      input.category ?? null,
      occurredAt,
      input.source ?? 'MANUAL',
      input.rawText ?? null,
      input.externalRef ?? null,
      input.dedupKey ?? null,
      input.outingId ?? null,
      input.note ?? null,
      now,
    ]
  );
  return result.lastInsertRowId;
}

export async function getTransactionById(id: number): Promise<TransactionRow | null> {
  const db = getAdapter();
  return db.getFirstAsync<TransactionRow>(`SELECT * FROM Transactions WHERE id = ?;`, [id]);
}

export async function getAllTransactions(): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(`SELECT * FROM Transactions ORDER BY occurred_at DESC;`);
}

export async function getTransactionsBetween(
  startIso: string,
  endIso: string
): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions
     WHERE excluded_at IS NULL AND occurred_at >= ? AND occurred_at < ?
     ORDER BY occurred_at DESC;`,
    [startIso, endIso]
  );
}

export async function setTransactionCategory(id: number, category: string | null): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET category = ? WHERE id = ?;`, [category, id]);
}

export async function setTransactionOuting(id: number, outingId: number | null): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET outing_id = ? WHERE id = ?;`, [outingId, id]);
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`DELETE FROM Transactions WHERE id = ?;`, [id]);
}


/**
 * Edits a transaction the user is correcting by hand.
 *
 * A capture that read the merchant wrong is far more common than one that
 * should be thrown away entirely, and retyping the whole thing to fix a name
 * is busywork.
 */
export async function updateTransaction(
  id: number,
  fields: {
    amount?: number;
    merchant?: string;
    category?: string | null;
    occurredAt?: string;
    note?: string | null;
    direction?: Direction;
    kind?: TransactionKind;
  }
): Promise<void> {
  const db = getAdapter();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.amount !== undefined) {
    sets.push('amount = ?');
    params.push(Math.abs(fields.amount));
  }
  if (fields.merchant !== undefined) {
    sets.push('merchant = ?');
    params.push(fields.merchant.trim());
  }
  if (fields.category !== undefined) {
    sets.push('category = ?');
    params.push(fields.category);
  }
  if (fields.occurredAt !== undefined) {
    sets.push('occurred_at = ?');
    params.push(fields.occurredAt);
  }
  if (fields.note !== undefined) {
    sets.push('note = ?');
    params.push(fields.note);
  }
  if (fields.direction !== undefined) {
    sets.push('direction = ?');
    params.push(fields.direction);
  }
  if (fields.kind !== undefined) {
    sets.push('kind = ?');
    params.push(fields.kind);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE Transactions SET ${sets.join(', ')} WHERE id = ?;`, params);
}

/**
 * Marks a transaction as not real spending, or restores it.
 *
 * Kept rather than deleted so its dedup key still blocks the same promotional
 * SMS from being re-imported by the next backfill - deleting it would let the
 * junk straight back in.
 */
export async function setTransactionExcluded(id: number, excluded: boolean): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET excluded_at = ? WHERE id = ?;`, [
    excluded ? new Date().toISOString() : null,
    id,
  ]);
}

export async function getExcludedTransactions(): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions WHERE excluded_at IS NOT NULL ORDER BY occurred_at DESC;`
  );
}

/**
 * Spend totals per calendar month, newest first.
 *
 * The basis for any statement about "last month" - without it, insights can
 * only ever describe the period you happen to be in and can never notice a
 * trend across them.
 */
export async function getMonthlySpend(
  monthsBack = 6,
  now: Date = new Date()
): Promise<Array<{ month: string; total: number; count: number; days: number }>> {
  const db = getAdapter();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  return db.getAllAsync<{ month: string; total: number; count: number; days: number }>(
    `SELECT substr(occurred_at, 1, 7) AS month,
            SUM(amount) AS total,
            COUNT(*) AS count,
            COUNT(DISTINCT substr(occurred_at, 1, 10)) AS days
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND occurred_at >= ?
     GROUP BY month
     ORDER BY month DESC;`,
    [start.toISOString()]
  );
}

/** Category totals per month, for spotting what actually changed. */
export async function getCategoryByMonth(
  monthsBack = 6,
  now: Date = new Date()
): Promise<Array<{ month: string; category: string; total: number }>> {
  const db = getAdapter();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  return db.getAllAsync<{ month: string; category: string; total: number }>(
    `SELECT substr(occurred_at, 1, 7) AS month,
            COALESCE(category, 'Uncategorised') AS category,
            SUM(amount) AS total
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND occurred_at >= ?
     GROUP BY month, category
     ORDER BY month DESC, total DESC;`,
    [start.toISOString()]
  );
}

/**
 * Merchants charged in more than one distinct month - the raw material for
 * spotting a subscription the user has forgotten about.
 */
export async function getRepeatMerchants(
  monthsBack = 6,
  now: Date = new Date()
): Promise<
  Array<{ merchant: string; months: number; charges: number; total: number; lastAt: string }>
> {
  const db = getAdapter();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  return db.getAllAsync<{
    merchant: string;
    months: number;
    charges: number;
    total: number;
    lastAt: string;
  }>(
    `SELECT merchant,
            COUNT(DISTINCT substr(occurred_at, 1, 7)) AS months,
            COUNT(*) AS charges,
            SUM(amount) AS total,
            MAX(occurred_at) AS lastAt
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND occurred_at >= ?
     GROUP BY lower(merchant)
     HAVING months >= 2
     ORDER BY total DESC;`,
    [start.toISOString()]
  );
}

// ---------------------------------------------------------------------------
// Blocklist: senders and merchants that are never a transaction.
// ---------------------------------------------------------------------------

export async function addToBlocklist(pattern: string, reason?: string | null): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `INSERT OR IGNORE INTO CaptureBlocklist (pattern, reason, created_at) VALUES (?, ?, ?);`,
    [pattern.trim().toLowerCase(), reason ?? null, new Date().toISOString()]
  );
}

export async function removeFromBlocklist(pattern: string): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`DELETE FROM CaptureBlocklist WHERE pattern = ?;`, [
    pattern.trim().toLowerCase(),
  ]);
}

export async function getBlocklist(): Promise<Array<{ pattern: string; reason: string | null }>> {
  const db = getAdapter();
  return db.getAllAsync<{ pattern: string; reason: string | null }>(
    `SELECT pattern, reason FROM CaptureBlocklist ORDER BY created_at DESC;`
  );
}

/** True when any blocked pattern appears in the sender, merchant or body. */
export async function isBlocked(...candidates: Array<string | null | undefined>): Promise<boolean> {
  const patterns = await getBlocklist();
  if (patterns.length === 0) return false;

  const haystack = candidates.filter(Boolean).join(' ').toLowerCase();
  return patterns.some((entry) => haystack.includes(entry.pattern));
}

// ---------------------------------------------------------------------------
// Money queries.
//
// Every one of these filters on `kind`, never on `direction`. Summing DEBITs
// would sweep in SETTLE_OUT rows (paying a friend back) and double-count an
// expense that was already booked when the bill was paid. Summing CREDITs
// would treat a friend's repayment as fresh allowance.
// ---------------------------------------------------------------------------

/**
 * Gross spending in a window: SPEND minus REFUND. This is money that left the
 * account for goods and services — before accounting for anything friends owe
 * you back on those bills.
 */
export async function getGrossSpendBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT
       COALESCE(SUM(CASE WHEN kind = 'SPEND' THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN amount ELSE 0 END), 0) AS total
     FROM Transactions
     WHERE kind IN ('SPEND', 'REFUND') AND excluded_at IS NULL
       AND occurred_at >= ? AND occurred_at < ?;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/** Allowance and top-ups received in a window. Excludes friends repaying you. */
export async function getIncomeBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM Transactions
     WHERE kind = 'INCOME' AND excluded_at IS NULL AND occurred_at >= ? AND occurred_at < ?;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/**
 * Still-unrecovered money you fronted on bills paid within the window.
 *
 * Backed out of gross spending to get what you actually spent on yourself. It
 * uses each IOU's *open* balance (amount minus everything settled against it),
 * so a partial repayment moves this number by exactly what came back.
 */
export async function getOpenReceivablesOnSpendBetween(
  startIso: string,
  endIso: string
): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(open_amount), 0) AS total FROM (
       SELECT IOUs.amount - COALESCE(
         (SELECT SUM(s.amount) FROM Settlements s WHERE s.iou_id = IOUs.id), 0
       ) AS open_amount
       FROM IOUs
       JOIN Transactions ON Transactions.id = IOUs.transaction_id
       WHERE IOUs.direction = 'THEY_OWE_ME'
         AND Transactions.kind = 'SPEND'
         AND Transactions.excluded_at IS NULL
         AND Transactions.occurred_at >= ? AND Transactions.occurred_at < ?
     ) WHERE open_amount > 0;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/** Spending grouped by category for a window, largest first. */
export async function getSpendByCategory(
  startIso: string,
  endIso: string
): Promise<Array<{ category: string; total: number; count: number }>> {
  const db = getAdapter();
  return db.getAllAsync<{ category: string; total: number; count: number }>(
    `SELECT COALESCE(category, 'Uncategorised') AS category,
            SUM(amount) AS total,
            COUNT(*) AS count
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL
       AND occurred_at >= ? AND occurred_at < ?
     GROUP BY COALESCE(category, 'Uncategorised')
     ORDER BY total DESC;`,
    [startIso, endIso]
  );
}

/** Daily spend totals for a window, oldest first. Gaps are omitted, not zero-filled. */
export async function getDailySpend(
  startIso: string,
  endIso: string
): Promise<Array<{ day: string; total: number }>> {
  const db = getAdapter();
  return db.getAllAsync<{ day: string; total: number }>(
    `SELECT substr(occurred_at, 1, 10) AS day, SUM(amount) AS total
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL
       AND occurred_at >= ? AND occurred_at < ?
     GROUP BY day
     ORDER BY day ASC;`,
    [startIso, endIso]
  );
}

/**
 * Finds a recent transaction that looks like the same payment arriving from a
 * second source. The UNIQUE dedup_key catches anything carrying a bank
 * reference number; this is the fuzzy backstop for messages that carry none,
 * where SMS and the notification listener word the merchant differently.
 */
export async function findProbableDuplicate(
  amount: number,
  occurredAtIso: string,
  windowSeconds = 90
): Promise<TransactionRow | null> {
  const db = getAdapter();
  const at = new Date(occurredAtIso).getTime();
  const from = new Date(at - windowSeconds * 1000).toISOString();
  const to = new Date(at + windowSeconds * 1000).toISOString();

  return db.getFirstAsync<TransactionRow>(
    `SELECT * FROM Transactions
     WHERE abs(amount - ?) < 0.01 AND occurred_at >= ? AND occurred_at <= ?
     ORDER BY occurred_at DESC LIMIT 1;`,
    [amount, from, to]
  );
}
