# WarnApp

Native Android-App (Kotlin) + Firebase-Backend (Cloud Functions, Firestore, FCM, Storage) + Web-Adminpanel (HTML/CSS/JS).
Projekt: `genz-kommt` · Paketname: `de.warnapp.client` · Region der Functions: `europe-west1`.

> **Das ist ein privates Warnsystem und keine offizielle behördliche Warnung.**

## Was geprüft wurde – und was nicht

| Bereich | Status |
|---|---|
| Cloud-Functions-Logik (Rechteprüfung, Typen, Bestätigungsphrase, Rate-Limit, Fehlerprotokoll, Registrierung) | 10 Unit-Tests **ausgeführt, bestanden** (`cd functions && npm test`) |
| JavaScript-Syntax (Functions, Webpanel) | geprüft |
| XML-Ressourcen, Verweise `R.string/R.id/R.color/R.layout/R.drawable` | wohlgeformt und konsistent geprüft |
| Platzhalter-Alarmton `alarm_tone.wav` | erzeugt (4 s, gültige WAV) |
| **Gradle-Build / APK** | **nicht ausgeführt** (kein Netzwerk/Android SDK in meiner Umgebung) |
| Kotlin-Code und Android-Unit-Tests (`AlertPayloadTest`) | **nicht kompiliert, nicht ausgeführt** |
| Deploy, Login im Webpanel, echter Push, Ton auf Gerät | **nicht getestet** – siehe Abnahme-Checkliste unten |
| Firestore-/Storage-Regeln | geschrieben, **nicht** im Emulator getestet |

Bei einem Fehler im ersten Gradle-Sync schick mir die Fehlermeldung, dann korrigiere ich gezielt.

## Struktur

```
app/                 Android-App (Kotlin, minSdk 26, targetSdk 35)
functions/           Cloud Functions (Node 20): sendWarning, registerDevice, unregisterDevice
  core.js            Geschäftslogik (testbar)   test/   Unit-Tests   scripts/set-admin.js
web/                 Adminpanel (Firebase Hosting)
firestore.rules  storage.rules  firebase.json  .firebaserc
```

## Schritt 1 – Firebase Console  *(von dir auszuführen)*

1. **Authentication → Anmeldemethode**: *E-Mail/Passwort* **und** *Anonym* aktivieren (Anonym wird für die Geräteregistrierung benötigt).
2. **Authentication → Nutzer**: Admin-Konto mit E-Mail/Passwort anlegen.
3. **Firestore Database** erstellen (Produktionsmodus, Region z. B. `eur3`).
4. **Storage** aktivieren.
5. **Projekteinstellungen → Deine Apps → Android-App hinzufügen**: Paketname `de.warnapp.client`. SHA-256-Fingerabdruck eintragen (Debug: `./gradlew signingReport`). `google-services.json` herunterladen und als **`app/google-services.json`** speichern.
6. **Blaze-Tarif** aktivieren (für Cloud Functions erforderlich).
7. Optional, aber empfohlen: **zweites Firebase-Projekt für Tests** anlegen und in `.firebaserc` bei `test` eintragen. Dann gibt es getrennte Test- und Produktionsumgebungen (jeweils eigene Android-App-Registrierung und `google-services.json`).

## Schritt 2 – Backend deployen

```bash
npm i -g firebase-tools && firebase login
cd functions && npm install && npm test && cd ..
firebase deploy --only firestore:rules,storage,functions,hosting --project test    # erst Test!
```
* Umgebungsdateien: `functions/.env.test` / `functions/.env.prod` (`WARN_ENV`, optional `REGISTRATION_CODE`, `ENFORCE_APP_CHECK`). Nicht einchecken.
* Der FCM-Topic heißt `warnapp_<WARN_ENV>`; Test- und Produktionsgeräte erhalten so nie die Meldungen der anderen Umgebung.

## Schritt 3 – Admin-Recht setzen (nur serverseitig)

Clients können Custom Claims nicht selbst setzen. Lokal auf deinem Rechner:
```bash
gcloud auth application-default login          # keine Schlüsseldatei nötig
cd functions && node scripts/set-admin.js admin@beispiel.de
```
Danach im Webpanel neu anmelden. **Niemals** Service-Account-Schlüssel in App, Webseite oder Repository ablegen (`.gitignore` schließt sie aus).

## Schritt 4 – Webpanel

Läuft nach dem Deploy unter `https://genz-kommt.web.app`. Lokal: `firebase serve --only hosting` bzw. `cd web && python3 -m http.server 5000`
(dann `localhost` unter Authentication → Einstellungen → Autorisierte Domains eintragen; auf Hosting ist die Domain bereits erlaubt).

Ablauf pro Meldung: Typ-Button → **Vorschau** → **zweite Bestätigung** → (nur ernste Warnung) `WARNUNG SENDEN` eintippen → Ergebnis.
Das Panel zeigt den tatsächlichen Rückgabestatus der Function. „von FCM angenommen“ bedeutet **nicht**, dass Geräte erreicht wurden; FCM liefert bei Topic-Versand keine Zustellquittung je Gerät.

## Schritt 5 – Android-App bauen

1. Ordner in Android Studio (aktuelle stabile Version, JDK 17) öffnen, Gradle-Sync abwarten. Falls `gradlew` fehlt, erzeugt Android Studio den Wrapper, alternativ `gradle wrapper --gradle-version 8.9`.
2. **Eigenen Ton**: Datei `app/src/main/res/raw/alarm_tone.wav` ersetzen (Dateiname exakt so). Eine Platzhalter-Sirene liegt bereits dort.
   *Wichtig:* Der Ton eines Benachrichtigungskanals wird beim ersten Anlegen fest gespeichert. Nach einem Tonwechsel App deinstallieren/neu installieren oder die Kanal-IDs (`warn_alarm_v1`, `warn_probe_v1`) in `NotificationHelper.kt` **und** `functions/core.js` auf `_v2` erhöhen.
3. APK: *Build → Build APK(s)* (Debug) oder *Generate Signed Bundle/APK* (Release; Keystore selbst erzeugen und sicher aufbewahren).
4. Auf dem Gerät: App öffnen → ggf. Registrierungscode → **Registrieren** → Benachrichtigungen erlauben.

## Wie die App funktioniert

* **Empfang:** FCM-Benachrichtigungsnachricht mit hoher Priorität an den Topic. Bei geschlossener App zeigt das **System** die Benachrichtigung samt Kanalton an – es läuft kein eigener Dauer-Hintergrunddienst und keine Aktivität wird heimlich gestartet.
* **Vordergrund:** `onMessageReceived` → Dialog mit **OK**; Ton (Alarm-Lautstärke, Schleife bis OK, max. 60 s) und Vibration enden mit OK, die Benachrichtigung wird entfernt.
* **Tippen auf die Benachrichtigung:** öffnet den Dialog (ohne erneuten Ton).
* **Entwarnung:** eigener Kanal, normaler Benachrichtigungston, keine Sirene.
* **Registrierung:** erst nach Tippen auf *Registrieren* (Zustimmung). WorkManager wiederholt bei Netzfehlern automatisch; erneute Registrierung nach Tokenwechsel (`onNewToken`), App-Update (`MY_PACKAGE_REPLACED`) und App-Start.
* **Abmelden:** Server entfernt Topic-Abo und Geräteeintrag.
* **Fehlerhinweise in der App:** kein Internet, Benachrichtigungsberechtigung fehlt (Android 13+), Benachrichtigungen/Kanal ausgeschaltet, Registrierung abgelehnt.

## Sicherheitsmodell

* Warnungen nur über die Function `sendWarning`: prüft Anmeldung **und** Custom Claim `admin`, validiert Typ/Längen (Titel ≤ 60, Text ≤ 500), erzwingt `WARNUNG SENDEN` **serverseitig**, begrenzt auf 10 Aussendungen/Minute/Admin, protokolliert Erfolg, Fehler, abgelehnte und unberechtigte Versuche (`warnings`, `auditLog`).
* Firestore: Clients dürfen nichts schreiben; Lesen nur für Admins. Storage: nur Admins, nur WAV/MP3/OGG, < 2 MB.
* **Topic-Abonnement nur serverseitig** (`registerDevice`), nicht durch den Client. Missbrauchsbegrenzung durch manipulierte Clients: anonyme Authentifizierung, Rate-Limit (20/min), optionaler Registrierungscode, App Check. Geräte können ohnehin nur *empfangen*; senden kann nur ein Admin.
* **App Check:** (1) Android: Play Integrity in der Console aktivieren (Release), im Debug-Build das Debug-Token aus Logcat unter *App Check → Apps → Debug-Tokens* eintragen. (2) Web: reCAPTCHA v3 anlegen, Websiteschlüssel in `web/firebase-config.js` (`appCheckSiteKey`) eintragen. (3) Erst wenn beides läuft, in `functions/.env.*` `ENFORCE_APP_CHECK=true` setzen und neu deployen – sonst sperrst du dich selbst aus.

## Grenzen (bitte ehrlich einplanen)

Ein FCM-Push kann **keine garantierte, unbegrenzte Sirene** erzwingen:
* **Kein Internet / Flugmodus:** keine Zustellung, bis das Gerät wieder online ist (Meldung verfällt nach 1 h, Entwarnung nach 6 h).
* **Benachrichtigungen oder Kanal „Warnung“ ausgeschaltet:** keine Anzeige, kein Ton.
* **Nicht stören / lautlos / Lautstärke 0:** Kanalton kann unterdrückt werden; Ausnahmen für „Nicht stören“ kann nur der Nutzer erlauben (Systemeinstellung).
* **App erzwungen beendet** („Beenden erzwingen“) oder aggressive Hersteller-Energiesparfunktionen (Xiaomi, Huawei, Samsung u. a.): FCM-Zustellung kann ausbleiben. Abhilfe nur durch den Nutzer: Akkuoptimierung für die App ausnehmen/Autostart erlauben (Button „App-Einstellungen öffnen“).
* Die Kanal-Sirene spielt einmal (Länge der WAV) und nicht endlos; nur im Vordergrund läuft sie in Schleife bis „OK“.
* Hochgeladene Töne im Webpanel werden nur abgelegt; die App spielt den eingebauten Ton.

Die App installiert sich nicht als System-App, versteckt sich nicht und verhindert keine Deinstallation.

### Optional: autorisierte Geräteverwaltung
Für Firmen-/Familiengeräte, die du selbst verwaltest, kann ein **Android-Enterprise-Gerät im „vollständig verwalteten“ Modus** (Provisionierung per QR-Code bei der Ersteinrichtung nach Werksreset) über ein EMM/MDM (z. B. Android Management API) die App installieren, Benachrichtigungen erlauben und die Akku-Optimierung ausnehmen. Das erfordert die **Zustimmung/das Eigentum** am Gerät und ist für fremde Privatgeräte nicht vorgesehen.

## Tests

* Backend: `cd functions && npm test` → Probewarnung, ernste Warnung (mit/ohne Bestätigung), Entwarnung, unberechtigter Zugriff (ohne Login / ohne Admin-Claim), Validierung, FCM-Fehler, Rate-Limit, Registrierung.
* Android (lokal): `./gradlew testDebugUnitTest` (Payload-Parsing).

## Abnahme-Checkliste (auf deinem Testprojekt durchgehen)

- [ ] `./gradlew assembleDebug` baut fehlerfrei
- [ ] Webpanel: Login mit Admin klappt; Konto **ohne** Claim wird abgewiesen
- [ ] Probewarnung an Testgerät, App **im Vordergrund**: Dialog + Ton, OK beendet beides
- [ ] Probewarnung, App **geschlossen** (nicht „erzwungen beendet“): Benachrichtigung mit Ton
- [ ] Ernste Warnung: ohne `WARNUNG SENDEN` nicht möglich; mit Eingabe kommt sie an
- [ ] Entwarnung kommt separat ohne Sirene an
- [ ] Benachrichtigungen ausschalten / Flugmodus: App zeigt verständliche Hinweise
- [ ] Normaler Nutzer (ohne Claim) ruft `sendWarning` auf → `permission-denied` (Eintrag in `auditLog`)
- [ ] Erst danach Produktion deployen: `firebase deploy --project prod`
