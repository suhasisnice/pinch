package com.suhasisnice.pinchcapture

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.Settings
import android.provider.Telephony
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

class PinchCaptureModule : Module() {

    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("PinchCapture")

        Events(ON_MESSAGE)

        OnStartObserving {
            // Push arrivals straight through while JS is listening. The
            // SharedPreferences queue remains the source of truth, so anything
            // that lands while JS is down is still collected by drainMessages().
            CaptureBuffer.listener = { entry ->
                runCatching { sendEvent(ON_MESSAGE, entry.toMap()) }
            }
        }

        OnStopObserving {
            CaptureBuffer.listener = null
        }

        // -- SMS -------------------------------------------------------------

        Function("hasSmsPermission") {
            hasPermission(Manifest.permission.RECEIVE_SMS) && hasPermission(Manifest.permission.READ_SMS)
        }

        AsyncFunction("requestSmsPermission") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            // Expo's permission flow does not cover SMS, so this asks directly
            // and reports the result on the next hasSmsPermission() call. The
            // UI re-checks when the app returns to the foreground.
            activity.requestPermissions(
                arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS),
                SMS_PERMISSION_REQUEST
            )
            promise.resolve(true)
        }

        /**
         * One-time backfill of recent inbox messages, so turning capture on
         * does not start from an empty history.
         */
        AsyncFunction("readRecentSms") { limit: Int, promise: Promise ->
            if (!hasPermission(Manifest.permission.READ_SMS)) {
                promise.resolve(JSONArray().toListOfMaps())
                return@AsyncFunction
            }

            val results = JSONArray()
            val projection = arrayOf(
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE
            )

            context.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                projection,
                null,
                null,
                "${Telephony.Sms.DATE} DESC LIMIT ${limit.coerceIn(1, 500)}"
            )?.use { cursor ->
                val addressIndex = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIndex = cursor.getColumnIndex(Telephony.Sms.BODY)
                val dateIndex = cursor.getColumnIndex(Telephony.Sms.DATE)

                while (cursor.moveToNext()) {
                    val body = cursor.getString(bodyIndex) ?: continue
                    results.put(
                        JSONObject().apply {
                            put("source", "SMS")
                            put("sender", cursor.getString(addressIndex) ?: "unknown")
                            put("body", body)
                            put("receivedAt", cursor.getLong(dateIndex))
                        }
                    )
                }
            }

            promise.resolve(results.toListOfMaps())
        }

        // -- Contacts --------------------------------------------------------

        Function("hasContactsPermission") {
            hasPermission(Manifest.permission.READ_CONTACTS)
        }

        /**
         * Phone contacts, for picking who a bill is split with.
         *
         * Deliberately read-only and on demand: nothing is copied into the
         * app's database until the user actually picks someone. Numbers are
         * returned so the WhatsApp nudge has something to open, and duplicates
         * (the same person stored on SIM and account) are collapsed by name.
         */
        AsyncFunction("readContacts") { promise: Promise ->
            if (!hasPermission(Manifest.permission.READ_CONTACTS)) {
                promise.resolve(emptyList<Map<String, Any?>>())
                return@AsyncFunction
            }

            val byName = LinkedHashMap<String, Map<String, Any?>>()
            val projection = arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            )

            context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE NOCASE ASC"
            )?.use { cursor ->
                val nameIndex =
                    cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numberIndex =
                    cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

                while (cursor.moveToNext()) {
                    val name = cursor.getString(nameIndex)?.trim().orEmpty()
                    if (name.isEmpty()) continue
                    val number = cursor.getString(numberIndex)?.trim()
                    byName.getOrPut(name.lowercase()) {
                        mapOf("name" to name, "phone" to number)
                    }
                }
            }

            promise.resolve(byName.values.toList())
        }

        // -- Notification listener -------------------------------------------

        Function("isNotificationListenerEnabled") {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            ).orEmpty()
            enabled.contains(context.packageName)
        }

        /**
         * There is no runtime dialog for notification access — it can only be
         * granted from system settings, so the app sends the user there.
         */
        Function("openNotificationListenerSettings") {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(intent) }
                .onFailure {
                    context.startActivity(
                        Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }
        }

        Function("openAppSettings") {
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null)
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(intent) }
        }

        // -- Buffer ----------------------------------------------------------

        AsyncFunction("drainMessages") { promise: Promise ->
            promise.resolve(CaptureBuffer.drain(context.applicationContext).toListOfMaps())
        }

        Function("pendingCount") {
            CaptureBuffer.pendingCount(context.applicationContext)
        }
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    companion object {
        private const val ON_MESSAGE = "onMessage"
        private const val SMS_PERMISSION_REQUEST = 7411
    }
}

// Expo's Kotlin bridge serialises Maps and Lists, not org.json types.
private fun JSONObject.toMap(): Map<String, Any?> =
    keys().asSequence().associateWith { key -> if (isNull(key)) null else get(key) }

private fun JSONArray.toListOfMaps(): List<Map<String, Any?>> =
    (0 until length()).mapNotNull { index ->
        (opt(index) as? JSONObject)?.toMap()
    }
