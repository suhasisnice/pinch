import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { parseMessage } from './parserService';
import { markDetectedTransfers } from './transferService';
import { backfillCategories, classifyStoredTransactions } from './classificationService';

const REVALIDATION_KEY = 'pinch.revalidatedRules';

/**
 * The rule-set version. Bump this whenever the parser gets stricter, and
 * every device re-checks its imported history once on the next launch.
 *
 * 2 — an SMS must name the account the money moved through.
 * 3 — money moved between the user's own accounts is detected and set aside.
 * 4 — money sent to a person and returned by them is cancelled out.
 * 5 — wallet top-ups, card bills and cash withdrawals are recognised, and
 *     reversals are booked against spending instead of as income.
 * 6 — spending recorded before the merchant classifier existed gets a
 *     category. Until this, the classifier only ever saw transactions
 *     captured after it shipped, so an existing ledger stayed Uncategorised
 *     however good it got — and Insights, which is built on category
 *     breakdown, read as empty because of it.
 * 7 — "sent" no longer means outgoing on its own. It briefly did, to catch
 *     HDFC's "Sent Rs.500 From A/C x1234 To ZOMATO", which also read every
 *     incoming payment as spending of the same amount. Stored rows pointing
 *     the wrong way are turned back round here, since a direction cannot be
 *     corrected by hand from the edit sheet.
 */
export const PARSER_RULES_VERSION = 7;

export interface RevalidationResult {
  /** Transactions examined: captured, and still carrying their original text. */
  checked: number;
  /** Those today's rules would no longer accept. */
  rejected: TransactionRow[];
  /** Money those rejected rows were wrongly counting as spending. */
  rejectedSpend: number;
  /** Movements between the user's own accounts that were set aside. */
  transfersFound: number;
  /** Spending those transfers were wrongly adding to the total. */
  transferSpend: number;
  /** Payments that moved money rather than spending it. */
  reclassified: number;
  /** Spending those payments were wrongly adding to the total. */
  reclassifiedSpend: number;
  /** Rows whose direction was stored the wrong way round. */
  directionsCorrected: number;
  /** Older transactions that finally got a category. */
  categorised: number;
  /** Distinct merchants the classifier still could not place. */
  merchantsUnrecognised: number;
}

/**
 * Finds transactions that only exist because an older, looser parser let them
 * in.
 *
 * Tightening the parser fixes what happens next, but it does nothing about
 * what is already stored — and a budget is computed from what is stored. So
 * every captured row that still has its original message is re-read under
 * today's rules, and anything that would now be turned away is reported.
 *
 * Manual entries are never touched: the user typed those, and no parser has
 * an opinion worth more than that. Rows with no original text (imported by a
 * build that did not keep it) are skipped rather than guessed at.
 */
export async function findStaleCaptures(): Promise<RevalidationResult> {
  const all = await db.getAllTransactions();
  const result: RevalidationResult = {
    checked: 0,
    rejected: [],
    rejectedSpend: 0,
    transfersFound: 0,
    transferSpend: 0,
    reclassified: 0,
    reclassifiedSpend: 0,
    directionsCorrected: 0,
    categorised: 0,
    merchantsUnrecognised: 0,
  };

  for (const row of all) {
    if (row.source === 'MANUAL') continue;
    if (!row.raw_text) continue;

    result.checked += 1;

    const parsed = parseMessage(row.raw_text, null, { source: row.source });
    if (parsed === null) {
      result.rejected.push(row);
      if (row.kind === 'SPEND') result.rejectedSpend += row.amount;
    }
  }

  return result;
}

/**
 * Re-reads which way the money went, for rows already on the books.
 *
 * A parser fix only changes what happens next; the budget is computed from
 * what is stored. When "sent" was briefly read as always outgoing, every
 * incoming payment landed as spending of the same size — an error of twice
 * the amount in the totals — and there is no way to flip a direction by hand,
 * because the edit sheet only offers amount, merchant and category.
 *
 * Deliberately narrow. Only captured rows that still have their original
 * message, only where the parser is now confident, and only plain SPEND or
 * INCOME: anything tied to a person, a transfer or a refund has a kind that
 * was decided by more than the message text, and re-deriving it from the
 * words alone would undo that.
 */
async function correctStoredDirections(): Promise<number> {
  const all = await db.getAllTransactions();
  let corrected = 0;

  for (const row of all) {
    if (row.source === 'MANUAL' || !row.raw_text) continue;
    if (row.excluded_at !== null || row.transfer_pair_id !== null) continue;
    if (row.kind !== 'SPEND' && row.kind !== 'INCOME') continue;

    const parsed = parseMessage(row.raw_text, null, { source: row.source });
    if (!parsed || parsed.direction === row.direction) continue;

    await db.updateTransaction(row.id, {
      direction: parsed.direction,
      kind: parsed.direction === 'DEBIT' ? 'SPEND' : 'INCOME',
    });
    corrected += 1;
  }

  return corrected;
}

/**
 * Excludes everything findStaleCaptures turned up.
 *
 * Excluded rather than deleted, for the same reason the manual flow does it:
 * the row's dedup key is what stops the identical message being re-imported
 * by the next backfill, and the user can put any of it back from Settings.
 */
export async function revalidateHistory(): Promise<RevalidationResult> {
  const result = await findStaleCaptures();

  for (const row of result.rejected) {
    await db.setTransactionExcluded(row.id, true);
  }

  // Before transfer detection, which pairs a debit with a credit — a leg
  // pointing the wrong way cannot find its partner.
  result.directionsCorrected = await correctStoredDirections();

  // Run transfer detection after the junk has gone, so a promotional message
  // can never be paired with a real credit and hide a genuine expense.
  const transfers = await markDetectedTransfers();
  result.transfersFound = transfers.pairs.length;
  result.transferSpend = transfers.removedFromSpending;

  // Last, so a wallet top-up already claimed as one leg of a transfer is not
  // counted twice in what the user is told.
  const classified = await classifyStoredTransactions();
  result.reclassified = classified.applied.length;
  result.reclassifiedSpend = classified.removedFromSpending;

  // After all of the above, so nothing junk, transferred or non-spend gets a
  // spending category it has no business carrying.
  const backfilled = await backfillCategories();
  result.categorised = backfilled.categorised;
  result.merchantsUnrecognised = backfilled.merchantsUnrecognised;

  return result;
}

/**
 * Runs the re-check once per rule-set version.
 *
 * Returns null when there was nothing to do, so the caller can stay silent
 * rather than announcing a no-op to someone who never had the problem.
 */
export async function revalidateIfRulesChanged(): Promise<RevalidationResult | null> {
  // Imported lazily so this module stays usable in tests without a storage
  // shim standing by.
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;

  const stored = await AsyncStorage.getItem(REVALIDATION_KEY);
  if (Number(stored) >= PARSER_RULES_VERSION) return null;

  const result = await revalidateHistory();
  await AsyncStorage.setItem(REVALIDATION_KEY, String(PARSER_RULES_VERSION));

  const changed =
    result.rejected.length > 0 ||
    result.transfersFound > 0 ||
    result.reclassified > 0 ||
    result.directionsCorrected > 0 ||
    result.categorised > 0;
  return changed ? result : null;
}
