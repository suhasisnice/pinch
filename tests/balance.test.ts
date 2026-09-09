import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';

async function move(
  amount: number,
  direction: 'DEBIT' | 'CREDIT',
  occurredAt: string,
  merchant = 'Test'
): Promise<number> {
  return db.addTransaction({
    amount,
    direction,
    kind: direction === 'DEBIT' ? 'SPEND' : 'INCOME',
    merchant,
    category: null,
    occurredAt,
    source: 'MANUAL',
    rawText: null,
    externalRef: null,
    dedupKey: `${merchant}-${occurredAt}-${amount}`,
    outingId: null,
  });
}

describe('bank balance', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('has nothing to say before a balance is entered', async () => {
    const state = await db.getBalanceState();
    expect(state.snapshot).toBeNull();
    expect(state.projected).toBeNull();
  });

  it('moves the entered figure by what happened afterwards', async () => {
    await db.recordBalance(5000, new Date('2026-09-09T09:00:00.000Z'));
    await move(300, 'DEBIT', '2026-09-09T12:00:00.000Z');
    await move(1000, 'CREDIT', '2026-09-09T13:00:00.000Z');

    const state = await db.getBalanceState();
    expect(state.spentSince).toBe(300);
    expect(state.receivedSince).toBe(1000);
    expect(state.projected).toBe(5700);
  });

  it('ignores anything that happened before the snapshot', async () => {
    await move(9999, 'DEBIT', '2026-09-08T12:00:00.000Z');
    await db.recordBalance(5000, new Date('2026-09-09T09:00:00.000Z'));

    // The typed figure already reflects that spending; counting it again
    // would subtract it twice.
    expect((await db.getBalanceState()).projected).toBe(5000);
  });

  it('counts every direction, not only spending', async () => {
    await db.recordBalance(1000, new Date('2026-09-09T09:00:00.000Z'));
    const out = await move(500, 'DEBIT', '2026-09-09T10:00:00.000Z', 'Transfer out');
    const back = await move(500, 'CREDIT', '2026-09-09T10:02:00.000Z', 'Transfer in');
    await db.markTransferPair(out, back);

    // A transfer between your own accounts nets to zero across both legs,
    // which is correct for a total held across accounts.
    expect((await db.getBalanceState()).projected).toBe(1000);
  });

  it('leaves out junk that was excluded', async () => {
    await db.recordBalance(2000, new Date('2026-09-09T09:00:00.000Z'));
    const junk = await move(800, 'DEBIT', '2026-09-09T10:00:00.000Z', 'Voucher');
    await db.setTransactionExcluded(junk, true);

    expect((await db.getBalanceState()).projected).toBe(2000);
  });

  it('uses the most recent figure when several were entered', async () => {
    await db.recordBalance(5000, new Date('2026-09-01T09:00:00.000Z'));
    await db.recordBalance(3200, new Date('2026-09-09T09:00:00.000Z'));

    const state = await db.getBalanceState();
    expect(state.snapshot?.amount).toBe(3200);
    expect(state.projected).toBe(3200);
  });

  it('keeps the history so drift can be compared later', async () => {
    await db.recordBalance(5000, new Date('2026-09-01T09:00:00.000Z'));
    await db.recordBalance(3200, new Date('2026-09-09T09:00:00.000Z'));

    const history = await db.getBalanceHistory();
    expect(history.map((h) => h.amount)).toEqual([3200, 5000]);
  });
});
