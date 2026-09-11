package com.suhasisnice.pinchcapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Captures payment notifications from banking and UPI apps, and bank alert
 * emails from Gmail.
 *
 * This exists because a large share of student spending never produces an SMS
 * at all — a GPay or PhonePe payment posts a notification and nothing else. It
 * also covers banks that have moved to app-only alerts, and banks (Canara
 * Bank among them) that only ever send a transaction alert by email.
 *
 * Only packages on the allowlist are read. A notification listener can see
 * every notification on the device, so restricting it to known payment apps at
 * the source means nothing else is ever buffered, let alone stored.
 *
 * Gmail is a special case within that allowlist: unlike a banking app, where
 * every notification is inherently about money, a mail app's notifications
 * are a person's actual inbox. Letting all of it through would mean every
 * personal email gets written to the on-disk capture queue, if only
 * momentarily before JS discards it — a much bigger privacy footprint than
 * "restrict to known payment apps" was ever meant to allow. So a second,
 * content-level filter applies to Gmail alone: the notification must itself
 * look like a bank alert (its sender name matches a known bank) before it is
 * ever buffered. Every other package on the list is trusted on package
 * identity alone, same as before.
 */
class PinchNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName ?: return
        val isEmail = isEmailApp(packageName)
        if (!isEmail && !isPaymentApp(packageName)) return

        // Ongoing notifications are persistent UI (a running transfer, a
        // foreground service), not an event that just happened.
        if (sbn.isOngoing) return

        // Gmail posts a "N new messages" group summary alongside each real
        // per-email notification when several arrive close together; it names
        // no sender and would otherwise be parsed as a blank, useless entry.
        if (isEmail && (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()

        // The expanded body carries the full sentence when it exists; the
        // collapsed one is often truncated with an ellipsis mid-amount.
        val body = listOf(title, bigText.ifBlank { text })
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .trim()

        if (body.isBlank()) return

        // The content-level gate described above: an email notification only
        // ever gets buffered when it reads like a bank sent it. A payment
        // app's notification skips this — its package is already the trust
        // signal.
        if (isEmail && !looksLikeBankAlert(body)) return

        val entry = JSONObject().apply {
            put("source", "NOTIFICATION")
            put("sender", packageName)
            put("body", body)
            put("receivedAt", sbn.postTime)
        }
        CaptureBuffer.add(applicationContext, entry)
    }

    private fun isPaymentApp(packageName: String): Boolean =
        PAYMENT_PACKAGES.any { packageName.startsWith(it) }

    private fun isEmailApp(packageName: String): Boolean =
        EMAIL_PACKAGES.any { packageName.startsWith(it) }

    private fun looksLikeBankAlert(body: String): Boolean {
        val lower = body.lowercase()
        return KNOWN_BANK_NAMES.any { lower.contains(it) }
    }

    companion object {
        // Gmail proper, plus Gmail Go (same alerts, lighter app, common on
        // budget phones this app's audience is likely to carry).
        private val EMAIL_PACKAGES = listOf(
            "com.google.android.gm",
            "com.google.android.gm.lite"
        )

        // Matched against the notification's sender name and subject, not an
        // SMS header, so these are the names a bank actually signs its mail
        // as rather than the short codes used in KNOWN_BANK_TOKENS elsewhere.
        private val KNOWN_BANK_NAMES = listOf(
            "canara", "hdfc", "icici", "state bank of india", "sbi", "axis bank",
            "kotak", "yes bank", "idfc", "indusind", "punjab national bank", "pnb",
            "bank of baroda", "union bank", "federal bank", "rbl bank",
            "au small finance bank", "bandhan bank", "citibank", "hsbc",
            "standard chartered", "karnataka bank", "south indian bank",
            "city union bank", "dcb bank", "bank of india", "central bank of india",
            "uco bank", "indian overseas bank", "punjab & sind", "indian bank"
        )

        private val PAYMENT_PACKAGES = listOf(
            // UPI apps
            "com.google.android.apps.nbu.paisa.user", // Google Pay India
            "com.phonepe.app",
            "net.one97.paytm",
            "in.amazon.mShop.android.shopping", // Amazon Pay lives in the shopping app
            "in.org.npci.upiapp", // BHIM
            "com.mobikwik_new",
            "com.freecharge.android",
            "com.dreamplug.androidapp", // CRED
            "money.super.payments",
            // Banks
            "com.snapwork.hdfc",
            "com.csam.icici.bank.imobile",
            "com.sbi.lotusintouch",
            "com.sbi.SBIFreedomPlus",
            "com.axis.mobile",
            "com.msf.kbank.mobile", // Kotak
            "com.bankofbaroda.mconnect",
            "com.infrasofttech.indianbank",
            "com.fss.pnbpsp",
            "com.idfcfirstbank.optimus",
            "com.yesbank",
            "com.rblbank.mobank",
            "com.au.aubank",
            "com.fedmobile"
        )
    }
}
