#!/usr/bin/env node
// ONE-TIME setup script. Grants the {admin: true} custom claim to a single
// Firebase Auth user so Firestore rules (firestore.rules) recognize them as
// the wishlist administrator. Run this locally, once, right after creating
// the admin user in the Firebase console — never deploy this script or the
// service-account key anywhere.
//
// Usage:
//   npm install            (inside scripts/, once)
//   node set-admin-claim.js /path/to/service-account.json admin@example.com
//
// After running, log out and back in on admin.html — an already-issued ID
// token does NOT pick up a newly-set custom claim until it's refreshed.

const { readFileSync } = require('fs');
const admin = require('firebase-admin');

const [, , serviceAccountPath, adminEmail] = process.argv;

if (!serviceAccountPath || !adminEmail) {
  console.error('Usage: node set-admin-claim.js /path/to/service-account.json admin@example.com');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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
