package de.warnapp.client

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object NotificationHelper {
    // Muessen mit functions/core.js (CHANNELS) uebereinstimmen.
    const val CH_WARNING = "warn_alarm_v1"
    const val CH_PROBE = "warn_probe_v1"
    const val CH_ALL_CLEAR = "warn_allclear_v1"

    fun channelFor(type: String) = when (type) {
        AlertPayload.WARNING -> CH_WARNING
        AlertPayload.PROBE -> CH_PROBE
        else -> CH_ALL_CLEAR
    }

    /** Kanalton kann nach dem Anlegen nur vom Nutzer geändert werden. Ändert sich der Ton, neue Kanal-ID (…_v2) vergeben. */
    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val alarmAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val tone = AlertPlayer.toneUri(ctx)

        fun alarmChannel(id: String, name: Int, desc: Int) = NotificationChannel(id, ctx.getString(name), NotificationManager.IMPORTANCE_HIGH).apply {
            description = ctx.getString(desc)
            setSound(tone, alarmAttrs)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(alarmChannel(CH_WARNING, R.string.ch_warning, R.string.ch_warning_desc))
        nm.createNotificationChannel(alarmChannel(CH_PROBE, R.string.ch_probe, R.string.ch_probe_desc))
        nm.createNotificationChannel(
            NotificationChannel(CH_ALL_CLEAR, ctx.getString(R.string.ch_allclear), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = ctx.getString(R.string.ch_allclear_desc)
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()
                )
            }
        )
    }

    /** Fallback, falls der Service eine Meldung erhält, aber keine Activity sichtbar ist. */
    fun show(ctx: Context, p: AlertPayload) {
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("type", p.type); putExtra("title", p.title); putExtra("body", p.body); putExtra("warningId", p.warningId)
        }
        val pi = PendingIntent.getActivity(ctx, p.warningId.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, channelFor(p.type))
            .setSmallIcon(R.drawable.ic_stat_warn)
            .setContentTitle(p.title).setContentText(p.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(p.body))
            .setCategory(if (p.isAlarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_STATUS)
            .setPriority(if (p.isAlarm) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true).setContentIntent(pi).build()
        try { NotificationManagerCompat.from(ctx).notify(p.warningId, 0, n) } catch (_: SecurityException) {}
    }

    /** FCM postet System-Benachrichtigungen mit tag=warningId und id=0. */
    fun cancel(ctx: Context, warningId: String) {
        NotificationManagerCompat.from(ctx).cancel(warningId, 0)
    }
}
