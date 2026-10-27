package de.warnapp.client

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import java.io.IOException
import java.util.concurrent.TimeUnit

object Backend {
    const val REGION = "europe-west1"
    private const val WORK = "register_device"

    /** Anmeldung/Token-Wechsel/Update: Registrierung mit automatischem Wiederholen bei Netzproblemen. */
    fun enqueueRegistration(ctx: Context) {
        if (!Prefs.wantsRegistration(ctx)) return
        val req = OneTimeWorkRequestBuilder<RegisterWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, req)
    }

    suspend fun register(ctx: Context) {
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) auth.signInAnonymously().await()
        val token = FirebaseMessaging.getInstance().token.await()
        FirebaseFunctions.getInstance(REGION).getHttpsCallable("registerDevice").call(
            hashMapOf("token" to token, "appVersion" to BuildConfig.VERSION_NAME, "code" to Prefs.regCode(ctx))
        ).await()
    }

    suspend fun unregister(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK)
        Prefs.setWantsRegistration(ctx, false)
        if (FirebaseAuth.getInstance().currentUser != null) {
            FirebaseFunctions.getInstance(REGION).getHttpsCallable("unregisterDevice").call().await()
        }
    }

    /** Liefert (verständliche Meldung, lohnt sich ein erneuter Versuch). */
    fun describe(e: Exception): Pair<String, Boolean> = when {
        e is FirebaseFunctionsException -> when (e.code) {
            FirebaseFunctionsException.Code.PERMISSION_DENIED -> "Registrierung abgelehnt: Registrierungscode falsch oder App Check fehlgeschlagen." to false
            FirebaseFunctionsException.Code.INVALID_ARGUMENT -> "Registrierung abgelehnt: ungültige Daten." to false
            FirebaseFunctionsException.Code.RESOURCE_EXHAUSTED -> "Zu viele Versuche. Es wird später erneut versucht." to true
            FirebaseFunctionsException.Code.UNAUTHENTICATED -> "Anmeldung fehlgeschlagen. Es wird erneut versucht." to true
            else -> "Server nicht erreichbar (${e.code}). Es wird erneut versucht." to true
        }
        e is IOException -> "Keine Internetverbindung. Es wird erneut versucht." to true
        else -> "Registrierung fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}" to true
    }
}

class RegisterWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = applicationContext
        return try {
            Backend.register(c)
            Prefs.setRegStatus(c, "Registriert. Warnungen werden empfangen.")
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val (msg, retry) = Backend.describe(e)
            Prefs.setRegStatus(c, msg)
            if (retry && runAttemptCount < 8) Result.retry() else Result.failure()
        }
    }
}
