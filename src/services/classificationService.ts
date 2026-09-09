import * as db from '../db/dbService';
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
 * Labels payments that moved money instead of spending it.
 *
 * Card bills are the delicate one. Excluding the bill is only correct when
 * the card's own purchases are being captured — then the bill is a duplicate
 * of spending already recorded. If they are not, the bill is the *only*
 * record of that spending, and dropping it would make an entire credit card
 * disappear from the budget. So the decision depends on what else is in the
 * ledger, and is re-made every time this runs: the day card alerts start
 * arriving, past bills stop counting.
 */
export async function classifyStoredTransactions(): Promise<ClassificationResult> {
  const [all, cardTracked] = await Promise.all([
    db.getAllTransactions(),
    db.hasCardTransactions(),
  ]);

  const result: ClassificationResult = { applied: [], removedFromSpending: 0 };

  for (const row of all) {
    if (row.excluded_at !== null || row.transfer_pair_id !== null) continue;

    const reason = classifyNonSpend({
      direction: row.direction,
      merchant: row.merchant,
      rawText: row.raw_text,
    });

    if (reason === null) {
      if (row.non_spend_reason !== null) await db.setNonSpendReason(row.id, null);
      continue;
    }

    if (reason === 'CARD_BILL' && !cardTracked) {
      // Nothing else records this card, so the bill has to stand in for it.
      continue;
    }

    if (reason === 'CASH_WITHDRAWAL') {
      // Still spending; it only wants an honest category.
      if (row.category !== 'Cash') await db.setTransactionCategory(row.id, 'Cash');
      continue;
    }

    if (row.non_spend_reason === reason) continue;

    await db.setNonSpendReason(row.id, reason);
    result.applied.push({
      id: row.id,
      merchant: row.merchant,
      amount: row.amount,
      reason,
    });
    if (removesFromSpending(reason) && row.kind === 'SPEND') {
      result.removedFromSpending += row.amount;
    }
  }

  return result;
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
