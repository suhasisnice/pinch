/** Formats the roast/reminder text sent for an unpaid IOU. */
export function buildNudgeMessage(name: string, amount: number, merchant: string): string {
  const formattedAmount = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `Hey ${name}, you owe me ₹${formattedAmount} for ${merchant}. Please pay via UPI!`;
}

/**
 * Strips everything but digits and a leading "+" so a phone number typed as
 * "+91 98765-43210" or "(987) 654-3210" still produces a valid wa.me-style
 * phone param.
 */
export function sanitizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function buildWhatsAppUrl(message: string, phone?: string | null): string {
  const encodedText = encodeURIComponent(message);
  const cleanPhone = phone ? sanitizePhoneForWhatsApp(phone) : '';
  return cleanPhone
    ? `whatsapp://send?phone=${cleanPhone}&text=${encodedText}`
    : `whatsapp://send?text=${encodedText}`;
}
