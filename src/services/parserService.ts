export type ParsedDirection = 'DEBIT' | 'CREDIT';

export interface ParsedMessage {
  amount: number;
  direction: ParsedDirection;
  /** Merchant for a debit, sender for a credit. */
  counterparty: string | null;
  /** Bank/UPI reference number when present — the best dedup key available. */
  reference: string | null;
  /** Last digits of the account or card, when the message names them. */
  accountHint: string | null;
  /** 0..1. Below ACCEPT_THRESHOLD the parse goes to the review inbox. */
  confidence: number;
}

/**
 * A parse at or above this is trustworthy enough to post automatically;
 * anything less waits for the user in the capture inbox. Set deliberately
 * high — a wrong auto-logged transaction is far more damaging to trust than
 * an extra tap.
 */
export const ACCEPT_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Rejection: messages that mention money but are not a transaction.
//
// Checked first and hard-stopped, because several of these (notably "will be
// debited" reminders and failed-payment notices) otherwise parse perfectly and
// would silently invent spending that never happened.
// ---------------------------------------------------------------------------
const REJECT_PATTERNS: RegExp[] = [
  // -- Not a payment at all ------------------------------------------------
  /\botp\b/i,
  /one[\s-]?time\s+password/i,
  /\bdo not share\b/i,
  /\bwill be (?:debited|deducted|charged)\b/i,
  /\bis due\b/i,
  /\bdue on\b/i,
  /\bhas (?:failed|been declined)\b/i,
  /\b(?:failed|declined|unsuccessful|reversed|cancelled)\b/i,
  /\brequest(?:ed|ing)? (?:money|payment)\b/i,
  /\bcollect request\b/i,
  /\bavailable balance\b/i,
  /\bavl(?:\.| )?bal\b/i,
  /\bbalance (?:is|:)/i,
  /\bmin(?:imum)? (?:amount )?due\b/i,
  /\bstatement\b/i,
  /\bemi\s+(?:of|due|starts)\b/i,

  // -- Promotional: vouchers, coupons, cashback bait ------------------------
  // These quote a rupee amount in a sentence shaped almost exactly like a
  // real debit alert, so they parse cleanly and become invented spending.
  /\boffer\b/i,
  /\bvoucher\b/i,
  /\bcoupon\b/i,
  /\bpromo\s*code\b/i,
  /\bgift\s*(?:card|voucher)\b/i,
  /\bcashback\b/i,
  /\breward\s*points?\b/i,
  /\bscratch\s*card\b/i,
  /\bflat\s+\d+%/i,
  /\bupto\s+\d+%/i,
  /\bup\s+to\s+(?:rs\.?|inr|₹)/i,
  /\bsave\s+(?:rs\.?|inr|₹)/i,
  /\bdiscount\b/i,
  /\bsale\s+(?:is|ends|starts|live)\b/i,
  /\blimited\s+(?:time|period|offer)\b/i,
  /\bhurry\b/i,
  /\bdeal\b/i,
  /\bfree\b/i,

  // -- Gambling and "win money" spam ---------------------------------------
  // Rummy, fantasy cricket and betting apps are relentless SMS advertisers in
  // India and every message is built around a rupee figure.
  /\bwin\b/i,
  /\bwon\b/i,
  /\bjackpot\b/i,
  /\blottery\b/i,
  /\blucky\s+draw\b/i,
  /\brummy\b/i,
  /\bteen\s*patti\b/i,
  /\bpoker\b/i,
  /\bcasino\b/i,
  /\bbetting\b/i,
  /\bfantasy\b/i,
  /\bdream\s*11\b/i,
  /\bplay\s+(?:now|and\s+win)\b/i,
  /\bbonus\b/i,
  /\bdeposit\s+(?:now|and)\b/i,

  // -- App-install / referral marketing ------------------------------------
  /\bapply now\b/i,
  /\bclick\b/i,
  /\bdownload\b/i,
  /\binstall\b/i,
  /\bregister\s+now\b/i,
  /\bjoin\s+now\b/i,
  /\bsign\s*up\b/i,
  /\brefer(?:ral)?\b/i,
  /\binvite\b/i,
  /\bearn\s+(?:up\s*to|upto|rs\.?|inr|₹)/i,
  /\bloan\b/i,
  /\bcredit\s+limit\b/i,
  /\bpre[\s-]?approved\b/i,
  /\beligible for\b/i,

  // -- Structural tells of bulk marketing ----------------------------------
  // A bank's transaction alert never carries a link, an unsubscribe line or a
  // terms-and-conditions notice. Any of these is close to proof.
  /https?:\/\//i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  /\b(?:bit\.ly|tinyurl|cutt\.ly|rb\.gy|t\.co)\b/i,
  /\bt\s*&\s*c\b/i,
  /\bterms\s+(?:and|&)\s+conditions\b/i,
  /\bunsubscribe\b/i,
  /\bto\s+opt[\s-]?out\b/i,
  /\breply\s+stop\b/i,
  /\bcall\s+(?:us|now)\b/i,
  /\btoll[\s-]?free\b/i,
];

/** Sender IDs are shaped like VM-HDFCBK, AD-ICICIB, JD-SBIINB. */
const BANK_SENDER = /^[A-Z]{2}-?([A-Z]{4,8})(?:-?[A-Z])?$/i;
const KNOWN_BANK_TOKENS = [
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'YESBNK', 'IDFC', 'INDUS', 'PNB', 'BOB',
  'CANARA', 'UNION', 'FEDERAL', 'RBL', 'AUBANK', 'BANDHN', 'CITI', 'HSBC', 'SCB',
  'PAYTM', 'PHONPE', 'GPAY', 'AMZNPY', 'MOBIKW', 'FREECH', 'SLICE', 'JUPITR', 'FAMPAY',
];

const AMOUNT = String.raw`(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)`;
const AMOUNT_TRAILING = String.raw`([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)`;

const DEBIT_VERBS =
  /\b(?:debited|spent|paid|withdrawn|deducted|purchase|txn of|sent to|transferred to)\b/i;
const CREDIT_VERBS = /\b(?:credited|received|added|refunded|deposited)\b/i;

// ---------------------------------------------------------------------------
// Merchant extraction. Tried in order; the first hit wins, and earlier
// patterns are the more specific ones.
// ---------------------------------------------------------------------------
// Must start with a letter, so a date ("at 08-09-26") can never be captured
// as a merchant name.
const NAME = String.raw`[A-Za-z][A-Za-z0-9 &'.\-_@]{1,48}?`;
const STOP = String.raw`(?=\s+(?:on|via|using|ref|upi|txn|dated|at\s+\d)\b|[.,;!]|$)`;

// Order matters: the first match wins, so the most specific phrasings come
// first and the greedy catch-alls come last.
const MERCHANT_PATTERNS: RegExp[] = [
  // "...spent at OLIVE CAFE on 08-09-26"
  new RegExp(String.raw`\bspent\s+at\s+(${NAME})${STOP}`, 'i'),
  // "...debited ... to VPA merchant@ybl"
  new RegExp(String.raw`\bto\s+VPA\s+(${NAME})${STOP}`, 'i'),
  // "...; OLIVE CAFE credited"
  new RegExp(String.raw`;\s*(${NAME})\s+credited`, 'i'),
  // "paid to Olive Cafe" / "sent to Rahul"
  new RegExp(String.raw`\b(?:paid|sent|transferred)\s+to\s+(${NAME})${STOP}`, 'i'),
  // "UPI/P2M/123456789/OLIVE CAFE"
  new RegExp(String.raw`UPI\/(?:P2M|P2A)\/\d+\/(${NAME})${STOP}`, 'i'),
  // "at OLIVE CAFE". Deliberately ahead of the "spent on" branch: HDFC writes
  // "spent on <card> at <merchant>", where "spent on" would otherwise capture
  // the card description instead of the merchant.
  new RegExp(String.raw`\bat\s+(${NAME})${STOP}`, 'i'),
  // "spent on Amazon Pay" — only reached when there is no "at ..." clause.
  new RegExp(String.raw`\bspent\s+on\s+(${NAME})${STOP}`, 'i'),
  // "from RAHUL" (credits)
  new RegExp(String.raw`\bfrom\s+(${NAME})${STOP}`, 'i'),
  // "by RAHUL"
  new RegExp(String.raw`\bby\s+(${NAME})${STOP}`, 'i'),
];

const REFERENCE_PATTERNS: RegExp[] = [
  /\b(?:UPI|Ref(?:erence)?(?:\s*No\.?)?|RRN|Txn(?:\s*ID)?)[:\s#-]*([A-Z0-9]{6,25})\b/i,
  /\bUPI\/(?:P2M|P2A)\/(\d{6,20})\b/i,
  /\b(\d{12})\b/, // bare UPI RRN
];

/**
 * References to *your* account or card.
 *
 * This is the single most useful signal in the whole parser. A bank telling
 * you money moved always says which account it moved from — "A/c XX1234",
 * "Card ending 5678". A voucher blast never does, because it is not about an
 * account at all. Requiring one is a structural test rather than a keyword
 * guess, which is why it holds up against spam nobody has seen yet.
 */
const ACCOUNT_PATTERNS: RegExp[] = [
  // A/c XX1234, account no. xxxx1234, card no *1234
  /\b(?:a\/c|a\/c no|ac|acct|account|card)\s*(?:no\.?|number)?\s*[Xx*]+\s*(\d{3,6})\b/i,
  // Card ending 1234 / ending with 1234
  /\b(?:ending|endg)\s*(?:with|in)?\s*(\d{3,6})\b/i,
  // A/c 1234, linked to 1234 — digits directly after an account word
  /\b(?:a\/c|acct|account)\s*(?:no\.?|number)?\s*(\d{4,6})\b/i,
  // Bare masked number: XXXX1234, ****1234
  /\b[Xx*]{2,}\s?(\d{3,6})\b/,
];

// Noise that survives merchant capture and should be trimmed off the end.
const MERCHANT_NOISE = /\b(?:on|via|using|ref|refno|upi|txn|dated|a\/c|acct|account)\b.*$/i;

function parseAmount(raw: string): number | null {
  const value = parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function cleanName(raw: string): string {
  return (
    raw
      .replace(MERCHANT_NOISE, '')
      // A VPA ("zomato@ybl", "9876543210@paytm") names the payee before the
      // handle; the bank suffix is routing detail, not a merchant.
      .replace(/@[A-Za-z0-9.\-]+$/, '')
      .replace(/[^A-Za-z0-9 &'.\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Titleises a single-case merchant name — banks shout ("OLIVE CAFE") and VPAs
 * whisper ("zomato@ybl"). A name that already mixes cases was written that way
 * on purpose ("McDonald's", "BookMyShow") and is left alone.
 */
function prettify(name: string): string {
  const isSingleCase = name === name.toUpperCase() || name === name.toLowerCase();
  if (!isSingleCase) return name;

  return name
    .toLowerCase()
    .split(' ')
    .map((word) => (word.length > 1 ? word[0].toUpperCase() + word.slice(1) : word.toUpperCase()))
    .join(' ');
}

function extractFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function isLikelyBankSender(sender: string | null | undefined): boolean {
  if (!sender) return false;
  const upper = sender.toUpperCase();
  const match = upper.match(BANK_SENDER);
  const token = match?.[1] ?? upper;
  return KNOWN_BANK_TOKENS.some((known) => token.includes(known) || upper.includes(known));
}

export function isRejected(text: string): boolean {
  return REJECT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Parses a bank SMS or payment-app notification into a transaction.
 *
 * Returns null when the message is not a transaction at all. A low-confidence
 * result is still returned — the caller decides whether to post it or route it
 * to the review inbox — so that an unfamiliar bank format shows up as
 * something the user can confirm rather than vanishing silently.
 */
export interface ParseOptions {
  /**
   * Where the message came from. SMS is held to the stricter standard: it
   * must name an account or card, because anyone can send an SMS. A
   * notification has already been filtered by package — it came from GPay or
   * a bank's own app — so the sender is trustworthy even when the wording is
   * casual and names no account.
   */
  source?: 'SMS' | 'NOTIFICATION';
}

export function parseMessage(
  text: string,
  sender?: string | null,
  options: ParseOptions = {}
): ParsedMessage | null {
  if (!text || text.trim().length < 6) return null;
  if (isRejected(text)) return null;

  const amountRaw =
    text.match(new RegExp(AMOUNT, 'i'))?.[1] ?? text.match(new RegExp(AMOUNT_TRAILING, 'i'))?.[1];
  const amount = amountRaw ? parseAmount(amountRaw) : null;
  if (amount === null) return null;

  const isDebit = DEBIT_VERBS.test(text);
  const isCredit = CREDIT_VERBS.test(text);
  if (!isDebit && !isCredit) return null;

  // "debited ... ; MERCHANT credited" names both verbs. The account is the
  // subject of the sentence, so a debit reading wins.
  const direction: ParsedDirection = isDebit ? 'DEBIT' : 'CREDIT';

  const rawName = extractFirst(text, MERCHANT_PATTERNS);
  const counterparty = rawName ? prettify(cleanName(rawName)) : null;
  const reference = extractFirst(text, REFERENCE_PATTERNS);
  const accountHint = extractFirst(text, ACCOUNT_PATTERNS);

  // The structural gate. An SMS that quotes an amount and a verb but never
  // says which account it came out of is describing someone else's money —
  // an offer, a reward, a game's balance. Rejected outright rather than sent
  // to review, because a review inbox full of coupons is its own kind of
  // broken. Notifications skip this: their package allowlist already did the
  // equivalent job.
  if (options.source !== 'NOTIFICATION' && !accountHint) return null;

  // Confidence is additive over independent corroborating signals.
  let confidence = 0.3;
  if (isDebit !== isCredit) confidence += 0.2; // unambiguous direction
  if (counterparty && counterparty.length >= 3) confidence += 0.2;
  if (reference) confidence += 0.15;
  if (accountHint) confidence += 0.2;
  if (isLikelyBankSender(sender)) confidence += 0.15;
  if (/₹|rs\.?|inr/i.test(text)) confidence += 0.05;

  return {
    amount,
    direction,
    counterparty: counterparty || null,
    reference,
    accountHint,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
  };
}

/**
 * Stable identity for a payment, so the same event arriving over SMS and the
 * notification listener collapses to one transaction.
 *
 * A bank reference number is globally unique and used verbatim when present.
 * Without one, the key falls back to amount plus a coarse time bucket —
 * deliberately not including the merchant, because SMS and notifications word
 * the same merchant differently ("OLIVE CAFE" vs "Olive Cafe UPI").
 */
export function buildDedupKey(
  parsed: Pick<ParsedMessage, 'amount' | 'reference' | 'direction'>,
  occurredAt: Date = new Date(),
  bucketSeconds = 120
): string {
  if (parsed.reference) return `ref:${parsed.reference.toUpperCase()}`;
  const bucket = Math.floor(occurredAt.getTime() / (bucketSeconds * 1000));
  return `amt:${parsed.direction}:${parsed.amount.toFixed(2)}:${bucket}`;
}

// ---------------------------------------------------------------------------
// Backwards-compatible helpers used by the existing parser tests.
// ---------------------------------------------------------------------------

export interface ParsedDebit {
  amount: number;
  merchant: string;
}

export interface ParsedCredit {
  amount: number;
  sender: string;
}

export function parseDebitSms(sms: string): ParsedDebit | null {
  const parsed = parseMessage(sms);
  if (!parsed || parsed.direction !== 'DEBIT' || !parsed.counterparty) return null;
  return { amount: parsed.amount, merchant: parsed.counterparty };
}

export function parseCreditSms(sms: string): ParsedCredit | null {
  const parsed = parseMessage(sms);
  if (!parsed || parsed.direction !== 'CREDIT' || !parsed.counterparty) return null;
  return { amount: parsed.amount, sender: parsed.counterparty };
}
