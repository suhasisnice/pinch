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

/** Where the money sits: the bank account, or notes in the wallet. */
export type Pocket = 'BANK' | 'CASH';

export async function recordBalance(
  amount: number,
  at: Date = new Date(),
  pocket: Pocket = 'BANK'
): Promise<number> {
  const db = getAdapter();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO BalanceSnapshots (amount, recorded_at, created_at, pocket) VALUES (?, ?, ?, ?);`,
    [amount, at.toISOString(), now, pocket]
  );
  return result.lastInsertRowId;
}

export async function getLatestBalanceSnapshot(
  pocket: Pocket = 'BANK'
): Promise<BalanceSnapshot | null> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ id: number; amount: number; recorded_at: string }>(
    `SELECT id, amount, recorded_at FROM BalanceSnapshots
     WHERE pocket = ?
     ORDER BY recorded_at DESC, id DESC LIMIT 1;`,
    [pocket]
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
     WHERE excluded_at IS NULL AND paid_in_cash = 0 AND occurred_at > ?;`,
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

/**
 * The notes in the wallet now, projected from the last count the user typed.
 *
 * Only two things move it: a cash withdrawal puts money in, and a payment
 * logged as paid in cash takes it out. Cash spent and never logged is
 * invisible here until the user counts again, and the gap is that spending.
 */
export async function getCashState(): Promise<BalanceState> {
  const snapshot = await getLatestBalanceSnapshot('CASH');
  if (!snapshot) {
    return { snapshot: null, projected: null, spentSince: 0, receivedSince: 0 };
  }

  const row = await getAdapter().getFirstAsync<{ out: number | null; inn: number | null }>(
    `SELECT
       COALESCE(SUM(CASE WHEN paid_in_cash = 1 AND direction = 'DEBIT' THEN amount ELSE 0 END), 0) AS out,
       COALESCE(SUM(CASE WHEN non_spend_reason = 'CASH_WITHDRAWAL' THEN amount ELSE 0 END), 0) AS inn
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

/** When the wallet was first counted, or null if cash is not being tracked. */
export async function getCashTrackedSince(): Promise<string | null> {
  const row = await getAdapter().getFirstAsync<{ since: string | null }>(
    `SELECT MIN(recorded_at) AS since FROM BalanceSnapshots WHERE pocket = 'CASH';`
  );
  return row?.since ?? null;
}

export async function getBalanceHistory(limit = 20): Promise<BalanceSnapshot[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ id: number; amount: number; recorded_at: string }>(
    `SELECT id, amount, recorded_at FROM BalanceSnapshots
     WHERE pocket = 'BANK'
     ORDER BY recorded_at DESC, id DESC LIMIT ?;`,
    [limit]
  );
  return rows.map((r) => ({ id: r.id, amount: r.amount, recordedAt: r.recorded_at }));
}
