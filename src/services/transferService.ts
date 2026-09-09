import * as db from '../db/dbService';
import {
  TransferPair,
  TransferSide,
  detectRoundTrips,
  detectTransfers,
} from '../math/transfers';
import { parseMessage } from './parserService';

/**
 * Runs self-transfer detection over stored transactions.
 *
 * The account number each leg names is not stored on the row, so it is
 * recovered by re-reading the original message. That is the single most
 * useful signal for telling a transfer (two different accounts) from a
 * refund (the same account twice), and it is cheap to recompute.
 */
function toSide(row: Awaited<ReturnType<typeof db.getAllTransactions>>[number], linked: Set<number>): TransferSide {
  // A manual row has no message to re-read, so it contributes no account
  // hint — which is correct: the user never told us which account it came from.
  const parsed =
    row.raw_text && row.source !== 'MANUAL'
      ? parseMessage(row.raw_text, null, { source: row.source })
      : null;

  return {
    id: row.id,
    amount: row.amount,
    direction: row.direction,
    kind: row.kind,
    merchant: row.merchant,
    occurredAt: row.occurred_at,
    rawText: row.raw_text,
    accountHint: parsed?.accountHint ?? null,
    linkedToPerson: linked.has(row.id),
  };
}

export interface TransferScanResult {
  pairs: TransferPair[];
  /** Money that stops being counted as spending once these are applied. */
  removedFromSpending: number;
}

export async function findTransfers(): Promise<TransferScanResult> {
  const [all, ious] = await Promise.all([db.getAllTransactions(), db.getOpenIOUs()]);

  // Any transaction already carrying a debt is a bill shared with a person,
  // not a move between the user's own accounts.
  const linked = new Set(
    ious.map((iou) => iou.transactionId).filter((id): id is number => id !== null)
  );

  const candidates = all
    .filter((row) => row.excluded_at === null && row.transfer_pair_id === null)
    .map((row) => toSide(row, linked));

  // Two different questions, so two passes. Self-transfers move your own
  // money between accounts; round trips are money that went to a person and
  // came straight back. A leg claimed by the first pass is not offered to the
  // second.
  const transfers = detectTransfers(candidates);
  const claimed = new Set(transfers.flatMap((p) => [p.debit.id, p.credit.id]));
  const roundTrips = detectRoundTrips(
    candidates.filter((row) => !claimed.has(row.id))
  );

  const pairs = [...transfers, ...roundTrips];

  return {
    pairs,
    removedFromSpending: pairs.reduce((sum, pair) => sum + pair.debit.amount, 0),
  };
}

/** Applies everything findTransfers is confident about. */
export async function markDetectedTransfers(): Promise<TransferScanResult> {
  const result = await findTransfers();

  for (const pair of result.pairs) {
    await db.markTransferPair(pair.debit.id, pair.credit.id);
  }

  return result;
}
