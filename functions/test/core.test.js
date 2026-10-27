"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeCore, CONFIRM_PHRASE } = require("../core");

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }

function fakeDb() {
  const store = {};
  const col = (n) => (store[n] ||= {});
  const doc = (n, id) => ({
    set: async (d) => { col(n)[id] = { ...d }; },
    update: async (d) => { col(n)[id] = { ...col(n)[id], ...d }; },
    get: async () => ({ exists: id in col(n), data: () => col(n)[id] }),
    delete: async () => { delete col(n)[id]; },
  });
  return {
    store,
    collection: (n) => ({ doc: (id) => doc(n, id) }),
    runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, d) => ref.set(d) }),
  };
}

function setup({ sendImpl, registrationCode = "" } = {}) {
  const db = fakeDb();
  const sent = [];
  let n = 0;
  const messaging = {
    send: sendImpl || (async (m) => { sent.push(m); return "projects/x/messages/1"; }),
    subscribeToTopic: async () => ({ failureCount: 0 }),
    unsubscribeFromTopic: async () => ({}),
  };
  const core = makeCore({ HttpsError, db, messaging, serverTimestamp: () => "TS", newId: () => `id${++n}`, topic: "warnapp_test", registrationCode });
  return { core, db, sent };
}
const admin = { uid: "a1", token: { admin: true } };
const user = { uid: "u1", token: {} };

test("ohne Anmeldung: unauthenticated", async () => {
  const { core, sent } = setup();
  await assert.rejects(core.sendWarning({ data: { type: "PROBE" } }), { code: "unauthenticated" });
  assert.equal(sent.length, 0);
});

test("normaler Nutzer darf nicht senden und wird protokolliert", async () => {
  const { core, db, sent } = setup();
  await assert.rejects(core.sendWarning({ auth: user, data: { type: "WARNING", confirmation: CONFIRM_PHRASE, body: "x" } }), { code: "permission-denied" });
  assert.equal(sent.length, 0);
  assert.equal(Object.values(db.store.auditLog)[0].event, "denied_send");
});

test("Probewarnung wird mit Standardtext gesendet", async () => {
  const { core, sent, db } = setup();
  const r = await core.sendWarning({ auth: admin, data: { type: "PROBE" } });
  assert.equal(r.ok, true);
  assert.equal(r.status, "accepted_by_fcm");
  assert.equal(sent[0].topic, "warnapp_test");
  assert.equal(sent[0].data.type, "PROBE");
  assert.match(sent[0].data.body, /Probewarnung/);
  assert.equal(sent[0].android.notification.channelId, "warn_probe_v1");
  assert.equal(db.store.warnings[r.warningId].adminUid, "a1");
});

test("Ernste Warnung ohne Bestätigungsphrase wird abgelehnt", async () => {
  const { core, sent } = setup();
  await assert.rejects(core.sendWarning({ auth: admin, data: { type: "WARNING", title: "Gefahr", body: "Test", confirmation: "ja" } }), { code: "failed-precondition" });
  assert.equal(sent.length, 0);
});

test("Ernste Warnung mit Bestätigung nutzt Alarm-Kanal und Ton", async () => {
  const { core, sent } = setup();
  const r = await core.sendWarning({ auth: admin, data: { type: "WARNING", title: "Gefahr", body: "Bitte Gebäude verlassen", confirmation: CONFIRM_PHRASE } });
  assert.equal(r.ok, true);
  assert.equal(sent[0].android.notification.channelId, "warn_alarm_v1");
  assert.equal(sent[0].android.notification.sound, "alarm_tone");
  assert.match(sent[0].notification.title, /^WARNUNG: /);
});

test("Entwarnung: eigener Kanal, kein Sirenenton", async () => {
  const { core, sent } = setup();
  await core.sendWarning({ auth: admin, data: { type: "ALL_CLEAR" } });
  assert.equal(sent[0].data.type, "ALL_CLEAR");
  assert.equal(sent[0].android.notification.channelId, "warn_allclear_v1");
  assert.equal(sent[0].android.notification.sound, "default");
  assert.match(sent[0].data.body, /Entwarnung/);
});

test("zu lange Nachricht und ungültiger Typ werden abgelehnt", async () => {
  const { core } = setup();
  await assert.rejects(core.sendWarning({ auth: admin, data: { type: "PROBE", body: "x".repeat(501) } }), { code: "invalid-argument" });
  await assert.rejects(core.sendWarning({ auth: admin, data: { type: "SIRENE" } }), { code: "invalid-argument" });
});

test("FCM-Fehler wird protokolliert und ehrlich zurückgegeben", async () => {
  const { core, db } = setup({ sendImpl: async () => { const e = new Error("quota"); e.code = "messaging/quota-exceeded"; throw e; } });
  const r = await core.sendWarning({ auth: admin, data: { type: "PROBE" } });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "messaging/quota-exceeded");
  assert.equal(db.store.warnings[r.warningId].status, "failed");
});

test("Rate-Limit: 11. Aussendung pro Minute wird gestoppt", async () => {
  const { core } = setup();
  for (let i = 0; i < 10; i++) await core.sendWarning({ auth: admin, data: { type: "PROBE" } });
  await assert.rejects(core.sendWarning({ auth: admin, data: { type: "PROBE" } }), { code: "resource-exhausted" });
});

test("Geräteregistrierung: Code-Prüfung, Speichern, Abmelden", async () => {
  const { core, db } = setup({ registrationCode: "geheim" });
  const token = "t".repeat(60);
  await assert.rejects(core.registerDevice({ auth: user, data: { token, code: "falsch" } }), { code: "permission-denied" });
  await assert.rejects(core.registerDevice({ data: { token, code: "geheim" } }), { code: "unauthenticated" });
  await assert.rejects(core.registerDevice({ auth: user, data: { token: "kurz", code: "geheim" } }), { code: "invalid-argument" });
  await core.registerDevice({ auth: user, data: { token, code: "geheim", appVersion: "1.0" } });
  assert.equal(db.store.devices.u1.subscribeStatus, "subscribed");
  await core.unregisterDevice({ auth: user });
  assert.equal(db.store.devices.u1, undefined);
});
