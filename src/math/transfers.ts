/**
 * Detects money you moved between your own accounts.
 *
 * A self-transfer leaves one account and arrives in another, so a naive
 * ledger counts the outgoing leg as spending and the incoming leg as income.
 * Both are wrong, and the error is large: moving 10,000 to a savings account
 * reads as a 10,000 shopping trip funded by a 10,000 windfall.
 *
 * The hard part is that a friend repaying you looks almost identical — a
 * debit followed by a matching credit. Getting that wrong is worse than
 * missing a transfer, because it silently erases a real expense the user did
 * bear. So the scoring below is deliberately asymmetric: evidence that this
 * is a *person* paying you counts against a match far more strongly than
 * timing evidence counts for it, and anything short of confident is left
 * alone rather than guessed at.
 */

export interface TransferSide {
  id: number;
  amount: number;
  direction: 'DEBIT' | 'CREDIT';
  kind: string;
  merchant: string;
  occurredAt: string;
  rawText?: string | null;
  /** Last digits of the account the message named, when it named one. */
  accountHint?: string | null;
  /** True when this row is already tied to a debt with a person. */
  linkedToPerson?: boolean;
}

export interface TransferPair {
  debit: TransferSide;
  credit: TransferSide;
  confidence: number;
  reasons: string[];
}

/** At or above this, a pair is marked automatically. */
export const TRANSFER_AUTO_THRESHOLD = 0.8;

/** Beyond this gap, two legs are not the same movement of money. */
const MAX_GAP_MS = 24 * 60 * 60 * 1000;

/** Phrases banks use when the money is going to you. */
const SELF_MARKERS =
  /\b(?:self[\s-]?transfer|own\s+a\/c|own\s+account|to\s+your\s+own|self\b|transfer\s+to\s+self)\b/i;

/** Phrases that mean a transfer happened, without saying to whom. */
const TRANSFER_MARKERS = /\b(?:imps|neft|rtgs|transfer(?:red)?|moved)\b/i;

function gapMs(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b));
}

function textOf(side: TransferSide): string {
  return `${side.rawText ?? ''} ${side.merchant ?? ''}`;
}

/**
 * A merchant string that looks like a person's name rather than a business.
 *
 * Crude on purpose: two or three capitalised words with no company suffix.
 * It only ever *reduces* confidence, so a false positive here costs a missed
 * transfer, never a wrongly erased expense.
 */
function looksLikePerson(name: string): boolean {
  const trimmed = name.trim();
  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(trimmed)) return false;
  return !/\b(?:ltd|limited|pvt|inc|llp|store|mart|cafe|foods|services|technologies)\b/i.test(
    trimmed
  );
}

/** Scores one candidate pairing. */
export function scoreTransfer(debit: TransferSide, credit: TransferSide): TransferPair | null {
  if (debit.direction !== 'DEBIT' || credit.direction !== 'CREDIT') return null;
  if (Math.abs(debit.amount - credit.amount) > 0.01) return null;

  const gap = gapMs(debit.occurredAt, credit.occurredAt);
  if (gap > MAX_GAP_MS) return null;

  // The credit must actually follow the debit. A credit that arrived first is
  // a different event that happens to match in size.
  if (Date.parse(credit.occurredAt) < Date.parse(debit.occurredAt)) return null;

  const reasons: string[] = [];
  let confidence = 0.35;
  reasons.push('same amount, within a day');

  if (gap <= 5 * 60 * 1000) {
    confidence += 0.25;
    reasons.push('minutes apart');
  } else if (gap <= 60 * 60 * 1000) {
    confidence += 0.12;
    reasons.push('within the hour');
  }

  const combined = `${textOf(debit)} ${textOf(credit)}`;
  if (SELF_MARKERS.test(combined)) {
    confidence += 0.3;
    reasons.push('message says it went to your own account');
  } else if (TRANSFER_MARKERS.test(combined)) {
    confidence += 0.12;
    reasons.push('looks like a bank transfer');
  }

  // Two different accounts named is the shape of a transfer. The same account
  // twice is a refund or a reversal, not a move between accounts.
  if (debit.accountHint && credit.accountHint) {
    if (debit.accountHint !== credit.accountHint) {
      confidence += 0.2;
      reasons.push('different accounts named');
    } else {
      confidence -= 0.35;
      reasons.push('same account both sides — more likely a refund');
    }
  }

  // --- Evidence against, weighted heavily ------------------------------
  if (credit.kind === 'SETTLE_IN' || debit.linkedToPerson || credit.linkedToPerson) {
    confidence -= 0.6;
    reasons.push('already tied to a person');
  }

  if (looksLikePerson(credit.merchant)) {
    confidence -= 0.4;
    reasons.push('the credit came from what looks like a person');
  }

  return {
    debit,
    credit,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    reasons,
  };
}

/**
 * Pairs debits with credits across a set of transactions.
 *
 * Greedy by confidence, and each transaction can belong to at most one pair —
 * three 500 payments in an afternoon must not all claim the same 500 credit.
 */
export function detectTransfers(
  transactions: TransferSide[],
  threshold = TRANSFER_AUTO_THRESHOLD
): TransferPair[] {
  const debits = transactions.filter((t) => t.direction === 'DEBIT');
  const credits = transactions.filter((t) => t.direction === 'CREDIT');

  const candidates: TransferPair[] = [];
  for (const debit of debits) {
    for (const credit of credits) {
      const scored = scoreTransfer(debit, credit);
      if (scored && scored.confidence >= threshold) candidates.push(scored);
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const claimed = new Set<number>();
  const pairs: TransferPair[] = [];
  for (const candidate of candidates) {
    if (claimed.has(candidate.debit.id) || claimed.has(candidate.credit.id)) continue;
    claimed.add(candidate.debit.id);
    claimed.add(candidate.credit.id);
    pairs.push(candidate);
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Round trips: money sent to a person and returned by that same person.
// ---------------------------------------------------------------------------

/**
 * Normalises a counterparty for comparison.
 *
 * Bank messages name the same person differently on the way out and the way
 * back — "RAHUL KUMAR" against "Rahul", a VPA against a display name — so a
 * literal string match finds almost nothing.
 */
function normaliseName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/@[a-z0-9.\-]+$/, '') // strip the VPA handle
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/** True when two counterparties are plausibly the same person. */
export function sameCounterparty(a: string, b: string): boolean {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (left.length === 0 || right.length === 0) return false;

  // Any shared name token is enough: "Rahul Kumar" and "Rahul" are the same
  // person, and two different friends sharing a first name *and* an exact
  // amount within minutes is a coincidence worth accepting.
  return left.some((token) => right.includes(token));
}

/** How long after sending money a return still counts as the same event. */
export const ROUND_TRIP_WINDOW_MS = 60 * 60 * 1000;

/**
 * Finds money sent to someone and returned by that same someone.
 *
 * This is the case the self-transfer detector deliberately refuses: it treats
 * a credit from a person as evidence *against* a transfer, so that a friend
 * paying their share of dinner is never mistaken for moving your own money.
 *
 * But the discriminator is right there in the counterparty. A bill split has
 * a merchant on the way out and a person on the way back — you paid the
 * restaurant, Rahul paid you. A bounced payment has the same person on both
 * legs. When the name matches on both sides, the amount is identical, and it
 * came back within the hour, nothing was bought and nothing was owed.
 */
export function detectRoundTrips(
  transactions: TransferSide[],
  windowMs = ROUND_TRIP_WINDOW_MS
): TransferPair[] {
  const debits = transactions.filter((t) => t.direction === 'DEBIT');
  const credits = transactions.filter((t) => t.direction === 'CREDIT');

  const candidates: TransferPair[] = [];

  for (const debit of debits) {
    for (const credit of credits) {
      if (Math.abs(debit.amount - credit.amount) > 0.01) continue;

      const gap = Date.parse(credit.occurredAt) - Date.parse(debit.occurredAt);
      if (gap < 0 || gap > windowMs) continue;
      if (!sameCounterparty(debit.merchant, credit.merchant)) continue;

      // A leg already settled against a debt is a repayment being recorded
      // properly; cancelling it would erase the debt it just cleared.
      if (debit.linkedToPerson || credit.linkedToPerson) continue;
      if (credit.kind === 'SETTLE_IN' || debit.kind === 'SETTLE_OUT') continue;

      const minutes = gap / 60000;
      candidates.push({
        debit,
        credit,
        confidence: minutes <= 10 ? 0.95 : 0.85,
        reasons: [
          `same person both ways (${debit.merchant})`,
          minutes < 1 ? 'returned immediately' : `returned after ${Math.round(minutes)} min`,
        ],
      });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const claimed = new Set<number>();
  const pairs: TransferPair[] = [];
  for (const candidate of candidates) {
    if (claimed.has(candidate.debit.id) || claimed.has(candidate.credit.id)) continue;
    claimed.add(candidate.debit.id);
    claimed.add(candidate.credit.id);
    pairs.push(candidate);
  }

  return pairs;
}
