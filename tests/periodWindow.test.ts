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

describe('what the budget window actually covers', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('ignores spending from earlier in the month once a period starts today', async () => {
    // Installed on the 1st, so a period exists that began then.
    await db.ensureBudgetPeriod(3000, new Date(2026, 8, 1, 9, 0));

    // Spent through the first week — the "stuff for dad" case.
    await spendOn(new Date(2026, 8, 2, 12, 0), 4000, 'Croma');
    await spendOn(new Date(2026, 8, 5, 12, 0), 2669, 'Reliance Digital');

    const today = new Date(2026, 8, 9, 15, 0);

    // Before starting fresh: the old period still spans the whole month.
    const before = await getBudgetSnapshot(3000, today);
    expect(before.budget.grossSpend).toBe(6669);
    expect(before.budget.spendablePool).toBe(3000 - 6669);

    // Start fresh from today with 9000.
    await db.resetData({ periods: true });
    await db.startBudgetPeriod({ allowance: 9000, days: 30, now: today });

    const after = await getBudgetSnapshot(9000, today);
    expect(after.budget.allowance).toBe(9000);
    expect(after.budget.grossSpend).toBe(0);
    expect(after.budget.spendablePool).toBe(9000);
    expect(after.daysRemaining).toBe(30);
  });

  it('still counts what was spent earlier the same day the period starts', async () => {
    const today = new Date(2026, 8, 9, 15, 0);
    await spendOn(new Date(2026, 8, 9, 8, 30), 250, 'Chai Point');

    await db.startBudgetPeriod({ allowance: 9000, days: 30, now: today });
    const snapshot = await getBudgetSnapshot(9000, today);

    expect(snapshot.budget.grossSpend).toBe(250);
  });

  it('a new period beats an older one that also covers today', async () => {
    await db.ensureBudgetPeriod(3000, new Date(2026, 8, 1, 9, 0));
    const today = new Date(2026, 8, 9, 15, 0);
    await db.startBudgetPeriod({ allowance: 9000, days: 30, now: today });

    const current = await db.getCurrentBudgetPeriod(today);
    expect(current?.allowance).toBe(9000);
    expect(current?.startsOn.slice(0, 10)).toBe(
      new Date(2026, 8, 9).toISOString().slice(0, 10)
    );
  });
});
