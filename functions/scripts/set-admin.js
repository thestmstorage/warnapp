"use strict";
// Setzt/entfernt den Admin-Custom-Claim. Laeuft NUR lokal auf deinem Rechner.
// Authentifizierung ueber Application Default Credentials:
//   gcloud auth application-default login
// Es wird kein Schluessel in das Repository geschrieben.
// Aufruf: node scripts/set-admin.js admin@example.de [--remove]
const admin = require("firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "genz-kommt" });
(async () => {
  const [email, flag] = process.argv.slice(2);
  if (!email) { console.error("Aufruf: node scripts/set-admin.js <e-mail> [--remove]"); process.exit(1); }
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { admin: flag !== "--remove" });
  console.log(`${email} (${user.uid}): admin=${flag !== "--remove"}. Der Nutzer muss sich neu anmelden.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
