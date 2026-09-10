import * as db from '../src/db/dbService';
import { backfillCategories } from '../src/services/classificationService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

const spend = (merchant: string, extra: Record<string, unknown> = {}) =>
  db.addTransaction({
    amount: 200,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant,
    occurredAt: new Date().toISOString(),
    ...extra,
  });

describe('backfillCategories', () => {
  it('categorises spending that predates the classifier', async () => {
    const zomato = await spend('Zomato');
    const uber = await spend('Uber Trip 8817');

    const result = await backfillCategories();

    expect(result.categorised).toBe(2);
    expect((await db.getTransactionById(zomato))?.category).toBe('Food');
    expect((await db.getTransactionById(uber))?.category).toBe('Transport');
  });

  it('never overwrites a category the user set by hand', async () => {
    const id = await spend('Zomato');
    // Seed data would call this Food; the user said otherwise.
    await db.setTransactionCategory(id, 'Outing');

    const result = await backfillCategories();

    expect(result.categorised).toBe(0);
    expect((await db.getTransactionById(id))?.category).toBe('Outing');
  });

  it('classifies each distinct merchant once, however many rows it has', async () => {
    await spend('Zomato');
    await spend('Zomato');
    await spend('Zomato');

    const result = await backfillCategories();

    expect(result.merchantsRecognised).toBe(1);
    expect(result.categorised).toBe(3);
  });

  it('leaves a merchant it cannot place alone, and says so', async () => {
    const id = await spend('XYZ9182 Holdings');

    const result = await backfillCategories();

    expect(result.merchantsUnrecognised).toBe(1);
    expect(result.categorised).toBe(0);
    expect((await db.getTransactionById(id))?.category).toBeNull();
  });

  it('does not give a spending category to money that was not spent', async () => {
    const topUp = await spend('Paytm');
    await db.setNonSpendReason(topUp, 'WALLET_TOPUP');

    const excluded = await spend('Some Junk Cafe');
    await db.setTransactionExcluded(excluded, true);

    const result = await backfillCategories();

    expect(result.categorised).toBe(0);
    expect((await db.getTransactionById(topUp))?.category).toBeNull();
    expect((await db.getTransactionById(excluded))?.category).toBeNull();
  });

  it('picks up what a correction taught it, not just the seed vocabulary', async () => {
    const first = await spend('Bhukkad Dhaba');
    await backfillCategories();
    // Nothing in the seed data knows "bhukkad"; this one stays blank.
    expect((await db.getTransactionById(first))?.category).toBeNull();

    const { learnFromCategoryCorrection } = await import(
      '../src/services/classificationService'
    );
    await learnFromCategoryCorrection('Bhukkad Dhaba', 'Food');

    const second = await spend('Bhukkad Corner');
    const result = await backfillCategories();

    expect(result.categorised).toBeGreaterThan(0);
    expect((await db.getTransactionById(second))?.category).toBe('Food');
  });
});
