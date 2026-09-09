import { getAdapter } from '../connection';
import { OutingRow, TransactionRow } from '../types';

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
                 WHERE i.outing_id = Outings.id), 0) AS headcount
     FROM Outings
     ${includeClosed ? '' : 'WHERE closed_at IS NULL'}
     ORDER BY starts_at DESC;`
  );

  return rows.map((row) => {
    const totalSpent = row.totalSpent ?? 0;
    const yourShare = Math.max(0, totalSpent - (row.openOwed ?? 0));
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
    };
  });
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
