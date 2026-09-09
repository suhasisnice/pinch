package com.suhasisnice.pinchcapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Captures payment notifications from banking and UPI apps.
 *
 * This exists because a large share of student spending never produces an SMS
 * at all — a GPay or PhonePe payment posts a notification and nothing else. It
 * also covers banks that have moved to app-only alerts.
 *
 * Only packages on the allowlist are read. A notification listener can see
 * every notification on the device, so restricting it to known payment apps at
 * the source means nothing else is ever buffered, let alone stored.
 */
class PinchNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName ?: return
        if (!isPaymentApp(packageName)) return

        // Ongoing notifications are persistent UI (a running transfer, a
        // foreground service), not an event that just happened.
        if (sbn.isOngoing) return

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

    companion object {
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
