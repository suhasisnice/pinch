import { getAdapter } from '../connection';

export interface BalanceSnapshot {
  id: number;
  amount: number;
  recordedAt: string;
}

export interface BalanceState {
  /** The last figure the user typed in, if any. */
  snapshot: BalanceSnapshot | null;
  /** That figure moved by everything captured since. */
  projected: number | null;
  /** Money out since the snapshot. */
  spentSince: number;
  /** Money in since the snapshot. */
  receivedSince: number;
}

export async function recordBalance(amount: number, at: Date = new Date()): Promise<number> {
  const db = getAdapter();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO BalanceSnapshots (amount, recorded_at, created_at) VALUES (?, ?, ?);`,
    [amount, at.toISOString(), now]
  );
  return result.lastInsertRowId;
}

export async function getLatestBalanceSnapshot(): Promise<BalanceSnapshot | null> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ id: number; amount: number; recorded_at: string }>(
    `SELECT id, amount, recorded_at FROM BalanceSnapshots
     ORDER BY recorded_at DESC, id DESC LIMIT 1;`
  );
  return row ? { id: row.id, amount: row.amount, recordedAt: row.recorded_at } : null;
}

/**
 * The balance now, projected forward from the last figure the user typed.
 *
 * Every direction counts here, not just spending — this is the bank account,
 * not the budget. Transfers between the user's own accounts net to zero
 * across their two legs, which is right for a total across accounts, and
 * excluded junk is left out because it never happened.
 */
export async function getBalanceState(): Promise<BalanceState> {
  const snapshot = await getLatestBalanceSnapshot();
  if (!snapshot) {
    return { snapshot: null, projected: null, spentSince: 0, receivedSince: 0 };
  }

  const db = getAdapter();
  const row = await db.getFirstAsync<{ out: number | null; inn: number | null }>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0) AS out,
       COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS inn
     FROM Transactions
     WHERE excluded_at IS NULL AND occurred_at > ?;`,
    [snapshot.recordedAt]
  );

  const spentSince = row?.out ?? 0;
  const receivedSince = row?.inn ?? 0;

  return {
    snapshot,
    projected: snapshot.amount - spentSince + receivedSince,
    spentSince,
    receivedSince,
  };
}

export async function getBalanceHistory(limit = 20): Promise<BalanceSnapshot[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ id: number; amount: number; recorded_at: string }>(
    `SELECT id, amount, recorded_at FROM BalanceSnapshots
     ORDER BY recorded_at DESC, id DESC LIMIT ?;`,
    [limit]
  );
  return rows.map((r) => ({ id: r.id, amount: r.amount, recordedAt: r.recorded_at }));
}
