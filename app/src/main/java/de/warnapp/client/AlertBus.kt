package de.warnapp.client

import android.os.Handler
import android.os.Looper

/** Verbindet den Messaging-Service mit der sichtbaren Activity (nur im Vordergrund). */
object AlertBus {
    interface Listener { fun onAlert(p: AlertPayload) }

    @Volatile var listener: Listener? = null
    private val main = Handler(Looper.getMainLooper())

    /** @return true, wenn eine sichtbare Activity die Meldung übernimmt. */
    fun deliver(p: AlertPayload): Boolean {
        val l = listener ?: return false
        main.post { l.onAlert(p) }
        return true
    }
}
