import { getAdapter } from '../connection';
import { BudgetPeriodRow } from '../types';

/**
 * A budget period is the window one allowance has to last.
 *
 * It is stored rather than computed from the calendar because a student's
 * month starts when money lands, not on the 1st. Someone paid on the 5th who
 * budgets against calendar months looks flush for four days and broke for the
 * rest — the app would be wrong in the same direction every single month.
 */
export interface BudgetPeriod {
  id: number;
  startsOn: string;
  endsOn: string;
  allowance: number;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayDiff(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso.slice(0, 10));
  const to = Date.parse(toIso.slice(0, 10));
  return Math.round((to - from) / MS_PER_DAY);
}

function decorate(row: BudgetPeriodRow, now: Date): BudgetPeriod {
  const nowIso = now.toISOString();
  const daysTotal = Math.max(1, dayDiff(row.starts_on, row.ends_on));
  const elapsed = Math.min(daysTotal, Math.max(0, dayDiff(row.starts_on, nowIso)));
  return {
    id: row.id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    allowance: row.allowance,
    daysTotal,
    daysElapsed: elapsed,
    // Never zero: today is always still spendable, and this is a divisor.
    daysRemaining: Math.max(1, daysTotal - elapsed),
  };
}

export async function createBudgetPeriod(input: {
  startsOn: string;
  endsOn: string;
  allowance: number;
}): Promise<number> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO BudgetPeriods (starts_on, ends_on, allowance, created_at) VALUES (?, ?, ?, ?);`,
    [input.startsOn, input.endsOn, input.allowance, new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

/** The period containing `now`, or the most recent one if none covers it. */
export async function getCurrentBudgetPeriod(
  now: Date = new Date()
): Promise<BudgetPeriod | null> {
  const db = getAdapter();
  const nowIso = now.toISOString();

  const covering = await db.getFirstAsync<BudgetPeriodRow>(
    `SELECT * FROM BudgetPeriods WHERE starts_on <= ? AND ends_on > ? ORDER BY starts_on DESC LIMIT 1;`,
    [nowIso, nowIso]
  );
  if (covering) return decorate(covering, now);

  const latest = await db.getFirstAsync<BudgetPeriodRow>(
    `SELECT * FROM BudgetPeriods ORDER BY starts_on DESC LIMIT 1;`
  );
  return latest ? decorate(latest, now) : null;
}

export async function updateBudgetPeriod(
  id: number,
  fields: { allowance?: number; startsOn?: string; endsOn?: string }
): Promise<void> {
  const db = getAdapter();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.allowance !== undefined) {
    sets.push('allowance = ?');
    params.push(fields.allowance);
  }
  if (fields.startsOn !== undefined) {
    sets.push('starts_on = ?');
    params.push(fields.startsOn);
  }
  if (fields.endsOn !== undefined) {
    sets.push('ends_on = ?');
    params.push(fields.endsOn);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE BudgetPeriods SET ${sets.join(', ')} WHERE id = ?;`, params);
}

/**
 * Returns the current period, creating a default one (today + 30 days) when
 * the user has never set one up. Guarantees the home screen always has a
 * window to divide by.
 */
export async function ensureBudgetPeriod(
  allowance: number,
  now: Date = new Date()
): Promise<BudgetPeriod> {
  const existing = await getCurrentBudgetPeriod(now);
  if (existing && existing.endsOn > now.toISOString()) return existing;

  const startsOn = now.toISOString();
  const endsOn = new Date(now.getTime() + 30 * MS_PER_DAY).toISOString();
  const id = await createBudgetPeriod({ startsOn, endsOn, allowance });

  return decorate(
    { id, starts_on: startsOn, ends_on: endsOn, allowance, created_at: startsOn },
    now
  );
}

export async function getAllBudgetPeriods(): Promise<BudgetPeriodRow[]> {
  const db = getAdapter();
  return db.getAllAsync<BudgetPeriodRow>(`SELECT * FROM BudgetPeriods ORDER BY starts_on DESC;`);
}
