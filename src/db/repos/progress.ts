import { getAdapter } from '../connection';

/** "2026-09", on the local calendar. */
export function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Writes this month's net worth, replacing an earlier figure from the same month. */
export async function recordNetWorth(value: number, now: Date = new Date()): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `INSERT INTO NetWorthSnapshots (month, value, recorded_at) VALUES (?, ?, ?)
     ON CONFLICT(month) DO UPDATE SET value = excluded.value, recorded_at = excluded.recorded_at;`,
    [monthKey(now), value, now.toISOString()]
  );
}

/** Oldest first, at most `limit` months. */
export async function getNetWorthHistory(limit = 12): Promise<{ month: string; value: number }[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ month: string; value: number }>(
    `SELECT month, value FROM NetWorthSnapshots ORDER BY month DESC LIMIT ?;`,
    [limit]
  );
  return rows.reverse();
}

export async function getMilestones(): Promise<Map<string, string>> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ key: string; achieved_at: string }>(
    `SELECT key, achieved_at FROM Milestones;`
  );
  return new Map(rows.map((r) => [r.key, r.achieved_at]));
}

/** Records a milestone the first time it is reached; later calls keep the first date. */
export async function markMilestone(key: string, at: Date = new Date()): Promise<boolean> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO Milestones (key, achieved_at) VALUES (?, ?);`,
    [key, at.toISOString()]
  );
  return (result.changes ?? 0) > 0;
}

/**
 * What a window kept: net goal contributions plus net money invested. The
 * one number the saving habit is measured by.
 */
export async function getKeptBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ goals: number | null; invested: number | null }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM GoalContributions
          WHERE created_at >= ? AND created_at < ?) AS goals,
       (SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0)
          FROM Transactions
          WHERE non_spend_reason = 'INVESTMENT' AND status = 'COMPLETED' AND excluded_at IS NULL
            AND occurred_at >= ? AND occurred_at < ?) AS invested;`,
    [startIso, endIso, startIso, endIso]
  );
  return (row?.goals ?? 0) + (row?.invested ?? 0);
}
