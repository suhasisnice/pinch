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
  /**
   * Money coming back rather than arriving: a reversed payment, a cancelled
   * order, a merchant refund. Booked against spending instead of as income,
   * because it undoes a purchase rather than funding a new one.
   */
  isRefund: boolean;
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
// Two tiers. HARD patterns describe something that is never a completed
// payment whatever else the message says — an OTP, a future-tense reminder, a
// failed attempt — so they stop a message outright. SOFT patterns are
// marketing smells, and only apply when the message names no account or card.
// A promotional blast never names one (the same reasoning as the structural
// gate in parseMessage), so a message that does has already proved it is
// about real money, and a stray "click here to report" or "bonus credited"
// in it is incidental wording, not a sign of spam. Treating every smell as
// fatal is what once discarded every SBI Card purchase over a dispute link.
// ---------------------------------------------------------------------------
const HARD_REJECT_PATTERNS: RegExp[] = [
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
  /\bmin(?:imum)? (?:amount )?due\b/i,
  /\bstatement\b/i,
  // "EMI of Rs.2,450 debited" is a completed payment; only the reminder
  // wordings are rejected.
  /\bemi\s+(?:is\s+)?(?:due|starts)\b/i,

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
  /\bdeposit\s+(?:now|and)\b/i,

  // -- Structural tells of bulk marketing ----------------------------------
  // Only the link-shortener check stays HARD: a bank never needs bit.ly for
  // its own site, so this one holds "whatever else the message says," same
  // as every other pattern in this list. Everything else that used to live
  // here — unsubscribe, T&C, opt-out, reply-stop, "call us"/toll-free — is
  // SOFT-only below. A real transactional SMS routinely ends with a
  // customer-care line or a "T&C apply" footer (a fraud-report footer like
  // "Trxn. not done by you? Report at https://sbicard.com/Dispute", or a
  // card alert's own toll-free number), so treating those as fatal
  // regardless of context was silently dropping genuine, account-naming
  // payments — the same class of bug the SOFT list's own comment describes
  // fixing for bare links, just missed for these.
  /\b(?:bit\.ly|tinyurl|cutt\.ly|rb\.gy|t\.co)\b/i,
];

const SOFT_REJECT_PATTERNS: RegExp[] = [
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
  // Soft rather than grouped with the gambling words: "Diwali bonus of
  // Rs.5,000 credited to A/c XX1234" is real income.
  /\bbonus\b/i,

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
  // An unsubscribe line or a terms-and-conditions notice is close to proof
  // of marketing when nothing else in the message names an account — but a
  // real card alert routinely ends with a customer-care line, a toll-free
  // number, or a "T&C apply" footer, so these are fatal only in the
  // account-naming exception's absence, not unconditionally. (Bare links
  // used to be rejected outright by a blanket https?:// check — every SBI
  // Card purchase, silently discarded before the amount was ever read — and
  // link-shortener domains specifically are still reliable enough to live in
  // HARD_REJECT_PATTERNS instead, above.)
  /\bt\s*&\s*c\b/i,
  /\bterms\s+(?:and|&)\s+conditions\b/i,
  /\bunsubscribe\b/i,
  /\bto\s+opt[\s-]?out\b/i,
  /\breply\s+stop\b/i,
  /\bcall\s+(?:us|now)\b/i,
  /\btoll[\s-]?free\b/i,
];

/**
 * Money that has already come back.
 *
 * These messages are full of words the reject list exists to catch —
 * "reversed", "failed", "cancelled" — because they describe a payment that
 * did not stick. But the money genuinely returned, and dropping the message
 * leaves the original debit standing as spending that was undone. Requiring
 * *past-tense arrival* separates them from "your payment failed, a refund
 * will be issued", where nothing has moved yet.
 */
const REVERSAL_MARKERS = /\b(?:reversed|refund(?:ed)?|cancell?ed|failed|returned)\b/i;
const ARRIVED_MARKERS =
  /\b(?:credited\s+back|credited\s+to\s+your|has\s+been\s+credited|refunded\s+to\s+your|reversed\s+and\s+credited|money\s+is\s+back)\b/i;

export function isReversalCredit(text: string): boolean {
  return REVERSAL_MARKERS.test(text) && ARRIVED_MARKERS.test(text);
}

/** Sender IDs are shaped like VM-HDFCBK, AD-ICICIB, JD-SBIINB. */
const BANK_SENDER = /^[A-Z]{2}-?([A-Z]{4,8})(?:-?[A-Z])?$/i;
const KNOWN_BANK_TOKENS = [
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'YESBNK', 'IDFC', 'INDUS', 'PNB', 'BOB',
  'CANARA', 'UNION', 'FEDERAL', 'RBL', 'AUBANK', 'BANDHN', 'CITI', 'HSBC', 'SCB',
  'PAYTM', 'PHONPE', 'GPAY', 'AMZNPY', 'MOBIKW', 'FREECH', 'SLICE', 'JUPITR', 'FAMPAY',
];

const AMOUNT = String.raw`(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)`;
const AMOUNT_TRAILING = String.raw`([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)`;
// SBI's UPI alerts (and some others) quote no currency symbol at all —
// "debited by 150.0". Only trusted directly against a transaction verb, so a
// bare number elsewhere in the message — a date, a phone number — is never
// mistaken for the amount.
const AMOUNT_VERB_ADJACENT = String.raw`\b(?:debited|credited|paid|sent|received|withdrawn|deducted|deposited)\s+(?:by|of|for)?\s*([\d,]+(?:\.\d{1,2})?)\b`;

// Compiled once at load, in priority order, rather than on every parse.
const AMOUNT_PATTERNS: RegExp[] = [AMOUNT, AMOUNT_TRAILING, AMOUNT_VERB_ADJACENT].map(
  (source) => new RegExp(source, 'i')
);

/**
 * Verbs that can only mean money leaving. Nothing else in the sentence can
 * talk them out of it.
 */
const DEBIT_VERBS_STRONG = /\b(?:debited|spent|withdrawn|deducted|purchase|txn of)\b/i;

/**
 * Verbs that describe a payment without saying which end of it you are on.
 *
 * "Sent Rs.500 From A/C x1234 To ZOMATO" and "Piggy sent ₹230 to you" use the
 * same word for opposite directions; the verb is not the deciding evidence,
 * the recipient is. These only count as a debit when nothing says the money
 * arrived with the user.
 */
const DEBIT_VERBS_DIRECTIONAL = /\b(?:paid|sent|transferred to|trf to)\b/i;

/**
 * The money landed with the user.
 *
 * Payment apps phrase an incoming transfer as a sentence about the sender —
 * "X sent you", "X paid you ₹230 to you" — so the only reliable marker is
 * who it went to.
 */
const INBOUND_MARKERS =
  /\bto\s+you\b|\bto\s+your\s+(?:a\/c|acct|account|wallet|upi|vpa)\b|\b(?:sent|paid)\s+you\b/i;

const CREDIT_VERBS = /\b(?:credited|received|added|refunded|deposited)\b/i;

// ---------------------------------------------------------------------------
// Which way the money went.
//
// Asking "does this message contain a debit verb?" is only safe while the
// message contains one verb. Bank SMS routinely contain both, in either
// order — a debit alert that goes on to say the money was credited to the
// payee, a credit alert quoting the month's debits, a reversal describing
// the original payment it undoes. Answering globally, with debit winning
// ties, silently reads some of those backwards, and a sign error is the
// worst thing this parser can do: it moves the number by twice the amount
// and looks like an ordinary transaction while doing it.
//
// The verb that decides is the one governing the amount that was actually
// extracted, which is reliably the nearest one to it. Indian bank SMS put
// it on either side — "is credited with Rs 20", "Rs.369 spent on" — so
// distance is measured in both directions rather than assuming an order.
// ---------------------------------------------------------------------------
const DEBIT_STRONG_G = new RegExp(DEBIT_VERBS_STRONG.source, 'gi');
const DEBIT_DIRECTIONAL_G = new RegExp(DEBIT_VERBS_DIRECTIONAL.source, 'gi');
const CREDIT_G = new RegExp(CREDIT_VERBS.source, 'gi');

interface DirectionHit {
  index: number;
  direction: ParsedDirection;
}

function matchPositions(pattern: RegExp, text: string): number[] {
  pattern.lastIndex = 0;
  const found: number[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    found.push(match.index);
    match = pattern.exec(text);
  }
  pattern.lastIndex = 0;
  return found;
}

/**
 * Every direction verb in the message and which way each one points.
 *
 * A directional verb ("paid", "sent") is not evidence on its own — the same
 * word covers both ends of a payment — so it takes its meaning from whether
 * anything says the money arrived with the user.
 */
function directionHits(text: string, inbound: boolean): DirectionHit[] {
  const hits: DirectionHit[] = [];
  for (const index of matchPositions(DEBIT_STRONG_G, text)) hits.push({ index, direction: 'DEBIT' });
  for (const index of matchPositions(CREDIT_G, text)) hits.push({ index, direction: 'CREDIT' });
  for (const index of matchPositions(DEBIT_DIRECTIONAL_G, text)) {
    hits.push({ index, direction: inbound ? 'CREDIT' : 'DEBIT' });
  }
  return hits;
}

export interface ResolvedDirection {
  direction: ParsedDirection;
  /**
   * True when every direction verb in the message agrees. A message that
   * says both scores lower and lands in review, which is the right place
   * for one whose own wording does not settle which way the money went.
   */
  unambiguous: boolean;
}

/**
 * The direction of the verb nearest the amount, or null when the message
 * names no direction at all.
 *
 * Ties go to a debit, which is the pre-existing behaviour and the safer
 * reading: counting money as spent when it arrived understates what is
 * available, while the reverse overstates it and invites overspending.
 */
export function resolveDirection(
  text: string,
  amountIndex: number,
  inbound: boolean
): ResolvedDirection | null {
  const hits = directionHits(text, inbound);
  if (hits.length === 0) return null;

  let best: DirectionHit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const distance = Math.abs(hit.index - amountIndex);
    if (distance < bestDistance || (distance === bestDistance && hit.direction === 'DEBIT')) {
      best = hit;
      bestDistance = distance;
    }
  }
  if (!best) return null;

  return {
    direction: best.direction,
    unambiguous: hits.every((hit) => hit.direction === best!.direction),
  };
}

// ---------------------------------------------------------------------------
// Merchant extraction. Tried in order; the first hit wins, and earlier
// patterns are the more specific ones.
// ---------------------------------------------------------------------------
// Must start with a letter, so a date ("at 08-09-26") can never be captured
// as a merchant name.
const NAME = String.raw`[A-Za-z][A-Za-z0-9 &'.\-_@]{1,48}?`;
// "from" belongs here alongside the others: "paid to Chai Point from Paytm
// A/c..." names the wallet the payment left from, not more of the payee.
const STOP = String.raw`(?=\s+(?:on|via|using|from|ref|upi|txn|dated|at\s+\d)\b|[.,;!]|$)`;

// Order matters: the first match wins, so the most specific phrasings come
// first and the greedy catch-alls come last.
/**
 * Only consulted when the message says the money arrived with the user.
 *
 * A payment app names the sender first and the recipient last — "Piggy 🐷
 * sent ₹230 to you" — which is the reverse of every bank format below, and
 * matching it unconditionally reads "You paid Rs.220 to swiggy@ybl" as a
 * payment from someone called You. The run of non-alphanumerics is for the
 * emoji people put in display names: NAME cannot hold one, so without it the
 * name stops at the emoji.
 */
const INBOUND_MERCHANT_PATTERNS: RegExp[] = [
  new RegExp(String.raw`^(${NAME})\s*[^A-Za-z0-9]*\s*(?:sent|paid)\s+`, 'i'),
];

const MERCHANT_PATTERNS: RegExp[] = [
  // "...spent at OLIVE CAFE on 08-09-26"
  new RegExp(String.raw`\bspent\s+at\s+(${NAME})${STOP}`, 'i'),
  // "...debited ... to VPA merchant@ybl"
  new RegExp(String.raw`\bto\s+VPA\s+(${NAME})${STOP}`, 'i'),
  // "...; OLIVE CAFE credited"
  new RegExp(String.raw`;\s*(${NAME})\s+credited`, 'i'),
  // "paid to Olive Cafe" / "sent to Rahul" / SBI's "trf to ZOMATO"
  new RegExp(String.raw`\b(?:paid|sent|transferred|trf)\s+to\s+(${NAME})${STOP}`, 'i'),
  // "UPI/P2M/123456789/OLIVE CAFE"
  new RegExp(String.raw`UPI\/(?:P2M|P2A)\/\d+\/(${NAME})${STOP}`, 'i'),
  // "at OLIVE CAFE". Deliberately ahead of the "spent on" branch: HDFC writes
  // "spent on <card> at <merchant>", where "spent on" would otherwise capture
  // the card description instead of the merchant.
  new RegExp(String.raw`\bat\s+(${NAME})${STOP}`, 'i'),
  // "spent on Amazon Pay" — only reached when there is no "at ..." clause.
  new RegExp(String.raw`\bspent\s+on\s+(${NAME})${STOP}`, 'i'),
  // Bare "... A/c XX1234 to OLIVE CAFE" / "... From A/c x1234 To ZOMATO On
  // ..." / Federal Bank's "debited ... towards ZEPTO" — HDFC, SBI and Federal
  // each write the payee as its own clause, not glued to the verb the way
  // "paid to X" is. Last of the debit-shaped patterns since this is the
  // least specific of them. Excludes "to your/my account ..." — a credit's
  // "credited to your account XX1234 from Priya Sharma" otherwise gets read
  // as paying "your account" instead of reaching the "from Priya Sharma"
  // that actually names who sent it.
  // "you" is guarded as well as "your": "sent ₹230 to you" was being read as
  // a payment to a merchant named You.
  new RegExp(
    String.raw`\bto(?:wards)?\s+(?!your\b|you\b|my\b|the\s+account\b)(${NAME})${STOP}`,
    'i'
  ),
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

/**
 * Same, but keeping where the match started — which is what lets the
 * direction be decided by the verb attached to *this* amount rather than by
 * any verb anywhere in the message.
 */
function extractFirstAt(
  text: string,
  patterns: RegExp[]
): { value: string; index: number } | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && match.index !== undefined) {
      return { value: match[1], index: match.index };
    }
  }
  return null;
}

// Every ACCOUNT_PATTERNS match ends on its captured digits, so what follows
// the match is what follows the digits.
const CONTINUES_AS_DATE = /^[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/;

/**
 * The account or card digits, skipping a candidate that is really the start
 * of a date ("account 2025-09-11"). The structural gate and the soft reject
 * tier both treat a named account as proof the message is about real money,
 * so a date misread as one would wave through exactly what they exist to stop.
 */
function extractAccountHint(text: string): string | null {
  for (const pattern of ACCOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.[1] || match.index === undefined) continue;
    if (CONTINUES_AS_DATE.test(text.slice(match.index + match[0].length))) continue;
    return match[1];
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

export function isRejected(text: string, namesAccount = false): boolean {
  if (HARD_REJECT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return !namesAccount && SOFT_REJECT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Which specific pattern rejected a message, for `RawEvents`/`ParsedEvents`
 * diagnostics — "why did my payment not show up" needs an actual answer,
 * not just the fact that it didn't. Kept separate from `isRejected` itself:
 * that function is on the hot path for every parse and only ever needs a
 * boolean, so it stays a plain `.some()` rather than building a reason
 * string on every call just for the rare one a human will actually read.
 */
export function rejectionReason(text: string, namesAccount = false): string | null {
  const hard = HARD_REJECT_PATTERNS.find((pattern) => pattern.test(text));
  if (hard) return `hard reject: ${hard.source}`;
  if (namesAccount) return null;
  const soft = SOFT_REJECT_PATTERNS.find((pattern) => pattern.test(text));
  return soft ? `soft reject: ${soft.source}` : null;
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

  // Checked before the reject list, which would otherwise throw away the very
  // message that undoes a debit already on the books.
  const refund = isReversalCredit(text);
  const accountHint = extractAccountHint(text);
  if (!refund && isRejected(text, accountHint !== null)) return null;

  const amountMatch = extractFirstAt(text, AMOUNT_PATTERNS);
  const amount = amountMatch ? parseAmount(amountMatch.value) : null;
  if (amount === null || amountMatch === null) return null;

  // Decided by the verb governing this amount, not by whichever verb appears
  // anywhere in the message — see resolveDirection. A long alert naming both
  // a debit and a credit used to be read as a debit whichever one was the
  // actual event.
  const inbound = INBOUND_MARKERS.test(text);
  const resolved = resolveDirection(text, amountMatch.index, inbound);
  if (!refund && resolved === null) return null;

  // A reversal is money arriving, whatever verbs the sentence also contains —
  // "Rs 250 debited ... has been reversed" names a debit and is a credit.
  const direction: ParsedDirection = refund ? 'CREDIT' : resolved!.direction;

  const rawName = extractFirst(
    text,
    inbound ? [...INBOUND_MERCHANT_PATTERNS, ...MERCHANT_PATTERNS] : MERCHANT_PATTERNS
  );
  const counterparty = rawName ? prettify(cleanName(rawName)) : null;
  const reference = extractFirst(text, REFERENCE_PATTERNS);

  // The structural gate. An SMS that quotes an amount and a verb but never
  // says which account it came out of is describing someone else's money —
  // an offer, a reward, a game's balance. Rejected outright rather than sent
  // to review, because a review inbox full of coupons is its own kind of
  // broken. Notifications skip this: their package allowlist already did the
  // equivalent job.
  if (options.source !== 'NOTIFICATION' && !accountHint) return null;

  // Confidence is additive over independent corroborating signals.
  let confidence = 0.3;
  if (refund) confidence += 0.2; // an explicit reversal is unambiguous
  // Every direction verb in the message agrees. One that contradicts itself
  // scores lower and lands in review, which is where a message whose own
  // wording does not settle the direction belongs.
  else if (resolved!.unambiguous) confidence += 0.2;
  if (counterparty && counterparty.length >= 3) confidence += 0.2;
  if (reference) confidence += 0.15;
  if (accountHint) confidence += 0.2;
  if (isLikelyBankSender(sender)) confidence += 0.15;
  if (/₹|rs\.?|inr/i.test(text)) confidence += 0.05;
  // A notification never carries an account number and rarely carries a
  // reference — the two biggest bonuses above — not because the message is
  // shaky, but because that is simply not how a payment app words its own
  // notifications. The structural gate a few lines up already treats a
  // notification's package allowlist as equivalent evidence to an SMS
  // naming its account; the score did not, capping even a perfectly
  // unambiguous notification (clear amount, clear direction, a real name)
  // several points under the accept threshold for reasons that had nothing
  // to do with how trustworthy the message actually was.
  if (options.source === 'NOTIFICATION') confidence += 0.25;

  return {
    amount,
    direction,
    counterparty: counterparty || null,
    reference,
    accountHint,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
    isRefund: refund,
  };
}

/**
 * Walks the exact same gates `parseMessage` returns `null` from, in the same
 * order, and names the one that fired — the permanent version of the
 * throwaway diagnostic harness this project used once, by hand, to work out
 * why one real SMS never became a transaction. `RawEvents`/`ParsedEvents`
 * (Phase 7) call this whenever `parseMessage` returns `null`, so "why did my
 * payment not show up" is a stored fact from the moment it happens, not
 * something that has to be reconstructed later from a message that, before
 * this phase, was not even kept.
 *
 * Returns null when `parseMessage` would not actually reject the text —
 * callers should not need to duplicate `parseMessage`'s own logic to find
 * that out.
 */
export function explainRejection(
  text: string,
  sender?: string | null,
  options: ParseOptions = {}
): string | null {
  if (!text || text.trim().length < 6) return 'too short to be a transaction';

  const refund = isReversalCredit(text);
  const accountHint = extractAccountHint(text);
  if (!refund) {
    const reason = rejectionReason(text, accountHint !== null);
    if (reason) return reason;
  }

  const amountMatch = extractFirstAt(text, AMOUNT_PATTERNS);
  const amount = amountMatch ? parseAmount(amountMatch.value) : null;
  if (amount === null || amountMatch === null) return 'no amount found';

  const inbound = INBOUND_MARKERS.test(text);
  if (!refund && resolveDirection(text, amountMatch.index, inbound) === null) {
    return 'no debit or credit verb found';
  }

  if (options.source !== 'NOTIFICATION' && !accountHint) {
    return 'no account or card number named (and not a notification)';
  }

  return null;
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
