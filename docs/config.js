// Fill these in during setup (see SETUP.md). Not secret values — Firestore
// security rules (firestore.rules) are what actually protect the data — but
// still restrict this Web API key by HTTP referrer (your GitHub Pages URL)
// in Google Cloud Console → Credentials.
export const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY',
  projectId: 'REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID',
};

// The guest-page password hash is NOT stored here — it lives in Firestore
// (doc appConfig/guestGate) so it never sits in this public git repo. Set
// or change it from admin.html ("Ustawienia" section) after logging in.
