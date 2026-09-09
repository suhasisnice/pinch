import { getAdapter } from '../connection';
import { BudgetPeriodRow } from '../types';
import { startOfDayIso } from '../../utils/format';

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

/**
 * Whole days between two instants, counted on the local calendar.
 *
 * Slicing the ISO strings to their date part counted UTC days instead, which
 * disagrees with the local midnight a period starts on: anywhere east of UTC,
 * a period created today began "yesterday" in UTC, so day one already reported
 * one day elapsed and the daily limit was divided by 29 instead of 30 — every
 * day of every period, in the same direction.
 */
function dayDiff(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toIso);
  to.setHours(0, 0, 0, 0);
  // Rounded rather than floored so a DST shift cannot lose or add a day.
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
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
    `SELECT * FROM BudgetPeriods WHERE starts_on <= ? AND ends_on > ?
     ORDER BY starts_on DESC, id DESC LIMIT 1;`,
    [nowIso, nowIso]
  );
  if (covering) return decorate(covering, now);

  const latest = await db.getFirstAsync<BudgetPeriodRow>(
    `SELECT * FROM BudgetPeriods ORDER BY starts_on DESC, id DESC LIMIT 1;`
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

  // Midnight, for the same reason as startBudgetPeriod: a period that begins
  // at the moment of first launch would exclude everything spent earlier today.
  const startsOn = startOfDayIso(now);
  const endsOn = new Date(Date.parse(startsOn) + 30 * MS_PER_DAY).toISOString();
  const id = await createBudgetPeriod({ startsOn, endsOn, allowance });

  return decorate(
    { id, starts_on: startsOn, ends_on: endsOn, allowance, created_at: startsOn },
    now
  );
}

/**
 * Starts (or restarts) the period the user just configured in Settings.
 *
 * Two things this does that a bare insert did not:
 *
 * - The period starts at midnight, not at the moment the button was pressed.
 *   Starting mid-afternoon silently excluded everything already spent today
 *   from the period totals, so the app disagreed with the user's own memory of
 *   the day within seconds of being set up.
 * - Re-running it on the same day updates that day's period instead of
 *   stacking another row on top of it. Correcting a typo in the allowance is a
 *   normal thing to do, and it should not leave a trail of dead periods that
 *   `getCurrentBudgetPeriod` then has to break a tie between.
 */
export async function startBudgetPeriod(input: {
  allowance: number;
  days: number;
  now?: Date;
}): Promise<BudgetPeriod> {
  const now = input.now ?? new Date();
  const days = Math.max(1, Math.round(input.days));

  // The user's local midnight, matching every other day boundary in the app.
  const startsOn = startOfDayIso(now);
  const endsOn = new Date(Date.parse(startsOn) + days * MS_PER_DAY).toISOString();

  const db = getAdapter();
  const sameDay = await db.getFirstAsync<BudgetPeriodRow>(
    `SELECT * FROM BudgetPeriods WHERE substr(starts_on, 1, 10) = ? ORDER BY id DESC LIMIT 1;`,
    [startsOn.slice(0, 10)]
  );

  if (sameDay) {
    await updateBudgetPeriod(sameDay.id, { allowance: input.allowance, startsOn, endsOn });
    return decorate(
      { ...sameDay, starts_on: startsOn, ends_on: endsOn, allowance: input.allowance },
      now
    );
  }

  const id = await createBudgetPeriod({ startsOn, endsOn, allowance: input.allowance });
  return decorate(
    { id, starts_on: startsOn, ends_on: endsOn, allowance: input.allowance, created_at: startsOn },
    now
  );
}

export async function getAllBudgetPeriods(): Promise<BudgetPeriodRow[]> {
  const db = getAdapter();
  return db.getAllAsync<BudgetPeriodRow>(`SELECT * FROM BudgetPeriods ORDER BY starts_on DESC;`);
}
