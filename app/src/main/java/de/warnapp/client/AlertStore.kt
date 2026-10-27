package de.warnapp.client

import android.content.Context
import org.json.JSONArray

/** Lokaler Meldungsverlauf (letzte 50), dedupliziert nach warningId. */
object AlertStore {
    private const val FILE = "alerts"
    private const val KEY = "items"
    private const val MAX = 50

    @Synchronized
    fun add(ctx: Context, p: AlertPayload) {
        val list = load(ctx).toMutableList()
        if (list.any { it.warningId == p.warningId }) return
        list.add(0, p)
        val arr = JSONArray()
        list.take(MAX).forEach { arr.put(it.toJson()) }
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
    }

    @Synchronized
    fun load(ctx: Context): List<AlertPayload> {
        val raw = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { AlertPayload.fromJson(arr.getJSONObject(it)) }
        } catch (e: Exception) { emptyList() }
    }
}
