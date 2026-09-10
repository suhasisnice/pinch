import * as db from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

const spend = (amount: number, merchant = 'Olive Cafe', extra: Record<string, unknown> = {}) =>
  db.addTransaction({ amount, direction: 'DEBIT', kind: 'SPEND', merchant, ...extra });

describe('transactions', () => {
  it('stores a spend and reads it back', async () => {
    const id = await spend(700);
    const row = await db.getTransactionById(id);

    expect(row).toMatchObject({ amount: 700, direction: 'DEBIT', kind: 'SPEND' });
  });

  it('stores amounts as positive regardless of sign passed in', async () => {
    const id = await db.addTransaction({
      amount: -250,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Zepto',
    });
    expect((await db.getTransactionById(id))?.amount).toBe(250);
  });

  it('returns the existing row instead of duplicating a known dedup key', async () => {
    const first = await spend(340, 'Swiggy', { dedupKey: 'upi-ref-99' });
    const second = await spend(340, 'Swiggy', { dedupKey: 'upi-ref-99' });

    expect(second).toBe(first);
    expect(await db.getAllTransactions()).toHaveLength(1);
  });

  it('finds a probable duplicate arriving from a second source', async () => {
    const at = new Date().toISOString();
    await spend(340, 'SWIGGY', { occurredAt: at });

    const match = await db.findProbableDuplicate(340, 'DEBIT', at);
    expect(match?.merchant).toBe('SWIGGY');
  });

  it('does not treat an unrelated later payment as a duplicate', async () => {
    const at = new Date().toISOString();
    await spend(340, 'Swiggy', { occurredAt: at });

    const hoursLater = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    expect(await db.findProbableDuplicate(340, 'DEBIT', hoursLater)).toBeNull();
  });

  it('does not treat a same-amount payment the other way as a duplicate', async () => {
    // Send someone 200, they send 200 straight back: two real, opposite
    // payments, not one message reported twice. Matching on amount alone
    // used to read the reply as a duplicate of the original and drop it.
    const at = new Date().toISOString();
    await spend(200, 'Shreyas', { occurredAt: at });

    const secondsLater = new Date(Date.parse(at) + 30 * 1000).toISOString();
    expect(await db.findProbableDuplicate(200, 'CREDIT', secondsLater)).toBeNull();
  });

  it('catches a same-direction duplicate several minutes apart', async () => {
    // A bank's own SMS for a UPI payment routinely lags the paying app's
    // push notification by minutes, not seconds.
    const at = new Date().toISOString();
    await spend(150, 'Zomato', { occurredAt: at });

    const fourMinutesLater = new Date(Date.parse(at) + 4 * 60 * 1000).toISOString();
    const match = await db.findProbableDuplicate(150, 'DEBIT', fourMinutesLater);
    expect(match?.merchant).toBe('Zomato');
  });
});

describe('money queries respect kind, not direction', () => {
  const period = ['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'] as const;
  const at = '2026-09-10T12:00:00.000Z';

  it('counts spending but not repayments', async () => {
    await spend(1000, 'Toit', { occurredAt: at });
    // You pay a friend back. A DEBIT, but the expense was already booked.
    await db.addTransaction({
      amount: 400,
      direction: 'DEBIT',
      kind: 'SETTLE_OUT',
      merchant: 'Ish',
      occurredAt: at,
    });

    expect(await db.getGrossSpendBetween(...period)).toBe(1000);
  });

  it('subtracts refunds from gross spend', async () => {
    await spend(1000, 'Myntra', { occurredAt: at });
    await db.addTransaction({
      amount: 300,
      direction: 'CREDIT',
      kind: 'REFUND',
      merchant: 'Myntra',
      occurredAt: at,
    });

    expect(await db.getGrossSpendBetween(...period)).toBe(700);
  });

  it('counts allowance as income but not a friend repaying you', async () => {
    await db.addTransaction({
      amount: 9000,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Dad',
      occurredAt: at,
    });
    await db.addTransaction({
      amount: 450,
      direction: 'CREDIT',
      kind: 'SETTLE_IN',
      merchant: 'Rahul',
      occurredAt: at,
    });

    expect(await db.getIncomeBetween(...period)).toBe(9000);
  });

  it('excludes spending outside the window', async () => {
    await spend(500, 'Old', { occurredAt: '2026-08-15T12:00:00.000Z' });
    await spend(200, 'New', { occurredAt: at });

    expect(await db.getGrossSpendBetween(...period)).toBe(200);
  });

  it('groups spending by category', async () => {
    await spend(300, 'Swiggy', { occurredAt: at, category: 'Food' });
    await spend(200, 'Zomato', { occurredAt: at, category: 'Food' });
    await spend(150, 'Uber', { occurredAt: at, category: 'Transport' });

    const breakdown = await db.getSpendByCategory(...period);
    expect(breakdown[0]).toMatchObject({ category: 'Food', total: 500, count: 2 });
    expect(breakdown[1]).toMatchObject({ category: 'Transport', total: 150 });
  });
});

describe('IOUs', () => {
  let contactId: number;

  beforeEach(async () => {
    contactId = await db.addContact('Rahul', false, '+919000000000');
  });

  it('derives the open amount from the settlements ledger', async () => {
    const txId = await spend(700);
    const iouId = await db.createIOU({ contactId, amount: 175, direction: 'THEY_OWE_ME', transactionId: txId });

    expect((await db.getIOUById(iouId))?.openAmount).toBe(175);

    await db.settleIOU(iouId, 75);
    const partly = await db.getIOUById(iouId);
    expect(partly?.settledAmount).toBe(75);
    expect(partly?.openAmount).toBe(100);

    await db.settleIOU(iouId);
    expect((await db.getIOUById(iouId))?.openAmount).toBe(0);
  });

  it('never records more repaid than was owed', async () => {
    const iouId = await db.createIOU({ contactId, amount: 100, direction: 'THEY_OWE_ME' });
    const paid = await db.settleIOU(iouId, 500);

    expect(paid).toBe(100);
    expect((await db.getIOUById(iouId))?.openAmount).toBe(0);
  });

  // The bug in the old resolveIOUByAmount: with two identical debts it closed
  // whichever row it happened to see first.
  it('settles the IOU you named, not merely one of the same size', async () => {
    const other = await db.addContact('Arjun');
    const rahulIOU = await db.createIOU({ contactId, amount: 175, direction: 'THEY_OWE_ME' });
    const arjunIOU = await db.createIOU({ contactId: other, amount: 175, direction: 'THEY_OWE_ME' });

    await db.settleIOU(arjunIOU);

    expect((await db.getIOUById(rahulIOU))?.openAmount).toBe(175);
    expect((await db.getIOUById(arjunIOU))?.openAmount).toBe(0);
  });

  it('applies one payment across several debts, oldest first', async () => {
    const a = await db.createIOU({ contactId, amount: 100, direction: 'THEY_OWE_ME' });
    const b = await db.createIOU({ contactId, amount: 200, direction: 'THEY_OWE_ME' });

    const result = await db.settleContactBalance(contactId, 250);

    expect(result.applied).toBe(250);
    expect((await db.getIOUById(a))?.openAmount).toBe(0);
    expect((await db.getIOUById(b))?.openAmount).toBe(50);
  });

  it('lists only debts with money still outstanding', async () => {
    const a = await db.createIOU({ contactId, amount: 100, direction: 'THEY_OWE_ME' });
    await db.createIOU({ contactId, amount: 200, direction: 'THEY_OWE_ME' });
    await db.settleIOU(a);

    expect(await db.getOpenIOUs()).toHaveLength(1);
  });

  it('nets debts in both directions into one balance', async () => {
    await db.createIOU({ contactId, amount: 450, direction: 'THEY_OWE_ME' });
    await db.createIOU({ contactId, amount: 200, direction: 'I_OWE_THEM' });

    const balance = (await db.getContactBalances()).find((b) => b.contactId === contactId);
    expect(balance?.netAmount).toBe(250);
    expect(balance?.openCount).toBe(2);
  });

  it('reports a negative balance when you owe more than you are owed', async () => {
    await db.createIOU({ contactId, amount: 100, direction: 'THEY_OWE_ME' });
    await db.createIOU({ contactId, amount: 400, direction: 'I_OWE_THEM' });

    const balance = (await db.getContactBalances()).find((b) => b.contactId === contactId);
    expect(balance?.netAmount).toBe(-300);
  });

  it('totals receivables and payables separately', async () => {
    await db.createIOU({ contactId, amount: 450, direction: 'THEY_OWE_ME' });
    await db.createIOU({ contactId, amount: 200, direction: 'I_OWE_THEM' });

    expect(await db.getTotalReceivable()).toBe(450);
    expect(await db.getTotalPayable()).toBe(200);
  });

  it('tracks how quickly someone settles', async () => {
    const iouId = await db.createIOU({ contactId, amount: 100, direction: 'THEY_OWE_ME' });
    await db.settleIOU(iouId);

    const balance = (await db.getContactBalances()).find((b) => b.contactId === contactId);
    expect(balance?.settledCount).toBe(1);
    expect(balance?.avgDaysToSettle).not.toBeNull();
  });

  it('reuses a contact rather than duplicating them by name', async () => {
    const again = await db.findOrCreateContactByName('rahul');
    expect(again).toBe(contactId);
    expect(await db.getContacts()).toHaveLength(1);
  });

  it('matches an existing contact by phone even when the name is worded differently', async () => {
    // "Rahul" from beforeEach was saved with +919000000000. A different
    // capture path naming him "Rahul Kumar" but carrying the same number
    // (in a different format) should resolve to the same contact, not fork
    // his balance across two rows that never settle each other.
    const again = await db.findOrCreateContact({ name: 'Rahul Kumar', phone: '090000 00000' });
    expect(again).toBe(contactId);
    expect(await db.getContacts()).toHaveLength(1);
  });

  it('still matches by name when no phone is known', async () => {
    const again = await db.findOrCreateContact({ name: 'rahul' });
    expect(again).toBe(contactId);
    expect(await db.getContacts()).toHaveLength(1);
  });
});

describe('merging contacts', () => {
  it('moves every IOU onto the kept contact and removes the other one', async () => {
    const keepId = await db.addContact('Dad');
    const mergeId = await db.addContact('D Kumar');

    const openIou = await db.createIOU({ contactId: keepId, amount: 100, direction: 'THEY_OWE_ME' });
    const forkedIou = await db.createIOU({ contactId: mergeId, amount: 229, direction: 'THEY_OWE_ME' });

    await db.mergeContacts(keepId, mergeId);

    expect((await db.getIOUById(openIou))?.contactId).toBe(keepId);
    expect((await db.getIOUById(forkedIou))?.contactId).toBe(keepId);

    const contacts = await db.getContacts();
    expect(contacts.map((c) => c.id)).not.toContain(mergeId);

    const balance = (await db.getContactBalances()).find((b) => b.contactId === keepId);
    expect(balance?.netAmount).toBe(329);
  });

  it('carries the phone number over when the kept contact has none', async () => {
    const keepId = await db.addContact('Dad');
    const mergeId = await db.addContact('D Kumar', false, '9876543210');

    await db.mergeContacts(keepId, mergeId);

    expect((await db.getContactById(keepId))?.phone).toBe('9876543210');
  });
});

describe('goals', () => {
  it('sums contributions into progress', async () => {
    const goalId = await db.createGoal({ name: 'Laptop', targetAmount: 45000 });
    await db.contributeToGoal(goalId, 5000);
    await db.contributeToGoal(goalId, 2500, 'ROUNDUP');

    const goal = await db.getGoalById(goalId);
    expect(goal?.savedAmount).toBe(7500);
    expect(goal?.remainingAmount).toBe(37500);
    expect(goal?.fraction).toBeCloseTo(7500 / 45000, 5);
  });

  it('allows a withdrawal for a broke week', async () => {
    const goalId = await db.createGoal({ name: 'Goa', targetAmount: 5000 });
    await db.contributeToGoal(goalId, 2000);
    await db.contributeToGoal(goalId, -500);

    expect((await db.getGoalById(goalId))?.savedAmount).toBe(1500);
  });

  it('marks a fully funded goal complete', async () => {
    const goalId = await db.createGoal({ name: 'Headphones', targetAmount: 2000 });
    await db.contributeToGoal(goalId, 2000);

    expect((await db.getGoalById(goalId))?.isComplete).toBe(true);
  });

  it('hides archived goals', async () => {
    const goalId = await db.createGoal({ name: 'Old', targetAmount: 1000 });
    await db.archiveGoal(goalId);

    expect(await db.getActiveGoals()).toHaveLength(0);
  });

  // Contributions are virtual: no Transaction row, so the budget is not
  // charged twice for the same rupee.
  it('does not write a transaction when contributing', async () => {
    const goalId = await db.createGoal({ name: 'Laptop', targetAmount: 45000 });
    await db.contributeToGoal(goalId, 5000);

    expect(await db.getAllTransactions()).toHaveLength(0);
  });
});

describe('outings', () => {
  it('rolls up spend and backs out what others still owe', async () => {
    const outingId = await db.createOuting({ name: 'Goa', startsAt: '2026-09-01T00:00:00.000Z' });
    const contactId = await db.addContact('Ish');

    const txId = await spend(1200, 'Beach Shack', {
      occurredAt: '2026-09-02T12:00:00.000Z',
      outingId,
    });
    await db.createIOU({ contactId, amount: 400, direction: 'THEY_OWE_ME', transactionId: txId, outingId });

    const outing = await db.getOutingById(outingId);
    expect(outing?.totalSpent).toBe(1200);
    expect(outing?.yourShare).toBe(800);
    expect(outing?.headcount).toBe(2);
  });

  it('flags going over the outing budget', async () => {
    const outingId = await db.createOuting({ name: 'Movie', budgetAmount: 500 });
    await spend(700, 'PVR', { outingId });

    expect((await db.getOutingById(outingId))?.isOverBudget).toBe(true);
  });

  it('suggests untagged spending inside the window', async () => {
    const outingId = await db.createOuting({
      name: 'Trip',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-05T00:00:00.000Z',
    });
    await spend(300, 'Inside', { occurredAt: '2026-09-02T10:00:00.000Z' });
    await spend(300, 'Outside', { occurredAt: '2026-09-20T10:00:00.000Z' });

    const candidates = await db.getCandidateTransactions(outingId);
    expect(candidates.map((c) => c.merchant)).toEqual(['Inside']);
  });
});

describe('capture inbox', () => {
  it('holds a parse without touching the budget', async () => {
    await db.recordCapture({
      rawText: 'Rs. 700 spent at Olive Cafe',
      source: 'SMS',
      parsedAmount: 700,
      parsedMerchant: 'Olive Cafe',
      parsedDirection: 'DEBIT',
      confidence: 0.9,
    });

    expect(await db.getPendingCaptureCount()).toBe(1);
    expect(await db.getAllTransactions()).toHaveLength(0);
  });

  it('refuses a message it has already filed', async () => {
    const first = await db.recordCapture({ rawText: 'x', source: 'SMS', dedupKey: 'ref-1' });
    const second = await db.recordCapture({ rawText: 'x', source: 'NOTIFICATION', dedupKey: 'ref-1' });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await db.getPendingCaptureCount()).toBe(1);
  });

  it('categorises a known merchant', async () => {
    expect(await db.categoriseMerchant('SWIGGY BANGALORE')).toBe('Food');
    expect(await db.categoriseMerchant('Uber India')).toBe('Transport');
  });

  it('learns a correction and prefers it afterwards', async () => {
    await db.learnMerchantRule('Cafe Coffee Day', 'Outing');
    expect(await db.categoriseMerchant('Cafe Coffee Day')).toBe('Outing');
  });

  it('returns null for a merchant it has never seen', async () => {
    expect(await db.categoriseMerchant('Xyzzy Traders')).toBeNull();
  });
});

describe('budget periods', () => {
  it('creates a default period on first run', async () => {
    const period = await db.ensureBudgetPeriod(9000, new Date('2026-09-09T10:00:00.000Z'));

    expect(period.allowance).toBe(9000);
    expect(period.daysTotal).toBe(30);
    expect(period.daysRemaining).toBe(30);
  });

  it('counts down as the period elapses', async () => {
    await db.ensureBudgetPeriod(9000, new Date('2026-09-01T10:00:00.000Z'));
    const later = await db.getCurrentBudgetPeriod(new Date('2026-09-11T10:00:00.000Z'));

    expect(later?.daysElapsed).toBe(10);
    expect(later?.daysRemaining).toBe(20);
  });

  it('never reports zero days remaining', async () => {
    await db.ensureBudgetPeriod(9000, new Date('2026-09-01T00:00:00.000Z'));
    const past = await db.getCurrentBudgetPeriod(new Date('2026-11-01T00:00:00.000Z'));

    expect(past?.daysRemaining).toBe(1);
  });
});

describe('notification log', () => {
  it('counts sends for rate limiting', async () => {
    await db.logNotification({ type: 'TXN_PULSE', tier: 'FRESH', title: 'Pinch', body: 'a' });
    await db.logNotification({ type: 'TXN_PULSE', tier: 'STEADY', title: 'Pinch', body: 'b' });

    const since = new Date(Date.now() - 60000).toISOString();
    expect(await db.countSince('TXN_PULSE', since)).toBe(2);
    expect(await db.countSince('OVERSPEND', since)).toBe(0);
  });

  it('remembers recent bodies so copy is not repeated', async () => {
    await db.logNotification({ type: 'TXN_PULSE', tier: 'FRESH', title: 'Pinch', body: 'first' });
    await db.logNotification({ type: 'TXN_PULSE', tier: 'FRESH', title: 'Pinch', body: 'second' });

    expect(await db.getRecentBodies('TXN_PULSE', 5)).toEqual(['second', 'first']);
  });
});
