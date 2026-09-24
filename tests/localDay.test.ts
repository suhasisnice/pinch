// Pinned to India, where this bug lived: UTC is 5:30 behind, so a 1 AM spend
// has a UTC date of the day before. Set before any Date is made.
process.env.TZ = 'Asia/Kolkata';

import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';
import { computeStreak, weekdayPattern } from '../src/math/insights';

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
 * Spending is filed under the day the user lived, not the UTC day. Before,
 * everything between midnight and 5:30 AM landed on the day before: a late
 * Saturday night showed up as Friday, and could break a streak that held.
 */
describe('daily spend uses the local day', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('runs in IST', () => {
    expect(new Date(2026, 8, 20, 1, 0).toISOString()).toBe('2026-09-19T19:30:00.000Z');
  });

  it('files a 1 AM spend under that day, not the one before', async () => {
    await spendOn(new Date(2026, 8, 20, 1, 0), 400, 'LATE DOSA');
    await spendOn(new Date(2026, 8, 19, 23, 0), 100, 'CHAI');

    const days = await db.getDailySpend(
      new Date(2026, 8, 1).toISOString(),
      new Date(2026, 9, 1).toISOString()
    );
    expect(days).toEqual([
      { day: '2026-09-19', total: 100 },
      { day: '2026-09-20', total: 400 },
    ]);
  });

  it('counts the right days in the monthly history', async () => {
    await spendOn(new Date(2026, 8, 20, 1, 0), 400, 'LATE DOSA');
    await spendOn(new Date(2026, 8, 20, 13, 0), 100, 'LUNCH');

    const months = await db.getMonthlySpend(6, new Date(2026, 8, 25));
    expect(months[0]).toMatchObject({ total: 500, count: 2, days: 1 });
  });

  it('keeps a streak and a weekday on the local calendar', async () => {
    // Sunday 20th, 1 AM: over the ₹300 limit. Saturday itself was fine.
    await spendOn(new Date(2026, 8, 20, 1, 0), 400, 'LATE DOSA');
    await spendOn(new Date(2026, 8, 19, 12, 0), 100, 'CHAI');
    const daily = await db.getDailySpend(
      new Date(2026, 8, 1).toISOString(),
      new Date(2026, 9, 1).toISOString()
    );

    expect(computeStreak(daily, 300, '2026-09-21')).toBe(0); // Sunday broke it
    expect(computeStreak(daily, 300, '2026-09-20')).toBeGreaterThan(0); // Saturday held
    const sunday = weekdayPattern(daily).find((w) => w.weekday === 0);
    expect(sunday).toBeDefined();
  });
});
