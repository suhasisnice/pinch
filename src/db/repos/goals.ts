import { getAdapter } from '../connection';
import { GoalContributionRow, GoalRow } from '../types';

export interface GoalProgress {
  id: number;
  name: string;
  emoji: string;
  targetAmount: number;
  savedAmount: number;
  remainingAmount: number;
  deadline: string | null;
  /** 0..1, clamped. */
  fraction: number;
  isComplete: boolean;
  createdAt: string;
}

export async function createGoal(input: {
  name: string;
  targetAmount: number;
  emoji?: string;
  deadline?: string | null;
}): Promise<number> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO Goals (name, emoji, target_amount, deadline, created_at) VALUES (?, ?, ?, ?, ?);`,
    [
      input.name.trim(),
      input.emoji ?? '🎯',
      input.targetAmount,
      input.deadline ?? null,
      new Date().toISOString(),
    ]
  );
  return result.lastInsertRowId;
}

export async function archiveGoal(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Goals SET archived_at = ? WHERE id = ?;`, [
    new Date().toISOString(),
    id,
  ]);
}

export async function deleteGoal(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`DELETE FROM Goals WHERE id = ?;`, [id]);
}

export async function updateGoal(
  id: number,
  fields: { name?: string; targetAmount?: number; deadline?: string | null; emoji?: string }
): Promise<void> {
  const db = getAdapter();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name.trim());
  }
  if (fields.targetAmount !== undefined) {
    sets.push('target_amount = ?');
    params.push(fields.targetAmount);
  }
  if (fields.deadline !== undefined) {
    sets.push('deadline = ?');
    params.push(fields.deadline);
  }
  if (fields.emoji !== undefined) {
    sets.push('emoji = ?');
    params.push(fields.emoji);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE Goals SET ${sets.join(', ')} WHERE id = ?;`, params);
}

/**
 * Active goals with progress folded in.
 *
 * `savedAmount` is summed from GoalContributions rather than stored on the
 * goal, so it cannot drift from the contributions that produced it. Note that
 * contributions never create a Transaction: the money has not moved anywhere,
 * it is still in the account and merely spoken for. Writing a SPEND row for a
 * contribution would subtract it from the budget twice — once as spending and
 * again as a savings reserve.
 */
export async function getActiveGoals(): Promise<GoalProgress[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<GoalRow & { saved: number | null }>(
    `SELECT Goals.*,
            COALESCE((SELECT SUM(amount) FROM GoalContributions gc WHERE gc.goal_id = Goals.id), 0) AS saved
     FROM Goals
     WHERE archived_at IS NULL
     ORDER BY
       CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
       deadline ASC,
       created_at ASC;`
  );

  return rows.map((row) => {
    const saved = row.saved ?? 0;
    const remaining = Math.max(0, row.target_amount - saved);
    return {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      targetAmount: row.target_amount,
      savedAmount: saved,
      remainingAmount: remaining,
      deadline: row.deadline,
      fraction: row.target_amount > 0 ? Math.min(1, Math.max(0, saved / row.target_amount)) : 0,
      isComplete: remaining <= 0.009,
      createdAt: row.created_at,
    };
  });
}

export async function getGoalById(id: number): Promise<GoalProgress | null> {
  const goals = await getActiveGoals();
  return goals.find((g) => g.id === id) ?? null;
}

/**
 * Records progress toward a goal. Positive amounts save; negative amounts
 * withdraw (the honest escape hatch for a broke week — better than letting
 * someone silently fall behind and delete the app).
 */
export async function contributeToGoal(
  goalId: number,
  amount: number,
  source: 'ROUNDUP' | 'MANUAL' | 'AUTO' = 'MANUAL',
  transactionId?: number | null
): Promise<number> {
  if (amount === 0) return 0;
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO GoalContributions (goal_id, amount, source, transaction_id, created_at)
     VALUES (?, ?, ?, ?, ?);`,
    [goalId, amount, source, transactionId ?? null, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

export async function getContributions(goalId: number): Promise<GoalContributionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<GoalContributionRow>(
    `SELECT * FROM GoalContributions WHERE goal_id = ? ORDER BY created_at DESC;`,
    [goalId]
  );
}

/** Total saved across every active goal — money reserved, not yet spent. */
export async function getTotalReserved(): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(gc.amount), 0) AS total
     FROM GoalContributions gc
     JOIN Goals ON Goals.id = gc.goal_id
     WHERE Goals.archived_at IS NULL;`
  );
  return row?.total ?? 0;
}
