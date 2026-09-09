import * as db from '../db/dbService';
import {
  MAX_GAP_MS,
  TransferPair,
  TransferSide,
  detectRoundTrips,
  detectTransfers,
} from '../math/transfers';
import { parseMessage } from './parserService';

type Row = Awaited<ReturnType<typeof db.getAllTransactions>>[number];

/**
 * Runs self-transfer detection over stored transactions.
 *
 * The account number each leg names is not stored on the row, so it is
 * recovered by re-reading the original message. That is the single most
 * useful signal for telling a transfer (two different accounts) from a
 * refund (the same account twice), and it is cheap to recompute.
 */
function toSide(row: Row, linked: Set<number>): TransferSide {
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

/**
 * Turns raw rows into scoreable candidates: not excluded, not already
 * claimed by an earlier pairing, and marked when a debt already ties them
 * to a person rather than to the user's own accounts.
 */
async function buildCandidates(rows: Row[]): Promise<TransferSide[]> {
  const ious = await db.getOpenIOUs();
  const linked = new Set(
    ious.map((iou) => iou.transactionId).filter((id): id is number => id !== null)
  );
  return rows
    .filter((row) => row.excluded_at === null && row.transfer_pair_id === null)
    .map((row) => toSide(row, linked));
}

export interface TransferScanResult {
  pairs: TransferPair[];
  /** Money that stops being counted as spending once these are applied. */
  removedFromSpending: number;
}

/**
 * Two different questions over the same candidate set. Self-transfers move
 * your own money between accounts; round trips are money that went to a
 * person and came straight back. A leg claimed by the first pass is not
 * offered to the second.
 */
function pairCandidates(candidates: TransferSide[]): TransferPair[] {
  const transfers = detectTransfers(candidates);
  const claimed = new Set(transfers.flatMap((p) => [p.debit.id, p.credit.id]));
  const roundTrips = detectRoundTrips(candidates.filter((row) => !claimed.has(row.id)));
  return [...transfers, ...roundTrips];
}

export async function findTransfers(): Promise<TransferScanResult> {
  const all = await db.getAllTransactions();
  const candidates = await buildCandidates(all);
  const pairs = pairCandidates(candidates);

  return {
    pairs,
    removedFromSpending: pairs.reduce((sum, pair) => sum + pair.debit.amount, 0),
  };
}

/** Applies everything findTransfers is confident about. For backfills and rule-version bumps. */
export async function markDetectedTransfers(): Promise<TransferScanResult> {
  const result = await findTransfers();

  for (const pair of result.pairs) {
    await db.markTransferPair(pair.debit.id, pair.credit.id);
  }

  return result;
}

/**
 * Looks for this one transaction's transfer partner among other recent,
 * unclaimed transactions, and applies the match immediately if confident.
 *
 * findTransfers scans the whole ledger and is for backfills and rule-version
 * bumps; this is the version meant to run the moment a new transaction
 * lands, so a transfer to savings — or money sent to a friend and handed
 * straight back — is recognised within the same session instead of sitting
 * wrong until the next full sweep, which today only happens from a Settings
 * button or once per app update.
 *
 * Scoped to a window either side of the transaction rather than the whole
 * history: a partner leg, if one exists at all, is within MAX_GAP_MS of this
 * one by definition (see scoreTransfer), so nothing further out could ever
 * match and there is no reason to read it.
 */
export async function checkForTransferMatch(transactionId: number): Promise<TransferPair | null> {
  const row = await db.getTransactionById(transactionId);
  if (!row || row.excluded_at !== null || row.transfer_pair_id !== null) return null;

  const centre = Date.parse(row.occurred_at);
  const windowStart = new Date(centre - MAX_GAP_MS).toISOString();
  const windowEnd = new Date(centre + MAX_GAP_MS).toISOString();

  const nearby = await db.getTransactionsBetween(windowStart, windowEnd);
  const candidates = await buildCandidates(nearby);
  const pairs = pairCandidates(candidates);

  const match = pairs.find((p) => p.debit.id === transactionId || p.credit.id === transactionId);
  if (!match) return null;

  await db.markTransferPair(match.debit.id, match.credit.id);
  return match;
}
