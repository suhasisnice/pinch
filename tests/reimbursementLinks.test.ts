import * as db from '../src/db/dbService';
import { groupLinkedTransactions, planReimbursement } from '../src/math/reimbursement';
import { TransactionRow } from '../src/db/types';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { disableConfirmGate } from './utils/settings';

const day = (d: number, h = 12) => new Date(2026, 8, d, h, 0).toISOString();
const WINDOW: [string, string] = [new Date(2026, 8, 1).toISOString(), new Date(2026, 9, 1).toISOString()];

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

describe('planReimbursement', () => {
  const spend = (id: number, amount: number, d: number, extra: Partial<{ splitAway: number; openFromPayer: number }> = {}) => ({
    id,
    amount,
    occurredAt: day(d),
    splitAway: 0,
    openFromPayer: 0,
    ...extra,
  });

  it('nets a full repayment to nothing', () => {
    const plan = planReimbursement(500, [spend(1, 500, 3)]);
    expect(plan).toMatchObject({ applied: 500, excess: 0, spent: 500, net: 0 });
    expect(plan.allocations).toEqual([{ spendId: 1, fromExisting: 0, fromNew: 500 }]);
  });

  it('leaves your share when the payment covers only part of a bill', () => {
    // Fronted 2,400 for dinner, a friend sends back 1,800.
    const plan = planReimbursement(1800, [spend(1, 2400, 3)]);
    expect(plan).toMatchObject({ applied: 1800, excess: 0, net: 600 });
  });

  it('spreads one payment across several bills, oldest first', () => {
    const plan = planReimbursement(300, [spend(2, 250, 5), spend(1, 120, 2)]);
    expect(plan.allocations).toEqual([
      { spendId: 1, fromExisting: 0, fromNew: 120 },
      { spendId: 2, fromExisting: 0, fromNew: 180 },
    ]);
    expect(plan.net).toBe(70);
  });

  it('uses what the payer already owed before inventing anything', () => {
    const plan = planReimbursement(600, [spend(1, 2400, 3, { splitAway: 600, openFromPayer: 600 })]);
    expect(plan.allocations).toEqual([{ spendId: 1, fromExisting: 600, fromNew: 0 }]);
  });

  it("never charges the payer for a share already on someone else", () => {
    // 1,200 bill: 400 already charged to a third friend. Only 800 is left to attribute.
    const plan = planReimbursement(1000, [spend(1, 1200, 3, { splitAway: 400 })]);
    expect(plan.applied).toBe(800);
    expect(plan.excess).toBe(200);
  });

  it('reports a payment bigger than what was ticked, rather than absorbing it', () => {
    const plan = planReimbursement(520, [spend(1, 500, 3)]);
    expect(plan.excess).toBe(20);
    expect(plan.net).toBe(-20);
  });
});

// ---------------------------------------------------------------------------
// Grouping for the ledger
// ---------------------------------------------------------------------------

describe('groupLinkedTransactions', () => {
  const row = (id: number, amount: number, direction: 'DEBIT' | 'CREDIT', d: number): TransactionRow =>
    ({
      id,
      amount,
      direction,
      kind: direction === 'DEBIT' ? 'SPEND' : 'SETTLE_IN',
      merchant: `m${id}`,
      category: null,
      occurred_at: day(d),
      source: 'SMS',
      excluded_at: null,
      transfer_pair_id: null,
    }) as TransactionRow;

  it('folds a spend and its repayment into one net line at the repayment', () => {
    const rows = [row(3, 50, 'DEBIT', 6), row(2, 1800, 'CREDIT', 5), row(1, 2400, 'DEBIT', 3)];
    const items = groupLinkedTransactions(rows, [{ creditId: 2, spendId: 1, amount: 1800 }]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'single' });
    expect(items[1]).toMatchObject({ type: 'group', net: 600, moneyOut: 2400, moneyIn: 1800, occurredAt: day(5) });
  });

  it('joins chains: one bill repaid by several friends', () => {
    const rows = [row(4, 600, 'CREDIT', 6), row(3, 600, 'CREDIT', 5), row(1, 1800, 'DEBIT', 3)];
    const items = groupLinkedTransactions(rows, [
      { creditId: 3, spendId: 1, amount: 600 },
      { creditId: 4, spendId: 1, amount: 600 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'group', net: 600 });
    if (items[0].type === 'group') expect(items[0].members.map((m) => m.id)).toEqual([4, 3, 1]);
  });

  it('does not invent a net for a member the filter hid', () => {
    const rows = [row(2, 1800, 'CREDIT', 5)];
    const items = groupLinkedTransactions(rows, [{ creditId: 2, spendId: 1, amount: 1800 }]);
    expect(items).toEqual([{ type: 'single', transaction: rows[0] }]);
  });
});

// ---------------------------------------------------------------------------
// Linking against real SQL
// ---------------------------------------------------------------------------

describe('linking a reimbursement', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
    await disableConfirmGate();
  });

  async function dinnerAndRepayment() {
    const dinner = await db.addTransaction({
      amount: 2400, direction: 'DEBIT', kind: 'SPEND', merchant: 'Toit', category: 'Food', occurredAt: day(3, 21),
    });
    const repaid = await db.addTransaction({
      amount: 1800, direction: 'CREDIT', kind: 'INCOME', merchant: 'Rahul', occurredAt: day(4, 10),
    });
    return { dinner, repaid };
  }

  it('keeps both rows, stops the repayment counting as income, and nets the spend', async () => {
    const { dinner, repaid } = await dinnerAndRepayment();
    expect(await db.getIncomeBetween(...WINDOW)).toBe(1800);

    await db.linkReimbursement(repaid, [dinner]);

    // Nothing erased.
    expect(await db.getTransactionById(dinner)).not.toBeNull();
    expect(await db.getTransactionById(repaid)).not.toBeNull();

    expect((await db.getTransactionById(repaid))?.kind).toBe('SETTLE_IN');
    expect(await db.getIncomeBetween(...WINDOW)).toBe(0);

    const borne = await db.getBorneBetween(...WINDOW);
    expect(borne).toMatchObject({ paid: 2400, borne: 600, recovered: 1800, stillOwed: 0 });

    expect(await db.getReimbursementLinks()).toEqual([{ creditId: repaid, spendId: dinner, amount: 1800 }]);
  });

  it('leaves the bank balance exactly where it was', async () => {
    await db.recordBalance(10_000, new Date(2026, 8, 1));
    const { dinner, repaid } = await dinnerAndRepayment();
    const before = (await db.getBalanceState()).projected;

    await db.linkReimbursement(repaid, [dinner]);

    expect((await db.getBalanceState()).projected).toBe(before);
    expect(before).toBe(10_000 - 2400 + 1800);
  });

  it('settles a split the user already made instead of charging twice', async () => {
    const { dinner, repaid } = await dinnerAndRepayment();
    const rahul = await db.addContact('Rahul');
    const iou = await db.createIOU({ contactId: rahul, amount: 1800, direction: 'THEY_OWE_ME', transactionId: dinner });

    await db.linkReimbursement(repaid, [dinner]);

    expect((await db.getIOUById(iou))?.openAmount).toBe(0);
    const borne = await db.getBorneBetween(...WINDOW);
    expect(borne.splitAway).toBe(1800);
  });

  it('refuses more money than the ticked spends explain, and writes nothing', async () => {
    const small = await db.addTransaction({
      amount: 300, direction: 'DEBIT', kind: 'SPEND', merchant: 'Chai', occurredAt: day(3),
    });
    const repaid = await db.addTransaction({
      amount: 1800, direction: 'CREDIT', kind: 'INCOME', merchant: 'Rahul', occurredAt: day(4),
    });

    await expect(db.linkReimbursement(repaid, [small])).rejects.toThrow();
    expect((await db.getTransactionById(repaid))?.kind).toBe('INCOME');
    expect(await db.getReimbursementLinks()).toEqual([]);
    // A refused save should not have created anyone.
    expect(await db.findContactIdByNameOrAlias('Rahul')).toBeNull();
  });

  it('unlinks cleanly, removing only what the link made', async () => {
    const { dinner, repaid } = await dinnerAndRepayment();
    const priya = await db.addContact('Priya');
    const split = await db.createIOU({ contactId: priya, amount: 300, direction: 'THEY_OWE_ME', transactionId: dinner });

    await db.linkReimbursement(repaid, [dinner]);
    await db.unlinkReimbursement(repaid);

    expect((await db.getTransactionById(repaid))?.kind).toBe('INCOME');
    expect(await db.getReimbursementLinks()).toEqual([]);
    // The user's own split survives.
    expect((await db.getIOUById(split))?.openAmount).toBe(300);
    const borne = await db.getBorneBetween(...WINDOW);
    expect(borne.splitAway).toBe(300);
  });

  it('can be edited: relinking replaces rather than stacks', async () => {
    // The cab is *earlier* than dinner, so it is allocated first and both
    // spends get a share of the 1,800.
    const { dinner, repaid } = await dinnerAndRepayment();
    const cab = await db.addTransaction({
      amount: 400, direction: 'DEBIT', kind: 'SPEND', merchant: 'Uber', occurredAt: day(3, 19),
    });

    await db.linkReimbursement(repaid, [dinner]);
    await db.linkReimbursement(repaid, [dinner, cab]);

    const links = await db.getReimbursementLinks();
    expect(links.reduce((sum, l) => sum + l.amount, 0)).toBe(1800);
    expect(links.map((l) => l.spendId).sort()).toEqual([dinner, cab].sort());
    expect(links.find((l) => l.spendId === cab)?.amount).toBe(400);
  });

  describe('net out, from the spend', () => {
    // Paid 70 for the auto, the friend sent their half straight after.
    async function autoAndHalf() {
      const auto = await db.addTransaction({
        amount: 70, direction: 'DEBIT', kind: 'SPEND', merchant: 'Auto', occurredAt: day(3, 18),
      });
      const half = await db.addTransaction({
        amount: 35, direction: 'CREDIT', kind: 'INCOME', merchant: 'Rahul', occurredAt: day(3, 19),
      });
      return { auto, half };
    }

    it('offers money from before or after, nearest first, and nets the spend to your share', async () => {
      const { auto, half } = await autoAndHalf();
      const earlier = await db.addTransaction({
        amount: 35, direction: 'CREDIT', kind: 'INCOME', merchant: 'Mum', occurredAt: day(2),
      });

      const ids = (await db.getNetOutCandidates(auto)).map((c) => c.id);
      expect(ids).toEqual([half, earlier]);

      await db.netOut(auto, [half]);

      expect((await db.getTransactionById(half))?.kind).toBe('SETTLE_IN');
      expect(await db.getIncomeBetween(...WINDOW)).toBe(35); // Mum's, untouched
      expect(await db.getBorneBetween(...WINDOW)).toMatchObject({ paid: 70, borne: 35, recovered: 35 });
      expect(await db.getReimbursementLinks()).toEqual([{ creditId: half, spendId: auto, amount: 35 }]);
      expect((await db.getNetOutCandidates(auto))[0]).toMatchObject({ id: half, applied: 35 });
    });

    it('takes several payments, and unticking one puts it back as income', async () => {
      const { auto, half } = await autoAndHalf();
      const more = await db.addTransaction({
        amount: 20, direction: 'CREDIT', kind: 'INCOME', merchant: 'Priya', occurredAt: day(4),
      });

      await db.netOut(auto, [half, more]);
      expect((await db.getBorneBetween(...WINDOW)).borne).toBe(15);

      await db.netOut(auto, [half]);
      expect((await db.getTransactionById(more))?.kind).toBe('INCOME');
      expect((await db.getBorneBetween(...WINDOW)).borne).toBe(35);

      await db.netOut(auto, []);
      expect(await db.getReimbursementLinks()).toEqual([]);
      expect(await db.getIncomeBetween(...WINDOW)).toBe(55);
    });

    it('hides a payment that already paid something else back', async () => {
      const { auto, half } = await autoAndHalf();
      const chai = await db.addTransaction({
        amount: 35, direction: 'DEBIT', kind: 'SPEND', merchant: 'Chai', occurredAt: day(3, 17),
      });
      await db.linkReimbursement(half, [chai]);
      expect(await db.getNetOutCandidates(auto)).toEqual([]);
    });

    it('is all or nothing when one payment is too big for the spend', async () => {
      const { auto, half } = await autoAndHalf();
      const big = await db.addTransaction({
        amount: 50, direction: 'CREDIT', kind: 'INCOME', merchant: 'Priya', occurredAt: day(4),
      });

      await expect(db.netOut(auto, [half, big])).rejects.toThrow();
      expect(await db.getReimbursementLinks()).toEqual([]);
      expect((await db.getTransactionById(half))?.kind).toBe('INCOME');
    });
  });

  it('offers a spend the payer already owes on first, and a later one too', async () => {
    const { dinner, repaid } = await dinnerAndRepayment();
    const unrelated = await db.addTransaction({
      amount: 90, direction: 'DEBIT', kind: 'SPEND', merchant: 'Metro', occurredAt: day(3, 22),
    });
    const later = await db.addTransaction({
      amount: 60, direction: 'DEBIT', kind: 'SPEND', merchant: 'Chai', occurredAt: day(6),
    });
    const rahul = await db.addContact('Rahul');
    await db.createIOU({ contactId: rahul, amount: 1800, direction: 'THEY_OWE_ME', transactionId: dinner });

    const ids = (await db.getReimbursementCandidates(repaid)).map((c) => c.id);
    expect(ids[0]).toBe(dinner);
    expect(ids).toContain(unrelated);
    expect(ids).toContain(later);
  });
});
