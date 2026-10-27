"use strict";
const crypto = require("node:crypto");

const TYPES = Object.freeze({ PROBE: "PROBE", WARNING: "WARNING", ALL_CLEAR: "ALL_CLEAR" });
const LIMITS = Object.freeze({ titleMax: 60, bodyMax: 500, tokenMin: 20, tokenMax: 4096 });
const CONFIRM_PHRASE = "WARNUNG SENDEN";
// Muessen mit NotificationHelper.kt in der App uebereinstimmen.
const CHANNELS = Object.freeze({ PROBE: "warn_probe_v1", WARNING: "warn_alarm_v1", ALL_CLEAR: "warn_allclear_v1" });
const LABELS = Object.freeze({ PROBE: "PROBEWARNUNG", WARNING: "WARNUNG", ALL_CLEAR: "ENTWARNUNG" });
const DEFAULTS = Object.freeze({
  PROBE: { title: "PROBEWARNUNG", body: "Dies ist eine Probewarnung. Es besteht keine Gefahr." },
  WARNING: { title: "WARNUNG", body: "" },
  ALL_CLEAR: { title: "ENTWARNUNG", body: "Entwarnung – die zuvor gemeldete Gefahr besteht nicht mehr." },
});

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const t = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  return t.length <= max ? t : null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function buildMessage({ type, title, body, topic, warningId, sentAt }) {
  const label = LABELS[type];
  const shownTitle = title.toUpperCase().startsWith(label) ? title : `${label}: ${title}`;
  const isAlarm = type !== TYPES.ALL_CLEAR;
  return {
    topic,
    notification: { title: shownTitle, body },
    data: { type, title: shownTitle, body, warningId, sentAt },
    android: {
      priority: "high",
      ttl: isAlarm ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000,
      notification: {
        channelId: CHANNELS[type],
        tag: warningId,
        sound: isAlarm ? "alarm_tone" : "default",
        defaultVibrateTimings: true,
        visibility: "public",
        priority: isAlarm ? "max" : "default",
      },
    },
  };
}

function makeCore({ HttpsError, db, messaging, serverTimestamp, now = () => Date.now(), newId, topic, registrationCode = "" }) {
  async function audit(event, uid, extra) {
    try {
      await db.collection("auditLog").doc(newId()).set({ event, uid: uid || null, ...extra, at: serverTimestamp() });
    } catch (_) { /* Audit darf die Antwort nie veraendern */ }
  }

  async function checkRate(key, max) {
    const ref = db.collection("rateLimits").doc(key);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const t = now();
      let { windowStart = 0, count = 0 } = snap.exists ? snap.data() : {};
      if (t - windowStart > 60000) { windowStart = t; count = 0; }
      if (count >= max) throw new HttpsError("resource-exhausted", "Zu viele Anfragen. Bitte eine Minute warten.");
      tx.set(ref, { windowStart, count: count + 1 });
    });
  }

  function validateSend(data) {
    if (!data || typeof data !== "object") throw new HttpsError("invalid-argument", "Ungültige Anfrage.");
    const type = data.type;
    if (!Object.values(TYPES).includes(type)) throw new HttpsError("invalid-argument", "Unbekannter Meldungstyp.");
    const title = cleanText(data.title ?? "", LIMITS.titleMax);
    const body = cleanText(data.body ?? "", LIMITS.bodyMax);
    if (title === null) throw new HttpsError("invalid-argument", `Titel darf höchstens ${LIMITS.titleMax} Zeichen haben.`);
    if (body === null) throw new HttpsError("invalid-argument", `Nachricht darf höchstens ${LIMITS.bodyMax} Zeichen haben.`);
    const finalTitle = title || DEFAULTS[type].title;
    const finalBody = body || DEFAULTS[type].body;
    if (!finalBody) throw new HttpsError("invalid-argument", "Eine Nachricht ist erforderlich.");
    if (type === TYPES.WARNING && data.confirmation !== CONFIRM_PHRASE) {
      throw new HttpsError("failed-precondition", `Für eine WARNUNG muss exakt "${CONFIRM_PHRASE}" bestätigt werden.`);
    }
    return { type, title: finalTitle, body: finalBody };
  }

  async function sendWarning(request) {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Anmeldung erforderlich.");
    if (auth.token.admin !== true) {
      await audit("denied_send", auth.uid, {});
      throw new HttpsError("permission-denied", "Keine Berechtigung zum Senden von Warnungen.");
    }
    let input;
    try { input = validateSend(request.data); }
    catch (e) { await audit("rejected_send", auth.uid, { reason: e.message }); throw e; }

    await checkRate(`send_${auth.uid}`, 10);

    const warningId = newId();
    const sentAt = new Date(now()).toISOString();
    const message = buildMessage({ ...input, topic, warningId, sentAt });
    const logRef = db.collection("warnings").doc(warningId);
    await logRef.set({ ...input, adminUid: auth.uid, topic, status: "pending", createdAt: serverTimestamp() });
    try {
      const fcmMessageId = await messaging.send(message);
      await logRef.update({ status: "accepted_by_fcm", fcmMessageId, completedAt: serverTimestamp() });
      return {
        ok: true, warningId, status: "accepted_by_fcm", fcmMessageId,
        note: "FCM hat die Nachricht angenommen. Das ist KEINE Zustellbestätigung an einzelne Geräte.",
      };
    } catch (err) {
      const errorCode = (err && err.code) || "unknown";
      await logRef.update({ status: "failed", errorCode, errorMessage: String((err && err.message) || "").slice(0, 300), completedAt: serverTimestamp() });
      return { ok: false, warningId, status: "failed", errorCode, note: "Versand fehlgeschlagen. Es wurde nichts zugestellt." };
    }
  }

  async function registerDevice(request) {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Anmeldung erforderlich.");
    const d = request.data || {};
    const token = typeof d.token === "string" ? d.token : "";
    if (token.length < LIMITS.tokenMin || token.length > LIMITS.tokenMax) throw new HttpsError("invalid-argument", "Ungültiges Geräte-Token.");
    if (registrationCode) {
      if (typeof d.code !== "string" || !safeEqual(d.code, registrationCode)) {
        await audit("bad_registration_code", auth.uid, {});
        throw new HttpsError("permission-denied", "Registrierungscode falsch.");
      }
    }
    await checkRate(`reg_${auth.uid}`, 20);
    const ref = db.collection("devices").doc(auth.uid);
    const existing = await ref.get();
    const old = existing.exists ? existing.data() : null;
    if (old && old.token && old.token !== token) {
      try { await messaging.unsubscribeFromTopic(old.token, topic); } catch (_) { /* altes Token evtl. ungültig */ }
    }
    const res = await messaging.subscribeToTopic(token, topic);
    const failed = res && res.failureCount > 0;
    await ref.set({
      token, uid: auth.uid, platform: "android",
      appVersion: cleanText(String(d.appVersion ?? ""), 20) || "?",
      topic, subscribeStatus: failed ? "failed" : "subscribed",
      registeredAt: old ? old.registeredAt : serverTimestamp(),
      lastSeen: serverTimestamp(),
    });
    if (failed) throw new HttpsError("internal", "Topic-Abonnement fehlgeschlagen.");
    return { ok: true };
  }

  async function unregisterDevice(request) {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Anmeldung erforderlich.");
    const ref = db.collection("devices").doc(auth.uid);
    const snap = await ref.get();
    if (snap.exists) {
      try { await messaging.unsubscribeFromTopic(snap.data().token, topic); } catch (_) { /* weiter */ }
      await ref.delete();
    }
    return { ok: true };
  }

  return { sendWarning, registerDevice, unregisterDevice, validateSend };
}

module.exports = { makeCore, buildMessage, TYPES, LIMITS, CONFIRM_PHRASE, CHANNELS, DEFAULTS };
