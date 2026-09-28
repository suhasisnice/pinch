import * as db from '../db/dbService';
import { CapturedMessage, drainMessages, readRecentSms } from '../../modules/pinch-capture';
import { ACCEPT_THRESHOLD, buildDedupKey, explainRejection, parseMessage } from './parserService';
import { PARSER_RULES_VERSION } from './revalidationService';
import { getBudgetSnapshot } from './budgetService';
import { planTransactionInterventions } from './interventionService';
import { NotificationSettings, isQuietHour, planForTransaction } from '../notifications/engine';
import { TITLES } from '../notifications/messages';
import { deliver, deliverAll, loadDeliveryHistory } from '../notifications/notificationService';
import {
  getMonthlyAllowance,
  getNotificationSettings,
  getRoundUpGoalId,
} from '../settings/settingsStore';
import { roundUpAmount } from '../math/budget';
import { looksLikeInvestment } from '../math/wealth';
import { formatMoney } from '../utils/format';
import { classifyNewTransaction } from './classificationService';
import { checkForTransferMatch } from './transferService';
import { checkForSettlement } from './settlementService';
import { isWorthKeeping, redactOtp } from './smsPrivacy';

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
  'com.google.android.gm': 'Email',
  'com.google.android.gm.lite': 'Email',
};

/** A sender as a person would name it: "Google Pay", not its package name. */
export function senderLabel(sender: string): string {
  return PACKAGE_LABELS[sender] ?? sender;
}

function labelFor(message: CapturedMessage): string {
  return senderLabel(message.sender);
}

/**
 * Runs one already-recorded message through parse -> dedup -> post or
 * queue, and writes exactly one `ParsedEvent` naming the outcome. Shared by
 * `ingestMessage` (a message arriving live, which records the `RawEvent`
 * itself first) and `reprocessRawEvent` (a message already on file from a
 * previous attempt) — the two differ only in where `rawEventId` and
 * `message` come from, not in how a message is judged.
 */
async function processMessage(
  rawEventId: number,
  message: CapturedMessage,
  options: { silent?: boolean } = {}
): Promise<'POSTED' | 'QUEUED' | 'SKIPPED'> {
  async function skip(
    reason: 'SKIPPED_BLOCKED' | 'SKIPPED_NO_PARSE' | 'SKIPPED_DUPLICATE' | 'SKIPPED_ADD_FAILED',
    fields: {
      rejectReason?: string | null;
      amount?: number | null;
      direction?: 'DEBIT' | 'CREDIT' | null;
      merchant?: string | null;
      confidence?: number | null;
    } = {}
  ): Promise<'SKIPPED'> {
    await db.recordParsedEvent({
      rawEventId,
      parserVersion: PARSER_RULES_VERSION,
      outcome: reason,
      ...fields,
    });
    return 'SKIPPED';
  }

  // Checked before the parser even runs: a sender the user has already
  // blocked (a rummy app, a "CTC" marketing shortcode) never gets to become
  // a review-inbox item again, let alone a transaction. Parsing runs on the
  // body too, since the same promotional blast is often resent from a
  // different-looking sender.
  if (await db.isBlocked(message.sender, message.body)) return skip('SKIPPED_BLOCKED');

  const parsed = parseMessage(message.body, message.source === 'SMS' ? message.sender : null, {
    source: message.source,
  });
  if (!parsed) {
    return skip('SKIPPED_NO_PARSE', {
      rejectReason: explainRejection(
        message.body,
        message.source === 'SMS' ? message.sender : null,
        {
          source: message.source,
        }
      ),
    });
  }

  const occurredAt = new Date(message.receivedAt || Date.now());
  const dedupKey = buildDedupKey(parsed, occurredAt);

  const merchant =
    parsed.counterparty ?? (message.source === 'NOTIFICATION' ? labelFor(message) : 'Unknown');

  const parsedFields = {
    amount: parsed.amount,
    direction: parsed.direction,
    merchant,
    confidence: parsed.confidence,
  };

  if (await db.isBlocked(merchant)) return skip('SKIPPED_BLOCKED', parsedFields);

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
  const existing = await db.findProbableDuplicate(
    parsed.amount,
    parsed.direction,
    occurredAt.toISOString(),
    undefined,
    { merchant, reference: parsed.reference }
  );
  if (existing) {
    return skip('SKIPPED_DUPLICATE', {
      ...parsedFields,
      rejectReason: `matched transaction #${existing.id}`,
    });
  }

  // Nothing above could confirm this is the same payment, but the shape of
  // it — same amount and direction, seconds apart, reported on a different
  // channel — is the shape of one event seen twice under two different
  // names for the sender. It is also the shape of two people settling a
  // shared bill at the same moment. Neither is safe to assume, so it goes
  // to review as a question instead of being merged or double-counted.
  const unconfirmed = await db.findUnconfirmedDuplicate(
    parsed.amount,
    parsed.direction,
    occurredAt.toISOString(),
    message.source
  );

  // A confident parse is held for confirmation rather than logged outright,
  // when that setting is on. Nothing is lost by waiting — an unanswered one
  // sits in Review exactly like a shaky parse does — but the budget does not
  // move until the payment is confirmed, which is the whole point of asking.
  //
  // Never during a bulk import. Backfilling months of SMS would otherwise
  // demand a hundred confirmations and fire a hundred notifications for
  // payments that happened weeks ago; `silent` is already how the backfill
  // says it is replaying history rather than reporting something new.
  const settings = await getNotificationSettings();
  const holdForConfirmation = settings.confirmBeforeLogging && options.silent !== true;

  // Looks like money going into (or out of) an investment: always asked,
  // never decided. Booking it as a spend would charge the budget for money
  // the user still owns; tagging it silently would be the fabrication
  // Phase 9 refused. Review asks "Investment?" instead — including during a
  // backfill, since the answer changes what the history means.
  const investmentLike = looksLikeInvestment(message.body, merchant);

  if (
    investmentLike ||
    unconfirmed ||
    holdForConfirmation ||
    parsed.confidence < ACCEPT_THRESHOLD
  ) {
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
      possibleDuplicateOf: unconfirmed?.id ?? null,
      suggestedReason: investmentLike ? 'INVESTMENT' : null,
    });
    if (id === null) {
      return skip('SKIPPED_DUPLICATE', {
        ...parsedFields,
        rejectReason: 'already in the review inbox',
      });
    }
    await db.recordParsedEvent({
      rawEventId,
      parserVersion: PARSER_RULES_VERSION,
      outcome: 'QUEUED',
      ...parsedFields,
      captureId: id,
      rejectReason: unconfirmed ? `might duplicate transaction #${unconfirmed.id}` : null,
    });

    // Only worth a buzz when the app could actually act on the answer, and
    // only for one it is otherwise confident about — a shaky parse or a
    // suspected duplicate is a question the Review screen asks properly,
    // with the evidence on screen.
    if (holdForConfirmation && !unconfirmed && parsed.confidence >= ACCEPT_THRESHOLD) {
      await notifyPendingConfirmation(id, parsed.amount, parsed.direction, merchant, settings);
    }
    return 'QUEUED';
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

  if (posted === null) {
    return skip('SKIPPED_ADD_FAILED', parsedFields);
  }

  await db.recordParsedEvent({
    rawEventId,
    parserVersion: PARSER_RULES_VERSION,
    outcome: 'POSTED',
    ...parsedFields,
    transactionId: posted,
  });
  return 'POSTED';
}

/**
 * Asks, on the lock screen, whether a payment the app is otherwise sure
 * about should count.
 *
 * Deliberately outside `planForTransaction`, which plans nudges about
 * spending that has already happened and caps them per day. This is not a
 * nudge — it is the only thing standing between a captured payment and the
 * ledger, so it is never rate-limited and never suppressed by quiet hours;
 * a payment at 2am still has to be answerable in the morning, and the
 * Review queue is where it waits either way.
 */
async function notifyPendingConfirmation(
  captureId: number,
  amount: number,
  direction: 'DEBIT' | 'CREDIT',
  merchant: string,
  settings: NotificationSettings
): Promise<void> {
  if (!settings.enabled) return;
  const sign = direction === 'CREDIT' ? '+' : '−';
  await deliver(
    {
      type: 'TXN_CONFIRM',
      tier: 'PENDING',
      title: TITLES.TXN_CONFIRM,
      body: `${sign}${formatMoney(amount)} · ${merchant}. Confirm to count it.`,
      payload: { captureId },
    },
    settings
  ).catch(() => undefined);
}

/**
 * Asks what a payment was, once it is on the books without a category.
 *
 * Only for spending, and only when nothing worked it out — the rules, the
 * learned classifier and the user's own corrections all had their turn
 * first. An uncategorised row is not wrong, it is just invisible to
 * Insights, and the cheapest moment to fix that is while the user still
 * remembers what they bought.
 */
async function notifyMissingCategory(
  transactionId: number,
  amount: number,
  merchant: string,
  settings: NotificationSettings
): Promise<void> {
  if (!settings.enabled || !settings.categoryPromptsEnabled) return;
  await deliver(
    {
      type: 'CATEGORY_PROMPT',
      tier: 'UNCATEGORISED',
      title: TITLES.CATEGORY_PROMPT,
      body: `${formatMoney(amount)} at ${merchant} has no category. Tap to set one.`,
      payload: { transactionId },
    },
    settings
  ).catch(() => undefined);
}

/**
 * Records a message as a `RawEvent` unconditionally, then runs it through
 * `processMessage`. This is the only place a message enters the pipeline
 * live — every gate downstream can say no, but nothing downstream can make
 * the message itself disappear without a trace.
 */
export async function ingestMessage(
  message: CapturedMessage,
  options: { silent?: boolean } = {}
): Promise<'POSTED' | 'QUEUED' | 'SKIPPED'> {
  // Personal texts are never kept, not even as raw evidence (see smsPrivacy).
  if (message.source === 'SMS' && !isWorthKeeping(message.sender, message.body)) return 'SKIPPED';
  message = { ...message, body: redactOtp(message.body) };
  const rawEventId = await db.recordRawEvent({
    source: message.source,
    sender: message.sender,
    body: message.body,
    receivedAt: new Date(message.receivedAt || Date.now()).toISOString(),
  });
  return processMessage(rawEventId, message, options);
}

/**
 * Re-runs one already-recorded message through the current parser, without
 * creating a second `RawEvent` for it. This is what actually gives
 * `RawEvents` its recovery value, not just its diagnostic one: from Phase 7
 * onward, a message dropped by a parser rule that later gets loosened (or
 * caught by a duplicate match that later gets more precise) can be
 * reprocessed and recovered, instead of being gone the way every dropped
 * message was before this table existed. Never touches `ParsedEvents` rows
 * from earlier attempts — a new attempt is a new row.
 */
export async function reprocessRawEvent(
  rawEventId: number,
  options: { silent?: boolean } = {}
): Promise<'POSTED' | 'QUEUED' | 'SKIPPED' | null> {
  const raw = await db.getRawEventById(rawEventId);
  if (!raw) return null;
  return processMessage(
    rawEventId,
    {
      source: raw.source,
      sender: raw.sender ?? '',
      body: raw.body,
      receivedAt: Date.parse(raw.receivedAt),
    },
    options
  );
}

export interface ReprocessResult {
  checked: number;
  posted: number;
  queued: number;
  stillSkipped: number;
}

/**
 * Sweeps every message that has never once produced a transaction or a
 * review item, and tries again under the current parser. Meant to be run
 * after a parser fix ships — the equivalent, for messages that were
 * dropped outright, of what `revalidateHistory` already does for messages
 * that made it onto the books but were classified wrong.
 */
export async function reprocessUnresolvedRawEvents(limit = 200): Promise<ReprocessResult> {
  const unresolved = await db.getUnresolvedRawEvents(limit);
  const result: ReprocessResult = { checked: 0, posted: 0, queued: 0, stillSkipped: 0 };

  for (const raw of unresolved) {
    result.checked += 1;
    const outcome = await processMessage(
      raw.id,
      {
        source: raw.source,
        sender: raw.sender ?? '',
        body: raw.body,
        receivedAt: Date.parse(raw.receivedAt),
      },
      { silent: true }
    );
    if (outcome === 'POSTED') result.posted += 1;
    else if (outcome === 'QUEUED') result.queued += 1;
    else result.stillSkipped += 1;
  }

  return result;
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
  /** Only with `category`, when the user picked one level deeper. */
  subcategory?: string | null;
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
  /** A manual ledger correction rather than an ordinary purchase/allowance. See TransactionRow.is_adjustment. */
  isAdjustment?: boolean;
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
  // A category handed in was picked by a person. Otherwise the categoriser
  // decides, and says how sure it is — a guess is applied but shown as one.
  const decision =
    input.category == null && input.direction === 'DEBIT'
      ? await db.categoriseTransaction({ merchant: input.merchant, rawText: input.rawText })
      : null;
  const category = input.category ?? decision?.category ?? null;
  const subcategory = input.category ? (input.subcategory ?? null) : (decision?.subcategory ?? null);
  const categorySource = input.category ? 'USER' : (decision?.source ?? null);

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
    subcategory,
    categorySource,
    occurredAt,
    source: input.source ?? 'MANUAL',
    rawText: input.rawText ?? null,
    externalRef: input.externalRef ?? null,
    dedupKey: input.dedupKey ?? null,
    outingId,
    isAdjustment: input.isAdjustment,
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
      input.silent === true,
      occurredAt
    );
  }

  // Money moving rather than being spent — a wallet top-up, a self-transfer,
  // a friend's money sent straight back — used to only get recognised from a
  // Settings button or the next app update's rule-version bump, so it sat
  // wrong in "safe to spend" for however long until then. Checking right
  // here means it is correct within the same session it happened in.
  // Every kind runs through this, not just SPEND: the transfer's credit leg
  // needs the same check as its debit leg, and neither is a SPEND.
  //
  // Settlement is checked before the transfer match, not after: once a
  // credit is confirmed to be closing a debt its kind becomes SETTLE_IN,
  // which the round-trip detector already treats as decided and leaves
  // alone. Checking the other order would let a payment that settles a
  // real, tracked debt get mistaken for an untracked wash instead.
  try {
    await classifyNewTransaction(transactionId);
    await checkForSettlement(transactionId);
    await checkForTransferMatch(transactionId);
  } catch {
    // Never lets a classification hiccup block a transaction that already
    // wrote successfully — the next full sweep still catches it later.
  }

  return transactionId;
}

// ---------------------------------------------------------------------------
// Manual transfer — Phase 2.
// ---------------------------------------------------------------------------

export interface PostTransferInput {
  amount: number;
  /** Free-text account label money left, e.g. "HDFC Savings". */
  fromLabel: string;
  /** Free-text account label money arrived in, e.g. "SBI FD". */
  toLabel: string;
  occurredAt?: string;
  note?: string | null;
}

/**
 * Records money moved between the user's own accounts as one action.
 *
 * Deliberately does not go through `postTransaction`: that pipeline runs
 * categorisation, round-up savings, and a spend/income notification, none of
 * which make sense for a transfer (there is nothing to categorise about
 * "HDFC Savings", and a self-transfer earning a "you spent ₹1,000" nudge or
 * silently feeding a round-up goal would both be wrong). Two ordinary rows
 * are written directly and linked with the same `markTransferPair` an
 * auto-detected transfer uses, so every spend/income/category/insights query
 * — which already filters `transfer_pair_id IS NULL` — excludes both legs
 * exactly as it would for one the parser found on its own.
 */
export async function postTransfer(
  input: PostTransferInput
): Promise<{ debitId: number; creditId: number }> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  const debitId = await db.addTransaction({
    amount: input.amount,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: input.toLabel.trim(),
    occurredAt,
    source: 'MANUAL',
    note: input.note ?? null,
  });
  const creditId = await db.addTransaction({
    amount: input.amount,
    direction: 'CREDIT',
    kind: 'INCOME',
    merchant: input.fromLabel.trim(),
    occurredAt,
    source: 'MANUAL',
    note: input.note ?? null,
  });

  await db.markTransferPair(debitId, creditId);
  return { debitId, creditId };
}

// ---------------------------------------------------------------------------
// Manual loan — Phase 2.
// ---------------------------------------------------------------------------

export interface PostLoanInput {
  amount: number;
  /** LENT: you lent it, they owe you. BORROWED: you borrowed it, you owe them. */
  direction: 'LENT' | 'BORROWED';
  counterpartyName: string;
  counterpartyPhone?: string | null;
  reason?: string | null;
  occurredAt?: string;
}

/**
 * Creates a loan as one guided step: the transaction, then the debt against
 * it. The same two calls `MarkAsLoanSheet` makes on a row that already
 * exists — lending is still ordinary cash leaving the account and borrowing
 * is still cash arriving, so both go through `postTransaction` for the same
 * categorisation/notification treatment any other expense or income gets,
 * and the resulting IOU is what keeps it from counting as a full personal
 * expense or windfall income (see `expectedRecovery`/`openPayables` in
 * `math/budget.ts`).
 */
export async function postLoan(
  input: PostLoanInput
): Promise<{ transactionId: number; iouId: number } | null> {
  const lending = input.direction === 'LENT';
  const transactionId = await postTransaction({
    amount: input.amount,
    direction: lending ? 'DEBIT' : 'CREDIT',
    merchant: input.counterpartyName.trim(),
    occurredAt: input.occurredAt,
  });
  if (transactionId === null) return null;

  const contactId = await db.findOrCreateContact({
    name: input.counterpartyName.trim(),
    phone: input.counterpartyPhone,
  });
  const iouId = await db.createIOU({
    contactId,
    amount: input.amount,
    direction: lending ? 'THEY_OWE_ME' : 'I_OWE_THEM',
    transactionId,
    reason: input.reason?.trim() || input.counterpartyName.trim(),
  });

  return { transactionId, iouId };
}

// ---------------------------------------------------------------------------
// Manual investment contribution/withdrawal — Phase 9.
//
// No dedicated Investments screen or tab: PRODUCT_SPEC.md §2 fixes exactly
// five bottom-navigation destinations (Today/Outings/Savings/Split/Insights)
// and names none of them Investments, while §14's required-documents list
// still asks for a PHASE_9_INVESTMENTS.md. Followed the higher document —
// "Investment contribution" (§1.3's own transaction-type list) is a
// recognised transaction concept, not a sixth screen. See
// docs/phases/PHASE_9_INVESTMENTS.md for the conflict as reported.
// ---------------------------------------------------------------------------

export interface PostInvestmentInput {
  amount: number;
  /** CONTRIBUTION: money left the bank for the investment. WITHDRAWAL: it came back. */
  direction: 'CONTRIBUTION' | 'WITHDRAWAL';
  /** The platform/fund/broker — "Zerodha", "Groww SIP", "PPF". */
  label: string;
  occurredAt?: string;
  /** Which holding it went into or came out of (v16). Null/absent = unassigned. */
  holdingId?: number | null;
  /** Evidence carried over when this came from a captured message. */
  source?: 'MANUAL' | 'SMS' | 'NOTIFICATION';
  rawText?: string | null;
  dedupKey?: string | null;
}

/**
 * Records money moving into or out of an investment, tagged
 * `non_spend_reason: 'INVESTMENT'` on whichever direction applies so it
 * never counts as spending (a contribution) or income (a withdrawal) — see
 * `math/classification.ts`.
 *
 * Deliberately bypasses `postTransaction`: that pipeline's `SPEND` path runs
 * round-up saving and a spend notification, and its categoriser would try
 * to guess a spend category for "Zerodha" — none of which make sense for
 * money moving into a fund the app cannot see the value of, same reasoning
 * `postTransfer` already bypasses it for a self-transfer's two legs.
 */
export async function postInvestment(input: PostInvestmentInput): Promise<number> {
  const contribution = input.direction === 'CONTRIBUTION';
  const transactionId = await db.addTransaction({
    amount: input.amount,
    direction: contribution ? 'DEBIT' : 'CREDIT',
    kind: contribution ? 'SPEND' : 'INCOME',
    merchant: input.label.trim(),
    occurredAt: input.occurredAt,
    source: input.source ?? 'MANUAL',
    rawText: input.rawText ?? null,
    dedupKey: input.dedupKey ?? null,
  });
  await db.setNonSpendReason(transactionId, 'INVESTMENT');
  if (input.holdingId) await db.setTransactionHolding(transactionId, input.holdingId);
  return transactionId;
}

/**
 * Review's "Yes, invested": books a captured message as money into (a debit)
 * or out of (a credit) an investment, keeping the message as evidence.
 */
export async function acceptCaptureAsInvestment(
  captureId: number,
  holdingId: number | null
): Promise<number | null> {
  const capture = await db.getCaptureById(captureId);
  if (!capture || capture.status !== 'PENDING') return null;

  const transactionId = await postInvestment({
    amount: capture.parsed_amount ?? 0,
    direction: capture.parsed_direction === 'CREDIT' ? 'WITHDRAWAL' : 'CONTRIBUTION',
    label: capture.parsed_merchant ?? 'Investment',
    occurredAt: capture.received_at,
    holdingId,
    source: capture.source,
    rawText: capture.raw_text,
    dedupKey: capture.dedup_key,
  });
  await db.setCaptureStatus(captureId, 'ACCEPTED', transactionId);
  return transactionId;
}

/** Round-up saving plus the notification pass. Failures here never block the write. */
async function runSpendSideEffects(
  transactionId: number,
  amount: number,
  merchant: string,
  category: string | null,
  outingId: number | null,
  silent: boolean,
  occurredAt: string
): Promise<void> {
  const goalsCrossed: Array<{ name: string; emoji: string; percent: number; remaining: number }> =
    [];

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

    // Asked before the spending nudges below, and independently of them: an
    // uncategorised row is not a spending problem, it is a gap in what
    // Insights can say later, and the cheapest moment to close it is while
    // the user still remembers what they bought. Re-read rather than
    // trusting the category passed in, because classifyNewTransaction runs
    // between the insert and here and may well have worked one out.
    const stored = await db.getTransactionById(transactionId);
    if (stored && stored.kind === 'SPEND' && stored.category === null) {
      await notifyMissingCategory(transactionId, amount, merchant, settings);
    }

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

    // Interventions (0.9.19): recovery, caps, callouts. A recovery that
    // starts with this spend rides on the overspend line instead of
    // buzzing a second time.
    const extra = await planTransactionInterventions({
      transactionId,
      amount,
      merchant,
      category,
      occurredAt: new Date(occurredAt),
      snapshot,
      settings,
    });
    if (extra.overspendSuffix) {
      const over = planned.find((p) => p.type === 'OVERSPEND');
      if (over) over.body = `${over.body}. ${extra.overspendSuffix}`;
      else
        extra.planned.unshift({
          type: 'RECOVERY',
          tier: 'RECOVERY_START',
          title: TITLES.RECOVERY,
          body: extra.overspendSuffix,
          payload: { transactionId },
        });
    }

    // The engine already kept its own list out of quiet hours; these too.
    const interventions = isQuietHour(new Date(), settings) ? [] : extra.planned;
    await deliverAll([...planned, ...interventions], settings);
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
 * Discards a capture the user has confirmed is a payment already recorded,
 * and — the point of asking — remembers why, so the same pair of names never
 * has to be asked about again.
 *
 * What the answer actually tells the app is that two names are one person:
 * the one this message used, and the one on the transaction it repeats. That
 * is recorded against a contact, which makes it useful twice over — the
 * duplicate matcher stops asking (`sameKnownPerson`), and settlement
 * matching starts finding this person's repayments whichever name the
 * reporting channel happens to use (`findContactIdByNameOrAlias`).
 *
 * Only for credits. Money arriving is a person paying, and a person is what
 * a contact represents. A debit duplicate is two reports of paying a shop,
 * and inventing a contact for a shop would put junk in the list of people
 * the user actually owes and is owed by, to learn something nothing else
 * reads.
 */
export async function confirmCaptureIsDuplicate(captureId: number): Promise<void> {
  const capture = await db.getCaptureById(captureId);
  if (!capture || capture.status !== 'PENDING') return;

  const twinId = capture.possible_duplicate_of;
  const alias = capture.parsed_merchant?.trim();

  if (twinId !== null && alias) {
    const twin = await db.getTransactionById(twinId);
    if (twin && twin.direction === 'CREDIT' && capture.parsed_direction === 'CREDIT') {
      const contactId = await db.findOrCreateContact({ name: twin.merchant });
      await db.addContactAlias(contactId, alias);
    }
  }

  await db.rejectCapture(captureId);
}
