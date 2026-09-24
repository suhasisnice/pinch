import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';
import { getBudgetSnapshot } from '../src/services/budgetService';

async function spendOn(date: Date, amount: number, merchant: string): Promise<void> {
  await db.addTransaction({
    amount,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant,
    category: null,
    occurredAt: date.toISOString(),
    source: 'MANUAL',
    rawText: null,
    externalRef: null,
    dedupKey: `${merchant}-${date.getTime()}`,
    outingId: null,
  });
}

/**
 * Today's limit is set by the morning, not re-cut by every spend.
 *
 * The pool already has today's spending taken out of it. Dividing that by the
 * days left and then subtracting today's spending again charged each rupee
 * spent today twice — a little mid-month, and double on the last day.
 */
describe("today's limit", () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('does not shrink as you spend today', async () => {
    const start = new Date(2026, 8, 1, 9, 0);
    await db.startBudgetPeriod({ allowance: 3000, days: 30, now: start });
    const noon = new Date(2026, 8, 1, 12, 0);

    const fresh = await getBudgetSnapshot(3000, noon);
    expect(fresh.today.dailyLimit).toBeCloseTo(100, 5);

    await spendOn(new Date(2026, 8, 1, 11, 0), 60, 'Canteen');
    const after = await getBudgetSnapshot(3000, noon);
    expect(after.today.dailyLimit).toBeCloseTo(100, 5);
    expect(after.today.remainingToday).toBeCloseTo(40, 5);
    // The rest of the period is still what is left, spread over the days.
    expect(after.budget.spendablePool).toBe(2940);
  });

  it('counts a spend once on the last day of the period', async () => {
    const start = new Date(2026, 8, 1, 9, 0);
    await db.startBudgetPeriod({ allowance: 1000, days: 10, now: start });
    await spendOn(new Date(2026, 8, 3, 12, 0), 900, 'Rent share');

    const lastDay = new Date(2026, 8, 10, 12, 0);
    await spendOn(new Date(2026, 8, 10, 10, 0), 50, 'Chai');
    const snapshot = await getBudgetSnapshot(1000, lastDay);

    expect(snapshot.daysRemaining).toBe(1);
    expect(snapshot.today.dailyLimit).toBeCloseTo(100, 5);
    expect(snapshot.today.remainingToday).toBeCloseTo(50, 5);
    expect(snapshot.today.state).toBe('STEADY');
  });

  it('still goes over when today really is over', async () => {
    const start = new Date(2026, 8, 1, 9, 0);
    await db.startBudgetPeriod({ allowance: 3000, days: 30, now: start });
    await spendOn(new Date(2026, 8, 1, 10, 0), 160, 'Swiggy');
    const snapshot = await getBudgetSnapshot(3000, new Date(2026, 8, 1, 12, 0));
    expect(snapshot.today.remainingToday).toBeCloseTo(-60, 5);
    expect(snapshot.today.state).toBe('OVER');
  });
});
