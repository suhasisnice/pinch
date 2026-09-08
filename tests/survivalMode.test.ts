import {
  computeDailySurvivalCap,
  daysLeftInMonth,
  isSurvivalMode,
  SURVIVAL_MODE_THRESHOLD,
} from '../src/math/survivalMode';

describe('isSurvivalMode', () => {
  test('true when balance is below the threshold', () => {
    expect(isSurvivalMode(999)).toBe(true);
  });

  test('false when balance is at or above the threshold', () => {
    expect(isSurvivalMode(1000)).toBe(false);
    expect(isSurvivalMode(5000)).toBe(false);
  });

  test('true for a negative balance', () => {
    expect(isSurvivalMode(-50)).toBe(true);
  });

  test('respects a custom threshold', () => {
    expect(isSurvivalMode(1500, 2000)).toBe(true);
    expect(isSurvivalMode(2500, 2000)).toBe(false);
  });

  test('exports the default threshold as 1000', () => {
    expect(SURVIVAL_MODE_THRESHOLD).toBe(1000);
  });
});

describe('daysLeftInMonth', () => {
  test('counts today as day 1 of what is left', () => {
    const lastDayOfMonth = new Date(Date.UTC(2026, 8, 30)); // Sep 30, 2026 (30-day month)
    expect(daysLeftInMonth(lastDayOfMonth)).toBe(1);
  });

  test('first of the month in a 30-day month has 30 days left', () => {
    const firstOfMonth = new Date(Date.UTC(2026, 8, 1)); // Sep 1, 2026
    expect(daysLeftInMonth(firstOfMonth)).toBe(30);
  });

  test('handles a 31-day month', () => {
    const firstOfMonth = new Date(Date.UTC(2026, 9, 1)); // Oct 1, 2026
    expect(daysLeftInMonth(firstOfMonth)).toBe(31);
  });

  test('handles February in a non-leap year', () => {
    const firstOfMonth = new Date(Date.UTC(2026, 1, 1)); // Feb 1, 2026 (not a leap year)
    expect(daysLeftInMonth(firstOfMonth)).toBe(28);
  });
});

describe('computeDailySurvivalCap', () => {
  test('divides balance evenly across remaining days', () => {
    expect(computeDailySurvivalCap(500, 5)).toBe(100);
  });

  test('treats zero days left as 1 (today is still spendable)', () => {
    expect(computeDailySurvivalCap(200, 0)).toBe(200);
  });

  test('handles a negative balance (still divides, still shown as a deficit)', () => {
    expect(computeDailySurvivalCap(-100, 5)).toBe(-20);
  });
});
