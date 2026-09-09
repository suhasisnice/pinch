import * as db from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

/**
 * End-to-end through the real database rather than the pure function: this
 * is what actually runs on a fresh install, seeded migration and all.
 */
describe('smartCategoriseMerchant, on a fresh database', () => {
  it('reads a never-before-seen merchant from the seeded vocabulary alone', async () => {
    // Nothing has taught MerchantRules "Truffles Cafe" — only the migration's
    // seed data, which knows "cafe" means Food.
    await expect(db.smartCategoriseMerchant('Truffles Cafe')).resolves.toBe('Food');
    await expect(db.smartCategoriseMerchant('Uber Trip 8817')).resolves.toBe('Transport');
  });

  it('returns null for a merchant with no recognisable word at all', async () => {
    await expect(db.smartCategoriseMerchant('XYZ9182 Holdings')).resolves.toBeNull();
  });

  it('lets an exact MerchantRules correction override the seeded guess', async () => {
    // The seed data would read "Cafe" as Food; a direct correction for this
    // exact merchant should win regardless.
    await db.learnMerchantRule('Study Cafe', 'Academics');
    await expect(db.smartCategoriseMerchant('Study Cafe')).resolves.toBe('Academics');
  });
});

describe('the token vocabulary learning from a correction', () => {
  it('generalises a correction to a merchant it has never seen', async () => {
    // "Bhukkad" is not in the seed data and matches nothing on its own.
    await expect(db.smartCategoriseMerchant('Bhukkad Dhaba')).resolves.toBeNull();

    await db.bumpTokenWeights('Bhukkad Dhaba', 'Food');

    // The correction should not just remember this exact name (that is
    // MerchantRules' job) — it should teach "bhukkad" broadly, so a second
    // place using only that word is read correctly even with no exact match.
    await expect(db.smartCategoriseMerchant('Bhukkad Corner')).resolves.toBe('Food');
  });

  it('is not fooled by a genuinely unknown second word riding along with a real one', async () => {
    // "Junction" is nowhere in the vocabulary at all, under any category —
    // it should be read as no information, not as weak evidence that quietly
    // favours whichever category happens to have the smallest seed list.
    await db.bumpTokenWeights('Bhukkad Dhaba', 'Food');
    await expect(db.smartCategoriseMerchant('Bhukkad Junction')).resolves.toBe('Food');
  });

  it('is fed automatically when a transaction detail sheet-style correction is applied', async () => {
    const { learnFromCategoryCorrection } = await import('../src/services/classificationService');
    await learnFromCategoryCorrection('Rustic Kitchen', 'Food');

    const rules = await db.getCategoryTokenWeights();
    expect(rules.Food?.kitchen).toBeGreaterThan(0);
    // The exact-match table should also have learned the full name.
    await expect(db.smartCategoriseMerchant('Rustic Kitchen')).resolves.toBe('Food');
  });

  it('does nothing when the correction clears the category rather than setting one', async () => {
    const { learnFromCategoryCorrection } = await import('../src/services/classificationService');
    const before = await db.getCategoryTokenWeights();
    await learnFromCategoryCorrection('Some Merchant', null);
    const after = await db.getCategoryTokenWeights();
    expect(after).toEqual(before);
  });
});
