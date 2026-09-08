export interface ParsedDebit {
  amount: number;
  merchant: string;
}

export interface ParsedCredit {
  amount: number;
  sender: string;
}

// Text that can trail a captured name/merchant before we cut it off.
const TRAILING_STOP = String.raw`(?=\s+via\s+upi|\s+using\s+upi|\s+on\s+\d|[.,]|$)`;
const NAME_CHARS = String.raw`[a-zA-Z0-9 &'.\-]+?`;
const AMOUNT = String.raw`([\d,]+(?:\.\d{1,2})?)`;

// Tried in order; first pattern that matches wins.
const DEBIT_PATTERNS: RegExp[] = [
  // "Rs. 700 spent at Olive Cafe via UPI" / "INR 1,250.50 spent on Amazon Pay"
  new RegExp(
    String.raw`(?:rs\.?|inr)\s*${AMOUNT}\s+(?:has\s+been\s+|was\s+)?spent\s+(?:at|on)\s+(${NAME_CHARS})${TRAILING_STOP}`,
    'i'
  ),
  // "Rs 500 debited from A/c XX1234 on 05-Sep-26 spent at Big Bazaar."
  new RegExp(
    String.raw`(?:rs\.?|inr)\s*${AMOUNT}\s+debited\b[^.]*?\bat\s+(${NAME_CHARS})${TRAILING_STOP}`,
    'i'
  ),
];

const CREDIT_PATTERNS: RegExp[] = [
  // "Received Rs. 175 from Rahul via UPI"
  new RegExp(
    String.raw`received\s+(?:rs\.?|inr)\s*${AMOUNT}\s+from\s+(${NAME_CHARS})${TRAILING_STOP}`,
    'i'
  ),
  // "Rs 175 credited to your a/c from Rahul via UPI"
  new RegExp(
    String.raw`(?:rs\.?|inr)\s*${AMOUNT}\s+(?:has\s+been\s+)?credited\b[^.]*?\bfrom\s+(${NAME_CHARS})${TRAILING_STOP}`,
    'i'
  ),
];

function parseAmount(raw: string): number | null {
  const value = parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function parseDebitSms(sms: string): ParsedDebit | null {
  if (!sms) return null;
  for (const pattern of DEBIT_PATTERNS) {
    const match = sms.match(pattern);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    const merchant = cleanText(match[2]);
    if (amount !== null && merchant) {
      return { amount, merchant };
    }
  }
  return null;
}

export function parseCreditSms(sms: string): ParsedCredit | null {
  if (!sms) return null;
  for (const pattern of CREDIT_PATTERNS) {
    const match = sms.match(pattern);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    const sender = cleanText(match[2]);
    if (amount !== null && sender) {
      return { amount, sender };
    }
  }
  return null;
}
