import * as db from '../db/dbService';
import {
  BudgetBreakdown,
  ReceivableInput,
  TodayStatus,
  computeBudget,
  computeToday,
  expectedRecovery,
  totalGoalReserve,
} from '../math/budget';
import { GoalProgress } from '../db/repos/goals';
import { averageDailySpend, computeStreak } from '../math/insights';
import { daysBetween, endOfDayIso, startOfDayIso } from '../utils/format';

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

  const goalReserve = totalGoalReserve(
    goals.map((goal) => ({
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      daysUntilDeadline: goal.deadline
        ? Math.ceil((new Date(goal.deadline).getTime() - now.getTime()) / MS_PER_DAY)
        : null,
      daysRemainingInPeriod: period.daysRemaining,
    }))
  );

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
