/**
 * The single number the whole app exists to produce: what you can spend today
 * without wrecking the rest of the period.
 *
 * Everything here is a pure function of plain numbers so it can be reasoned
 * about and tested without a database. `assembleBudget` in budgetService.ts
 * does the data gathering.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Receivable confidence
// ---------------------------------------------------------------------------

export interface ReceivableInput {
  openAmount: number;
  /** Mean days this person has taken to settle, or null if never settled. */
  avgDaysToSettle: number | null;
  settledCount: number;
  isGhost: boolean;
  /** How long this particular debt has been outstanding. */
  daysOutstanding: number;
}

/**
 * How much of what someone owes you should count as money you actually have.
 *
 * Counting every IOU at face value is the most common way a split-tracking app
 * lies to you: it shows a comfortable balance built entirely out of debts from
 * people who are never going to pay. Weighting by demonstrated behaviour makes
 * the headline number defensible.
 *
 * Two independent factors, multiplied:
 *   - who they are: how fast they have historically settled
 *   - how stale this debt is: a 40-day-old IOU is worth less than a fresh one
 */
export function receivableConfidence(input: ReceivableInput): number {
  if (input.isGhost) return 0.15;

  let personFactor: number;
  if (input.settledCount === 0 || input.avgDaysToSettle === null) {
    // No track record. Moderately optimistic, not credulous.
    personFactor = 0.6;
  } else if (input.avgDaysToSettle <= 3) {
    personFactor = 1;
  } else if (input.avgDaysToSettle <= 7) {
    personFactor = 0.9;
  } else if (input.avgDaysToSettle <= 14) {
    personFactor = 0.75;
  } else if (input.avgDaysToSettle <= 30) {
    personFactor = 0.5;
  } else {
    personFactor = 0.3;
  }

  // Halves roughly every 30 days outstanding, floored so a debt never becomes
  // literally worthless while it is still open.
  const staleness = Math.max(0.25, Math.pow(0.5, Math.max(0, input.daysOutstanding) / 30));

  return Math.max(0, Math.min(1, personFactor * staleness));
}

export function expectedRecovery(receivables: ReceivableInput[]): number {
  return receivables.reduce((sum, r) => sum + r.openAmount * receivableConfidence(r), 0);
}

// ---------------------------------------------------------------------------
// Goal reserve
// ---------------------------------------------------------------------------

export interface GoalReserveInput {
  targetAmount: number;
  savedAmount: number;
  /** Days until the deadline. null = no deadline; <= 0 = due now or overdue. */
  daysUntilDeadline: number | null;
  /** Days left in the current budget period. */
  daysRemainingInPeriod: number;
}

/**
 * How much of the current period's money a goal lays claim to.
 *
 * A goal you are not currently setting money aside for is a wish, not a plan,
 * so the reserve is subtracted from spendable money rather than displayed as a
 * separate aspiration. Saving then happens by default and spending is what
 * requires a decision.
 *
 * A deadline inside this period claims everything still needed. A deadline
 * further out claims only this period's proportional share, so a six-month
 * goal does not swallow one month's allowance.
 *
 * Note that `savedAmount` does NOT reduce the reserve: contributions are
 * virtual labels on money still sitting in the account, so that money still
 * has to be held back from spending. What contributions do is retire the goal
 * once they reach the target.
 */
export function goalReserve(goal: GoalReserveInput): number {
  const stillNeeded = Math.max(0, goal.targetAmount - goal.savedAmount);
  const alreadySetAside = Math.min(goal.savedAmount, goal.targetAmount);

  if (goal.daysUntilDeadline === null) {
    // Open-ended: treat as a gentle 90-day horizon rather than claiming everything.
    const share = Math.min(1, goal.daysRemainingInPeriod / 90);
    return alreadySetAside + stillNeeded * share;
  }

  if (goal.daysUntilDeadline <= goal.daysRemainingInPeriod) {
    // Due within this period — the full remainder is owed now.
    return alreadySetAside + stillNeeded;
  }

  const share = goal.daysRemainingInPeriod / goal.daysUntilDeadline;
  return alreadySetAside + stillNeeded * share;
}

/**
 * The largest share of an allowance that goals may claim.
 *
 * Without a ceiling, an ambitious goal silently eats the whole budget: a
 * 10,000 target with no deadline reserves a third of itself over 90 days,
 * which against a 3,000 allowance is 3,333 — more than exists. The user is
 * then told they have negative money to spend, with no visible cause, because
 * the goal card is on a different screen and the reserve is invisible.
 *
 * Saving first is the right default. Saving *everything* is not a budget, it
 * is a wall, and a wall gets uninstalled.
 */
export const MAX_GOAL_RESERVE_SHARE = 0.5;

export interface GoalReserveResult {
  /** What goals actually claim, after the ceiling. */
  reserved: number;
  /** What they asked for. */
  requested: number;
  /** True when the ceiling had to hold them back. */
  capped: boolean;
}

export function totalGoalReserve(goals: GoalReserveInput[]): number {
  return goals.reduce((sum, g) => sum + goalReserve(g), 0);
}

/**
 * Goal reserve with a ceiling relative to what is actually coming in.
 *
 * `capacity` is the money the period has to work with — the allowance plus
 * anything topped up. Goals never take more than half of it, so the headline
 * number can go negative from real spending or real debt, but never from
 * ambition alone.
 */
export function cappedGoalReserve(
  goals: GoalReserveInput[],
  capacity: number
): GoalReserveResult {
  const requested = totalGoalReserve(goals);
  if (capacity <= 0) return { reserved: 0, requested, capped: requested > 0 };

  const ceiling = capacity * MAX_GOAL_RESERVE_SHARE;
  const reserved = Math.min(requested, ceiling);

  return { reserved, requested, capped: reserved < requested - 0.009 };
}

// ---------------------------------------------------------------------------
// The budget itself
// ---------------------------------------------------------------------------

export interface BudgetInput {
  /** The period's planned allowance. */
  allowance: number;
  /** Extra money that arrived mid-period (parental top-up). */
  topUps: number;
  /** SPEND minus REFUND for the period. Cash that actually left. */
  grossSpend: number;
  /** SETTLE_IN for the period: friends repaying you. Cash that came back. */
  settledIn: number;
  /** SETTLE_OUT for the period: you repaying friends. Cash that left again. */
  settledOut: number;
  /** Confidence-weighted value of debts still owed to you. */
  expectedRecovery: number;
  /** What you still owe others. Never discounted — you have to pay it. */
  openPayables: number;
  /** Money spoken for by savings goals. */
  goalReserve: number;
  daysRemaining: number;
}

export interface BudgetBreakdown extends BudgetInput {
  /** Everything you can still spend across the rest of the period. */
  spendablePool: number;
  /** spendablePool / daysRemaining. The headline number. */
  dailyLimit: number;
  /** True when the pool has gone negative — already overcommitted. */
  isUnderwater: boolean;
}

/**
 * Every obligation is counted exactly once, and the count is continuous across
 * settlement — which is the property that makes the number stop jumping around.
 *
 * A debt owed to you is either open (valued at `expectedRecovery`) or repaid
 * (arriving as `settledIn` cash), never both, and the moment it flips from one
 * to the other the pool barely moves. Same on the other side: what you owe is
 * either `openPayables` or already gone as `settledOut`.
 *
 * This is also why `kind` exists in the schema. Summing raw DEBITs would sweep
 * `settledOut` into `grossSpend` and charge you twice for one dinner; summing
 * raw CREDITs would treat a friend's repayment as fresh allowance.
 */
export function computeBudget(input: BudgetInput): BudgetBreakdown {
  const spendablePool =
    input.allowance +
    input.topUps -
    input.grossSpend +
    input.settledIn -
    input.settledOut +
    input.expectedRecovery -
    input.openPayables -
    input.goalReserve;

  const days = Math.max(1, input.daysRemaining);

  return {
    ...input,
    spendablePool,
    dailyLimit: spendablePool / days,
    isUnderwater: spendablePool < 0,
  };
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export interface TodayStatus {
  dailyLimit: number;
  spentToday: number;
  remainingToday: number;
  /** 0..1+, where > 1 means over the day's limit. */
  usedFraction: number;
  state: 'FRESH' | 'STEADY' | 'CLOSE' | 'OVER';
}

export function computeToday(dailyLimit: number, spentToday: number): TodayStatus {
  const limit = Math.max(0, dailyLimit);
  const remaining = limit - spentToday;
  const usedFraction = limit > 0 ? spentToday / limit : spentToday > 0 ? Infinity : 0;

  let state: TodayStatus['state'];
  if (usedFraction >= 1) state = 'OVER';
  else if (usedFraction >= 0.8) state = 'CLOSE';
  else if (usedFraction > 0) state = 'STEADY';
  else state = 'FRESH';

  return { dailyLimit: limit, spentToday, remainingToday: remaining, usedFraction, state };
}

// ---------------------------------------------------------------------------
// "Can I afford it?"
// ---------------------------------------------------------------------------

export interface AffordabilityVerdict {
  amount: number;
  /** Daily limit for the remaining days if this purchase happens. */
  newDailyLimit: number;
  /** Change in the daily limit. Always <= 0 for a real purchase. */
  dailyDelta: number;
  affordable: boolean;
  /** How many days of typical spending this purchase costs you. */
  daysOfTypicalSpending: number | null;
  severity: 'EASY' | 'FINE' | 'TIGHT' | 'RECKLESS';
}

/**
 * Answers the question people actually have — "can I say yes to this?" — in
 * terms of what it costs, not a yes/no. Being told a number is meaningless;
 * being told it drops you to 95 a day for the next 12 days is a decision.
 */
export function canIAfford(
  amount: number,
  budget: BudgetBreakdown,
  typicalDailySpend: number | null = null
): AffordabilityVerdict {
  const days = Math.max(1, budget.daysRemaining);
  const newPool = budget.spendablePool - amount;
  const newDailyLimit = newPool / days;

  const daysOfTypicalSpending =
    typicalDailySpend && typicalDailySpend > 0 ? amount / typicalDailySpend : null;

  let severity: AffordabilityVerdict['severity'];
  // Thresholds are inclusive: a purchase that exactly halves what you have to
  // live on each day is tight, not merely fine.
  if (newPool < 0) severity = 'RECKLESS';
  else if (budget.dailyLimit > 0 && newDailyLimit <= budget.dailyLimit * 0.5) severity = 'TIGHT';
  else if (budget.dailyLimit > 0 && newDailyLimit <= budget.dailyLimit * 0.8) severity = 'FINE';
  else severity = 'EASY';

  return {
    amount,
    newDailyLimit,
    dailyDelta: newDailyLimit - budget.dailyLimit,
    affordable: newPool >= 0,
    daysOfTypicalSpending,
    severity,
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * The date the money runs out at the current burn rate, or null if the pool
 * outlasts the period. Returns a day index from today, not a Date, so callers
 * choose their own formatting.
 */
export function daysUntilBroke(spendablePool: number, avgDailyBurn: number): number | null {
  if (avgDailyBurn <= 0) return null;
  if (spendablePool <= 0) return 0;
  return Math.floor(spendablePool / avgDailyBurn);
}

/** Rounds up to the next multiple of `step` — the round-up savings nudge. */
export function roundUpAmount(amount: number, step = 10): number {
  if (step <= 0) return 0;
  const rounded = Math.ceil(amount / step) * step;
  return Number((rounded - amount).toFixed(2));
}
