package com.suhasisnice.pinchcapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import org.json.JSONObject

/**
 * Receives incoming SMS and buffers anything that could be a bank message.
 *
 * Multi-part messages arrive as several PDUs belonging to one logical text, so
 * parts sharing an originating address are concatenated before buffering —
 * a long bank SMS split mid-number would otherwise parse as two broken
 * fragments, and the amount could land in whichever half.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = runCatching { Telephony.Sms.Intents.getMessagesFromIntent(intent) }
            .getOrNull() ?: return
        if (messages.isEmpty()) return

        val bySender = LinkedHashMap<String, StringBuilder>()
        var timestamp = System.currentTimeMillis()

        for (message in messages) {
            val sender = message.originatingAddress ?: message.displayOriginatingAddress ?: "unknown"
            val body = message.messageBody ?: continue
            bySender.getOrPut(sender) { StringBuilder() }.append(body)
            timestamp = message.timestampMillis
        }

        for ((sender, body) in bySender) {
            val text = body.toString()
            if (text.isBlank()) continue

            val entry = JSONObject().apply {
                put("source", "SMS")
                put("sender", sender)
                put("body", text)
                put("receivedAt", timestamp)
            }
            CaptureBuffer.add(context.applicationContext, entry)
        }
    }
}
