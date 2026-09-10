import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import {
  NonSpendReason,
  classifyNonSpend,
  removesFromSpending,
} from '../math/classification';

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
    if (row.category !== 'Cash') await db.setTransactionCategory(row.id, 'Cash');
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

/**
 * Teaches the categoriser from a category the user set or corrected by hand.
 *
 * Feeds both learning tables: the exact-match one (so this merchant is right
 * next time, with certainty) and the token-weight one (so what the words in
 * its name mean generalises to merchants never seen before). A blank
 * category is not a correction — there is nothing to learn from "cleared" —
 * so it is a no-op rather than teaching the tables to forget.
 */
export async function learnFromCategoryCorrection(
  merchant: string,
  category: string | null
): Promise<void> {
  if (!category) return;
  await Promise.all([db.learnMerchantRule(merchant, category), db.bumpTokenWeights(merchant, category)]);
}

export interface CategoryBackfillResult {
  /** Rows that had no category and now have one. */
  categorised: number;
  /** Distinct merchant names the classifier had an opinion about. */
  merchantsRecognised: number;
  /** Distinct merchant names it could not place, left as they were. */
  merchantsUnrecognised: number;
}

/**
 * Gives a category to spending that was recorded before there was anything
 * able to categorise it.
 *
 * The token classifier runs inside postTransaction, so it only ever sees
 * transactions captured after it shipped. Everything already in the ledger —
 * which, on a real install, is most of it — stayed Uncategorised no matter
 * how good the classifier got. Insights is built almost entirely on category
 * breakdown, so that one gap was enough to make the whole screen read as
 * empty.
 *
 * Only fills blanks. A category the user set by hand is never overwritten,
 * and neither is one an earlier run already worked out.
 *
 * Grouped by merchant rather than run per row: the classifier reloads the
 * whole token table on each call, and a ledger of a thousand transactions
 * holds far fewer than a thousand distinct shop names.
 */
export async function backfillCategories(): Promise<CategoryBackfillResult> {
  const all = await db.getAllTransactions();

  const needing = all.filter(
    (row) =>
      row.category === null &&
      row.direction === 'DEBIT' &&
      row.kind === 'SPEND' &&
      row.excluded_at === null &&
      row.transfer_pair_id === null &&
      row.non_spend_reason === null
  );

  const byMerchant = new Map<string, number[]>();
  for (const row of needing) {
    const key = row.merchant.trim().toLowerCase();
    if (!key) continue;
    const ids = byMerchant.get(key);
    if (ids) ids.push(row.id);
    else byMerchant.set(key, [row.id]);
  }

  const result: CategoryBackfillResult = {
    categorised: 0,
    merchantsRecognised: 0,
    merchantsUnrecognised: 0,
  };

  for (const [merchant, ids] of byMerchant) {
    const category = await db.smartCategoriseMerchant(merchant);
    if (!category) {
      result.merchantsUnrecognised += 1;
      continue;
    }
    result.merchantsRecognised += 1;
    for (const id of ids) {
      await db.setTransactionCategory(id, category);
      result.categorised += 1;
    }
  }

  return result;
}
