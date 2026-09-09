import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';
import { findStaleCaptures, revalidateHistory } from '../src/services/revalidationService';

async function add(input: {
  merchant: string;
  amount: number;
  source: 'SMS' | 'NOTIFICATION' | 'MANUAL';
  rawText: string | null;
}): Promise<number> {
  return db.addTransaction({
    amount: input.amount,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: input.merchant,
    category: null,
    occurredAt: new Date().toISOString(),
    source: input.source,
    rawText: input.rawText,
    externalRef: null,
    dedupKey: `${input.merchant}-${input.amount}`,
    outingId: null,
  });
}

describe('revalidating imported history', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('finds rows an older, looser parser let in', async () => {
    await add({
      merchant: 'Zomato',
      amount: 250,
      source: 'SMS',
      rawText: 'Rs.250 debited from A/c XX1234 to VPA zomato@ybl. Ref 512345678901',
    });
    await add({
      merchant: 'Reward',
      amount: 500,
      source: 'SMS',
      rawText: 'Rs 500 credited as reward! Shop now and spend before 30 Sep',
    });
    await add({
      merchant: 'Rummy',
      amount: 1000,
      source: 'SMS',
      rawText: 'Play rummy now and win Rs 1000 daily! Download the app',
    });

    const result = await findStaleCaptures();

    expect(result.checked).toBe(3);
    expect(result.rejected.map((r) => r.merchant).sort()).toEqual(['Reward', 'Rummy']);
    expect(result.rejectedSpend).toBe(1500);
  });

  it('never touches what the user typed themselves', async () => {
    // A hand-entered row has no message behind it and no parser gets a vote.
    await add({ merchant: 'Cash lunch', amount: 120, source: 'MANUAL', rawText: null });

    const result = await findStaleCaptures();
    expect(result.checked).toBe(0);
    expect(result.rejected).toEqual([]);
  });

  it('skips rows imported before the original text was kept', async () => {
    await add({ merchant: 'Old import', amount: 300, source: 'SMS', rawText: null });

    const result = await findStaleCaptures();
    expect(result.checked).toBe(0);
    expect(result.rejected).toEqual([]);
  });

  it('holds notifications to the looser rule they were captured under', async () => {
    await add({
      merchant: 'Chai Point',
      amount: 95,
      source: 'NOTIFICATION',
      rawText: '₹95 paid to Chai Point using UPI. UPI transaction ID 712345678901',
    });

    const result = await findStaleCaptures();
    expect(result.rejected).toEqual([]);
  });

  it('takes the junk out of the spending total', async () => {
    await add({
      merchant: 'Zomato',
      amount: 250,
      source: 'SMS',
      rawText: 'Rs.250 debited from A/c XX1234 to VPA zomato@ybl. Ref 512345678901',
    });
    await add({
      merchant: 'Voucher',
      amount: 8419,
      source: 'SMS',
      rawText: 'Congrats! Rs 8419 has been credited as cashback. Claim now',
    });

    const before = await db.getGrossSpendBetween('2000-01-01', '2100-01-01');
    expect(before).toBe(8669);

    await revalidateHistory();

    const after = await db.getGrossSpendBetween('2000-01-01', '2100-01-01');
    expect(after).toBe(250);
  });

  it('is reversible, because rows are excluded rather than destroyed', async () => {
    const id = await add({
      merchant: 'Voucher',
      amount: 500,
      source: 'SMS',
      rawText: 'Rs 500 credited as reward! Shop now',
    });

    await revalidateHistory();
    expect((await db.getExcludedTransactions()).map((r) => r.id)).toEqual([id]);

    await db.setTransactionExcluded(id, false);
    expect(await db.getGrossSpendBetween('2000-01-01', '2100-01-01')).toBe(500);
  });
});
