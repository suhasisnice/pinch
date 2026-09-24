import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';

const WINDOW: [string, string] = ['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'];

async function spend(amount: number, merchant: string, category: string | null): Promise<number> {
  return db.addTransaction({
    amount,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant,
    category,
    occurredAt: '2026-09-09T12:00:00.000Z',
    source: 'MANUAL',
    rawText: null,
    externalRef: null,
    dedupKey: null,
    outingId: null,
  });
}

describe('category cost: paid vs yours', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('ranks by what was yours, not by what left the account', async () => {
    // Fronted a ₹2,400 dinner for four; ₹1,800 of it was never yours.
    const dinner = await spend(2400, 'Toit', 'Food');
    await spend(1000, 'Uber', 'Transport');
    const rahul = await db.addContact('Rahul');
    await db.createIOU({ contactId: rahul, amount: 1800, direction: 'THEY_OWE_ME', transactionId: dinner });

    const rows = await db.getCategoryCost(...WINDOW);

    expect(rows.map((r) => r.category)).toEqual(['Transport', 'Food']);
    const food = rows.find((r) => r.category === 'Food')!;
    expect(food.paid).toBe(2400);
    expect(food.splitAway).toBe(1800);
    expect(food.yours).toBe(600);
  });

  it('agrees with getBorneBetween in total', async () => {
    const a = await spend(900, 'Toit', 'Food');
    await spend(300, 'Chai', 'Food');
    await spend(500, 'Books', null);
    const priya = await db.addContact('Priya');
    await db.createIOU({ contactId: priya, amount: 300, direction: 'THEY_OWE_ME', transactionId: a });

    const rows = await db.getCategoryCost(...WINDOW);
    const borne = await db.getBorneBetween(...WINDOW);

    expect(rows.reduce((s, r) => s + r.paid, 0)).toBe(borne.paid);
    expect(rows.reduce((s, r) => s + r.yours, 0)).toBe(borne.borne);
    expect(rows.find((r) => r.category === 'Uncategorised')?.yours).toBe(500);
  });

  it('does not count what I owe someone else as money off my spending', async () => {
    const tx = await spend(600, 'Toit', 'Food');
    const rahul = await db.addContact('Rahul');
    await db.createIOU({ contactId: rahul, amount: 200, direction: 'I_OWE_THEM', transactionId: tx });

    const [food] = await db.getCategoryCost(...WINDOW);
    expect(food.yours).toBe(600);
  });

  it('leaves out junk and transfers', async () => {
    await spend(400, 'Chai', 'Food');
    const junk = await spend(5000, 'Voucher', 'Food');
    await db.setTransactionExcluded(junk, true);

    const [food] = await db.getCategoryCost(...WINDOW);
    expect(food.paid).toBe(400);
    expect(food.count).toBe(1);
  });

  it('never reports negative spending when an IOU exceeds its bill', async () => {
    const tx = await spend(300, 'Chai', 'Food');
    const rahul = await db.addContact('Rahul');
    await db.createIOU({ contactId: rahul, amount: 500, direction: 'THEY_OWE_ME', transactionId: tx });

    const [food] = await db.getCategoryCost(...WINDOW);
    expect(food.yours).toBe(0);
  });

  it("gives each spend with its own split share, agreeing with the category totals", async () => {
    const dinner = await spend(2400, "Toit", "Food");
    await spend(300, "Uber", "Transport");
    const rahul = await db.addContact("Rahul");
    await db.createIOU({ contactId: rahul, amount: 1800, direction: "THEY_OWE_ME", transactionId: dinner });

    const rows = await db.getSpendsWithShare(...WINDOW);
    expect(rows.map((r) => [r.merchant, r.splitAway])).toEqual(
      expect.arrayContaining([["Toit", 1800], ["Uber", 0]])
    );
    const cost = await db.getCategoryCost(...WINDOW);
    expect(rows.reduce((s, r) => s + r.amount - r.splitAway, 0)).toBe(cost.reduce((s, c) => s + c.yours, 0));
  });
});
