import * as db from '../src/db/dbService';
import { postInvestment, postLoan, postTransaction, postTransfer } from '../src/services/captureService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

const WINDOW_START = new Date(2026, 8, 1).toISOString();
const WINDOW_END = new Date(2026, 8, 30).toISOString();

describe('manual transfer', () => {
  it('creates two linked legs, neither counted as spend or income', async () => {
    const { debitId, creditId } = await postTransfer({
      amount: 1000,
      fromLabel: 'HDFC Savings',
      toLabel: 'SBI FD',
      occurredAt: new Date(2026, 8, 10).toISOString(),
    });

    const debit = await db.getTransactionById(debitId);
    const credit = await db.getTransactionById(creditId);
    expect(debit?.transfer_pair_id).toBe(creditId);
    expect(credit?.transfer_pair_id).toBe(debitId);
    expect(debit?.merchant).toBe('SBI FD');
    expect(credit?.merchant).toBe('HDFC Savings');

    expect(await db.getGrossSpendBetween(WINDOW_START, WINDOW_END)).toBe(0);
    expect(await db.getIncomeBetween(WINDOW_START, WINDOW_END)).toBe(0);

    const categories = await db.getSpendByCategory(WINDOW_START, WINDOW_END);
    expect(categories).toEqual([]);
  });

  it('does not appear in monthly spend totals', async () => {
    await postTransfer({
      amount: 500,
      fromLabel: 'Checking',
      toLabel: 'Savings',
      occurredAt: new Date(2026, 8, 5).toISOString(),
    });

    const months = await db.getMonthlySpend(3, new Date(2026, 8, 15));
    const thisMonth = months.find((m) => m.month === '2026-09');
    expect(thisMonth?.total ?? 0).toBe(0);
  });
});

describe('manual loan', () => {
  it('creates exactly one transaction and one IOU for a loan given', async () => {
    const result = await postLoan({
      amount: 2000,
      direction: 'LENT',
      counterpartyName: 'Rahul',
      reason: 'Rent shortfall',
    });

    expect(result).not.toBeNull();
    const transaction = await db.getTransactionById(result!.transactionId);
    expect(transaction?.direction).toBe('DEBIT');
    expect(transaction?.kind).toBe('SPEND');
    expect(transaction?.amount).toBe(2000);

    const ious = await db.getOpenIOUs();
    expect(ious).toHaveLength(1);
    expect(ious[0].direction).toBe('THEY_OWE_ME');
    expect(ious[0].amount).toBe(2000);
    expect(ious[0].transactionId).toBe(result!.transactionId);

    const all = await db.getAllTransactions();
    expect(all).toHaveLength(1);
  });

  it('creates an I_OWE_THEM IOU for a loan received', async () => {
    const result = await postLoan({
      amount: 500,
      direction: 'BORROWED',
      counterpartyName: 'Ish',
    });

    const transaction = await db.getTransactionById(result!.transactionId);
    expect(transaction?.direction).toBe('CREDIT');
    expect(transaction?.kind).toBe('INCOME');

    const ious = await db.getOpenIOUs();
    expect(ious[0].direction).toBe('I_OWE_THEM');
  });
});

describe('adjustments', () => {
  it('a debit adjustment counts toward spend and category totals like any SPEND', async () => {
    const transactionId = await postTransaction({
      amount: 200,
      direction: 'DEBIT',
      merchant: 'Cash spending catch-up',
      category: 'Food',
      occurredAt: new Date(2026, 8, 12).toISOString(),
      isAdjustment: true,
    });

    const row = await db.getTransactionById(transactionId!);
    expect(row?.is_adjustment).toBe(1);
    expect(row?.kind).toBe('SPEND');

    expect(await db.getGrossSpendBetween(WINDOW_START, WINDOW_END)).toBe(200);
    const categories = await db.getSpendByCategory(WINDOW_START, WINDOW_END);
    expect(categories.find((c) => c.category === 'Food')?.total).toBe(200);
  });

  it('a credit adjustment counts toward income like any INCOME', async () => {
    const transactionId = await postTransaction({
      amount: 300,
      direction: 'CREDIT',
      merchant: 'Found cash',
      occurredAt: new Date(2026, 8, 12).toISOString(),
      isAdjustment: true,
    });

    const row = await db.getTransactionById(transactionId!);
    expect(row?.is_adjustment).toBe(1);
    expect(await db.getIncomeBetween(WINDOW_START, WINDOW_END)).toBe(300);
  });

  it('an ordinary transaction defaults to is_adjustment = 0', async () => {
    const transactionId = await postTransaction({
      amount: 100,
      direction: 'DEBIT',
      merchant: 'Swiggy',
    });
    const row = await db.getTransactionById(transactionId!);
    expect(row?.is_adjustment).toBe(0);
  });
});

describe('deleting a transfer leg does not orphan its pair', () => {
  it('clears transfer_pair_id on the surviving leg', async () => {
    const { debitId, creditId } = await postTransfer({
      amount: 750,
      fromLabel: 'HDFC',
      toLabel: 'SBI',
    });

    await db.deleteTransaction(debitId);

    const survivor = await db.getTransactionById(creditId);
    expect(survivor?.transfer_pair_id).toBeNull();
  });

  it('leaves the surviving leg out of the transfer list once unpaired', async () => {
    const { debitId, creditId } = await postTransfer({
      amount: 750,
      fromLabel: 'HDFC',
      toLabel: 'SBI',
    });

    await db.deleteTransaction(creditId);

    const transfers = await db.getTransfers();
    expect(transfers.find((t) => t.id === debitId)).toBeUndefined();
  });
});

describe('manual investment', () => {
  it('a contribution counts toward neither spend nor income', async () => {
    const id = await postInvestment({ amount: 5000, direction: 'CONTRIBUTION', label: 'Zerodha' });

    const row = await db.getTransactionById(id);
    expect(row?.direction).toBe('DEBIT');
    expect(row?.non_spend_reason).toBe('INVESTMENT');

    expect(await db.getGrossSpendBetween(WINDOW_START, WINDOW_END)).toBe(0);
    expect(await db.getSpendByCategory(WINDOW_START, WINDOW_END)).toEqual([]);
  });

  it('a withdrawal counts toward neither income nor spend', async () => {
    const id = await postInvestment({ amount: 2000, direction: 'WITHDRAWAL', label: 'Zerodha' });

    const row = await db.getTransactionById(id);
    expect(row?.direction).toBe('CREDIT');
    expect(row?.non_spend_reason).toBe('INVESTMENT');
    expect(await db.getIncomeBetween(WINDOW_START, WINDOW_END)).toBe(0);
  });

  it('getTotalInvested nets contributions against withdrawals', async () => {
    await postInvestment({ amount: 5000, direction: 'CONTRIBUTION', label: 'Zerodha' });
    await postInvestment({ amount: 3000, direction: 'CONTRIBUTION', label: 'Groww SIP' });
    await postInvestment({ amount: 1000, direction: 'WITHDRAWAL', label: 'Zerodha' });

    expect(await db.getTotalInvested()).toBe(7000);
  });

  it('an ordinary expense to the same platform name is unaffected', async () => {
    // getTotalInvested only sums rows actually tagged INVESTMENT — a
    // one-off DEBIT to "Zerodha" that was never marked as one (e.g. a
    // support fee paid normally) must not be swept in by name alone.
    await postTransaction({ amount: 99, direction: 'DEBIT', merchant: 'Zerodha' });
    expect(await db.getTotalInvested()).toBe(0);
  });
});
