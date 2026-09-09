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
