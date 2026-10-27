package de.warnapp.client

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Nach einem App-Update die Registrierung erneuern (nur wenn der Nutzer sie zuvor gewünscht hat). */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            NotificationHelper.createChannels(context)
            Backend.enqueueRegistration(context.applicationContext)
        }
    }
}
