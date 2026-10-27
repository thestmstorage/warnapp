import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { getStorage, ref, uploadBytes, listAll, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig, functionsRegion, appCheckSiteKey } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const TYPE_NAME = { PROBE: "Probewarnung", WARNING: "Ernste Warnung", ALL_CLEAR: "Entwarnung" };
const DEFAULTS = {
  PROBE: { title: "PROBEWARNUNG", body: "Dies ist eine Probewarnung. Es besteht keine Gefahr." },
  WARNING: { title: "WARNUNG", body: "" },
  ALL_CLEAR: { title: "ENTWARNUNG", body: "Entwarnung – die zuvor gemeldete Gefahr besteht nicht mehr." },
};
const STATUS_TEXT = { pending: "wird gesendet …", accepted_by_fcm: "von FCM angenommen", failed: "fehlgeschlagen" };
const TONE_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/ogg"];
const TONE_MAX = 2 * 1024 * 1024;

if (["localhost", "127.0.0.1"].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
const app = initializeApp(firebaseConfig);
if (appCheckSiteKey) {
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
}
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, functionsRegion);
const storage = getStorage(app);
const sendWarning = httpsCallable(fns, "sendWarning");

let unsubs = [];
let pending = null; // { type, title, body }

function setPill(el, text, state) { el.textContent = text; el.className = "pill" + (state ? " " + state : ""); }
function fmt(ts) { const d = ts && ts.toDate ? ts.toDate() : null; return d ? d.toLocaleString("de-DE") : "–"; }
function cell(tr, text, cls) { const td = document.createElement("td"); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; }
function tag(type) { const s = document.createElement("span"); s.className = "tag " + type; s.textContent = TYPE_NAME[type] || type; return s; }
function showResult(kind, lines) {
  const r = $("result"); r.hidden = false; r.className = "result " + kind; r.replaceChildren();
  lines.forEach((l) => { const p = document.createElement("p"); p.style.margin = ".2rem 0"; p.textContent = l; r.appendChild(p); });
}
function describeError(e) {
  const map = {
    "functions/unauthenticated": "Nicht angemeldet.",
    "functions/permission-denied": "Keine Admin-Berechtigung (Custom Claim fehlt) oder App Check abgelehnt.",
    "functions/resource-exhausted": "Zu viele Aussendungen in kurzer Zeit. Bitte eine Minute warten.",
    "functions/failed-precondition": e.message,
    "functions/invalid-argument": e.message,
    "functions/unavailable": "Server nicht erreichbar. Internetverbindung prüfen.",
    "functions/deadline-exceeded": "Zeitüberschreitung. Der Versandstatus ist unklar – prüfe den Warnverlauf.",
  };
  return map[e.code] || `Fehler (${e.code || "unbekannt"}): ${e.message || ""}`;
}

// ---- Anmeldung ----
$("loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault(); $("loginError").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch (e) {
    const m = { "auth/invalid-credential": "E-Mail oder Passwort falsch.", "auth/too-many-requests": "Zu viele Versuche. Später erneut versuchen.", "auth/network-request-failed": "Keine Internetverbindung." };
    $("loginError").textContent = m[e.code] || "Anmeldung fehlgeschlagen.";
  }
});
$("logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((u) => u()); unsubs = [];
  if (!user) { $("dash").hidden = true; $("login").hidden = false; return; }
  let isAdmin = false;
  try { isAdmin = (await user.getIdTokenResult(true)).claims.admin === true; } catch (_) {}
  if (!isAdmin) {
    await signOut(auth);
    $("loginError").textContent = "Dieses Konto hat keine Admin-Berechtigung.";
    return;
  }
  $("login").hidden = true; $("dash").hidden = false;
  $("whoami").textContent = user.email;
  setPill($("pillAdmin"), "Admin: bestätigt", "ok");
  setPill($("pillAppCheck"), appCheckSiteKey ? "App Check: aktiv" : "App Check: nicht konfiguriert", appCheckSiteKey ? "ok" : "bad");
  startLive(); loadTones();
});

function startLive() {
  unsubs.push(onSnapshot(query(collection(db, "warnings"), orderBy("createdAt", "desc"), limit(50)), (snap) => {
    const tb = $("history"); tb.replaceChildren();
    snap.forEach((d) => {
      const w = d.data(), tr = document.createElement("tr");
      cell(tr, fmt(w.createdAt)); cell(tr, "").appendChild(tag(w.type)); cell(tr, w.title || "", "wrap");
      cell(tr, (w.adminUid || "").slice(0, 8));
      cell(tr, (STATUS_TEXT[w.status] || w.status) + (w.errorCode ? ` (${w.errorCode})` : ""));
      tb.appendChild(tr);
    });
    if (!snap.size) { const tr = document.createElement("tr"); cell(tr, "Noch keine Meldungen."); tb.appendChild(tr); }
  }, (e) => showResult("bad", ["Verlauf nicht lesbar: " + e.code])));
  unsubs.push(onSnapshot(query(collection(db, "devices"), orderBy("lastSeen", "desc"), limit(200)), (snap) => {
    const tb = $("devices"); tb.replaceChildren();
    let ok = 0;
    snap.forEach((d) => {
      const v = d.data(), tr = document.createElement("tr");
      if (v.subscribeStatus === "subscribed") ok++;
      cell(tr, d.id.slice(0, 8)); cell(tr, v.appVersion || "?"); cell(tr, v.subscribeStatus || "?");
      cell(tr, fmt(v.registeredAt)); cell(tr, fmt(v.lastSeen)); tb.appendChild(tr);
    });
    setPill($("pillDevices"), `Geräte: ${ok} registriert`, ok ? "ok" : "");
  }, () => setPill($("pillDevices"), "Geräte: nicht lesbar", "bad")));
}

// ---- Eingabe ----
function counters() { $("titleCount").textContent = `${$("title").value.length}/60`; $("bodyCount").textContent = `${$("body").value.length}/500`; }
$("title").addEventListener("input", counters); $("body").addEventListener("input", counters); counters();

document.querySelectorAll("[data-type]").forEach((btn) => btn.addEventListener("click", () => {
  const type = btn.dataset.type;
  const isDefault = (t, b) => Object.values(DEFAULTS).some((d) => d.title === t && d.body === b) || (!t && !b);
  let title = $("title").value.trim(), body = $("body").value.trim();
  if (isDefault(title, body) || (!title && !body)) { title = DEFAULTS[type].title; body = DEFAULTS[type].body; $("title").value = title; $("body").value = body; counters(); }
  title = title || DEFAULTS[type].title; body = body || DEFAULTS[type].body;
  if (!body) { showResult("bad", ["Bitte eine Nachricht eingeben."]); return; }
  openModal({ type, title, body });
}));

// ---- Bestätigungsdialog (2 Schritte) ----
let step = 1;
function openModal(p) {
  pending = p; step = 1;
  $("mTitle").textContent = "Vorschau: " + TYPE_NAME[p.type];
  const pv = $("mPreview"); pv.className = "preview " + p.type; pv.replaceChildren();
  const t = document.createElement("div"); t.className = "pt"; t.textContent = p.title;
  const b = document.createElement("div"); b.className = "pb"; b.textContent = p.body;
  pv.append(t, b);
  $("mStep2").hidden = true; $("mPhrase").value = ""; $("mNext").textContent = "Weiter zur Bestätigung"; $("mNext").disabled = false;
  $("modal").hidden = false; $("mNext").focus();
}
function closeModal() { $("modal").hidden = true; pending = null; }
$("mCancel").addEventListener("click", closeModal);
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
$("mPhrase").addEventListener("input", () => { if (step === 2 && pending.type === "WARNING") $("mNext").disabled = $("mPhrase").value !== "WARNUNG SENDEN"; });

$("mNext").addEventListener("click", async () => {
  if (step === 1) {
    step = 2; $("mStep2").hidden = false;
    const warn = pending.type === "WARNING";
    $("mStep2Text").textContent = warn
      ? "Diese Meldung geht an alle registrierten Geräte. Bitte erneut prüfen und bestätigen."
      : `Jetzt als „${TYPE_NAME[pending.type]}“ an alle registrierten Geräte senden?`;
    $("mPhraseWrap").hidden = !warn;
    $("mNext").textContent = "Jetzt senden"; $("mNext").disabled = warn;
    (warn ? $("mPhrase") : $("mNext")).focus();
    return;
  }
  const payload = { ...pending };
  if (payload.type === "WARNING") payload.confirmation = $("mPhrase").value;
  $("mNext").disabled = true; $("mNext").textContent = "Sende …";
  closeModal();
  showResult("", ["Wird gesendet …"]);
  try {
    const { data } = await sendWarning(payload);
    if (data.ok) showResult("ok", [
      `Status: von FCM angenommen (ID ${data.fcmMessageId}).`,
      data.note, `Protokoll-ID: ${data.warningId}`,
    ]);
    else showResult("bad", [`Versand fehlgeschlagen (${data.errorCode}).`, data.note, `Protokoll-ID: ${data.warningId}`]);
  } catch (e) { showResult("bad", ["Versand nicht ausgeführt.", describeError(e)]); }
});

// ---- Warntöne ----
async function loadTones() {
  const ul = $("toneList"); ul.replaceChildren();
  try {
    const res = await listAll(ref(storage, "tones"));
    if (!res.items.length) { const li = document.createElement("li"); li.textContent = "Noch keine Töne hochgeladen."; ul.appendChild(li); }
    res.items.forEach((it) => {
      const li = document.createElement("li"), n = document.createElement("span"), del = document.createElement("button");
      n.textContent = it.name; del.className = "btn ghost"; del.textContent = "Löschen";
      del.addEventListener("click", async () => {
        if (!confirm(`„${it.name}“ löschen?`)) return;
        try { await deleteObject(it); loadTones(); } catch (e) { $("toneMsg").textContent = "Löschen fehlgeschlagen: " + e.code; }
      });
      li.append(n, del); ul.appendChild(li);
    });
  } catch (e) { $("toneMsg").textContent = "Töne nicht ladbar: " + e.code; }
}
$("toneUpload").addEventListener("click", async () => {
  const f = $("toneFile").files[0], msg = $("toneMsg");
  if (!f) { msg.textContent = "Bitte zuerst eine Datei wählen."; return; }
  if (!TONE_TYPES.includes(f.type)) { msg.textContent = "Nur WAV, MP3 oder OGG sind erlaubt."; return; }
  if (f.size >= TONE_MAX) { msg.textContent = "Datei ist zu groß (maximal 2 MB)."; return; }
  const ext = f.name.split(".").pop().toLowerCase();
  if (!["wav", "mp3", "ogg"].includes(ext)) { msg.textContent = "Dateiendung muss .wav, .mp3 oder .ogg sein."; return; }
  const safe = f.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "ton";
  msg.textContent = "Lade hoch …";
  try { await uploadBytes(ref(storage, `tones/${Date.now()}_${safe}.${ext}`), f, { contentType: f.type }); msg.textContent = "Hochgeladen."; $("toneFile").value = ""; loadTones(); }
  catch (e) { msg.textContent = "Upload fehlgeschlagen: " + (e.code || e.message); }
});
