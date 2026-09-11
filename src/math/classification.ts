/**
 * Recognises payments that left the account without buying anything.
 *
 * These are not junk — the money genuinely moved, and rejecting them would
 * lose a real event. They are money changing form between two things the user
 * already owns: cash in a wallet app, a card balance being cleared, notes in
 * a pocket. Counting them as spending double-counts, because whatever the
 * money is eventually spent on gets captured separately.
 */

export type NonSpendReason = 'WALLET_TOPUP' | 'CARD_BILL' | 'CASH_WITHDRAWAL';

export interface ClassifiableTransaction {
  direction: 'DEBIT' | 'CREDIT';
  merchant: string;
  rawText?: string | null;
}

/** Wallets are places you keep money, not merchants you buy from. */
const WALLET_BRANDS =
  /\b(?:paytm|phonepe|phone\s*pe|amazon\s*pay|mobikwik|freecharge|ola\s*money|airtel\s*money|jiomoney|payzapp)\b/i;

/**
 * A brand name alone is not enough: paying a shop *through* PhonePe names
 * PhonePe too. Only a message that says money was put *into* the wallet
 * counts, which is a distinction the wording always makes.
 */
const WALLET_LOAD =
  /\b(?:wallet|add(?:ed)?\s+money|added\s+to|top[\s-]?up|topped\s+up|load(?:ed)?)\b/i;

const CARD_BILL =
  /\b(?:credit\s*card\s*(?:bill|payment|paid)|card\s*bill|cc\s*bill|bill\s*payment\s*to)\b/i;

/** CRED exists solely to pay card bills, so its name is itself the signal. */
const CARD_BILL_BRANDS = /\b(?:cred|billdesk\s*cc)\b/i;

/** Exported so payment-method detection (parserService.ts) doesn't duplicate this pattern. */
export const CASH_WITHDRAWAL =
  /\b(?:atm|cash\s*w(?:it)?hdr(?:awal|awn)?|cash\s*wdl|nfs\s*atm|withdrawn\s+at)\b/i;

function haystack(tx: ClassifiableTransaction): string {
  return `${tx.rawText ?? ''} ${tx.merchant ?? ''}`;
}

/**
 * What this payment really was, if it was not a purchase.
 *
 * Only debits are considered. A credit from a wallet is money coming back,
 * which is a different question handled elsewhere.
 */
export function classifyNonSpend(tx: ClassifiableTransaction): NonSpendReason | null {
  if (tx.direction !== 'DEBIT') return null;
  const text = haystack(tx);

  if (CASH_WITHDRAWAL.test(text)) return 'CASH_WITHDRAWAL';
  if (CARD_BILL.test(text) || CARD_BILL_BRANDS.test(text)) return 'CARD_BILL';
  if (WALLET_BRANDS.test(text) && WALLET_LOAD.test(text)) return 'WALLET_TOPUP';

  return null;
}

/**
 * Whether a classification should stop the payment counting as spending.
 *
 * Cash is the exception, and deliberately so. Removing a 2,000 withdrawal
 * would be honest about the withdrawal and dishonest about everything after
 * it: cash spending sends no messages, so nothing would ever replace it and
 * the month would look far cheaper than it was. Under-reporting is the worse
 * error, so the withdrawal stays counted and only gets a truthful category.
 */
export function removesFromSpending(reason: NonSpendReason | null): boolean {
  return reason === 'WALLET_TOPUP' || reason === 'CARD_BILL';
}

export const NON_SPEND_LABELS: Record<NonSpendReason, string> = {
  WALLET_TOPUP: 'Moved to a wallet',
  CARD_BILL: 'Credit card bill',
  CASH_WITHDRAWAL: 'Cash withdrawn',
};
