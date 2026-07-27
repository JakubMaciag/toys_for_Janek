// apiKey is NOT a secret in the sense that it must stay hidden from site
// visitors (their browser has to receive it to call Firebase, same as any
// client-side app) — but we still keep the raw value out of git history and
// out of GitHub's rendered source view. The placeholder below is replaced
// with the real key at deploy time by .github/workflows/deploy-pages.yml,
// which reads it from a GitHub Actions repo secret (Settings → Secrets and
// variables → Actions → FIREBASE_SITE_API_KEY). See SETUP.md.
export const FIREBASE_CONFIG = {
  apiKey: '__FIREBASE_SITE_API_KEY__',
  projectId: 'toys-for-janek',
};

// The guest-page password hash is NOT stored here — it lives in Firestore
// (doc appConfig/guestGate) so it never sits in this public git repo. Set
// or change it from admin.html ("Ustawienia" section) after logging in.
