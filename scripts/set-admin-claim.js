#!/usr/bin/env node
// ONE-TIME setup script. Grants the {admin: true} custom claim to a single
// Firebase Auth user so Firestore rules (firestore.rules) recognize them as
// the wishlist administrator. Run this locally, once, right after creating
// the admin user in the Firebase console.
//
// Uses Application Default Credentials (your own Google account, via
// `gcloud auth application-default login`) instead of a downloaded
// service-account JSON key — some Google Workspace/Cloud orgs disable
// service-account key creation entirely, and ADC sidesteps that since it's
// just an OAuth token tied to your own account, not a generated key file.
//
// Setup (once):
//   1. Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install
//   2. gcloud auth application-default login
//   3. gcloud auth application-default set-quota-project toys-for-janek
//   4. cd scripts && npm install
//
// Usage:
//   node set-admin-claim.js admin@example.com
//
// After running, log out and back in on admin.html — an already-issued ID
// token does NOT pick up a newly-set custom claim until it's refreshed.

const admin = require('firebase-admin');

const [, , adminEmail] = process.argv;

if (!adminEmail) {
  console.error('Usage: node set-admin-claim.js admin@example.com');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'toys-for-janek',
});

async function main() {
  const user = await admin.auth().getUserByEmail(adminEmail);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  console.log(`Granted {admin: true} to ${adminEmail} (uid: ${user.uid}).`);
  console.log('Now log out and back in on admin.html so the ID token picks up the claim.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to set admin claim:', err.message);
  process.exit(1);
});
