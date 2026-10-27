"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");
const { makeCore } = require("./core");

admin.initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const env = process.env.WARN_ENV || "prod";
const core = makeCore({
  HttpsError,
  db: admin.firestore(),
  messaging: admin.messaging(),
  serverTimestamp: () => FieldValue.serverTimestamp(),
  newId: () => crypto.randomUUID(),
  topic: `warnapp_${env}`,
  registrationCode: process.env.REGISTRATION_CODE || "",
});

const opts = { enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" };

exports.sendWarning = onCall(opts, (req) => core.sendWarning(req));
exports.registerDevice = onCall(opts, (req) => core.registerDevice(req));
exports.unregisterDevice = onCall(opts, (req) => core.unregisterDevice(req));
