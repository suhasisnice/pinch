import * as db from '../src/db/dbService';
import { getSpendingHistorySummary } from '../src/services/budgetService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

const spend = (amount: number, merchant: string, category: string, occurredAt: Date) =>
  db.addTransaction({
    amount,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant,
    category,
    occurredAt: occurredAt.toISOString(),
  });

describe('getSpendingHistorySummary', () => {
  it('returns null when there is no spending in the window at all', async () => {
    await expect(getSpendingHistorySummary()).resolves.toBeNull();
  });

  it('names the largest categories and their share of the total', async () => {
    const now = new Date();
    await spend(3000, 'Zomato', 'Food', daysAgo(2, now));
    await spend(1000, 'Uber', 'Transport', daysAgo(3, now));

    const summary = await getSpendingHistorySummary(now);
    expect(summary).not.toBeNull();
    expect(summary?.totalSpend).toBe(4000);
    expect(summary?.topCategories[0]).toEqual({ category: 'Food', total: 3000, fraction: 0.75 });
    expect(summary?.topCategories[1]).toEqual({ category: 'Transport', total: 1000, fraction: 0.25 });
  });

  it('surfaces a subscription that has renewed for three straight months', async () => {
    const now = new Date();
    await spend(199, 'Netflix', 'Subscriptions', daysAgo(2, now));
    await spend(199, 'Netflix', 'Subscriptions', daysAgo(32, now));
    await spend(199, 'Netflix', 'Subscriptions', daysAgo(62, now));

    const summary = await getSpendingHistorySummary(now);
    expect(summary?.recurringCount).toBe(1);
    expect(summary?.recurringMonthly).toBeCloseTo(199, 5);
  });

  it('does not call a single charge, seen only once, recurring', async () => {
    const now = new Date();
    await spend(199, 'Netflix', 'Subscriptions', daysAgo(2, now));

    const summary = await getSpendingHistorySummary(now);
    expect(summary?.recurringCount).toBe(0);
    expect(summary?.recurringMonthly).toBe(0);
  });

  it('ignores spending outside the window', async () => {
    const now = new Date();
    await spend(5000, 'Old Laptop Purchase', 'Shopping', daysAgo(200, now));

    await expect(getSpendingHistorySummary(now, 90)).resolves.toBeNull();
  });

  it('does not let a self-transfer or wallet top-up inflate the summary', async () => {
    const now = new Date();
    await spend(2000, 'Olive Cafe', 'Food', daysAgo(1, now));
    const id = await spend(3000, 'Paytm Wallet', 'Other', daysAgo(1, now));
    await db.setNonSpendReason(id!, 'WALLET_TOPUP');

    const summary = await getSpendingHistorySummary(now);
    expect(summary?.totalSpend).toBe(2000);
  });
});
