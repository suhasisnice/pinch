import {
  BudgetInput,
  canIAfford,
  computeBudget,
  computeToday,
  daysUntilBroke,
  expectedRecovery,
  goalReserve,
  receivableConfidence,
  roundUpAmount,
  totalGoalReserve,
} from '../src/math/budget';

const baseBudget: BudgetInput = {
  allowance: 10000,
  topUps: 0,
  grossSpend: 0,
  settledIn: 0,
  settledOut: 0,
  expectedRecovery: 0,
  openPayables: 0,
  goalReserve: 0,
  daysRemaining: 30,
};

describe('computeBudget', () => {
  it('divides a clean allowance across the period', () => {
    const result = computeBudget(baseBudget);
    expect(result.spendablePool).toBe(10000);
    expect(result.dailyLimit).toBeCloseTo(333.33, 2);
    expect(result.isUnderwater).toBe(false);
  });

  it('never divides by zero days', () => {
    const result = computeBudget({ ...baseBudget, daysRemaining: 0 });
    expect(Number.isFinite(result.dailyLimit)).toBe(true);
    expect(result.dailyLimit).toBe(10000);
  });

  it('flags an overcommitted pool as underwater', () => {
    const result = computeBudget({ ...baseBudget, grossSpend: 9000, openPayables: 2000 });
    expect(result.spendablePool).toBe(-1000);
    expect(result.isUnderwater).toBe(true);
  });

  // The invariant that keeps the headline number from lurching around.
  it('stays continuous when a friend repays you', () => {
    // You paid 1200 for dinner; friends owe you 900 and always pay promptly.
    const beforeRepayment = computeBudget({
      ...baseBudget,
      grossSpend: 1200,
      expectedRecovery: 900, // fully trusted
    });

    // They pay. The debt closes and 900 lands as SETTLE_IN — not as income.
    const afterRepayment = computeBudget({
      ...baseBudget,
      grossSpend: 1200,
      settledIn: 900,
      expectedRecovery: 0,
    });

    expect(beforeRepayment.spendablePool).toBe(afterRepayment.spendablePool);
    expect(beforeRepayment.spendablePool).toBe(10000 - 300);
  });

  it('stays continuous when you repay a friend', () => {
    const beforePaying = computeBudget({ ...baseBudget, openPayables: 260 });
    const afterPaying = computeBudget({ ...baseBudget, settledOut: 260, openPayables: 0 });

    expect(beforePaying.spendablePool).toBe(afterPaying.spendablePool);
    expect(beforePaying.spendablePool).toBe(9740);
  });

  // Regression guard for the v1 schema bug: without a `kind` column these two
  // would both be plain DEBITs and the dinner would be charged twice.
  it('does not charge one dinner twice', () => {
    // Friend fronted 400 of your dinner; later you pay them back.
    const owed = computeBudget({ ...baseBudget, openPayables: 400 });
    const repaid = computeBudget({ ...baseBudget, settledOut: 400, openPayables: 0 });

    expect(owed.spendablePool).toBe(9600);
    expect(repaid.spendablePool).toBe(9600);
    // The 400 is never also present in grossSpend.
  });

  it('treats a repayment as recovered cash, not fresh allowance', () => {
    const withRepayment = computeBudget({ ...baseBudget, grossSpend: 500, settledIn: 500 });
    expect(withRepayment.spendablePool).toBe(10000);
    // Had SETTLE_IN been booked as INCOME it would read 10500.
  });
});

describe('receivableConfidence', () => {
  const fresh = { openAmount: 100, settledCount: 4, isGhost: false, daysOutstanding: 0 };

  it('fully trusts someone who always pays within days', () => {
    expect(receivableConfidence({ ...fresh, avgDaysToSettle: 2 })).toBe(1);
  });

  it('discounts a slow payer', () => {
    const slow = receivableConfidence({ ...fresh, avgDaysToSettle: 20 });
    const quick = receivableConfidence({ ...fresh, avgDaysToSettle: 2 });
    expect(slow).toBeLessThan(quick);
    expect(slow).toBeCloseTo(0.5, 5);
  });

  it('barely counts a ghost', () => {
    expect(receivableConfidence({ ...fresh, avgDaysToSettle: 1, isGhost: true })).toBe(0.15);
  });

  it('is moderately optimistic about someone with no history', () => {
    const unknown = receivableConfidence({ ...fresh, settledCount: 0, avgDaysToSettle: null });
    expect(unknown).toBeGreaterThan(0.5);
    expect(unknown).toBeLessThan(1);
  });

  it('decays a debt that has been sitting there', () => {
    const newDebt = receivableConfidence({ ...fresh, avgDaysToSettle: 2, daysOutstanding: 0 });
    const oldDebt = receivableConfidence({ ...fresh, avgDaysToSettle: 2, daysOutstanding: 60 });
    expect(oldDebt).toBeLessThan(newDebt);
    expect(oldDebt).toBeCloseTo(0.25, 5);
  });

  it('never leaves the 0..1 range', () => {
    const extreme = receivableConfidence({
      openAmount: 100,
      avgDaysToSettle: 500,
      settledCount: 1,
      isGhost: false,
      daysOutstanding: 3650,
    });
    expect(extreme).toBeGreaterThanOrEqual(0);
    expect(extreme).toBeLessThanOrEqual(1);
  });

  it('weights a mixed set of debts', () => {
    const total = expectedRecovery([
      { openAmount: 1000, avgDaysToSettle: 1, settledCount: 5, isGhost: false, daysOutstanding: 0 },
      { openAmount: 1000, avgDaysToSettle: 2, settledCount: 3, isGhost: true, daysOutstanding: 0 },
    ]);
    expect(total).toBeCloseTo(1000 + 150, 5);
  });
});

describe('goalReserve', () => {
  it('claims the full remainder when the deadline lands inside the period', () => {
    const reserve = goalReserve({
      targetAmount: 3000,
      savedAmount: 0,
      daysUntilDeadline: 20,
      daysRemainingInPeriod: 30,
    });
    expect(reserve).toBe(3000);
  });

  it('claims only this period’s share of a distant goal', () => {
    const reserve = goalReserve({
      targetAmount: 45000,
      savedAmount: 0,
      daysUntilDeadline: 180,
      daysRemainingInPeriod: 30,
    });
    expect(reserve).toBeCloseTo(7500, 5);
  });

  // Saved money is a label on cash still sitting in the account, so it stays
  // reserved. If contributions reduced the reserve, that money would quietly
  // become spendable again and the goal would never be reached.
  it('keeps already-saved money held back', () => {
    const reserve = goalReserve({
      targetAmount: 3000,
      savedAmount: 1500,
      daysUntilDeadline: 15,
      daysRemainingInPeriod: 15,
    });
    expect(reserve).toBe(3000);
  });

  it('holds a completed goal’s money without claiming more', () => {
    const reserve = goalReserve({
      targetAmount: 3000,
      savedAmount: 3000,
      daysUntilDeadline: 10,
      daysRemainingInPeriod: 30,
    });
    expect(reserve).toBe(3000);
  });

  it('treats an overdue goal as due now', () => {
    const reserve = goalReserve({
      targetAmount: 1000,
      savedAmount: 200,
      daysUntilDeadline: -5,
      daysRemainingInPeriod: 10,
    });
    expect(reserve).toBe(1000);
  });

  it('paces an open-ended goal over a 90-day horizon', () => {
    const reserve = goalReserve({
      targetAmount: 9000,
      savedAmount: 0,
      daysUntilDeadline: null,
      daysRemainingInPeriod: 30,
    });
    expect(reserve).toBeCloseTo(3000, 5);
  });

  it('holds the budget consistent across a period as a goal is funded', () => {
    // 10000 allowance, 3000 goal due in 30 days, 30-day period.
    const dayOne = computeBudget({
      ...baseBudget,
      goalReserve: totalGoalReserve([
        { targetAmount: 3000, savedAmount: 0, daysUntilDeadline: 30, daysRemainingInPeriod: 30 },
      ]),
    });
    expect(dayOne.spendablePool).toBe(7000);
    expect(dayOne.dailyLimit).toBeCloseTo(233.33, 2);

    // Halfway: 3500 spent, 1500 of it labelled toward the goal.
    const midMonth = computeBudget({
      ...baseBudget,
      grossSpend: 3500,
      daysRemaining: 15,
      goalReserve: totalGoalReserve([
        { targetAmount: 3000, savedAmount: 1500, daysUntilDeadline: 15, daysRemainingInPeriod: 15 },
      ]),
    });
    // 10000 - 3500 spent - 3000 still owed to the goal = 3500 to live on.
    expect(midMonth.spendablePool).toBe(3500);
    expect(midMonth.dailyLimit).toBeCloseTo(233.33, 2);
  });
});

describe('computeToday', () => {
  it('reports a fresh day', () => {
    expect(computeToday(300, 0).state).toBe('FRESH');
  });

  it('warns as the limit approaches', () => {
    expect(computeToday(300, 250).state).toBe('CLOSE');
  });

  it('flags going over', () => {
    const today = computeToday(300, 340);
    expect(today.state).toBe('OVER');
    expect(today.remainingToday).toBe(-40);
  });

  it('handles a zero limit without producing NaN', () => {
    const today = computeToday(0, 50);
    expect(today.state).toBe('OVER');
    expect(Number.isNaN(today.usedFraction)).toBe(false);
  });
});

describe('canIAfford', () => {
  const budget = computeBudget({ ...baseBudget, daysRemaining: 12, allowance: 3600 });

  it('says yes cheaply for a small amount', () => {
    expect(canIAfford(100, budget).severity).toBe('EASY');
  });

  it('reports what a big purchase costs per day', () => {
    const verdict = canIAfford(1800, budget);
    expect(verdict.affordable).toBe(true);
    expect(verdict.newDailyLimit).toBeCloseTo(150, 5);
    expect(verdict.dailyDelta).toBeCloseTo(-150, 5);
    expect(verdict.severity).toBe('TIGHT');
  });

  it('refuses what the pool cannot cover', () => {
    const verdict = canIAfford(5000, budget);
    expect(verdict.affordable).toBe(false);
    expect(verdict.severity).toBe('RECKLESS');
  });

  it('translates an amount into days of normal spending', () => {
    const verdict = canIAfford(800, budget, 200);
    expect(verdict.daysOfTypicalSpending).toBe(4);
  });

  it('omits the translation without a spending history', () => {
    expect(canIAfford(800, budget, null).daysOfTypicalSpending).toBeNull();
  });
});

describe('projection helpers', () => {
  it('estimates days until broke', () => {
    expect(daysUntilBroke(1000, 250)).toBe(4);
  });

  it('returns null when nothing is being spent', () => {
    expect(daysUntilBroke(1000, 0)).toBeNull();
  });

  it('reports zero once already broke', () => {
    expect(daysUntilBroke(-50, 100)).toBe(0);
  });

  it('computes the round-up to the next ten', () => {
    expect(roundUpAmount(340)).toBe(0);
    expect(roundUpAmount(342)).toBe(8);
    expect(roundUpAmount(340.5)).toBe(9.5);
  });
});
