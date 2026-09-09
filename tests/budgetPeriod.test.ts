import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';
import { startOfDayIso } from '../src/utils/format';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('budget periods', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('starts the period at local midnight, not at the moment it was set up', async () => {
    const afternoon = new Date(2026, 8, 9, 15, 30);
    const period = await db.startBudgetPeriod({ allowance: 9000, days: 30, now: afternoon });

    expect(period.startsOn).toBe(startOfDayIso(afternoon));
    expect(period.daysTotal).toBe(30);
    expect(period.allowance).toBe(9000);
  });

  it('takes effect immediately as the current period', async () => {
    const now = new Date(2026, 8, 9, 10, 0);
    // First launch creates a default period.
    await db.ensureBudgetPeriod(5000, now);

    await db.startBudgetPeriod({ allowance: 9000, days: 15, now });

    const current = await db.getCurrentBudgetPeriod(now);
    expect(current?.allowance).toBe(9000);
    expect(current?.daysTotal).toBe(15);
    expect((await db.ensureBudgetPeriod(5000, now)).allowance).toBe(9000);
  });

  it('corrects the same day in place rather than stacking periods', async () => {
    const morning = new Date(2026, 8, 9, 9, 0);
    const evening = new Date(2026, 8, 9, 21, 0);

    await db.startBudgetPeriod({ allowance: 9000, days: 30, now: morning });
    await db.startBudgetPeriod({ allowance: 7500, days: 30, now: evening });

    const all = await db.getAllBudgetPeriods();
    expect(all).toHaveLength(1);
    expect(all[0].allowance).toBe(7500);
  });

  it('picks the newest period when two of them cover today', async () => {
    // Two overlapping periods with the same start date can only be created by
    // an older build; the current one must still resolve deterministically.
    const startsOn = '2026-09-01T00:00:00.000Z';
    await db.createBudgetPeriod({
      startsOn,
      endsOn: new Date(Date.parse(startsOn) + 30 * MS_PER_DAY).toISOString(),
      allowance: 5000,
    });
    await db.createBudgetPeriod({
      startsOn,
      endsOn: new Date(Date.parse(startsOn) + 30 * MS_PER_DAY).toISOString(),
      allowance: 9000,
    });

    const current = await db.getCurrentBudgetPeriod(new Date('2026-09-09T10:00:00.000Z'));
    expect(current?.allowance).toBe(9000);
  });

  it('counts spending from earlier the same day the period starts', async () => {
    const now = new Date(2026, 8, 9, 15, 30);
    await db.addTransaction({
      amount: 250,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Chai Point',
      category: 'Food',
      occurredAt: new Date(2026, 8, 9, 8, 15).toISOString(),
      source: 'MANUAL',
      rawText: null,
      externalRef: null,
      dedupKey: null,
      outingId: null,
    });

    const period = await db.startBudgetPeriod({ allowance: 9000, days: 30, now });
    const spent = await db.getGrossSpendBetween(period.startsOn, period.endsOn);

    expect(spent).toBe(250);
  });
});
