// Fill these in during setup (see SETUP.md). Not secret values — Firestore
// security rules (firestore.rules) are what actually protect the data — but
// still restrict this Web API key by chrome-extension:// referrer in
// Google Cloud Console → Credentials once you know your extension's ID.
export const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY',
  projectId: 'REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID',
};
