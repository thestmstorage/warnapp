package de.warnapp.client

import android.os.Bundle
import org.json.JSONObject

data class AlertPayload(
    val type: String,
    val title: String,
    val body: String,
    val warningId: String,
    val receivedAt: Long,
) {
    val isAlarm: Boolean get() = type != ALL_CLEAR

    fun toJson(): JSONObject = JSONObject()
        .put("type", type).put("title", title).put("body", body)
        .put("warningId", warningId).put("receivedAt", receivedAt)

    companion object {
        const val PROBE = "PROBE"
        const val WARNING = "WARNING"
        const val ALL_CLEAR = "ALL_CLEAR"
        val KEYS = listOf("type", "title", "body", "warningId", "sentAt")
        private val VALID = setOf(PROBE, WARNING, ALL_CLEAR)

        /** Baut ein Payload aus FCM-Datenfeldern. Unbekannte/fehlende Typen werden verworfen. */
        fun from(data: Map<String, String?>, now: Long = System.currentTimeMillis()): AlertPayload? {
            val type = data["type"]?.takeIf { it in VALID } ?: return null
            val title = data["title"]?.takeIf { it.isNotBlank() } ?: defaultTitle(type)
            val body = data["body"].orEmpty()
            val id = data["warningId"]?.takeIf { it.isNotBlank() } ?: "local-$now"
            return AlertPayload(type, title, body, id, now)
        }

        /** Beim Tippen auf eine System-Benachrichtigung kommen die Datenfelder als Intent-Extras an. */
        fun fromBundle(b: Bundle?, now: Long = System.currentTimeMillis()): AlertPayload? {
            if (b == null) return null
            return from(KEYS.associateWith { b.getString(it) }, now)
        }

        fun fromJson(o: JSONObject) = AlertPayload(
            o.getString("type"), o.getString("title"), o.getString("body"),
            o.getString("warningId"), o.getLong("receivedAt"),
        )

        fun defaultTitle(type: String) = when (type) {
            PROBE -> "PROBEWARNUNG"
            ALL_CLEAR -> "ENTWARNUNG"
            else -> "WARNUNG"
        }
    }
}
