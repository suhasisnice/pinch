import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { parseMessage } from './parserService';

const REVALIDATION_KEY = 'pinch.revalidatedRules';

/**
 * The rule-set version. Bump this whenever the parser gets stricter, and
 * every device re-checks its imported history once on the next launch.
 *
 * 2 — an SMS must name the account the money moved through.
 */
export const PARSER_RULES_VERSION = 2;

export interface RevalidationResult {
  /** Transactions examined: captured, and still carrying their original text. */
  checked: number;
  /** Those today's rules would no longer accept. */
  rejected: TransactionRow[];
  /** Money those rejected rows were wrongly counting as spending. */
  rejectedSpend: number;
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
  const result: RevalidationResult = { checked: 0, rejected: [], rejectedSpend: 0 };

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

  return result.rejected.length > 0 ? result : null;
}
