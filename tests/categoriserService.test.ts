import * as db from '../src/db/dbService';
import { LATEST_VERSION, MIGRATIONS } from '../src/db/migrations';
import { DbAdapter } from '../src/db/types';
import { postTransaction } from '../src/services/captureService';
import {
  backfillCategories,
  confirmCategoryGuess,
  learnFromCategoryCorrection,
  propagateCategoryCorrection,
} from '../src/services/classificationService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { disableConfirmGate } from './utils/settings';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
  await disableConfirmGate();
});

const spend = (merchant: string, extra: Record<string, unknown> = {}) =>
  db.addTransaction({
    amount: 200,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant,
    source: 'SMS',
    occurredAt: new Date().toISOString(),
    ...extra,
  });

const row = async (id: number) => (await db.getTransactionById(id))!;

describe('a captured payment gets category, sub-category and certainty', () => {
  it('applies a known brand with certainty and its sub-category', async () => {
    const id = await postTransaction({ amount: 240, direction: 'DEBIT', merchant: 'Swiggy', source: 'SMS', silent: true });
    expect(await row(id!)).toMatchObject({ category: 'Food', subcategory: 'Delivery', category_source: 'SURE' });
  });

  it('applies a weak match, marked as a guess', async () => {
    const id = await postTransaction({ amount: 180, direction: 'DEBIT', merchant: 'Hotel Empire', source: 'SMS', silent: true });
    expect(await row(id!)).toMatchObject({ category: 'Food', category_source: 'GUESS' });
  });

  it('leaves a person blank rather than guess from their name', async () => {
    const id = await postTransaction({ amount: 60, direction: 'DEBIT', merchant: 'Ramesh Kumar', source: 'SMS', silent: true });
    expect(await row(id!)).toMatchObject({ category: null, category_source: null });
  });

  it('records a category the user picked as theirs', async () => {
    const id = await postTransaction({
      amount: 60,
      direction: 'DEBIT',
      merchant: 'Canteen',
      category: 'Food',
      subcategory: 'Canteen & mess',
      silent: true,
    });
    expect(await row(id!)).toMatchObject({ category: 'Food', subcategory: 'Canteen & mess', category_source: 'USER' });
  });
});

describe('learning about people', () => {
  it('a correction for one Kumar never spreads to another', async () => {
    await learnFromCategoryCorrection('Ramesh Kumar', 'Food', { subcategory: 'Cafés & chai' });

    const again = await postTransaction({ amount: 20, direction: 'DEBIT', merchant: 'RAMESH KUMAR', source: 'SMS', silent: true });
    const other = await postTransaction({ amount: 500, direction: 'DEBIT', merchant: 'Suresh Kumar', source: 'SMS', silent: true });

    expect(await row(again!)).toMatchObject({ category: 'Food', subcategory: 'Cafés & chai', category_source: 'USER' });
    expect((await row(other!)).category).toBeNull();

    // And nothing about "kumar" was learned as a word.
    const weights = await db.getCategoryTokenWeights();
    expect(weights.Food?.kumar).toBeUndefined();
  });

  it('recognises the same person by UPI handle under a different name', async () => {
    const raw = 'Rs.40 debited from A/c XX1234 to ramesh.k@okaxis UPI Ref 1';
    await learnFromCategoryCorrection('Ramesh Kumar', 'Groceries', { rawText: raw });

    const id = await postTransaction({
      amount: 40,
      direction: 'DEBIT',
      merchant: 'RAMESH K',
      rawText: 'Rs.40 debited from A/c XX1234 to ramesh.k@okaxis UPI Ref 2',
      source: 'SMS',
      silent: true,
    });
    expect((await row(id!)).category).toBe('Groceries');
  });

  it('propagates a person correction only to that exact person', async () => {
    const mine = await spend('Ramesh Kumar');
    const theirs = await spend('Ramesh Kumaran');

    await propagateCategoryCorrection('Ramesh Kumar', 'Food', undefined);

    expect((await row(mine)).category).toBe('Food');
    expect((await row(theirs)).category).toBeNull();
  });

  it('a shop correction still teaches its words', async () => {
    await learnFromCategoryCorrection('Bhukkad Adda', 'Food');
    const weights = await db.getCategoryTokenWeights();
    expect(weights.Food?.bhukkad).toBeGreaterThan(0);
  });
});

describe('confirming a guess', () => {
  it('stops showing it as a guess and teaches the categoriser', async () => {
    const id = await spend('Hotel Empire', { category: 'Food', categorySource: 'GUESS' });
    await confirmCategoryGuess(id);

    expect((await row(id)).category_source).toBe('USER');
    const later = await postTransaction({ amount: 90, direction: 'DEBIT', merchant: 'HOTEL EMPIRE', source: 'SMS', silent: true });
    expect(await row(later!)).toMatchObject({ category: 'Food', category_source: 'USER' });
  });
});

describe('re-checking categories set before 0.9.21', () => {
  it('fixes what the old substring rules got wrong', async () => {
    const motorola = await spend('Motorola Mobility', { category: 'Transport', categorySource: 'LEGACY' });
    const jiomart = await spend('JioMart', { category: 'Subscriptions', categorySource: 'LEGACY' });

    await backfillCategories();

    // Only a substring rule ever said Motorola was a cab ride: cleared.
    expect(await row(motorola)).toMatchObject({ category: null });
    expect(await row(jiomart)).toMatchObject({ category: 'Groceries', category_source: 'SURE' });
  });

  it('clears a category only an old substring rule could have produced', async () => {
    const id = await spend('Kolar Gold Fields', { category: 'Transport', categorySource: 'LEGACY' });
    await backfillCategories();
    expect(await row(id)).toMatchObject({ category: null, category_source: null });
  });

  it('keeps an old category it has no opinion on, but as a guess', async () => {
    const id = await spend('Xyzzy', { category: 'Health', categorySource: 'LEGACY' });
    await backfillCategories();
    expect(await row(id)).toMatchObject({ category: 'Health', category_source: 'GUESS' });
  });

  it('hands back to the user anything matching a rule they taught', async () => {
    await db.learnMerchantRule('Amazon', 'Groceries');
    const id = await spend('AMAZON', { category: 'Groceries', categorySource: 'LEGACY' });
    await backfillCategories();
    expect(await row(id)).toMatchObject({ category: 'Groceries', category_source: 'USER' });
  });

  it('never touches a category the user set', async () => {
    const id = await spend('Motorola', { category: 'Transport', categorySource: 'USER' });
    await backfillCategories();
    expect(await row(id)).toMatchObject({ category: 'Transport', category_source: 'USER' });
  });
});

describe('migration v20', () => {
  async function migrate(adapter: DbAdapter, from: number, to: number): Promise<void> {
    for (const migration of MIGRATIONS) {
      if (migration.version <= from) continue;
      if (migration.version > to) break;
      for (const statement of migration.statements) await adapter.execAsync(statement);
      await adapter.execAsync(`PRAGMA user_version = ${migration.version};`);
    }
  }

  it('marks old categories LEGACY, keeps manual ones as USER, and drops only seeded rules', async () => {
    const adapter = await createSqlJsAdapter();
    await migrate(adapter, 0, 19);
    const now = new Date().toISOString();
    const insert = `INSERT INTO Transactions (amount, direction, kind, merchant, category, occurred_at, source, created_at)
      VALUES (100, 'DEBIT', 'SPEND', ?, ?, ?, ?, ?);`;
    await adapter.runAsync(insert, ['Motorola', 'Transport', now, 'SMS', now]);
    await adapter.runAsync(insert, ['Canteen', 'Food', now, 'MANUAL', now]);
    await adapter.runAsync(insert, ['HDFC ATM', 'Cash', now, 'SMS', now]);
    await adapter.runAsync(
      `INSERT INTO MerchantRules (pattern, category, hit_count, created_at) VALUES ('ola', 'Transport', 0, ?), ('chintu stores', 'Food', 2, ?);`,
      [now, now]
    );
    await adapter.runAsync(
      `INSERT OR REPLACE INTO CategoryTokenWeights (token, category, weight) VALUES ('zepto', 'Shopping', 3), ('mart', 'Shopping', 8);`
    );

    await migrate(adapter, 19, LATEST_VERSION);

    const rows = await adapter.getAllAsync<{ merchant: string; category_source: string }>(
      `SELECT merchant, category_source FROM Transactions ORDER BY id;`
    );
    expect(rows.map((r) => r.category_source)).toEqual(['LEGACY', 'USER', 'SURE']);

    const rules = await adapter.getAllAsync<{ pattern: string }>(`SELECT pattern FROM MerchantRules;`);
    expect(rules.map((r) => r.pattern)).toEqual(['chintu stores']);

    const weights = await adapter.getAllAsync<{ token: string; category: string }>(
      `SELECT token, category FROM CategoryTokenWeights WHERE token IN ('zepto', 'mart') ORDER BY token, category;`
    );
    // A pure seed moves; a word a correction touched stays where the user put it.
    expect(weights).toEqual(
      expect.arrayContaining([
        { token: 'zepto', category: 'Groceries' },
        { token: 'mart', category: 'Shopping' },
      ])
    );
    expect(weights).not.toContainEqual({ token: 'zepto', category: 'Shopping' });
  });
});
