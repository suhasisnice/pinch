/**
 * What Pinch is allowed to keep from an SMS.
 *
 * Mirrors `FinancialSms.kt`, which is the real gate: on a phone, a personal
 * message never reaches JS. This copy is the second lock — for messages that
 * arrive by another path (tests, the web preview, an older native build) and
 * for anything already stored before the gate existed (migration v18).
 *
 * Google Play's "SMS-based money management" exception covers financial
 * messages only; DPDP asks for no more data than the purpose needs.
 */

const PHONE_NUMBER = /^\+?[\d\s\-()]{8,}$/;

const MONEY =
  /(₹|\brs\.?\s?\d|\binr\b|\bdebited\b|\bcredited\b|\ba\/c\b|\bacct\b|\bupi\b|\bneft\b|\bimps\b|\bsip\b|\brefund)/i;

/** A person's phone number rather than a bank's business header. */
export function isPersonalSender(sender: string | null | undefined): boolean {
  return !!sender && PHONE_NUMBER.test(sender.trim());
}

export function isWorthKeeping(sender: string | null | undefined, body: string): boolean {
  if (!sender || !body.trim()) return false;
  if (isPersonalSender(sender)) return false;
  return MONEY.test(body);
}

const OTP_CONTEXT = /\b(otp|one[\s-]?time[\s-]?password|verification code|security code)\b/i;

/**
 * Masks one-time passwords before a message is stored. A bank's OTP SMS can
 * still be useful evidence ("an OTP was sent for ₹2,400 at Amazon"), but the
 * code itself must never sit in a database.
 */
export function redactOtp(body: string): string {
  if (!OTP_CONTEXT.test(body)) return body;
  return body.replace(/\b\d{4,8}\b(?![,.]?\d)/g, (digits, offset: number) => {
    // Keep amounts: a number right after a currency marker is money, not a code.
    const before = body.slice(Math.max(0, offset - 5), offset);
    return /(₹|rs\.?|inr)\s*$/i.test(before) ? digits : '•'.repeat(digits.length);
  });
}
