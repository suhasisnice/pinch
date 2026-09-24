import { getAdapter } from '../connection';
import { OutingReserveRow, OutingRow, TransactionRow } from '../types';

export interface OutingSummary {
  id: number;
  name: string;
  emoji: string;
  startsAt: string;
  endsAt: string | null;
  budgetAmount: number | null;
  closedAt: string | null;
  /** Total that left your account on this outing. */
  totalSpent: number;
  /** What you are actually out of pocket, after what others owe you back. */
  yourShare: number;
  transactionCount: number;
  headcount: number;
  /** null when no budget was set. */
  budgetFraction: number | null;
  isOverBudget: boolean;
  /**
   * Money set aside for this outing — summed from OutingReserves, never
   * stored directly, so it cannot drift from the ledger entries that
   * produced it. Separate from `totalSpent`: reserving money and spending it
   * are two different events (PRODUCT_SPEC §"Reserved vs spent").
   */
  reservedAmount: number;
  /** What is still needed to fully fund the plan, or null with no budget set. */
  stillNeeded: number | null;
}

export async function createOuting(input: {
  name: string;
  emoji?: string;
  startsAt?: string;
  endsAt?: string | null;
  budgetAmount?: number | null;
}): Promise<number> {
  const db = getAdapter();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO Outings (name, emoji, starts_at, ends_at, budget_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      input.name.trim(),
      input.emoji ?? 'party',
      input.startsAt ?? now,
      input.endsAt ?? null,
      input.budgetAmount ?? null,
      now,
    ]
  );
  return result.lastInsertRowId;
}

export async function closeOuting(id: number): Promise<void> {
  const db = getAdapter();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE Outings SET closed_at = ?, ends_at = COALESCE(ends_at, ?) WHERE id = ?;`,
    [now, now, id]
  );
}

export async function reopenOuting(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Outings SET closed_at = NULL WHERE id = ?;`, [id]);
}

export async function deleteOuting(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`DELETE FROM Outings WHERE id = ?;`, [id]);
}

export async function updateOuting(
  id: number,
  fields: { name?: string; emoji?: string; budgetAmount?: number | null; endsAt?: string | null }
): Promise<void> {
  const db = getAdapter();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name.trim());
  }
  if (fields.emoji !== undefined) {
    sets.push('emoji = ?');
    params.push(fields.emoji);
  }
  if (fields.budgetAmount !== undefined) {
    sets.push('budget_amount = ?');
    params.push(fields.budgetAmount);
  }
  if (fields.endsAt !== undefined) {
    sets.push('ends_at = ?');
    params.push(fields.endsAt);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE Outings SET ${sets.join(', ')} WHERE id = ?;`, params);
}

/**
 * Outings with spend rolled up.
 *
 * `yourShare` backs out only the *open* portion of what others owe on the
 * outing's bills. Once a friend actually pays you back, their share stops
 * being subtracted here and the settlement lands as SETTLE_IN — counted in
 * exactly one place, never both.
 */
export async function getOutings(includeClosed = true): Promise<OutingSummary[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<
    OutingRow & {
      totalSpent: number | null;
      transactionCount: number;
      openOwed: number | null;
      headcount: number;
      reservedAmount: number | null;
    }
  >(
    `SELECT
       Outings.*,
       COALESCE((SELECT SUM(t.amount) FROM Transactions t
                 WHERE t.outing_id = Outings.id AND t.kind = 'SPEND'), 0) AS totalSpent,
       COALESCE((SELECT COUNT(*) FROM Transactions t
                 WHERE t.outing_id = Outings.id AND t.kind = 'SPEND'), 0) AS transactionCount,
       COALESCE((SELECT SUM(open_amount) FROM (
                   SELECT i.amount - COALESCE(
                     (SELECT SUM(s.amount) FROM Settlements s WHERE s.iou_id = i.id), 0
                   ) AS open_amount
                   FROM IOUs i
                   WHERE i.outing_id = Outings.id AND i.direction = 'THEY_OWE_ME'
                 ) WHERE open_amount > 0.009), 0) AS openOwed,
       COALESCE((SELECT COUNT(DISTINCT i.contact_id) FROM IOUs i
                 WHERE i.outing_id = Outings.id), 0) AS headcount,
       COALESCE((SELECT SUM(r.amount) FROM OutingReserves r
                 WHERE r.outing_id = Outings.id), 0) AS reservedAmount
     FROM Outings
     ${includeClosed ? '' : 'WHERE closed_at IS NULL'}
     ORDER BY starts_at DESC;`
  );

  return rows.map((row) => {
    const totalSpent = row.totalSpent ?? 0;
    const yourShare = Math.max(0, totalSpent - (row.openOwed ?? 0));
    const reservedAmount = row.reservedAmount ?? 0;
    return {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      budgetAmount: row.budget_amount,
      closedAt: row.closed_at,
      totalSpent,
      yourShare,
      transactionCount: row.transactionCount,
      // +1 for you — IOU rows only cover the other people.
      headcount: row.headcount + 1,
      budgetFraction: row.budget_amount ? totalSpent / row.budget_amount : null,
      isOverBudget: row.budget_amount != null && totalSpent > row.budget_amount,
      reservedAmount,
      stillNeeded: row.budget_amount != null ? Math.max(0, row.budget_amount - reservedAmount) : null,
    };
  });
}

/**
 * Sets aside money for an outing without moving cash — the reserve ledger
 * entry mirrors GoalContributions exactly and for the same reason:
 * `reservedAmount` above is always summed fresh from this table, so it
 * cannot drift from what was actually reserved and released.
 *
 * Never writes a Transaction: the money has not moved, it is still in the
 * account and merely spoken for (same reasoning as contributeToGoal).
 */
export async function reserveForOuting(
  outingId: number,
  amount: number,
  source: 'MANUAL' | 'AUTO' = 'MANUAL'
): Promise<number> {
  if (amount === 0) return 0;
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO OutingReserves (outing_id, amount, source, created_at) VALUES (?, ?, ?, ?);`,
    [outingId, amount, source, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

/**
 * Frees up previously reserved money. A negative-amount ledger entry rather
 * than deleting rows, so the full history of what was reserved and when
 * stays auditable (PRODUCT_SPEC §11: never discard evidence merely because
 * it was superseded).
 */
export async function releaseOutingReserve(
  outingId: number,
  amount: number,
  source: 'MANUAL' | 'AUTO' = 'MANUAL'
): Promise<number> {
  return reserveForOuting(outingId, -Math.abs(amount), source);
}

export async function getOutingReserved(outingId: number): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM OutingReserves WHERE outing_id = ?;`,
    [outingId]
  );
  return row?.total ?? 0;
}

export async function getReserveHistory(outingId: number): Promise<OutingReserveRow[]> {
  const db = getAdapter();
  return db.getAllAsync<OutingReserveRow>(
    `SELECT * FROM OutingReserves WHERE outing_id = ? ORDER BY created_at DESC;`,
    [outingId]
  );
}

/**
 * Total money currently protected across every open outing — the Outings
 * side of "protected money" in the budget engine (see math/budget.ts).
 *
 * Scoped to outings that are not yet closed: closing an outing already means
 * "done," so its reserve should stop claiming a share of the budget even if
 * nothing explicitly released it back with releaseOutingReserve. The ledger
 * rows themselves are never deleted.
 */
export async function getTotalOutingReserved(): Promise<number> {
  const db = getAdapter();
  // What is still protected is the reserve minus what has already been spent
  // on the outing. The spending itself is already out of the budget (it is in
  // grossSpend like any other), so leaving the reserve at full size charged
  // every rupee spent on an outing twice until the outing was closed. That was
  // the "set aside looks high" report (docs/FIX_QUEUE.md). The filters are the
  // same ones getGrossSpendBetween uses, so the two can never disagree about
  // what counts as spent.
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(MAX(0, reserved - spent)), 0) AS total FROM (
       SELECT
         o.id,
         COALESCE((SELECT SUM(r.amount) FROM OutingReserves r WHERE r.outing_id = o.id), 0) AS reserved,
         COALESCE((SELECT SUM(CASE WHEN t.kind = 'SPEND' THEN t.amount ELSE -t.amount END)
                   FROM Transactions t
                   WHERE t.outing_id = o.id AND t.kind IN ('SPEND', 'REFUND')
                     AND t.status = 'COMPLETED' AND t.excluded_at IS NULL
                     AND t.transfer_pair_id IS NULL AND t.non_spend_reason IS NULL), 0) AS spent
       FROM Outings o
       WHERE o.closed_at IS NULL
     );`
  );
  return row?.total ?? 0;
}

export async function getOutingById(id: number): Promise<OutingSummary | null> {
  const all = await getOutings(true);
  return all.find((o) => o.id === id) ?? null;
}

/** The outing currently in progress, if any — used to auto-tag new spending. */
export async function getActiveOuting(at: string = new Date().toISOString()): Promise<OutingRow | null> {
  const db = getAdapter();
  return db.getFirstAsync<OutingRow>(
    `SELECT * FROM Outings
     WHERE closed_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at >= ?)
     ORDER BY starts_at DESC LIMIT 1;`,
    [at, at]
  );
}

export async function getOutingTransactions(outingId: number): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions WHERE outing_id = ? ORDER BY occurred_at DESC;`,
    [outingId]
  );
}

/**
 * Untagged spending inside an outing's time window — the "you spent 1,240
 * during Goa Trip, add it?" suggestion.
 */
export async function getCandidateTransactions(outingId: number): Promise<TransactionRow[]> {
  const db = getAdapter();
  const outing = await db.getFirstAsync<OutingRow>(`SELECT * FROM Outings WHERE id = ?;`, [outingId]);
  if (!outing) return [];

  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions
     WHERE kind = 'SPEND'
       AND outing_id IS NULL
       AND occurred_at >= ?
       AND occurred_at <= ?
     ORDER BY occurred_at DESC;`,
    [outing.starts_at, outing.ends_at ?? new Date().toISOString()]
  );
}
