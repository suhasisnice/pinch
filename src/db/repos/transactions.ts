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
     WHERE occurred_at >= ? AND occurred_at < ?
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
     WHERE kind IN ('SPEND', 'REFUND') AND occurred_at >= ? AND occurred_at < ?;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/** Allowance and top-ups received in a window. Excludes friends repaying you. */
export async function getIncomeBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM Transactions
     WHERE kind = 'INCOME' AND occurred_at >= ? AND occurred_at < ?;`,
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
     WHERE kind = 'SPEND' AND occurred_at >= ? AND occurred_at < ?
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
     WHERE kind = 'SPEND' AND occurred_at >= ? AND occurred_at < ?
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
