import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import {
  NonSpendReason,
  classifyNonSpend,
  removesFromSpending,
} from '../math/classification';
import { sameMerchant } from '../math/merchantClassifier';
import { categorise, CategoryDecision, isAmbiguousName, readPayee } from '../math/categoriser';

export interface ClassificationResult {
  applied: Array<{ id: number; merchant: string; amount: number; reason: NonSpendReason }>;
  /** Money that stops being counted as spending. */
  removedFromSpending: number;
}

/**
 * The actual decision, shared between the full sweep and the version that
 * runs the instant a single transaction is posted.
 *
 * Card bills are the delicate one. Excluding the bill is only correct when
 * the card's own purchases are being captured — then the bill is a duplicate
 * of spending already recorded. If they are not, the bill is the *only*
 * record of that spending, and dropping it would make an entire credit card
 * disappear from the budget. So the decision depends on what else is in the
 * ledger (cardTracked), not just this one row, and is re-made every time
 * this runs: the day card alerts start arriving, past bills stop counting.
 */
async function applyNonSpendClassification(
  row: TransactionRow,
  cardTracked: boolean
): Promise<{ reason: NonSpendReason; removedFromSpending: number } | null> {
  if (row.excluded_at !== null || row.transfer_pair_id !== null) return null;

  // INVESTMENT is never auto-detected (see classifyNonSpend) — it is only
  // ever set by hand, on either direction (a contribution is a debit, a
  // withdrawal is a credit). Left alone here rather than falling into the
  // generic "reason === null -> clear it" branch below, which would
  // otherwise silently undo a manual tag the moment this sweep next runs
  // (a PARSER_RULES_VERSION bump, a Settings recheck) simply because
  // classifyNonSpend has no pattern that could ever agree with it.
  if (row.non_spend_reason === 'INVESTMENT') return null;

  const reason = classifyNonSpend({
    direction: row.direction,
    merchant: row.merchant,
    rawText: row.raw_text,
  });

  if (reason === null) {
    if (row.non_spend_reason !== null) await db.setNonSpendReason(row.id, null);
    return null;
  }

  if (reason === 'CARD_BILL' && !cardTracked) {
    // Nothing else records this card, so the bill has to stand in for it.
    return null;
  }

  if (reason === 'CASH_WITHDRAWAL') {
    // Still spending; it only wants an honest category.
    if (row.category !== 'Cash') await db.setTransactionCategory(row.id, 'Cash', { source: 'SURE' });
    return null;
  }

  if (row.non_spend_reason === reason) return null;

  await db.setNonSpendReason(row.id, reason);
  return {
    reason,
    removedFromSpending: removesFromSpending(reason) && row.kind === 'SPEND' ? row.amount : 0,
  };
}

/**
 * Labels payments that moved money instead of spending it, across the whole
 * ledger. For backfills and rule-version bumps — see classifyNewTransaction
 * for the version that runs live as a transaction is posted.
 */
export async function classifyStoredTransactions(): Promise<ClassificationResult> {
  const [all, cardTracked] = await Promise.all([
    db.getAllTransactions(),
    db.hasCardTransactions(),
  ]);

  const result: ClassificationResult = { applied: [], removedFromSpending: 0 };

  for (const row of all) {
    const applied = await applyNonSpendClassification(row, cardTracked);
    if (!applied) continue;
    result.applied.push({ id: row.id, merchant: row.merchant, amount: row.amount, reason: applied.reason });
    result.removedFromSpending += applied.removedFromSpending;
  }

  return result;
}

/**
 * Classifies one transaction the moment it is posted, so a wallet top-up or
 * a cash withdrawal has its true category from the start rather than sitting
 * as ordinary spending until the next full sweep — which today only runs
 * from a Settings button or once per parser rule-version bump, neither of
 * which fires on the day-to-day rhythm of actually using the app.
 */
export async function classifyNewTransaction(
  transactionId: number
): Promise<{ reason: NonSpendReason; removedFromSpending: number } | null> {
  const row = await db.getTransactionById(transactionId);
  if (!row) return null;

  const cardTracked = await db.hasCardTransactions();
  return applyNonSpendClassification(row, cardTracked);
}

/** What a correction is about, beyond its merchant name. */
export interface CorrectionContext {
  subcategory?: string | null;
  /** The message it came from — it may name the payee's UPI handle. */
  rawText?: string | null;
}

/**
 * Teaches the categoriser from a category the user set, corrected or
 * confirmed by hand.
 *
 * For a shop, both learning tables are fed: the exact-merchant rule (so this
 * place is right next time, with certainty) and the token weights (so what
 * the words in its name mean generalises to places never seen before).
 *
 * For a person, only a per-person rule is written, against their UPI handle
 * and their name. Their name's words are never learned — "Ramesh Kumar" is
 * Food because of what Ramesh sells, not because of what "kumar" means, and
 * teaching it otherwise would file every Kumar the user pays as Food.
 *
 * A blank category is not a correction — there is nothing to learn from
 * "cleared" — so it is a no-op rather than teaching the tables to forget.
 */
export async function learnFromCategoryCorrection(
  merchant: string,
  category: string | null,
  context: CorrectionContext = {}
): Promise<void> {
  if (!category) return;
  const subcategory = context.subcategory ?? null;
  const knowledge = await db.loadCategoriserKnowledge();
  const payee = readPayee({ merchant, rawText: context.rawText }, knowledge);

  if (payee.kind === 'PERSON') {
    await db.learnPayeeRule(payee.keys, category, subcategory);
    return;
  }
  if (isAmbiguousName(payee, merchant)) {
    // Maybe a person: remembered exactly, and its words only ever help a
    // payee that is clearly a shop (see isAmbiguousName).
    await Promise.all([
      db.learnPayeeRule(payee.keys, category, subcategory),
      db.bumpTokenWeights(merchant, category),
    ]);
    return;
  }
  await Promise.all([
    db.learnMerchantRule(merchant, category, subcategory),
    db.bumpTokenWeights(merchant, category),
  ]);
}

/**
 * The user agreed with a guess. It stops being shown as one, and counts as
 * teaching — a confirmed guess is as good a signal as a correction.
 */
export async function confirmCategoryGuess(transactionId: number): Promise<void> {
  const row = await db.getTransactionById(transactionId);
  if (!row || !row.category) return;
  await db.confirmTransactionCategory(transactionId);
  await learnFromCategoryCorrection(row.merchant, row.category, {
    subcategory: row.subcategory,
    rawText: row.raw_text,
  });
}

/**
 * A category picked from a notification's quick buttons (Food / Transport /
 * Shopping), without opening the transaction.
 *
 * The same three steps as setting it in the detail sheet: set it as the
 * user's own, learn it, and reach the other payments to the same payee. It
 * learns from the original message too, so a person paid by UPI is
 * remembered as that person and not through the words in their name. The
 * notification handler once skipped that, and taught "kumar" = Food.
 */
export async function categoriseFromNotification(
  transactionId: number,
  category: string
): Promise<void> {
  const row = await db.getTransactionById(transactionId);
  // Something the user already set by hand in the app since the
  // notification went out wins over an old notification's button.
  if (!row || row.category_source === 'USER') return;
  await db.setTransactionCategory(transactionId, category, { subcategory: null, source: 'USER' });
  const context = { subcategory: null, rawText: row.raw_text };
  await learnFromCategoryCorrection(row.merchant, category, context);
  await propagateCategoryCorrection(row.merchant, category, transactionId, context);
}

export interface CategoryPropagationResult {
  /** Other transactions that also got this category. */
  updated: number;
}

/**
 * Applies a category correction to every other transaction that is plausibly
 * the same payee, not just the one that was just edited.
 *
 * learnFromCategoryCorrection only ever taught the classifier for the next
 * time this merchant shows up — a visit to the same restaurant chain from
 * months ago, already sitting there with whatever category it was first
 * (wrongly) given, was never revisited. Unlike backfillCategories, this is
 * allowed to overwrite an automatic category: correcting one instance by
 * hand is the strongest signal the app ever gets, stronger than whatever
 * guess is already sitting on the others. It does not overwrite another row
 * the user also set by hand — two visits to Amazon can honestly be Shopping
 * once and Groceries the next.
 *
 * For a shop, matching is fuzzy (see sameMerchant), because the same place
 * rarely shows up written identically twice. For a person it is exact —
 * same UPI handle, or same name — since two different people can easily
 * share most of a name.
 */
export async function propagateCategoryCorrection(
  merchant: string,
  category: string | null,
  excludeTransactionId?: number,
  context: CorrectionContext = {}
): Promise<CategoryPropagationResult> {
  if (!category) return { updated: 0 };

  const subcategory = context.subcategory ?? null;
  const knowledge = await db.loadCategoriserKnowledge();
  const payee = readPayee({ merchant, rawText: context.rawText }, knowledge);
  const asPerson = payee.kind === 'PERSON' || isAmbiguousName(payee, merchant);
  const all = await db.getAllTransactions();
  let updated = 0;

  for (const row of all) {
    if (row.id === excludeTransactionId) continue;
    if (row.direction !== 'DEBIT' || row.kind !== 'SPEND') continue;
    if (row.excluded_at !== null || row.transfer_pair_id !== null) continue;
    if (row.category_source === 'USER') continue;
    if (row.category === category && row.subcategory === subcategory) continue;

    const same =
      asPerson
        ? readPayee({ merchant: row.merchant, rawText: row.raw_text }, knowledge).keys.some((key) =>
            payee.keys.includes(key)
          )
        : sameMerchant(row.merchant, merchant);
    if (!same) continue;

    await db.setTransactionCategory(row.id, category, { subcategory, source: 'USER' });
    updated += 1;
  }

  return { updated };
}

export interface CategoryBackfillResult {
  /** Rows that had no category and now have one. */
  categorised: number;
  /** Distinct merchant names the classifier had an opinion about. */
  merchantsRecognised: number;
  /** Distinct merchant names it could not place, left as they were. */
  merchantsUnrecognised: number;
  /** Categories set before 0.9.21 that the new categoriser re-checked. */
  legacyResolved: number;
  /** Of those, how many it changed. */
  legacyChanged: number;
}

/**
 * The substring rules every install was seeded with before 0.9.21, frozen
 * here for one job: recognising a category that only ever came from one of
 * them. "Motorola" filed as Transport because it contains "ola" is not a
 * decision anyone made, and should not survive as a guess once the rule that
 * made it is gone. Never used to categorise anything.
 */
const PRE_0921_SEED_RULES: ReadonlyArray<[pattern: string, category: string]> = [
  ['swiggy', 'Food'], ['zomato', 'Food'], ['zepto', 'Food'], ['blinkit', 'Food'],
  ['instamart', 'Food'], ['dominos', 'Food'], ['mcdonald', 'Food'], ['starbucks', 'Food'],
  ['cafe', 'Food'], ['canteen', 'Food'], ['mess', 'Food'], ['uber', 'Transport'],
  ['ola', 'Transport'], ['rapido', 'Transport'], ['irctc', 'Transport'], ['redbus', 'Transport'],
  ['metro', 'Transport'], ['petrol', 'Transport'], ['amazon', 'Shopping'], ['flipkart', 'Shopping'],
  ['myntra', 'Shopping'], ['ajio', 'Shopping'], ['decathlon', 'Shopping'],
  ['netflix', 'Subscriptions'], ['spotify', 'Subscriptions'], ['prime', 'Subscriptions'],
  ['hotstar', 'Subscriptions'], ['youtube', 'Subscriptions'], ['jio', 'Subscriptions'],
  ['airtel', 'Subscriptions'], ['bookmyshow', 'Outing'], ['pvr', 'Outing'], ['inox', 'Outing'],
  ['cinepolis', 'Outing'], ['bar', 'Outing'], ['brewery', 'Outing'], ['pharmacy', 'Health'],
  ['apollo', 'Health'], ['pharmeasy', 'Health'], ['hospital', 'Health'], ['medical', 'Health'],
  ['book', 'Academics'], ['stationery', 'Academics'], ['xerox', 'Academics'],
  ['udemy', 'Academics'], ['coursera', 'Academics'], ['bescom', 'Bills'], ['bwssb', 'Bills'],
  ['nobroker', 'Rent'], ['nobrokerhood', 'Bills'], ['stanza', 'Rent'], ['nestaway', 'Rent'],
  ['bmtc', 'Transport'], ['namma yatri', 'Transport'],
];

/** Whether an old category is exactly what a pre-0.9.21 substring rule would have said. */
function cameFromOldSeed(merchant: string, category: string): boolean {
  const lower = merchant.toLowerCase();
  let best: readonly [string, string] | null = null;
  for (const rule of PRE_0921_SEED_RULES) {
    if (lower.includes(rule[0]) && (!best || rule[0].length > best[0].length)) best = rule;
  }
  return best !== null && best[1] === category;
}

function isSpendRow(row: TransactionRow): boolean {
  return (
    row.direction === 'DEBIT' &&
    row.kind === 'SPEND' &&
    row.excluded_at === null &&
    row.transfer_pair_id === null &&
    row.non_spend_reason === null
  );
}

/**
 * Gives a category to spending recorded before anything could categorise
 * it, and re-checks every category set before 0.9.21.
 *
 * The first job: the categoriser runs inside postTransaction, so it only
 * ever sees transactions captured after it shipped. Everything already in
 * the ledger stayed Uncategorised however good it got — and Insights, built
 * almost entirely on category breakdown, read as empty because of it.
 *
 * The second: a category from before 0.9.21 (LEGACY) could have come from
 * the user or from the old substring rules, and nothing recorded which. One
 * that matches something the user taught comes back as USER. Otherwise the
 * new categoriser gets its say; if it has none, a category that only an old
 * substring rule could have produced is cleared, and anything else is kept
 * but shown as a guess to confirm.
 *
 * A category the user set by hand is never overwritten.
 *
 * Blanks are grouped by merchant: a ledger of a thousand transactions holds
 * far fewer than a thousand distinct shop names, and grouping is fuzzy (see
 * sameMerchant), so a chain captured under several spellings still gets one
 * answer rather than several unrecognised ones.
 */
export async function backfillCategories(): Promise<CategoryBackfillResult> {
  const [all, knowledge] = await Promise.all([
    db.getAllTransactions(),
    db.loadCategoriserKnowledge(),
  ]);

  const result: CategoryBackfillResult = {
    categorised: 0,
    merchantsRecognised: 0,
    merchantsUnrecognised: 0,
    legacyResolved: 0,
    legacyChanged: 0,
  };

  for (const row of all) {
    if (row.category_source !== 'LEGACY' || !row.category) continue;
    result.legacyResolved += 1;
    if (!isSpendRow(row)) {
      await db.setTransactionCategory(row.id, row.category, {
        subcategory: row.subcategory,
        source: 'SURE',
      });
      continue;
    }
    const decision = categorise({ merchant: row.merchant, rawText: row.raw_text }, knowledge);
    if (decision) {
      if (decision.category !== row.category) result.legacyChanged += 1;
      await db.setTransactionCategory(row.id, decision.category, {
        subcategory: decision.subcategory,
        source: decision.source,
      });
    } else if (cameFromOldSeed(row.merchant, row.category)) {
      await db.setTransactionCategory(row.id, null);
      row.category = null;
      result.legacyChanged += 1;
    } else {
      await db.setTransactionCategory(row.id, row.category, { source: 'GUESS' });
    }
  }

  const needing = all.filter((row) => row.category === null && isSpendRow(row));

  const clusters: Array<{ names: string[]; rows: TransactionRow[] }> = [];
  for (const row of needing) {
    const key = row.merchant.trim();
    if (!key) continue;
    const cluster = clusters.find((c) => c.names.some((name) => sameMerchant(name, key)));
    if (cluster) {
      if (!cluster.names.includes(key)) cluster.names.push(key);
      cluster.rows.push(row);
    } else {
      clusters.push({ names: [key], rows: [row] });
    }
  }

  for (const cluster of clusters) {
    // One answer for the whole cluster when it is a shop. People are decided
    // row by row: two payees can share a name closely enough to cluster, and
    // a per-person rule is keyed exactly.
    let shared: CategoryDecision | null = null;
    for (const row of cluster.rows) {
      const decision = categorise({ merchant: row.merchant, rawText: row.raw_text }, knowledge);
      if (decision && decision.payee.kind !== 'PERSON') {
        shared = decision;
        break;
      }
    }

    let any = false;
    for (const row of cluster.rows) {
      const decision =
        shared ?? categorise({ merchant: row.merchant, rawText: row.raw_text }, knowledge);
      if (!decision) continue;
      await db.setTransactionCategory(row.id, decision.category, {
        subcategory: decision.subcategory,
        source: decision.source,
      });
      result.categorised += 1;
      any = true;
    }
    if (any) result.merchantsRecognised += 1;
    else result.merchantsUnrecognised += 1;
  }

  return result;
}
