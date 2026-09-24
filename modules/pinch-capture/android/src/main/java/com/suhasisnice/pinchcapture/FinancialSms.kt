package com.suhasisnice.pinchcapture

/**
 * The gate every SMS passes before Pinch keeps a copy of it.
 *
 * Google Play grants READ_SMS to budgeting apps under the "SMS-based money
 * management" exception, on the condition that nothing but financial messages
 * is collected. A friend's text, sent from a phone number, never leaves this
 * file: it is not buffered, not handed to JS and not written to the database.
 *
 * Two tests, both required:
 *  - The sender is a business header (Indian DLT senders look like "AX-HDFCBK"
 *    or "HDFCBK"), not a person's phone number.
 *  - The body talks about money: a currency amount or a banking verb.
 *
 * Leaning towards keeping a bank message the parser then rejects is fine —
 * that is what RawEvents is for. Keeping a personal message is not.
 */
object FinancialSms {
    private val PHONE_NUMBER = Regex("""^\+?[\d\s\-()]{8,}$""")

    private val MONEY = Regex(
        """(₹|\brs\.?\s?\d|\binr\b|\bdebited\b|\bcredited\b|\ba/c\b|\bacct\b|\bupi\b|\bneft\b|\bimps\b|\bsip\b|\brefund)""",
        RegexOption.IGNORE_CASE
    )

    fun isWorthKeeping(sender: String?, body: String?): Boolean {
        if (sender.isNullOrBlank() || body.isNullOrBlank()) return false
        if (PHONE_NUMBER.matches(sender.trim())) return false
        return MONEY.containsMatchIn(body)
    }
}
