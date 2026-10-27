package de.warnapp.client

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug-Build: Debug-Provider. Das Debug-Token steht im Logcat ("DebugAppCheckProvider") und wird in der Firebase Console registriert. */
object AppCheckInstaller {
    fun install() = FirebaseAppCheck.getInstance().installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
}
