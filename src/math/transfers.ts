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
