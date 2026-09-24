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
  /**
   * Net contributions made within the current period. Money saved in an
   * earlier period came out of that period's allowance, not this one's, so
   * holding it back again would charge the same rupees twice. When absent
   * (older callers, pure tests), everything saved is treated as this
   * period's — the original behaviour.
   */
  savedThisPeriod?: number;
  /**
   * False when a pay-yourself-first plan is in force: the plan decides how
   * much goes to goals, so the automatic pacing share is switched off and
   * only money actually set aside this period is held.
   */
  paced?: boolean;
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
  const alreadySetAside =
    goal.savedThisPeriod !== undefined
      ? goal.savedThisPeriod
      : Math.min(goal.savedAmount, goal.targetAmount);

  if (goal.paced === false) return alreadySetAside;

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
export function cappedGoalReserve(goals: GoalReserveInput[], capacity: number): GoalReserveResult {
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
  /** Money set aside for outings (see repos/outings.ts's OutingReserves ledger). Optional so every existing caller/test keeps compiling unchanged. */
  outingReserve?: number;
  /**
   * Money this period's monthly investment plans still claim (see
   * math/wealth.ts sipReserve). An allocation, like the goal reserve.
   */
  planReserve?: number;
  /**
   * Net cash that left for investments this period (contributions minus
   * withdrawals). Not spending — the money is still yours, in another form —
   * but it is no longer in the account to spend, so it leaves the pool the
   * way repaying a friend does.
   */
  investedNet?: number;
  daysRemaining: number;
}

export interface BudgetBreakdown extends BudgetInput {
  /** Everything you can still spend across the rest of the period. */
  spendablePool: number;
  /**
   * Same value as spendablePool, named to match PRODUCT_SPEC §1.1's
   * vocabulary: "money the user has chosen to make available for ordinary
   * spending." Both fields exist so nothing already reading spendablePool
   * has to change while Today (Phase 3) can read the spec's own term.
   */
  availableBudget: number;
  /** goalReserve + outingReserve + planReserve — money spoken for, whichever purpose. */
  protectedMoney: number;
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
  const outingReserve = input.outingReserve ?? 0;
  const planReserve = input.planReserve ?? 0;
  const investedNet = input.investedNet ?? 0;
  const protectedMoney = input.goalReserve + outingReserve + planReserve;

  const spendablePool =
    input.allowance +
    input.topUps -
    input.grossSpend +
    input.settledIn -
    input.settledOut +
    input.expectedRecovery -
    input.openPayables -
    investedNet -
    protectedMoney;

  const days = Math.max(1, input.daysRemaining);

  return {
    ...input,
    outingReserve,
    planReserve,
    investedNet,
    protectedMoney,
    spendablePool,
    availableBudget: spendablePool,
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

// ---------------------------------------------------------------------------
// Balance consistency
// ---------------------------------------------------------------------------

export interface BalanceConsistency {
  /**
   * bankBalance minus (availableBudget + protectedMoney). Positive: the bank
   * has money the ledger does not know about. Negative: the ledger thinks
   * there is more than the bank actually has — usually a missed transaction.
   */
  discrepancy: number;
  /** True when the gap is small enough to be rounding/pending-settlement noise. */
  isConsistent: boolean;
}

/** Below this gap, don't bother the user — ordinary noise, not a missed transaction. */
export const BALANCE_CONSISTENCY_TOLERANCE = 50;

/**
 * Compares the bank balance the user actually typed in against what the
 * transaction ledger thinks should be there.
 *
 * The two numbers come from unrelated sources — one observed, one derived
 * from parsed transactions — so PRODUCT_SPEC §1.1's "bank balance >= available
 * budget" is not an identity this engine can enforce by construction; it can
 * only measure the gap and say whether it is big enough to matter. Returns
 * null when no balance has ever been recorded, so a caller can distinguish
 * "never checked" from "checked and it matches."
 *
 * This is the same primitive Phase 7's missed-transaction reconciliation
 * needs ("Expected balance 8,200. User verifies bank and enters 7,900...
 * 300 unaccounted") — built once here as pure math, wired into a
 * find/add-manually/ignore flow whichever phase gets to that UI.
 */
export function checkBalanceConsistency(
  bankBalance: number | null,
  availableBudget: number,
  protectedMoney: number
): BalanceConsistency | null {
  if (bankBalance === null) return null;
  const discrepancy = bankBalance - (availableBudget + protectedMoney);
  return { discrepancy, isConsistent: Math.abs(discrepancy) <= BALANCE_CONSISTENCY_TOLERANCE };
}

/**
 * Whether an unaccounted-balance gap is worth raising again after the user
 * has already dismissed one.
 *
 * Dismissing is "I know about this one, stop asking" — not "never mention
 * my balance again". A gap that then grows or flips direction is a
 * different fact and worth surfacing; the same gap sitting there is not.
 * The tolerance is the same one that decides a gap is worth mentioning at
 * all, so nothing can resurface that would not have been shown fresh.
 */
export function shouldRaiseDiscrepancy(discrepancy: number, dismissed: number | null): boolean {
  if (Math.abs(discrepancy) <= BALANCE_CONSISTENCY_TOLERANCE) return false;
  if (dismissed === null) return true;
  return Math.abs(discrepancy - dismissed) > BALANCE_CONSISTENCY_TOLERANCE;
}

// ---------------------------------------------------------------------------
// Goal tracking status — Phase 4.
// ---------------------------------------------------------------------------

export type GoalTrackingStatus = 'ON_TRACK' | 'BEHIND';

/**
 * Whether a goal with a deadline has saved its fair share of the time
 * elapsed so far — the "ON TRACK" badge `SPOTIFY_FINANCE_UI_PROMPT.md`'s
 * goal-row example shows.
 *
 * Deliberately time-elapsed-vs-money-saved, not a comparison against a
 * historical contribution rate: that would need a query per goal (its full
 * `GoalContributions` history) just to answer a status a single subtraction
 * already answers correctly — a goal that has saved 40% of its target 40%
 * of the way to its deadline is on pace by definition, regardless of
 * whether that came in one contribution or ten.
 *
 * Returns null for a goal with no deadline — "ahead of" or "behind" nothing
 * is not a real question until there is a date to be ahead of or behind.
 */
export function goalTrackingStatus(
  savedAmount: number,
  targetAmount: number,
  createdAt: string,
  deadline: string | null,
  now: Date = new Date()
): GoalTrackingStatus | null {
  if (!deadline || targetAmount <= 0) return null;

  const totalMs = Date.parse(deadline) - Date.parse(createdAt);
  if (totalMs <= 0) return null;

  const elapsedMs = now.getTime() - Date.parse(createdAt);
  const expectedFraction = Math.max(0, Math.min(1, elapsedMs / totalMs));
  const actualFraction = Math.max(0, Math.min(1, savedAmount / targetAmount));

  // A little slack: a goal funded in occasional lump sums (allowance day,
  // not daily) shouldn't flip to BEHIND the moment it isn't perfectly
  // linear against the calendar.
  const SLACK = 0.05;
  return actualFraction + SLACK >= expectedFraction ? 'ON_TRACK' : 'BEHIND';
}

/**
 * A projected finish date for a goal with no deadline, from its current
 * saving rate. Returns null when nothing has been saved yet — there is no
 * rate to project from, and dividing by a zero pace would only produce a
 * misleadingly precise-looking "never."
 */
/** The shortest history a saving pace is read from. */
export const MIN_PACE_DAYS = 30;

export function estimatedCompletionDate(
  savedAmount: number,
  targetAmount: number,
  createdAt: string,
  now: Date = new Date()
): Date | null {
  const remaining = targetAmount - savedAmount;
  if (remaining <= 0) return now;
  if (savedAmount <= 0) return null;

  // A goal opened yesterday with a lump sum is not saving that sum every day.
  // Read at least a month of history, so a first deposit isn't mistaken for a pace.
  const daysSoFar = Math.max(MIN_PACE_DAYS, (now.getTime() - Date.parse(createdAt)) / MS_PER_DAY);
  const dailyRate = savedAmount / daysSoFar;
  if (dailyRate <= 0) return null;

  const daysRemaining = remaining / dailyRate;
  return new Date(now.getTime() + daysRemaining * MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Outing affordability — Phase 5.
// ---------------------------------------------------------------------------

export type OutingAffordability = 'COMFORTABLE' | 'TIGHT' | 'DISRUPTIVE';

/**
 * How much room a planned outing leaves once its money is set aside — the
 * spec's Comfortable/Tight/Disruptive states. `PRODUCT_SPEC.md` says the app
 * "must not block creation," so this is advisory only: nothing here stops
 * `reserveForOuting` from running.
 *
 * Same shape as `canIAfford`'s severity ladder (`newDailyLimit` relative to
 * the current one), deliberately: reserving for an outing and spending on
 * one impulse purchase both ask the identical question — "how much does
 * committing this money change what I have left per day?" — so they should
 * not read as two different mental models with two different thresholds.
 */
export function outingAffordability(
  fundingTarget: number,
  availableBudget: number,
  daysRemaining: number
): OutingAffordability {
  if (fundingTarget <= 0) return 'COMFORTABLE';

  const days = Math.max(1, daysRemaining);
  const dailyLimit = availableBudget / days;
  const dailyLimitAfter = (availableBudget - fundingTarget) / days;

  if (availableBudget - fundingTarget < 0) return 'DISRUPTIVE';
  if (dailyLimit > 0 && dailyLimitAfter <= dailyLimit * 0.5) return 'TIGHT';
  return 'COMFORTABLE';
}
