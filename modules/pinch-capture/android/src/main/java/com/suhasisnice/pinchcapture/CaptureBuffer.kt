package com.suhasisnice.pinchcapture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Holds captured messages until JavaScript is alive to collect them.
 *
 * An SMS broadcast or a posted notification can arrive while the React context
 * is not running — the OS starts the process for the broadcast, but JS may not
 * be ready, and the app can be killed again moments later. Emitting an event
 * and hoping someone is listening loses messages, so everything is written to
 * SharedPreferences first and drained by JS when it next comes up. The live
 * event is an optimisation on top, not the delivery mechanism.
 */
object CaptureBuffer {
    private const val PREFS = "pinch_capture"
    private const val KEY_QUEUE = "queue"
    private const val MAX_ENTRIES = 200

    /** Set while a module instance is attached, so arrivals can be pushed live. */
    @Volatile
    var listener: ((JSONObject) -> Unit)? = null

    @Synchronized
    fun add(context: Context, entry: JSONObject) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val queue = readQueue(prefs.getString(KEY_QUEUE, null))

        queue.put(entry)

        // Drop the oldest entries rather than growing without bound; a device
        // that has been offline for a week should not replay a thousand texts.
        val trimmed = if (queue.length() > MAX_ENTRIES) {
            JSONArray().also { out ->
                for (i in (queue.length() - MAX_ENTRIES) until queue.length()) {
                    out.put(queue.get(i))
                }
            }
        } else {
            queue
        }

        prefs.edit().putString(KEY_QUEUE, trimmed.toString()).apply()

        listener?.let { emit ->
            runCatching { emit(entry) }
        }
    }

    /** Returns everything buffered and clears it in one atomic step. */
    @Synchronized
    fun drain(context: Context): JSONArray {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val queue = readQueue(prefs.getString(KEY_QUEUE, null))
        prefs.edit().remove(KEY_QUEUE).apply()
        return queue
    }

    @Synchronized
    fun pendingCount(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return readQueue(prefs.getString(KEY_QUEUE, null)).length()
    }

    private fun readQueue(raw: String?): JSONArray =
        if (raw.isNullOrEmpty()) JSONArray() else runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
}
