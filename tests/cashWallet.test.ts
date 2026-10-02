import * as db from '../src/db/dbService';
import { postTransaction } from '../src/services/captureService';
import { classifyStoredTransactions } from '../src/services/classificationService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T09:00:00.000Z`);

const withdraw = (amount: number, day: number) =>
  postTransaction({
    amount,
    direction: 'DEBIT',
    merchant: 'ATM',
    rawText: `Rs.${amount} withdrawn at ATM from A/c XX1234`,
    source: 'SMS',
    occurredAt: at(day).toISOString(),
    silent: true,
  });

const spent = () => db.getGrossSpendBetween(at(1).toISOString(), at(30).toISOString());

describe('cash wallet', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('counts a withdrawal as spending while the wallet is not tracked', async () => {
    await withdraw(2000, 10);
    expect(await spent()).toBe(2000);
    expect((await db.getCashState()).projected).toBeNull();
  });

  it('moves a withdrawal from bank to wallet once the wallet is counted', async () => {
    await withdraw(700, 3); // before the first count: stays spending
    await db.recordBalance(10_000, at(5));
    await db.recordBalance(500, at(5), 'CASH');
    await withdraw(2000, 10);
    await classifyStoredTransactions(); // a full recheck must not change the answer

    expect(await spent()).toBe(700);
    expect((await db.getBalanceState()).projected).toBe(8000);
    expect((await db.getCashState()).projected).toBe(2500);
  });

  it('takes a cash payment from the wallet, not the bank, and counts it as spending', async () => {
    await db.recordBalance(10_000, at(5));
    await db.recordBalance(500, at(5), 'CASH');
    await postTransaction({
      amount: 120,
      direction: 'DEBIT',
      merchant: 'Chai',
      source: 'MANUAL',
      occurredAt: at(6).toISOString(),
      paidInCash: true,
      silent: true,
    });

    expect(await spent()).toBe(120);
    expect((await db.getBalanceState()).projected).toBe(10_000);
    expect((await db.getCashState()).projected).toBe(380);
  });
});
