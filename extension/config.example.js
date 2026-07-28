// Copy this file to config.js (same folder) and fill in real values — see
// SETUP.md. config.js is gitignored on purpose: unlike docs/config.js (built
// and deployed by a GitHub Actions workflow that injects the key from a repo
// secret), this file is loaded unpacked straight from your local disk by
// Chrome, so there's no build step to inject anything — the real key just
// has to live here, locally, and never gets committed.
export const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY',
  projectId: 'REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID',
};

// Opened in a new tab by the "Zobacz na liście" button after a successful save.
export const SITE_URL = 'REPLACE_WITH_YOUR_GITHUB_PAGES_URL/';
