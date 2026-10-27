// Oeffentliche Web-Konfiguration (kein Geheimnis; Schutz erfolgt ueber Auth, Regeln und App Check).
export const firebaseConfig = {
  apiKey: "AIzaSyCYlAFUiOJnBQwYEvDdY15u8kF0TigJXac",
  authDomain: "genz-kommt.firebaseapp.com",
  databaseURL: "https://genz-kommt-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "genz-kommt",
  storageBucket: "genz-kommt.firebasestorage.app",
  messagingSenderId: "935189919193",
  appId: "1:935189919193:web:b0935c486d273aa7a615c8",
  measurementId: "G-25FX364PPV"
};
export const functionsRegion = "europe-west1";
// reCAPTCHA-v3-Websiteschluessel fuer App Check (Firebase Console > App Check > Web-App). Leer = App Check aus.
export const appCheckSiteKey = "";
