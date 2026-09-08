import {
  computeSafeToSpend,
  currentYearMonth,
  getSafeToSpend,
  effectiveDaysRemaining,
  getCalibratedSafeToSpend,
  CalibrationBaseline,
} from '../src/math/safeToSpend';
import * as dbService from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

describe('safeToSpend.computeSafeToSpend (pure)', () => {
  test('basic case: allowance minus expenses', () => {
    const result = computeSafeToSpend(500, 200, 0);
    expect(result.safeToSpend).toBe(300);
  });

  test('open IOUs are isolated out of monthly expenses', () => {
    // Fronted $80 total, $30 of which is an open IOU someone else owes back.
    const result = computeSafeToSpend(500, 80, 30);
    expect(result.netMonthlyExpenses).toBe(50);
    expect(result.safeToSpend).toBe(450);
  });

  test('fully-open IOU expense nets to zero impact on safe-to-spend', () => {
    const result = computeSafeToSpend(300, 60, 60);
    expect(result.netMonthlyExpenses).toBe(0);
    expect(result.safeToSpend).toBe(300);
  });

  test('overspending produces a negative safe-to-spend', () => {
    const result = computeSafeToSpend(100, 250, 0);
    expect(result.safeToSpend).toBe(-150);
  });
});

describe('safeToSpend.currentYearMonth', () => {
  test('formats as YYYY-MM', () => {
    const date = new Date(Date.UTC(2026, 8, 8)); // September 2026
    expect(currentYearMonth(date)).toBe('2026-09');
  });
});

describe('safeToSpend.getSafeToSpend (DB-integrated, real SQLite via sql.js)', () => {
  beforeEach(async () => {
    dbService.__resetDatabaseForTests();
    const adapter = await createSqlJsAdapter();
    await dbService.initDatabase(adapter);
  });

  test('excludes open IOUs from this month expenses, counts settled ones normally', async () => {
    // $200 grocery run fronted for a roommate, $75 of it owed back and still open.
    const groceriesTxId = await dbService.addTransaction(200, 'Groceries', 'DEBIT');
    const roommate = await dbService.addContact('Roommate');
    await dbService.createIOU(groceriesTxId, roommate, 75);

    // $40 coffee, no IOU attached at all — a plain personal expense.
    await dbService.addTransaction(40, 'Coffee Shop', 'DEBIT');

    // $150 concert ticket fronted for a friend, already repaid (settled).
    const concertTxId = await dbService.addTransaction(150, 'Concert', 'DEBIT');
    const friend = await dbService.addContact('Friend');
    await dbService.createIOU(concertTxId, friend, 60);
    await dbService.resolveIOUByAmount(60);

    // addTransaction always stamps "now", so query whatever month that
    // actually falls in rather than a fixed string.
    const thisMonth = currentYearMonth();
    const breakdown = await getSafeToSpend(500, thisMonth);

    // Gross = 200 + 40 + 150 = 390; open IOU total = 75 (settled one stays counted).
    expect(breakdown.grossMonthlyExpenses).toBe(390);
    expect(breakdown.openIOUTotal).toBe(75);
    expect(breakdown.netMonthlyExpenses).toBe(315);
    expect(breakdown.safeToSpend).toBe(185);
  });

  test('a month with no transactions yields safe-to-spend equal to the allowance', async () => {
    const breakdown = await getSafeToSpend(250, '2099-01');
    expect(breakdown.grossMonthlyExpenses).toBe(0);
    expect(breakdown.openIOUTotal).toBe(0);
    expect(breakdown.safeToSpend).toBe(250);
  });

  test('CREDIT transactions are never counted as expenses', async () => {
    await dbService.addTransaction(100, 'Refund', 'CREDIT');
    const breakdown = await getSafeToSpend(200, currentYearMonth());
    expect(breakdown.grossMonthlyExpenses).toBe(0);
    expect(breakdown.safeToSpend).toBe(200);
  });
});

describe('safeToSpend.effectiveDaysRemaining (pure)', () => {
  test('equals daysRemaining when calibrated just now', () => {
    const baseline: CalibrationBaseline = {
      balance: 1000,
      daysRemaining: 10,
      calibratedAt: new Date().toISOString(),
    };
    expect(effectiveDaysRemaining(baseline, new Date())).toBe(10);
  });

  test('counts down by full days elapsed since calibration', () => {
    const baseline: CalibrationBaseline = {
      balance: 1000,
      daysRemaining: 10,
      calibratedAt: '2026-09-01T00:00:00.000Z',
    };
    const threeDaysLater = new Date('2026-09-04T00:00:00.000Z');
    expect(effectiveDaysRemaining(baseline, threeDaysLater)).toBe(7);
  });

  test('floors at 1 even if the window has technically run out', () => {
    const baseline: CalibrationBaseline = {
      balance: 1000,
      daysRemaining: 5,
      calibratedAt: '2026-09-01T00:00:00.000Z',
    };
    const wayLater = new Date('2026-10-01T00:00:00.000Z');
    expect(effectiveDaysRemaining(baseline, wayLater)).toBe(1);
  });
});

describe('safeToSpend.getCalibratedSafeToSpend (DB-integrated, real SQLite via sql.js)', () => {
  beforeEach(async () => {
    dbService.__resetDatabaseForTests();
    const adapter = await createSqlJsAdapter();
    await dbService.initDatabase(adapter);
  });

  test('rebases on the calibration balance, only counting spending logged after calibration', async () => {
    // Spending before calibration is already baked into the balance the
    // user typed in — it must not be double-counted.
    await dbService.addTransaction(300, 'Before calibration', 'DEBIT');

    const baseline: CalibrationBaseline = {
      balance: 1000,
      daysRemaining: 10,
      calibratedAt: new Date(Date.now() + 10).toISOString(),
    };
    await new Promise((resolve) => setTimeout(resolve, 20));

    await dbService.addTransaction(150, 'After calibration', 'DEBIT');

    const contactId = await dbService.addContact('Roommate');
    const txId = await dbService.addTransaction(80, 'Fronted for roommate', 'DEBIT');
    await dbService.createIOU(txId, contactId, 30);

    const breakdown = await getCalibratedSafeToSpend(baseline);

    // Gross since calibration = 150 + 80 = 230; open IOU = 30 isolated out.
    expect(breakdown.grossMonthlyExpenses).toBe(230);
    expect(breakdown.openIOUTotal).toBe(30);
    expect(breakdown.safeToSpend).toBe(1000 - 200);
    expect(breakdown.daysRemaining).toBe(10);
  });

  test('with no spending since calibration, safe-to-spend equals the calibrated balance', async () => {
    await dbService.addTransaction(9999, 'Long before calibration', 'DEBIT');

    const baseline: CalibrationBaseline = {
      balance: 400,
      daysRemaining: 6,
      calibratedAt: new Date(Date.now() + 10).toISOString(),
    };
    await new Promise((resolve) => setTimeout(resolve, 20));

    const breakdown = await getCalibratedSafeToSpend(baseline);
    expect(breakdown.safeToSpend).toBe(400);
  });
});
