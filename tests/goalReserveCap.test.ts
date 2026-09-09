import {
  MAX_GOAL_RESERVE_SHARE,
  cappedGoalReserve,
  goalReserve,
  totalGoalReserve,
} from '../src/math/budget';

describe('the reserve a goal claims', () => {
  it('reproduces the case that made Safe-to-Spend negative', () => {
    // A 10,000 goal with no deadline, 30 days left in the period. Paced over
    // the 90-day horizon that is a third of it — 3,333 — against a 3,000
    // allowance. The budget went negative from ambition alone.
    const reserve = goalReserve({
      targetAmount: 10000,
      savedAmount: 0,
      daysUntilDeadline: null,
      daysRemainingInPeriod: 30,
    });

    expect(Math.round(reserve)).toBe(3333);
    expect(3000 - reserve).toBeLessThan(0);
  });
});

describe('cappedGoalReserve', () => {
  const hungry = [
    { targetAmount: 10000, savedAmount: 0, daysUntilDeadline: null, daysRemainingInPeriod: 30 },
  ];

  it('never lets goals take more than half of what is coming in', () => {
    const result = cappedGoalReserve(hungry, 3000);

    expect(result.requested).toBeCloseTo(3333.33, 1);
    expect(result.reserved).toBe(1500);
    expect(result.capped).toBe(true);
    // The whole point: what is left is positive.
    expect(3000 - result.reserved).toBeGreaterThan(0);
  });

  it('leaves a reasonable goal completely alone', () => {
    const result = cappedGoalReserve(hungry, 20000);

    expect(result.reserved).toBeCloseTo(3333.33, 1);
    expect(result.capped).toBe(false);
  });

  it('scales with money topped up mid-period, not just the allowance', () => {
    const lean = cappedGoalReserve(hungry, 4000);
    const afterTopUp = cappedGoalReserve(hungry, 8000);
    expect(afterTopUp.reserved).toBeGreaterThan(lean.reserved);
  });

  it('reserves nothing when there is nothing to reserve from', () => {
    const result = cappedGoalReserve(hungry, 0);
    expect(result.reserved).toBe(0);
    expect(result.capped).toBe(true);
  });

  it('adds up multiple goals before applying the ceiling', () => {
    const two = [...hungry, ...hungry];
    const result = cappedGoalReserve(two, 10000);

    expect(result.requested).toBeCloseTo(totalGoalReserve(two), 5);
    expect(result.reserved).toBe(10000 * MAX_GOAL_RESERVE_SHARE);
  });

  it('is not capped when there are no goals at all', () => {
    const result = cappedGoalReserve([], 3000);
    expect(result.reserved).toBe(0);
    expect(result.capped).toBe(false);
  });
});
