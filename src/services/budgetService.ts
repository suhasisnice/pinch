import * as db from '../db/dbService';
import {
  BudgetBreakdown,
  ReceivableInput,
  TodayStatus,
  computeBudget,
  computeToday,
  expectedRecovery,
  cappedGoalReserve,
} from '../math/budget';
import { GoalProgress } from '../db/repos/goals';
import { averageDailySpend, categoryBreakdown, computeStreak, detectRecurring } from '../math/insights';
import { daysBetween, endOfDayIso, startOfDayIso, formatMoney, formatDayLabel } from '../utils/format';

export interface BudgetSnapshot {
  budget: BudgetBreakdown;
  today: TodayStatus;
  goals: GoalProgress[];
  periodStart: string;
  periodEnd: string;
  daysRemaining: number;
  avgDailyBurn: number;
  streakDays: number;
  totalReceivable: number;
  totalPayable: number;
  pendingCaptures: number;
  /** True when goals wanted more than the period could safely give them. */
  goalReserveCapped: boolean;
  /** What goals asked for before the ceiling was applied. */
  goalReserveRequested: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Gathers everything the home screen needs in one pass.
 *
 * Deliberately a single function rather than a hook per number: Safe-to-Spend,
 * today's remainder and the goal reserve all have to be computed from the same
 * instant, or the screen shows figures that quietly disagree with each other.
 */
export async function getBudgetSnapshot(
  allowanceFallback: number,
  now: Date = new Date()
): Promise<BudgetSnapshot> {
  const period = await db.ensureBudgetPeriod(allowanceFallback, now);
  const nowIso = now.toISOString();

  const [
    grossSpend,
    income,
    settledIn,
    settledOut,
    balances,
    openIOUs,
    goals,
    totalReceivable,
    totalPayable,
    pendingCaptures,
  ] = await Promise.all([
    db.getGrossSpendBetween(period.startsOn, period.endsOn),
    db.getIncomeBetween(period.startsOn, period.endsOn),
    getKindTotal('SETTLE_IN', period.startsOn, period.endsOn),
    getKindTotal('SETTLE_OUT', period.startsOn, period.endsOn),
    db.getContactBalances(),
    db.getOpenIOUs(),
    db.getActiveGoals(),
    db.getTotalReceivable(),
    db.getTotalPayable(),
    db.getPendingCaptureCount(),
  ]);

  // Weight each outstanding debt by how reliably that person actually pays.
  const balanceByContact = new Map(balances.map((b) => [b.contactId, b]));
  const receivables: ReceivableInput[] = openIOUs
    .filter((iou) => iou.direction === 'THEY_OWE_ME' && iou.openAmount > 0)
    .map((iou) => {
      const contact = balanceByContact.get(iou.contactId);
      return {
        openAmount: iou.openAmount,
        avgDaysToSettle: contact?.avgDaysToSettle ?? null,
        settledCount: contact?.settledCount ?? 0,
        isGhost: contact?.isGhost ?? false,
        daysOutstanding: Math.max(0, daysBetween(iou.createdAt, nowIso)),
      };
    });

  const goalReserveResult = cappedGoalReserve(
    goals.map((goal) => ({
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      daysUntilDeadline: goal.deadline
        ? Math.ceil((new Date(goal.deadline).getTime() - now.getTime()) / MS_PER_DAY)
        : null,
      daysRemainingInPeriod: period.daysRemaining,
    })),
    period.allowance + income
  );
  const goalReserve = goalReserveResult.reserved;

  const budget = computeBudget({
    allowance: period.allowance,
    topUps: income,
    grossSpend,
    settledIn,
    settledOut,
    expectedRecovery: expectedRecovery(receivables),
    openPayables: totalPayable,
    goalReserve,
    daysRemaining: period.daysRemaining,
  });

  const spentToday = await db.getGrossSpendBetween(startOfDayIso(now), endOfDayIso(now));
  const daily = await db.getDailySpend(period.startsOn, period.endsOn);

  return {
    budget,
    today: computeToday(budget.dailyLimit, spentToday),
    goals,
    periodStart: period.startsOn,
    periodEnd: period.endsOn,
    daysRemaining: period.daysRemaining,
    avgDailyBurn: averageDailySpend(daily),
    streakDays: computeStreak(daily, budget.dailyLimit, nowIso.slice(0, 10)),
    totalReceivable,
    totalPayable,
    pendingCaptures,
    goalReserveCapped: goalReserveResult.capped,
    goalReserveRequested: goalReserveResult.requested,
  };
}

async function getKindTotal(kind: string, startIso: string, endIso: string): Promise<number> {
  const adapter = db.getAdapter();
  const row = await adapter.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM Transactions
     WHERE kind = ? AND occurred_at >= ? AND occurred_at < ?;`,
    [kind, startIso, endIso]
  );
  return row?.total ?? 0;
}

/**
 * Reads a payday as either a plain number of days ("28") or a day/month
 * ("25/12", "5/3").
 *
 * A date in the past is taken to mean next year's one, so entering "05/01" on
 * New Year's Eve means the coming January, not one that has already gone.
 * Both ends are pinned to midnight so the answer is a count of calendar days
 * and does not quietly drop one depending on the time of day it was typed.
 */
export function parsePaydayDateOrDays(
  input: string,
  now: Date = new Date()
): { days: number; paydayDateIso: string } | null {
  const trimmed = input.trim();

  if (/^\d+$/.test(trimmed)) {
    const days = parseInt(trimmed, 10);
    const payday = new Date(now);
    payday.setDate(payday.getDate() + days);
    return { days, paydayDateIso: payday.toISOString() };
  }

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let target = new Date(today.getFullYear(), month - 1, day);
  // Rejects the likes of 30/02, which JS would roll forward into March.
  if (target.getDate() !== day || target.getMonth() !== month - 1) return null;

  if (target.getTime() < today.getTime()) {
    target = new Date(today.getFullYear() + 1, month - 1, day);
  }

  return {
    days: daysBetween(today.toISOString(), target.toISOString()),
    paydayDateIso: target.toISOString(),
  };
}

/**
 * What an allowance works out to per day, phrased for the budget editor.
 *
 * Returns null rather than Infinity when the period is empty, so the caller
 * shows nothing instead of a nonsense daily rate.
 */
export function budgetPreview(
  allowance: number,
  daysOrPayday: number | string,
  now: Date = new Date()
): { daily: number; days: number; paydayIso: string | null; previewString: string } | null {
  let days: number;
  let paydayIso: string | null = null;

  if (typeof daysOrPayday === 'number') {
    days = daysOrPayday;
  } else {
    const parsed = parsePaydayDateOrDays(daysOrPayday, now);
    if (!parsed) return null;
    days = parsed.days;
    paydayIso = parsed.paydayDateIso;
  }

  if (days <= 0) return null;

  const daily = Math.floor(allowance / days);
  const previewString = paydayIso
    ? `About ${formatMoney(daily)} / day from today until ${formatDayLabel(paydayIso)}`
    : `About ${formatMoney(daily)} / day over the next ${days} day${days === 1 ? '' : 's'}`;

  return { daily, days, paydayIso, previewString };
}

export interface SpendingHistorySummary {
  /** What subscriptions and other repeating charges cost per month, typically. */
  recurringMonthly: number;
  recurringCount: number;
  /** Largest few categories over the window, largest first. */
  topCategories: Array<{ category: string; total: number; fraction: number }>;
  totalSpend: number;
}

/**
 * What the last few months actually looked like, for someone about to set a
 * new budget rather than drift into another one.
 *
 * Deliberately not used to set the new allowance — that number should come
 * from what the person actually has now, not from a habit they are trying to
 * leave behind (see FreshStartSheet). This exists for the question the
 * allowance figure can't answer on its own: where does it tend to go. A
 * strict number chosen blind gets blown by the first subscription renewal
 * nobody remembered was still running; this is what lets it get chosen with
 * eyes open instead.
 *
 * Returns null when there is not enough history to say anything real, so the
 * caller can simply show nothing rather than a summary of almost no data.
 */
export async function getSpendingHistorySummary(
  now: Date = new Date(),
  windowDays = 90
): Promise<SpendingHistorySummary | null> {
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [categories, repeatRows] = await Promise.all([
    db.getSpendByCategory(windowStart.toISOString(), now.toISOString()),
    db.getRepeatMerchants(6, now),
  ]);

  const totalSpend = categories.reduce((sum, row) => sum + row.total, 0);
  if (totalSpend <= 0) return null;

  const recurring = detectRecurring(repeatRows);
  const recurringMonthly = recurring.reduce((sum, charge) => sum + charge.typicalAmount, 0);

  const topCategories = categoryBreakdown(categories)
    .slice(0, 3)
    .map((slice) => ({ category: slice.category, total: slice.total, fraction: slice.fraction }));

  return { recurringMonthly, recurringCount: recurring.length, topCategories, totalSpend };
}
