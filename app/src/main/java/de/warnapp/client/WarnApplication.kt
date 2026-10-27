package de.warnapp.client

import android.app.Application
import com.google.firebase.FirebaseApp

class WarnApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        FirebaseApp.initializeApp(this)
        AppCheckInstaller.install()
        NotificationHelper.createChannels(this)
    }
}
