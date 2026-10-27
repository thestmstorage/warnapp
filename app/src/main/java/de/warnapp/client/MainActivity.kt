package de.warnapp.client

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

class MainActivity : AppCompatActivity(), AlertBus.Listener {

    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshStatus() }
    private var dialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<TextInputEditText>(R.id.etRegCode).setText(Prefs.regCode(this))
        findViewById<Button>(R.id.btnNotif).setOnClickListener { onNotifClick() }
        findViewById<Button>(R.id.btnRegister).setOnClickListener { onRegister() }
        findViewById<Button>(R.id.btnUnregister).setOnClickListener { onUnregister() }
        findViewById<Button>(R.id.btnBattery).setOnClickListener {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        AlertBus.listener = this
        Backend.enqueueRegistration(this)
    }

    override fun onResume() {
        super.onResume()
        refreshStatus(); refreshHistory()
    }

    override fun onStop() {
        if (AlertBus.listener === this) AlertBus.listener = null
        super.onStop()
    }

    // ---- Meldungen ----
    override fun onAlert(p: AlertPayload) = showAlert(p, playSound = true)

    private fun handleIntent(i: Intent?) {
        val p = AlertPayload.fromBundle(i?.extras) ?: return
        AlertPayload.KEYS.forEach { i?.removeExtra(it) }
        // Der Systemton lief bereits über den Benachrichtigungskanal – hier nicht erneut abspielen.
        showAlert(p, playSound = false)
    }

    private fun showAlert(p: AlertPayload, playSound: Boolean) {
        AlertStore.add(this, p)
        if (playSound && p.isAlarm) AlertPlayer.start(this)
        dialog?.dismiss()
        dialog = MaterialAlertDialogBuilder(this)
            .setTitle(p.title)
            .setMessage("${p.body}\n\n${getString(R.string.received_at, fmt(p.receivedAt))}")
            .setCancelable(false)
            .setPositiveButton(R.string.ok) { _, _ ->
                AlertPlayer.stop()
                NotificationHelper.cancel(this, p.warningId)
                refreshHistory()
            }
            .show()
        refreshHistory()
    }

    private fun fmt(t: Long) = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.MEDIUM).format(Date(t))

    // ---- Status ----
    private fun hasInternet(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun permissionGranted() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun alarmChannelBlocked(): Boolean {
        val nm = getSystemService(android.app.NotificationManager::class.java)
        val ch = nm.getNotificationChannel(NotificationHelper.CH_WARNING)
        return ch != null && ch.importance == android.app.NotificationManager.IMPORTANCE_NONE
    }

    private fun refreshStatus() {
        val net = findViewById<TextView>(R.id.tvStatusNet)
        val notif = findViewById<TextView>(R.id.tvStatusNotif)
        val reg = findViewById<TextView>(R.id.tvStatusReg)
        val btn = findViewById<Button>(R.id.btnNotif)

        net.text = if (hasInternet()) getString(R.string.net_ok) else getString(R.string.net_missing)

        val enabled = NotificationManagerCompat.from(this).areNotificationsEnabled()
        when {
            !permissionGranted() -> { notif.text = getString(R.string.notif_no_permission); btn.text = getString(R.string.allow_notifications); btn.visibility = View.VISIBLE }
            !enabled -> { notif.text = getString(R.string.notif_disabled); btn.text = getString(R.string.open_settings); btn.visibility = View.VISIBLE }
            alarmChannelBlocked() -> { notif.text = getString(R.string.notif_channel_blocked); btn.text = getString(R.string.open_settings); btn.visibility = View.VISIBLE }
            else -> { notif.text = getString(R.string.notif_ok); btn.visibility = View.GONE }
        }
        reg.text = if (Prefs.wantsRegistration(this)) Prefs.regStatus(this) else getString(R.string.reg_none)
    }

    private fun onNotifClick() {
        if (!permissionGranted() && Build.VERSION.SDK_INT >= 33) {
            permLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }
    }

    // ---- Registrierung ----
    private fun onRegister() {
        Prefs.setRegCode(this, findViewById<TextInputEditText>(R.id.etRegCode).text?.toString()?.trim().orEmpty())
        Prefs.setWantsRegistration(this, true)
        Prefs.setRegStatus(this, getString(R.string.reg_running))
        if (!permissionGranted() && Build.VERSION.SDK_INT >= 33) permLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        Backend.enqueueRegistration(this)
        refreshStatus()
        Toast.makeText(this, R.string.reg_running, Toast.LENGTH_SHORT).show()
    }

    private fun onUnregister() {
        lifecycleScope.launch {
            try {
                Backend.unregister(applicationContext)
                Prefs.setRegStatus(applicationContext, getString(R.string.reg_none))
                Toast.makeText(this@MainActivity, R.string.unreg_done, Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Prefs.setWantsRegistration(applicationContext, true)
                Toast.makeText(this@MainActivity, Backend.describe(e).first, Toast.LENGTH_LONG).show()
            }
            refreshStatus()
        }
    }

    // ---- Verlauf ----
    private fun refreshHistory() {
        val box = findViewById<android.widget.LinearLayout>(R.id.llHistory)
        box.removeAllViews()
        val items = AlertStore.load(this)
        findViewById<View>(R.id.tvHistoryEmpty).visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        items.forEach { p ->
            val v = layoutInflater.inflate(R.layout.item_history, box, false)
            v.findViewById<TextView>(R.id.hTitle).apply {
                text = p.title
                setTextColor(getColor(when (p.type) { AlertPayload.WARNING -> R.color.red; AlertPayload.ALL_CLEAR -> R.color.green; else -> R.color.blue }))
            }
            v.findViewById<TextView>(R.id.hBody).text = p.body
            v.findViewById<TextView>(R.id.hTime).text = fmt(p.receivedAt)
            box.addView(v)
        }
    }
}
