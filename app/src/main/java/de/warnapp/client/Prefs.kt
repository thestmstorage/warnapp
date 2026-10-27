package de.warnapp.client

import android.content.Context

object Prefs {
    private fun p(c: Context) = c.getSharedPreferences("settings", Context.MODE_PRIVATE)

    fun wantsRegistration(c: Context) = p(c).getBoolean("wants_registration", false)
    fun setWantsRegistration(c: Context, v: Boolean) = p(c).edit().putBoolean("wants_registration", v).apply()

    fun regCode(c: Context): String = p(c).getString("reg_code", "") ?: ""
    fun setRegCode(c: Context, v: String) = p(c).edit().putString("reg_code", v).apply()

    fun regStatus(c: Context): String = p(c).getString("reg_status", "Noch nicht registriert.") ?: ""
    fun setRegStatus(c: Context, v: String) = p(c).edit().putString("reg_status", v).apply()
}
