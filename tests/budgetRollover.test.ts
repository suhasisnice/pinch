import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';
import { getBudgetSnapshot } from '../src/services/budgetService';

/**
 * ensureBudgetPeriod used to silently roll a finished period into a new one
 * at the same allowance, with whatever was left over simply gone from any
 * total the app tracked. These prove the sweep that now runs first: a
 * positive leftover lands in a Savings goal rather than vanishing, and a
 * negative one is left alone rather than pulling money back out of savings
 * on a guess.
 */
describe('sweeping a finished period into savings', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it("moves what a finished period didn't spend into a Savings goal", async () => {
    const start = new Date(2026, 8, 1, 0, 0);
    await db.startBudgetPeriod({ allowance: 3000, days: 2, now: start });
    await db.addTransaction({
      amount: 1000,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Cafe',
      occurredAt: new Date(2026, 8, 1, 10, 0).toISOString(),
    });

    // Past the 2-day period's end.
    await getBudgetSnapshot(5000, new Date(2026, 8, 4, 9, 0));

    const savings = (await db.getActiveGoals()).find((g) => g.name === 'Savings');
    expect(savings?.savedAmount).toBe(2000);
  });

  it('never pulls money out of savings for a period that ran over', async () => {
    const start = new Date(2026, 8, 1, 0, 0);
    await db.startBudgetPeriod({ allowance: 1000, days: 1, now: start });
    await db.addTransaction({
      amount: 1500,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Cafe',
      occurredAt: new Date(2026, 8, 1, 10, 0).toISOString(),
    });

    await getBudgetSnapshot(5000, new Date(2026, 8, 3, 9, 0));

    expect((await db.getActiveGoals()).find((g) => g.name === 'Savings')).toBeUndefined();
  });

  it('sweeps a finished period only once', async () => {
    const start = new Date(2026, 8, 1, 0, 0);
    await db.startBudgetPeriod({ allowance: 1000, days: 1, now: start });

    const after = new Date(2026, 8, 3, 9, 0);
    await getBudgetSnapshot(5000, after);
    await getBudgetSnapshot(5000, after);

    const savings = (await db.getActiveGoals()).find((g) => g.name === 'Savings');
    expect(savings?.savedAmount).toBe(1000);
  });

  it('reuses the same Savings goal across more than one rollover', async () => {
    await db.startBudgetPeriod({ allowance: 1000, days: 1, now: new Date(2026, 8, 1) });
    await getBudgetSnapshot(5000, new Date(2026, 8, 3));

    await db.startBudgetPeriod({ allowance: 2000, days: 1, now: new Date(2026, 8, 3) });
    await getBudgetSnapshot(5000, new Date(2026, 8, 5));

    const savingsGoals = (await db.getActiveGoals()).filter((g) => g.name === 'Savings');
    expect(savingsGoals).toHaveLength(1);
    expect(savingsGoals[0].savedAmount).toBe(3000);
  });

  it('does not touch a period that is still running', async () => {
    await db.startBudgetPeriod({ allowance: 3000, days: 30, now: new Date(2026, 8, 1) });
    await getBudgetSnapshot(5000, new Date(2026, 8, 5));

    expect((await db.getActiveGoals()).find((g) => g.name === 'Savings')).toBeUndefined();
  });
});
