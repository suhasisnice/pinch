import * as db from '../src/db/dbService';
import { backfillSettlements, checkForSettlement } from '../src/services/settlementService';
import { ingestMessage } from '../src/services/captureService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { CapturedMessage } from '../modules/pinch-capture';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

describe('checkForSettlement', () => {
  it('closes an open debt instead of leaving the credit as income', async () => {
    const contactId = await db.addContact('Dad');
    await db.createIOU({ contactId, amount: 229, direction: 'THEY_OWE_ME', reason: 'Lunch' });

    const txId = await db.addTransaction({
      amount: 229,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Dad',
    });

    const result = await checkForSettlement(txId);
    expect(result?.applied).toBe(229);
    expect((await db.getTransactionById(txId))?.kind).toBe('SETTLE_IN');

    const balance = (await db.getContactBalances()).find((b) => b.contactId === contactId);
    expect(balance?.netAmount).toBe(0);
  });

  it('closes more than one open debt from a single payment, oldest first', async () => {
    // The exact shape from real use: an older debt Dad already owed, plus
    // today's lunch he reimbursed, arriving together in one transfer.
    const contactId = await db.addContact('Dad');
    const older = await db.createIOU({
      contactId,
      amount: 100,
      direction: 'THEY_OWE_ME',
      reason: 'Cab fare',
    });
    const today = await db.createIOU({ contactId, amount: 229, direction: 'THEY_OWE_ME', reason: 'Lunch' });

    const txId = await db.addTransaction({
      amount: 329,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Dad',
    });

    const result = await checkForSettlement(txId);
    expect(result?.applied).toBe(329);
    expect(result?.iouIds.sort()).toEqual([older, today].sort());
    expect((await db.getTransactionById(txId))?.kind).toBe('SETTLE_IN');
    expect((await db.getIOUById(older))?.openAmount).toBe(0);
    expect((await db.getIOUById(today))?.openAmount).toBe(0);
  });

  it('leaves a credit from someone with no open debt as plain income', async () => {
    await db.addContact('Dad');
    const txId = await db.addTransaction({
      amount: 500,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Dad',
    });

    expect(await checkForSettlement(txId)).toBeNull();
    expect((await db.getTransactionById(txId))?.kind).toBe('INCOME');
  });

  it('never creates a contact for a stranger, and settles nothing', async () => {
    const txId = await db.addTransaction({
      amount: 500,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Some Rummy App',
    });

    expect(await checkForSettlement(txId)).toBeNull();
    expect(await db.getContacts()).toHaveLength(0);
  });

  it('leaves a debit alone', async () => {
    const contactId = await db.addContact('Dad');
    await db.createIOU({ contactId, amount: 229, direction: 'THEY_OWE_ME' });
    const txId = await db.addTransaction({ amount: 229, direction: 'DEBIT', kind: 'SPEND', merchant: 'Dad' });

    expect(await checkForSettlement(txId)).toBeNull();
  });
});

describe('settlement wired into live capture', () => {
  it('settles Dad paying back an old debt plus reimbursing lunch, in one real payment', async () => {
    const contactId = await db.addContact('Dad');
    const oldDebt = await db.createIOU({
      contactId,
      amount: 100,
      direction: 'THEY_OWE_ME',
      reason: 'Borrowed the other day',
    });

    const lunch = await db.addTransaction({
      amount: 229,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Dad',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await db.createIOU({ contactId, amount: 229, direction: 'THEY_OWE_ME', transactionId: lunch, reason: 'Lunch' });

    const paidBack: CapturedMessage = {
      source: 'NOTIFICATION',
      sender: 'com.phonepe.app',
      body: 'Dad sent ₹329 to you. UPI Ref 112233445599',
      receivedAt: Date.now(),
    };
    expect(await ingestMessage(paidBack)).toBe('POSTED');

    const balance = (await db.getContactBalances()).find((b) => b.contactId === contactId);
    expect(balance?.netAmount).toBe(0);
    expect((await db.getIOUById(oldDebt))?.openAmount).toBe(0);

    const all = await db.getAllTransactions();
    const credit = all.find((row) => row.direction === 'CREDIT')!;
    expect(credit.kind).toBe('SETTLE_IN');
  });
});

describe('backfillSettlements', () => {
  it('re-checks income already on the books once the feature exists', async () => {
    const contactId = await db.addContact('Dad');
    await db.createIOU({ contactId, amount: 229, direction: 'THEY_OWE_ME' });
    await db.addTransaction({ amount: 229, direction: 'CREDIT', kind: 'INCOME', merchant: 'Dad' });

    const result = await backfillSettlements();
    expect(result.settled).toBe(1);
    expect(result.amount).toBe(229);
  });

  it('does nothing when there is nothing to settle', async () => {
    await db.addTransaction({ amount: 500, direction: 'CREDIT', kind: 'INCOME', merchant: 'Employer' });
    const result = await backfillSettlements();
    expect(result.settled).toBe(0);
  });
});
