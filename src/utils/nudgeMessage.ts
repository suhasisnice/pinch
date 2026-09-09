/** Formats the reminder text sent for an unpaid IOU. */
export function buildNudgeMessage(name: string, amount: number, merchant: string): string {
  const formattedAmount = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `Hey ${name}, you owe me ₹${formattedAmount} for ${merchant}. Please pay via UPI!`;
}

/**
 * Strips everything but digits and a leading "+" so a phone number typed as
 * "+91 98765-43210" or "(987) 654-3210" still produces a valid phone param.
 */
export function sanitizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * Normalises a phone number to the digits-only, country-code-prefixed form
 * WhatsApp's click-to-chat link requires — no "+", no leading "0", no spaces.
 *
 * A plain 10-digit number, which is how most contacts save Indian mobile
 * numbers, is not addressable on its own: WhatsApp reads it as country code
 * "1" plus a 9-digit US number and either opens an empty chat or errors.
 * India (+91) is assumed because the rest of the app already assumes it —
 * amounts are formatted in rupees and transactions are parsed from Indian
 * bank SMS formats. A number that already carries a country code, or one
 * that is not 10 digits, is left as typed rather than guessed at.
 */
export function normalizePhoneForWhatsApp(phone: string): string {
  const digits = sanitizePhoneForWhatsApp(phone).replace(/^\+/, '');
  const local = digits.replace(/^0+/, '');

  if (/^\d{10}$/.test(local)) return `91${local}`;
  return digits;
}

/**
 * A WhatsApp click-to-chat link.
 *
 * Uses the https://wa.me/ form rather than the whatsapp:// deep link: it
 * opens the WhatsApp app directly with the message pre-filled and the chat
 * already open (one tap of Send finishes it), but as a normal https URL it
 * is always openable — unlike whatsapp://, which Android 11+ hides from
 * Linking.canOpenURL unless the app declares WhatsApp's package in a
 * <queries> manifest block. When no phone is on file this falls back to the
 * whatsapp:// scheme with no recipient, which opens WhatsApp's own contact
 * picker instead — the queries block (added via a config plugin) is what
 * makes that path work at all on a modern device.
 */
export function buildWhatsAppUrl(message: string, phone?: string | null): string {
  const encodedText = encodeURIComponent(message);
  if (phone) {
    return `https://wa.me/${normalizePhoneForWhatsApp(phone)}?text=${encodedText}`;
  }
  return `whatsapp://send?text=${encodedText}`;
}
