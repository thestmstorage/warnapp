package de.warnapp.client

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.net.Uri

/** Spielt den Warnton im Vordergrund (Alarm-Lautstärke) bis „OK“ oder höchstens 60 Sekunden. */
object AlertPlayer {
    private var player: MediaPlayer? = null
    private val main = Handler(Looper.getMainLooper())
    private val autoStop = Runnable { stop() }
    private var appCtx: Context? = null

    fun toneUri(ctx: Context): Uri {
        val id = ctx.resources.getIdentifier("alarm_tone", "raw", ctx.packageName)
        return if (id != 0) Uri.parse("android.resource://${ctx.packageName}/$id")
        else RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    }

    @Synchronized
    fun start(ctx: Context) {
        stop()
        val c = ctx.applicationContext
        appCtx = c
        try {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                )
                setDataSource(c, toneUri(c))
                isLooping = true
                prepare()
                start()
            }
            vibrate(c, true)
            main.postDelayed(autoStop, 60_000)
        } catch (e: Exception) {
            player?.release(); player = null
        }
    }

    @Synchronized
    fun stop() {
        main.removeCallbacks(autoStop)
        player?.let { try { it.stop() } catch (_: Exception) {}; it.release() }
        player = null
        appCtx?.let { vibrate(it, false) }
    }

    private fun vibrate(c: Context, on: Boolean) {
        val v: Vibrator = (c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        if (on) v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400), 0)) else v.cancel()
    }
}
