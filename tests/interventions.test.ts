import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { __resetStorage } from './mocks/async-storage';
import { __scheduled } from './mocks/expo-notifications';
import * as db from '../src/db/dbService';
import { getBudgetSnapshot } from '../src/services/budgetService';
import {
  getWeekPatterns,
  planTransactionInterventions,
  refreshRecovery,
  scheduleHeadsUps,
} from '../src/services/interventionService';
import { getRecoveryMission } from '../src/settings/settingsStore';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/notifications/engine';

const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, quietStartHour: 23, quietEndHour: 6 };

async function spend(at: Date, amount: number, merchant: string, category = 'Food') {
  return db.addTransaction({
    amount,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant,
    category,
    occurredAt: at.toISOString(),
    source: 'MANUAL',
    rawText: null,
    externalRef: null,
    dedupKey: `${merchant}-${at.getTime()}-${amount}`,
    outingId: null,
  });
}

/** 1 Sep 2026 is a Tuesday; a 30-day period at ₹3,000 → ₹100 a day. */
const day = (d: number, h = 13) => new Date(2026, 8, d, h, 0);

beforeEach(async () => {
  __resetStorage();
  __scheduled.clear();
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
  await db.startBudgetPeriod({ allowance: 3000, days: 30, now: day(1, 8) });
});

describe('recovery mission, end to end', () => {
  it('starts after an overspend, announces once, and finishes when held', async () => {
    await spend(day(1, 12), 160, 'Swiggy');
    const first = await refreshRecovery(await getBudgetSnapshot(3000, day(1)), day(1));
    expect(first.events).toEqual(['RECOVERY_START']);
    const mission = (await getRecoveryMission())!;
    expect(mission.startsOn).toBe('2026-09-02');
    expect(mission.daysNeeded).toBe(2);
    expect(mission.target).toBe(70);

    const again = await refreshRecovery(await getBudgetSnapshot(3000, day(1, 14)), day(1, 14));
    expect(again.events).toEqual([]);

    await spend(day(2), 50, 'Canteen');
    const dayTwo = await refreshRecovery(await getBudgetSnapshot(3000, day(2, 20)), day(2, 20));
    expect(dayTwo.view?.progress.dayNumber).toBe(1);
    expect(dayTwo.view?.leftToday).toBe(20);

    await spend(day(3), 60, 'Canteen');
    const done = await refreshRecovery(await getBudgetSnapshot(3000, day(4)), day(4));
    expect(done.events).toEqual(['RECOVERY_DONE']);
    expect(await getRecoveryMission()).toBeNull();
  });

  it('re-plans on the same day when the overspend grows', async () => {
    await spend(day(1, 10), 160, 'Swiggy');
    await refreshRecovery(await getBudgetSnapshot(3000, day(1, 11)), day(1, 11));
    await spend(day(1, 12), 200, 'Zomato');
    await refreshRecovery(await getBudgetSnapshot(3000, day(1, 13)), day(1, 13));
    const mission = (await getRecoveryMission())!;
    expect(mission.overBy).toBeGreaterThan(250);
    expect(mission.daysNeeded).toBeGreaterThan(2);
  });

  it('calls out a slip on a mission day, once', async () => {
    await spend(day(1, 12), 160, 'Swiggy');
    await refreshRecovery(await getBudgetSnapshot(3000, day(1)), day(1));

    const id = await spend(day(2, 12), 90, 'Dominos');
    const snap = await getBudgetSnapshot(3000, day(2, 13));
    const said = await planTransactionInterventions({
      transactionId: id,
      amount: 90,
      merchant: 'Dominos',
      category: 'Food',
      occurredAt: day(2, 12),
      snapshot: snap,
      settings,
      now: day(2, 13),
    });
    expect(said.planned.map((p) => p.tier)).toContain('RECOVERY_SLIP');

    const id2 = await spend(day(2, 14), 30, 'Chai');
    const again = await planTransactionInterventions({
      transactionId: id2,
      amount: 30,
      merchant: 'Chai',
      category: 'Food',
      occurredAt: day(2, 14),
      snapshot: await getBudgetSnapshot(3000, day(2, 15)),
      settings,
      now: day(2, 15),
    });
    expect(again.planned.map((p) => p.tier)).not.toContain('RECOVERY_SLIP');
  });
});

describe('caps and callouts, end to end', () => {
  async function after(at: Date, amount: number, merchant: string) {
    const id = await spend(at, amount, merchant);
    return planTransactionInterventions({
      transactionId: id,
      amount,
      merchant,
      category: 'Food',
      occurredAt: at,
      snapshot: await getBudgetSnapshot(3000, at),
      settings,
      now: at,
    });
  }

  it('warns near a cap once, then speaks on every payment past it', async () => {
    await db.setSpendCap('MERCHANT', 'Swiggy', 600);
    // Week of Mon 7 Sep.
    expect(
      (await after(day(7, 12), 300, 'Swiggy')).planned.filter((p) => p.type === 'CAP')
    ).toEqual([]);
    const near = await after(day(8, 12), 200, 'Swiggy');
    expect(near.planned.find((p) => p.type === 'CAP')?.tier).toBe('CAP_NEAR');
    const broken = await after(day(9, 12), 200, 'Swiggy');
    expect(broken.planned.find((p) => p.type === 'CAP')?.tier).toBe('CAP_BROKEN');
    const more = await after(day(10, 12), 50, 'Swiggy');
    expect(more.planned.find((p) => p.type === 'CAP')?.tier).toBe('CAP_BROKEN');

    const week = await getWeekPatterns(day(10, 18));
    expect(week.caps[0].spent).toBe(750);
    expect(week.caps[0].level).toBe('BROKEN');
  });

  it('names a habit on the payment that makes it one, and only then', async () => {
    await after(day(7, 12), 150, 'Swiggy');
    await after(day(8, 12), 150, 'Swiggy');
    const third = await after(day(9, 12), 150, 'Swiggy');
    const callout = third.planned.find((p) => p.type === 'CALLOUT');
    // Either savage line: both name the place, the count and the money.
    expect(callout?.body).toMatch(/Swiggy/);
    expect(callout?.body).toMatch(/3/);
    expect(callout?.body).toContain('₹450');
    const fourth = await after(day(10, 12), 150, 'Swiggy');
    expect(fourth.planned.find((p) => p.type === 'CALLOUT')).toBeUndefined();
  });

  it('stops calling out a habit once it has a cap', async () => {
    for (const d of [7, 8, 9]) await spend(day(d), 150, 'Swiggy');
    expect((await getWeekPatterns(day(9, 18))).callouts).toHaveLength(1);
    await db.setSpendCap('MERCHANT', 'Swiggy', 400);
    expect((await getWeekPatterns(day(9, 18))).callouts).toHaveLength(0);
  });

  it('stays silent with interventions switched off', async () => {
    await db.setSpendCap('MERCHANT', 'Swiggy', 100);
    const id = await spend(day(7, 12), 300, 'Swiggy');
    const out = await planTransactionInterventions({
      transactionId: id,
      amount: 300,
      merchant: 'Swiggy',
      category: 'Food',
      occurredAt: day(7, 12),
      snapshot: await getBudgetSnapshot(3000, day(7, 12)),
      settings: { ...settings, interventionsEnabled: false },
      now: day(7, 12),
    });
    expect(out.planned).toEqual([]);
  });
});

describe('heads-ups', () => {
  it('schedules a warning before a learned risky window', async () => {
    // Eight Friday nights at ₹900 before 30 Oct, in a period that covers them.
    await db.resetData({ periods: true });
    const now = new Date(2026, 9, 29, 12, 0); // Thursday 29 Oct
    await db.startBudgetPeriod({ allowance: 9000, days: 30, now: new Date(2026, 9, 20, 8) });
    for (let w = 1; w <= 8; w++) {
      const friday = new Date(2026, 9, 30 - w * 7, 22, 0);
      await spend(friday, 900, 'Bar');
    }
    await scheduleHeadsUps(await getBudgetSnapshot(9000, now), settings, now);
    const scheduled = __scheduled.get('pinch-headsup-0') as {
      content: { body: string };
      trigger: { date: Date };
    };
    expect(scheduled).toBeDefined();
    expect(scheduled.content.body).toContain('Friday nights');
    expect(scheduled.trigger.date.getDay()).toBe(5);
    expect(scheduled.trigger.date.getHours()).toBe(20);
  });

  it('schedules nothing when heads-ups are off', async () => {
    await scheduleHeadsUps(
      await getBudgetSnapshot(3000, day(5)),
      { ...settings, headsUpEnabled: false },
      day(5)
    );
    expect(__scheduled.size).toBe(0);
  });
});
