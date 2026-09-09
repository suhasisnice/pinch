import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';

const WINDOW: [string, string] = ['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'];

async function spend(amount: number, merchant: string): Promise<number> {
  return db.addTransaction({
    amount,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant,
    category: null,
    occurredAt: '2026-09-09T12:00:00.000Z',
    source: 'MANUAL',
    rawText: null,
    externalRef: null,
    dedupKey: null,
    outingId: null,
  });
}

describe('what you actually bore', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('is the whole bill when nothing was shared', async () => {
    await spend(900, 'Toit');
    const result = await db.getBorneBetween(...WINDOW);

    expect(result.paid).toBe(900);
    expect(result.splitAway).toBe(0);
    expect(result.borne).toBe(900);
  });

  it('subtracts what was charged to other people, paid back or not', async () => {
    // A 900 dinner split three ways: you fronted it, but 600 was never yours.
    const txId = await spend(900, 'Toit');
    const rahul = await db.addContact('Rahul');
    const priya = await db.addContact('Priya');
    await db.createIOU({ contactId: rahul, amount: 300, direction: 'THEY_OWE_ME', transactionId: txId });
    await db.createIOU({ contactId: priya, amount: 300, direction: 'THEY_OWE_ME', transactionId: txId });

    const result = await db.getBorneBetween(...WINDOW);

    expect(result.paid).toBe(900);
    expect(result.splitAway).toBe(600);
    expect(result.borne).toBe(300);
    expect(result.recovered).toBe(0);
    expect(result.stillOwed).toBe(600);
  });

  it('tracks recovery separately from what is genuinely yours', async () => {
    const txId = await spend(900, 'Toit');
    const rahul = await db.addContact('Rahul');
    const iouId = await db.createIOU({
      contactId: rahul,
      amount: 600,
      direction: 'THEY_OWE_ME',
      transactionId: txId,
    });

    await db.settleIOU(iouId, 250);
    const result = await db.getBorneBetween(...WINDOW);

    // Your share never changes when someone pays — only the recovery does.
    expect(result.borne).toBe(300);
    expect(result.recovered).toBe(250);
    expect(result.stillOwed).toBe(350);
  });

  it('ignores spending that was excluded as junk', async () => {
    await spend(900, 'Toit');
    const junk = await spend(5000, 'Voucher');
    await db.setTransactionExcluded(junk, true);

    expect((await db.getBorneBetween(...WINDOW)).paid).toBe(900);
  });

  it('ignores money moved between your own accounts', async () => {
    await spend(900, 'Toit');
    const out = await spend(10000, 'Transfer out');
    const back = await db.addTransaction({
      amount: 10000,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Transfer in',
      category: null,
      occurredAt: '2026-09-09T12:02:00.000Z',
      source: 'MANUAL',
      rawText: null,
      externalRef: null,
      dedupKey: null,
      outingId: null,
    });

    await db.markTransferPair(out, back);

    const result = await db.getBorneBetween(...WINDOW);
    expect(result.paid).toBe(900);
    expect(result.borne).toBe(900);

    // And it must leave income alone too, or the allowance inflates.
    expect(await db.getIncomeBetween(...WINDOW)).toBe(0);
  });

  it('puts the money back when a transfer is unmarked', async () => {
    const out = await spend(10000, 'Transfer out');
    const back = await db.addTransaction({
      amount: 10000,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Transfer in',
      category: null,
      occurredAt: '2026-09-09T12:02:00.000Z',
      source: 'MANUAL',
      rawText: null,
      externalRef: null,
      dedupKey: null,
      outingId: null,
    });

    await db.markTransferPair(out, back);
    expect((await db.getBorneBetween(...WINDOW)).paid).toBe(0);

    // Unmarking from either leg must clear both.
    await db.unmarkTransfer(back);
    expect((await db.getBorneBetween(...WINDOW)).paid).toBe(10000);
    expect(await db.getIncomeBetween(...WINDOW)).toBe(10000);
  });
});
