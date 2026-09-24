import * as db from '../db/dbService';
import { HoldingSummary } from '../db/repos/holdings';
import { GoalProgress } from '../db/repos/goals';
import {
  CAUTIOUS_RETURN_RATE,
  DEFAULT_RETURN_RATE,
  Ladder,
  cushionTarget,
  holdingWorth,
  ladder,
  monthsBetween,
} from '../math/wealth';
import { DEFAULT_PAY_PLAN, PayPlan, Payday, splitAcrossGoals } from '../math/payday';
import {
  HabitInsight,
  MilestoneState,
  habitInsight,
  habitStreak,
  keptRate,
  netWorth,
  nextMilestone,
  reachedMilestones,
} from '../math/progress';
import { getBudgetSnapshot } from './budgetService';
import {
  getCushionGoalId,
  getMonthlyAllowance,
  getPayPlan,
  getReturnRate,
  setCushionGoalId,
  setPayPlan,
} from '../settings/settingsStore';

export interface WealthSnapshot {
  holdings: HoldingSummary[];
  /** Invested but never pointed at a holding (e.g. every Phase 9 entry). */
  unassigned: number;
  /** Everything put in, net of withdrawals. */
  putIn: number;
  /** What it is worth as far as the user has said; put-in where they haven't. */
  worth: number;
  /** Sum of every monthly plan. */
  monthly: number;
  cushion: GoalProgress | null;
  ladder: Ladder;
  returnRate: number;
  cautiousRate: number;

  /** Pay yourself first. */
  plan: PayPlan;
  /** This period's checklist; null when the plan is off. */
  payday: Payday | null;
  /** The period's allowance, for showing the split in rupees. */
  allowance: number;
  /** Length of the current period in days, for "about ₹X a day". */
  periodDays: number;
  /** Open goals other than the cushion, for splitting the goals line. */
  otherGoals: GoalProgress[];

  /** Null until a bank balance has been entered. */
  netWorth: number | null;
  /** Oldest first. */
  netWorthHistory: { month: string; value: number }[];

  /** Oldest first: each recent budget period and what share of it was kept. */
  habit: { label: string; rate: number; kept: number }[];
  streak: number;

  milestones: { key: string; achievedAt: string }[];
  next: { title: string; toGo: number | null } | null;

  insight: HabitInsight | null;
}

const CUSHION_NAME = 'Emergency fund';
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const HABIT_PERIODS = 6;

export async function getWealthSnapshot(now: Date = new Date()): Promise<WealthSnapshot> {
  const allowanceSetting = await getMonthlyAllowance();
  // The budget snapshot owns the payday and the balance; reading it here
  // means Wealth and Today can never show two different plans.
  const budget = await getBudgetSnapshot(allowanceSetting, now);

  const [holdings, unassigned, history, goals, cushionId, returnRate, plan, periods, categories] =
    await Promise.all([
      db.getHoldings(),
      db.getUnassignedInvested(),
      db.getInvestingHistory(),
      db.getActiveGoals(),
      getCushionGoalId(),
      getReturnRate(DEFAULT_RETURN_RATE),
      getPayPlan(DEFAULT_PAY_PLAN),
      db.getAllBudgetPeriods(),
      db.getSpendByCategory(budget.periodStart, now.toISOString()),
    ]);

  // A cushion goal the user has since deleted or archived is simply gone —
  // rung one reads as not started, and "Start the cushion" makes a new one.
  const cushion = cushionId === null ? null : (goals.find((g) => g.id === cushionId) ?? null);

  const putIn = holdings.reduce((sum, h) => sum + h.putIn, 0) + unassigned;
  const worth =
    holdings.reduce((sum, h) => sum + holdingWorth(h.putIn, h.currentValue), 0) + unassigned;
  const monthly = holdings.reduce((sum, h) => sum + (h.sipAmount ?? 0), 0);

  // --- Net worth, written down once a month so it can have a history. ---
  const nw = netWorth({
    bank: budget.bankBalance,
    investments: worth,
    owedToYou: budget.totalReceivable,
    youOwe: budget.totalPayable,
  });
  if (nw !== null) await db.recordNetWorth(nw, now);
  const netWorthHistory = await db.getNetWorthHistory(12);

  // --- The saving habit, period by period. ---
  const nowIso = now.toISOString();
  const recent = periods
    .filter((p) => p.starts_on <= nowIso)
    .slice(0, HABIT_PERIODS)
    .reverse();
  const habit = await Promise.all(
    recent.map(async (p) => {
      const end = p.ends_on < nowIso ? p.ends_on : nowIso;
      const [kept, income] = await Promise.all([
        db.getKeptBetween(p.starts_on, end),
        db.getIncomeBetween(p.starts_on, end),
      ]);
      return {
        label: SHORT_MONTHS[new Date(p.starts_on).getMonth()],
        rate: keptRate(kept, p.allowance + income),
        kept,
      };
    })
  );
  // The current period is still running — the streak counts finished ones.
  const streak = habitStreak(
    habit
      .slice(0, -1)
      .map((h) => h.rate)
      .reverse()
  );

  // --- Milestones: stored the first time they are reached, so dates stick. ---
  const state: MilestoneState = {
    totalKept: goals.reduce((sum, g) => sum + g.savedAmount, 0) + putIn,
    cushionFraction: cushion ? cushion.fraction : null,
    paydayDoneEver: budget.payday?.allDone ?? false,
    habitStreak: streak,
    putIn,
    netWorth: nw,
  };
  const already = await db.getMilestones();
  for (const key of reachedMilestones(state)) {
    if (!already.has(key)) {
      await db.markMilestone(key, now);
      already.set(key, nowIso);
    }
  }
  const milestones = [...already.entries()]
    .map(([key, achievedAt]) => ({ key, achievedAt }))
    .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt));

  return {
    holdings,
    unassigned,
    putIn,
    worth,
    monthly,
    cushion,
    ladder: ladder({
      cushionSaved: cushion?.savedAmount ?? 0,
      cushionTarget: cushion?.targetAmount ?? cushionTarget(allowanceSetting),
      hasPlan: monthly > 0,
      monthsContributed: history.months,
      monthsInvested: history.firstAt ? monthsBetween(history.firstAt, nowIso) : null,
    }),
    returnRate,
    cautiousRate: Math.min(CAUTIOUS_RETURN_RATE, returnRate),
    plan,
    payday: budget.payday,
    allowance: budget.budget.allowance,
    periodDays: Math.max(
      1,
      Math.round((Date.parse(budget.periodEnd) - Date.parse(budget.periodStart)) / 86_400_000)
    ),
    otherGoals: goals.filter((g) => g.id !== cushionId && !g.isComplete),
    netWorth: nw,
    netWorthHistory,
    habit,
    streak,
    milestones,
    next: nextMilestone(state, new Set(already.keys())),
    insight: habitInsight(
      categories,
      Math.max(1, Math.round((now.getTime() - Date.parse(budget.periodStart)) / 86_400_000)),
      returnRate
    ),
  };
}

/**
 * Rung one: an ordinary goal named "Emergency fund", sized at three months
 * of allowance, remembered as the cushion. Being an ordinary goal is the
 * point — it reserves from the budget, takes contributions and round-ups,
 * and can be retargeted from Plans exactly like any other.
 */
export async function startCushion(): Promise<number> {
  const existing = await getCushionGoalId();
  if (existing !== null) {
    const goal = await db.getGoalById(existing);
    if (goal) return goal.id;
  }
  const allowance = await getMonthlyAllowance();
  const id = await db.createGoal({
    name: CUSHION_NAME,
    targetAmount: Math.max(1, Math.round(cushionTarget(allowance))),
    emoji: 'savings',
  });
  await setCushionGoalId(id);
  return id;
}

/** Switches pay-yourself-first on with the given split, creating the cushion if needed. */
export async function savePayPlan(plan: PayPlan): Promise<void> {
  if (plan.enabled && plan.cushionPct > 0) await startCushion();
  await setPayPlan(plan);
}

/** Checklist: "set aside ₹X in the cushion". */
export async function payCushion(amount: number): Promise<void> {
  if (!(amount > 0)) return;
  const id = await startCushion();
  await db.contributeToGoal(id, amount, 'MANUAL');
}

/** Checklist: "₹X to goals", split by how much each still needs. */
export async function payGoals(amount: number): Promise<void> {
  if (!(amount > 0)) return;
  const [goals, cushionId] = await Promise.all([db.getActiveGoals(), getCushionGoalId()]);
  const shares = splitAcrossGoals(
    amount,
    goals.filter((g) => g.id !== cushionId).map((g) => ({ id: g.id, remaining: g.remainingAmount }))
  );
  for (const share of shares) await db.contributeToGoal(share.id, share.amount, 'MANUAL');
}
