package de.warnapp.client

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class WarnMessagingService : FirebaseMessagingService() {

    /** Wird nur aufgerufen, wenn die App im Vordergrund ist (Benachrichtigungs-Nachrichten im Hintergrund zeigt das System selbst an). */
    override fun onMessageReceived(message: RemoteMessage) {
        val p = AlertPayload.from(message.data) ?: return
        val foreground = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        if (foreground && AlertBus.deliver(p)) return
        AlertStore.add(this, p)
        NotificationHelper.show(this, p)
    }

    /** Tokenwechsel: Registrierung beim Server erneuern. */
    override fun onNewToken(token: String) {
        Backend.enqueueRegistration(applicationContext)
    }
}
