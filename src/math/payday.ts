/**
 * Pay yourself first.
 *
 * When the allowance lands, a fixed share of it is split off — to the
 * cushion, to goals, to investing — before a rupee of it is spendable.
 * Spending gets what is left, and Today divides only that. The habit this
 * builds is the whole point: saving stops being whatever survives the month
 * and becomes the first thing the month does.
 *
 * Money in the plan is held back from the budget from the first day (the
 * `reserve`), exactly like a goal reserve. Ticking an item off moves that
 * money from "planned" to "set aside" — the reserve drops as the goal
 * contribution (or the investment) lands, so Today does not move when you
 * tick. The decision was made at payday.
 */

export interface PayPlan {
  enabled: boolean;
  /** Shares of the period's allowance, 0–1. */
  cushionPct: number;
  goalsPct: number;
  investPct: number;
}

/**
 * For someone on an allowance who is not investing yet: 15% kept, most of it
 * building the cushion. Investing starts at zero on purpose — the cushion
 * comes first (see the ladder in math/wealth.ts).
 */
export const DEFAULT_PAY_PLAN: PayPlan = {
  enabled: false,
  cushionPct: 0.1,
  goalsPct: 0.05,
  investPct: 0,
};

/** Never plan more than half the allowance away — same ceiling goals have. */
export const MAX_PLAN_SHARE = 0.5;

export type PaydayKey = 'CUSHION' | 'GOALS' | 'INVEST';

export interface PaydayItem {
  key: PaydayKey;
  /** What the plan asks for this period. */
  amount: number;
  /** What has actually been set aside / invested toward it this period. */
  done: number;
  complete: boolean;
}

export interface PaydayInput {
  allowance: number;
  plan: PayPlan;
  /** Still needed to fill the cushion *as of now*; null = no cushion yet. */
  cushionRemaining: number | null;
  /** Open goals other than the cushion. */
  openGoals: number;
  /** Monthly-plan (SIP) amounts that fall in this period. */
  sipDue: number;
  cushionDone: number;
  goalsDone: number;
  investedDone: number;
}

export interface Payday {
  items: PaydayItem[];
  /** Sum of every item. */
  total: number;
  /** allowance − total: what spending gets. */
  forSpending: number;
  /** Planned but not yet done — held back from the budget. */
  reserve: number;
  /** True when every item is done. */
  allDone: boolean;
  /** The cushion is full, so its share has nowhere to go — suggest moving it. */
  cushionShareIdle: boolean;
}

/** Rupee amounts round to the nearest 10 — nobody sets aside ₹1,487.35. */
export function roundPlan(amount: number): number {
  return Math.max(0, Math.round(amount / 10) * 10);
}

export function clampPlan(plan: PayPlan): PayPlan {
  const clamp = (x: number) => Math.min(MAX_PLAN_SHARE, Math.max(0, Number.isFinite(x) ? x : 0));
  let cushionPct = clamp(plan.cushionPct);
  let goalsPct = clamp(plan.goalsPct);
  let investPct = clamp(plan.investPct);
  const total = cushionPct + goalsPct + investPct;
  if (total > MAX_PLAN_SHARE) {
    const scale = MAX_PLAN_SHARE / total;
    cushionPct *= scale;
    goalsPct *= scale;
    investPct *= scale;
  }
  return { enabled: plan.enabled, cushionPct, goalsPct, investPct };
}

export function payday(input: PaydayInput): Payday {
  const plan = clampPlan(input.plan);
  const allowance = Math.max(0, input.allowance);
  const items: PaydayItem[] = [];

  const push = (key: PaydayKey, amount: number, done: number) => {
    const rounded = roundPlan(amount);
    if (rounded <= 0) return;
    const d = Math.max(0, done);
    items.push({ key, amount: rounded, done: d, complete: d >= rounded - 0.5 });
  };

  // The cushion never takes more than it still needs — counted from the
  // start of the period, so a contribution made today does not shrink the
  // plan it was made against.
  let cushionShareIdle = false;
  if (input.cushionRemaining !== null && plan.cushionPct > 0) {
    const neededAtPayday = Math.max(0, input.cushionRemaining) + Math.max(0, input.cushionDone);
    const amount = Math.min(allowance * plan.cushionPct, neededAtPayday);
    if (roundPlan(amount) <= 0) cushionShareIdle = true;
    push('CUSHION', amount, input.cushionDone);
  }

  if (input.openGoals > 0) push('GOALS', allowance * plan.goalsPct, input.goalsDone);

  // A monthly plan is a promise already made; the invest line never asks
  // for less than the SIPs falling due.
  push('INVEST', Math.max(allowance * plan.investPct, input.sipDue), input.investedDone);

  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const reserve = items.reduce((sum, i) => sum + Math.max(0, i.amount - i.done), 0);

  return {
    items,
    total,
    forSpending: allowance - total,
    reserve,
    allDone: items.length > 0 && items.every((i) => i.complete),
    cushionShareIdle,
  };
}

/**
 * Splits a goals amount across open goals by how much each still needs, so a
 * nearly-finished goal isn't overfed and a big one isn't starved. Rounded to
 * whole rupees; the rounding remainder goes to the neediest goal.
 */
export function splitAcrossGoals(
  amount: number,
  goals: { id: number; remaining: number }[]
): { id: number; amount: number }[] {
  const open = goals.filter((g) => g.remaining > 0.009);
  const need = open.reduce((sum, g) => sum + g.remaining, 0);
  if (amount <= 0 || need <= 0) return [];

  const capped = Math.min(amount, need);
  const shares = open.map((g) => ({
    id: g.id,
    amount: Math.floor((capped * g.remaining) / need),
  }));
  const leftover = Math.round(capped) - shares.reduce((sum, s) => sum + s.amount, 0);
  if (leftover > 0) {
    const neediest = open.reduce((a, b) => (b.remaining > a.remaining ? b : a));
    shares.find((s) => s.id === neediest.id)!.amount += leftover;
  }
  return shares.filter((s) => s.amount > 0);
}

/**
 * Builds the payday from rows the budget snapshot already has loaded, so the
 * budget and the Wealth screen can never compute two different plans.
 */
export function paydayFromData(input: {
  allowance: number;
  plan: PayPlan;
  cushionId: number | null;
  goals: { id: number; remainingAmount: number; isComplete: boolean }[];
  goalContributions: Map<number, number>;
  sipDue: number;
  investedDone: number;
}): Payday {
  const cushion =
    input.cushionId === null ? undefined : input.goals.find((g) => g.id === input.cushionId);
  const others = input.goals.filter((g) => g.id !== input.cushionId);
  const goalsDone = others.reduce(
    (sum, g) => sum + Math.max(0, input.goalContributions.get(g.id) ?? 0),
    0
  );
  return payday({
    allowance: input.allowance,
    plan: input.plan,
    cushionRemaining: cushion ? cushion.remainingAmount : null,
    openGoals: others.filter((g) => !g.isComplete).length,
    sipDue: input.sipDue,
    cushionDone: cushion ? Math.max(0, input.goalContributions.get(cushion.id) ?? 0) : 0,
    goalsDone,
    investedDone: input.investedDone,
  });
}
