import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';

async function seed(): Promise<void> {
  const contactId = await db.addContact('Rahul', false, '9876543210');
  const txId = await db.addTransaction({
    amount: 900,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: 'Toit',
    category: 'Outing',
    occurredAt: new Date().toISOString(),
    source: 'MANUAL',
    rawText: null,
    externalRef: null,
    dedupKey: null,
    outingId: null,
  });
  await db.createIOU({
    contactId,
    amount: 300,
    direction: 'THEY_OWE_ME',
    transactionId: txId,
    reason: 'Toit',
  });
  await db.createGoal({ name: 'Laptop', targetAmount: 45000 });
  await db.createOuting({ name: 'Movie night' });
  await db.addToBlocklist('ad-promo', 'spam');
  await db.recordCapture({
    rawText: 'Rs 100 debited from A/c XX1234',
    source: 'SMS',
    sender: 'VM-HDFCBK',
    receivedAt: new Date().toISOString(),
    parsedAmount: 100,
    parsedMerchant: 'Unknown',
    parsedDirection: 'DEBIT',
    confidence: 0.5,
    dedupKey: 'test-key',
  });
}

describe('resetData', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
    await seed();
  });

  it('counts what is there before anything is destroyed', async () => {
    const counts = await db.countData();
    expect(counts.transactions).toBe(1);
    expect(counts.ious).toBe(1);
    expect(counts.contacts).toBe(1);
    expect(counts.goals).toBe(1);
    expect(counts.outings).toBe(1);
    expect(counts.blocked).toBe(1);
    expect(counts.captures).toBe(1);
  });

  it('clears the ledger while keeping goals, friends and blocked senders', async () => {
    // The common case: a bad import poisoned the numbers. Wiping the goals
    // and the blocklist too would punish the user for the parser's mistake.
    await db.resetData({ ledger: true });

    const counts = await db.countData();
    expect(counts.transactions).toBe(0);
    expect(counts.ious).toBe(0);
    expect(counts.captures).toBe(0);

    expect(counts.goals).toBe(1);
    expect(counts.contacts).toBe(1);
    expect(counts.blocked).toBe(1);
  });

  it('leaves no spending behind for the budget to find', async () => {
    await db.resetData({ ledger: true });
    const spend = await db.getGrossSpendBetween('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');
    expect(spend).toBe(0);
  });

  it('can erase everything when asked', async () => {
    await db.resetData({
      ledger: true,
      contacts: true,
      goals: true,
      outings: true,
      blocklist: true,
      periods: true,
    });

    const counts = await db.countData();
    expect(counts).toEqual({
      transactions: 0,
      captures: 0,
      ious: 0,
      contacts: 0,
      goals: 0,
      outings: 0,
      blocked: 0,
    });
  });

  it('does nothing when asked for nothing', async () => {
    await db.resetData({});
    expect((await db.countData()).transactions).toBe(1);
  });
});
