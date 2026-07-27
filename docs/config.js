// Fill these in during setup (see SETUP.md). Not secret values — Firestore
// security rules (firestore.rules) are what actually protect the data — but
// still restrict this Web API key by HTTP referrer (your GitHub Pages URL)
// in Google Cloud Console → Credentials.
export const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY',
  projectId: 'REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID',
};

// SHA-256 hex digest of the shared "family password" for the guest page.
// This is a COSMETIC deterrent only (see SETUP.md) — anyone reading this
// public file's source cannot recover the password from the hash, but
// nothing stops a technical visitor from skipping the prompt entirely and
// calling the Firebase APIs directly. Generate the hash for your chosen
// password with the snippet in SETUP.md.
export const GUEST_PASSWORD_SHA256 = 'REPLACE_WITH_SHA256_HEX_OF_YOUR_FAMILY_PASSWORD';
