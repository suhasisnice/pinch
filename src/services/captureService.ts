import * as db from '../db/dbService';
import { CapturedMessage, drainMessages, readRecentSms } from '../../modules/pinch-capture';
import { ACCEPT_THRESHOLD, buildDedupKey, parseMessage } from './parserService';
import { getBudgetSnapshot } from './budgetService';
import { planForTransaction } from '../notifications/engine';
import { deliverAll, loadDeliveryHistory } from '../notifications/notificationService';
import {
  getMonthlyAllowance,
  getNotificationSettings,
  getRoundUpGoalId,
} from '../settings/settingsStore';
import { roundUpAmount } from '../math/budget';
import { classifyNewTransaction } from './classificationService';
import { checkForTransferMatch } from './transferService';

export interface IngestResult {
  processed: number;
  posted: number;
  queuedForReview: number;
  skipped: number;
}

/**
 * Maps a payment-app package name to something a person recognises, used when
 * a notification does not name the merchant itself.
 */
const PACKAGE_LABELS: Record<string, string> = {
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'com.phonepe.app': 'PhonePe',
  'net.one97.paytm': 'Paytm',
  'in.org.npci.upiapp': 'BHIM',
  'com.dreamplug.androidapp': 'CRED',
};

function labelFor(message: CapturedMessage): string {
  return PACKAGE_LABELS[message.sender] ?? message.sender;
}

/**
 * Runs one captured message through parse -> dedup -> post or queue.
 *
 * A message that parses confidently becomes a transaction immediately; a
 * shakier one is filed in the review inbox instead. The threshold matters:
 * silently logging a wrong transaction costs far more trust than asking.
 */
export async function ingestMessage(
  message: CapturedMessage,
  options: { silent?: boolean } = {}
): Promise<'POSTED' | 'QUEUED' | 'SKIPPED'> {
  // Checked before the parser even runs: a sender the user has already
  // blocked (a rummy app, a "CTC" marketing shortcode) never gets to become
  // a review-inbox item again, let alone a transaction. Parsing runs on the
  // body too, since the same promotional blast is often resent from a
  // different-looking sender.
  if (await db.isBlocked(message.sender, message.body)) return 'SKIPPED';

  const parsed = parseMessage(message.body, message.source === 'SMS' ? message.sender : null, {
    source: message.source,
  });
  if (!parsed) return 'SKIPPED';

  const occurredAt = new Date(message.receivedAt || Date.now());
  const dedupKey = buildDedupKey(parsed, occurredAt);

  const merchant =
    parsed.counterparty ?? (message.source === 'NOTIFICATION' ? labelFor(message) : 'Unknown');

  if (await db.isBlocked(merchant)) return 'SKIPPED';

  // Second line of defence behind the UNIQUE dedup key: the same payment
  // reported by SMS and by a notification, worded differently and carrying
  // no reference number to match on. Checked before the confidence gate
  // below, not after — a shakier parse of a payment that is already
  // correctly on the books (say, a bank SMS confirming what a payment app's
  // notification already posted) must never reach the review inbox at all,
  // where "is this real" is the wrong question to ask about it.
  //
  // Skipped whenever a match is found, regardless of whether its dedup key
  // happens to equal this one's: that equality only means addTransaction's
  // own UNIQUE check would have caught it further down for a confident
  // parse. A capture heading for the review inbox never reaches
  // addTransaction at all, so relying on that downstream idempotency here
  // would let a low-confidence echo of an already-posted payment through.
  const existing = await db.findProbableDuplicate(parsed.amount, parsed.direction, occurredAt.toISOString());
  if (existing) {
    return 'SKIPPED';
  }

  if (parsed.confidence < ACCEPT_THRESHOLD) {
    const id = await db.recordCapture({
      rawText: message.body,
      source: message.source,
      sender: message.sender,
      receivedAt: occurredAt.toISOString(),
      parsedAmount: parsed.amount,
      parsedMerchant: merchant,
      parsedDirection: parsed.direction,
      confidence: parsed.confidence,
      dedupKey,
    });
    return id === null ? 'SKIPPED' : 'QUEUED';
  }

  const posted = await postTransaction({
    amount: parsed.amount,
    direction: parsed.direction,
    merchant,
    occurredAt: occurredAt.toISOString(),
    source: message.source,
    rawText: message.body,
    externalRef: parsed.reference,
    dedupKey,
    // A reversal undoes a purchase; booking it as income would inflate the
    // allowance instead of cancelling the spending it reverses.
    kind: parsed.isRefund ? 'REFUND' : undefined,
    silent: options.silent,
  });

  return posted ? 'POSTED' : 'SKIPPED';
}

export interface PostTransactionInput {
  amount: number;
  direction: 'DEBIT' | 'CREDIT';
  merchant: string;
  occurredAt?: string;
  source?: 'SMS' | 'NOTIFICATION' | 'MANUAL';
  rawText?: string | null;
  externalRef?: string | null;
  dedupKey?: string | null;
  category?: string | null;
  outingId?: number | null;
  /** Set for a credit that repays a specific debt rather than being income. */
  settlesContactId?: number | null;
  /** Overrides the derived classification. Used for refunds and reversals. */
  kind?: 'SPEND' | 'INCOME' | 'SETTLE_IN' | 'SETTLE_OUT' | 'REFUND';
  /**
   * Suppresses nudges. Used by the historical backfill: importing a month of
   * old texts should fill in the ledger, not fire a burst of notifications
   * about spending that happened weeks ago.
   */
  silent?: boolean;
}

/**
 * Creates a transaction, classifies it, and runs the side effects that follow:
 * auto-categorisation, outing tagging, round-up saving, and notifications.
 *
 * The `kind` decision is the important one. A credit is only income if it is
 * not repaying a debt — otherwise it is SETTLE_IN, which clears a receivable
 * rather than inflating the allowance.
 */
export async function postTransaction(input: PostTransactionInput): Promise<number | null> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const category =
    input.category ?? (input.direction === 'DEBIT' ? await db.smartCategoriseMerchant(input.merchant) : null);

  let kind: 'SPEND' | 'INCOME' | 'SETTLE_IN' | 'SETTLE_OUT' | 'REFUND';
  if (input.kind) {
    kind = input.kind;
  } else if (input.direction === 'DEBIT') {
    kind = input.settlesContactId ? 'SETTLE_OUT' : 'SPEND';
  } else {
    kind = input.settlesContactId ? 'SETTLE_IN' : 'INCOME';
  }

  // Spending during an open outing belongs to it unless told otherwise.
  let outingId = input.outingId ?? null;
  if (outingId === null && kind === 'SPEND') {
    const active = await db.getActiveOuting(occurredAt);
    outingId = active?.id ?? null;
  }

  const transactionId = await db.addTransaction({
    amount: input.amount,
    direction: input.direction,
    kind,
    merchant: input.merchant,
    category,
    occurredAt,
    source: input.source ?? 'MANUAL',
    rawText: input.rawText ?? null,
    externalRef: input.externalRef ?? null,
    dedupKey: input.dedupKey ?? null,
    outingId,
  });

  if (input.settlesContactId) {
    if (kind === 'SETTLE_IN') {
      await db.settleContactBalance(input.settlesContactId, input.amount, transactionId);
    } else {
      // Paying a friend back clears what you owe them, oldest debt first.
      const open = await db.getOpenIOUsForContact(input.settlesContactId);
      let remaining = input.amount;
      for (const iou of open) {
        if (remaining <= 0.009 || iou.direction !== 'I_OWE_THEM') continue;
        const applied = Math.min(remaining, iou.openAmount);
        await db.settleIOU(iou.id, applied, transactionId);
        remaining -= applied;
      }
    }
  }

  if (kind === 'SPEND') {
    await runSpendSideEffects(
      transactionId,
      input.amount,
      input.merchant,
      category,
      outingId,
      input.silent === true
    );
  }

  // Money moving rather than being spent — a wallet top-up, a self-transfer,
  // a friend's money sent straight back — used to only get recognised from a
  // Settings button or the next app update's rule-version bump, so it sat
  // wrong in "safe to spend" for however long until then. Checking right
  // here means it is correct within the same session it happened in.
  // Every kind runs through this, not just SPEND: the transfer's credit leg
  // needs the same check as its debit leg, and neither is a SPEND.
  try {
    await classifyNewTransaction(transactionId);
    await checkForTransferMatch(transactionId);
  } catch {
    // Never lets a classification hiccup block a transaction that already
    // wrote successfully — the next full sweep still catches it later.
  }

  return transactionId;
}

/** Round-up saving plus the notification pass. Failures here never block the write. */
async function runSpendSideEffects(
  transactionId: number,
  amount: number,
  merchant: string,
  category: string | null,
  outingId: number | null,
  silent: boolean
): Promise<void> {
  const goalsCrossed: Array<{ name: string; emoji: string; percent: number; remaining: number }> = [];

  try {
    const roundUpGoalId = await getRoundUpGoalId();
    if (roundUpGoalId !== null) {
      const spare = roundUpAmount(amount, 10);
      if (spare > 0) {
        const before = await db.getGoalById(roundUpGoalId);
        await db.contributeToGoal(roundUpGoalId, spare, 'ROUNDUP', transactionId);
        const after = await db.getGoalById(roundUpGoalId);

        if (before && after) {
          const milestone = crossedMilestone(before.fraction, after.fraction);
          if (milestone !== null) {
            goalsCrossed.push({
              name: after.name,
              emoji: after.emoji,
              percent: milestone,
              remaining: after.remainingAmount,
            });
          }
        }
      }
    }
  } catch {
    // Round-up is a bonus; never let it stop a transaction being recorded.
  }

  if (silent) return;

  try {
    const settings = await getNotificationSettings();
    if (!settings.enabled) return;

    const [snapshot, history, allowance] = await Promise.all([
      getBudgetSnapshot(await getMonthlyAllowance()),
      loadDeliveryHistory(),
      getMonthlyAllowance(),
    ]);
    void allowance;

    const openIOUs = await db.getOpenIOUs();
    const alreadySplit = openIOUs.some((iou) => iou.transactionId === transactionId);

    const planned = planForTransaction({
      now: new Date(),
      transactionId,
      amount,
      merchant,
      category,
      alreadySplit: alreadySplit || outingId !== null,
      today: snapshot.today,
      budget: snapshot.budget,
      streakDays: snapshot.streakDays,
      goalsCrossed,
      avgDailyBurn: snapshot.avgDailyBurn,
      history,
      settings,
    });

    await deliverAll(planned, settings);
  } catch {
    // Notification failure must never surface as a failed transaction.
  }
}

const MILESTONES = [25, 50, 75, 100];

/** The highest milestone newly crossed by this contribution, if any. */
function crossedMilestone(beforeFraction: number, afterFraction: number): number | null {
  const before = beforeFraction * 100;
  const after = afterFraction * 100;
  let crossed: number | null = null;
  for (const milestone of MILESTONES) {
    if (before < milestone && after >= milestone) crossed = milestone;
  }
  return crossed;
}

/** Processes everything buffered natively while the app was closed. */
export async function ingestPending(): Promise<IngestResult> {
  const messages = await drainMessages();
  return ingestBatch(messages);
}

export async function ingestBatch(
  messages: CapturedMessage[],
  options: { silent?: boolean } = {}
): Promise<IngestResult> {
  const result: IngestResult = { processed: 0, posted: 0, queuedForReview: 0, skipped: 0 };

  // Oldest first, so dedup windows and outing tagging see events in order.
  const ordered = [...messages].sort((a, b) => a.receivedAt - b.receivedAt);

  for (const message of ordered) {
    result.processed += 1;
    try {
      const outcome = await ingestMessage(message, options);
      if (outcome === 'POSTED') result.posted += 1;
      else if (outcome === 'QUEUED') result.queuedForReview += 1;
      else result.skipped += 1;
    } catch {
      result.skipped += 1;
    }
  }

  return result;
}

/** One-time backfill when the user first grants SMS access. */
export async function backfillFromInbox(limit = 100): Promise<IngestResult> {
  const messages = await readRecentSms(limit);
  // Silent: these are old messages, and nudging about last week's coffee the
  // moment the app is installed is noise, not a warning.
  return ingestBatch(messages, { silent: true });
}

/** Promotes a reviewed capture into a real transaction. */
export async function acceptCapture(
  captureId: number,
  overrides: Partial<PostTransactionInput> = {}
): Promise<number | null> {
  const capture = await db.getCaptureById(captureId);
  if (!capture || capture.status !== 'PENDING') return null;

  const transactionId = await postTransaction({
    amount: overrides.amount ?? capture.parsed_amount ?? 0,
    direction: overrides.direction ?? capture.parsed_direction ?? 'DEBIT',
    merchant: overrides.merchant ?? capture.parsed_merchant ?? 'Unknown',
    occurredAt: capture.received_at,
    source: capture.source,
    rawText: capture.raw_text,
    dedupKey: capture.dedup_key,
    category: overrides.category,
    outingId: overrides.outingId,
    settlesContactId: overrides.settlesContactId,
  });

  await db.setCaptureStatus(captureId, 'ACCEPTED', transactionId);
  return transactionId;
}

/**
 * Accepts several pending captures at their parsed values.
 *
 * Built on acceptCapture, so each one still goes through postTransaction and
 * picks up outing tagging, round-ups and notifications. Captures that are no
 * longer pending are skipped rather than treated as failures.
 */
export async function acceptCapturesByIds(ids: number[]): Promise<number> {
  let accepted = 0;
  for (const id of ids) {
    if ((await acceptCapture(id)) !== null) accepted += 1;
  }
  return accepted;
}

/**
 * Rejects several pending captures, optionally blocking each distinct sender.
 *
 * Blocking is the useful half: the reason a review queue fills with junk is
 * one sender, and rejecting them one by one never stops the next message.
 */
export async function rejectCapturesByIds(
  ids: number[],
  blockSenders = false
): Promise<{ rejected: number; blocked: string[] }> {
  const blocked = new Set<string>();
  let rejected = 0;

  for (const id of ids) {
    const capture = await db.getCaptureById(id);
    if (!capture || capture.status !== 'PENDING') continue;

    if (blockSenders) {
      const sender = capture.sender?.trim();
      if (sender && !blocked.has(sender)) {
        await db.addToBlocklist(sender, 'Blocked from bulk review');
        blocked.add(sender);
      }
    }

    await db.rejectCapture(id);
    rejected += 1;
  }

  return { rejected, blocked: [...blocked] };
}
