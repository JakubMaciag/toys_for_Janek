// Thin wrapper around the Firebase Auth REST API and Firestore REST API.
// No SDK, no build step, just fetch(). Kept as a plain ES module so it can be
// loaded with <script type="module"> from popup.html / index.html / admin.html.
// This file is intentionally duplicated (not shared/symlinked) between
// extension/ and docs/ so neither side needs a bundler.

const AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1';
const TOKEN_BASE = 'https://securetoken.googleapis.com/v1';

function firestoreBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body && body.error && body.error.message) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body;
}

function normalizeSession(data) {
  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    localId: data.localId,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
  };
}

export async function signInWithPassword(apiKey, email, password) {
  const res = await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return normalizeSession(await parseJsonOrThrow(res));
}

export async function signInAnonymously(apiKey) {
  const res = await fetch(`${AUTH_BASE}/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  return normalizeSession(await parseJsonOrThrow(res));
}

export async function refreshSession(apiKey, refreshToken) {
  const res = await fetch(`${TOKEN_BASE}/token?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const data = await parseJsonOrThrow(res);
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    localId: data.user_id,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
  };
}

// Returns a session with a still-valid idToken, refreshing it first if it's
// expired (or about to expire within 60s). Returns null if session is null.
export async function ensureFreshSession(apiKey, session) {
  if (!session) return null;
  const skewMs = 60 * 1000;
  if (session.expiresAt && session.expiresAt - Date.now() > skewMs) {
    return session;
  }
  return refreshSession(apiKey, session.refreshToken);
}

// Decodes the (unverified, client-side-only) claims of an ID token so the UI
// can show a friendly "you're not an admin" message. This is NOT a security
// boundary — Firestore rules are the actual enforcement point.
export function decodeIdTokenClaims(idToken) {
  try {
    const payload = idToken.split('.')[1];
    const json = decodeURIComponent(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { stringValue: String(value) };
}

function fromFirestoreValue(fv) {
  if (!fv) return null;
  if ('nullValue' in fv) return null;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('doubleValue' in fv) return fv.doubleValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('stringValue' in fv) return fv.stringValue;
  return null;
}

function docToToy(doc) {
  const fields = doc.fields || {};
  const id = doc.name.split('/').pop();
  const toy = { id };
  for (const key of Object.keys(fields)) {
    toy[key] = fromFirestoreValue(fields[key]);
  }
  return toy;
}

function toyToFields(toy) {
  const fields = {};
  for (const key of Object.keys(toy)) {
    fields[key] = toFirestoreValue(toy[key]);
  }
  return fields;
}

export async function listToys(projectId, idToken) {
  const res = await fetch(`${firestoreBase(projectId)}/toys?pageSize=300`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return (data.documents || []).map(docToToy);
}

export async function createToy(projectId, idToken, toy) {
  const res = await fetch(`${firestoreBase(projectId)}/toys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toyToFields(toy) }),
  });
  const data = await parseJsonOrThrow(res);
  return docToToy(data);
}

// partialFields: object with ONLY the keys you want changed (drives updateMask).
export async function updateToyFields(projectId, idToken, toyId, partialFields) {
  const mask = Object.keys(partialFields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const res = await fetch(`${firestoreBase(projectId)}/toys/${toyId}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toyToFields(partialFields) }),
  });
  const data = await parseJsonOrThrow(res);
  return docToToy(data);
}

export async function deleteToy(projectId, idToken, toyId) {
  const res = await fetch(`${firestoreBase(projectId)}/toys/${toyId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  await parseJsonOrThrow(res);
}

// "Already owned/bought" record — a separate collection from `toys`, not
// tied to the guest wishlist/reservation flow at all (see firestore.rules:
// admin-only read+write, guests have no access whatsoever).
export async function listOwned(projectId, idToken) {
  const res = await fetch(`${firestoreBase(projectId)}/ownedToys?pageSize=300`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await parseJsonOrThrow(res);
  return (data.documents || []).map(docToToy);
}

export async function createOwned(projectId, idToken, item) {
  const res = await fetch(`${firestoreBase(projectId)}/ownedToys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toyToFields(item) }),
  });
  const data = await parseJsonOrThrow(res);
  return docToToy(data);
}

export async function updateOwnedFields(projectId, idToken, itemId, partialFields) {
  const mask = Object.keys(partialFields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const res = await fetch(`${firestoreBase(projectId)}/ownedToys/${itemId}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toyToFields(partialFields) }),
  });
  const data = await parseJsonOrThrow(res);
  return docToToy(data);
}

export async function deleteOwned(projectId, idToken, itemId) {
  const res = await fetch(`${firestoreBase(projectId)}/ownedToys/${itemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  await parseJsonOrThrow(res);
}

// Guest-page password hash lives in Firestore (doc appConfig/guestGate)
// instead of this repo — see firestore.rules for why it's public-readable
// and admin-only-writable. site-only concern, so this isn't duplicated
// into extension/firebase-rest.js (the extension never needs it).
const GUEST_GATE_PATH = 'appConfig/guestGate';

// Returns the stored hex hash, or null if the admin hasn't set one yet.
export async function getGuestPasswordHash(projectId) {
  const res = await fetch(`${firestoreBase(projectId)}/${GUEST_GATE_PATH}`);
  if (res.status === 404) return null;
  const data = await parseJsonOrThrow(res);
  return fromFirestoreValue((data.fields || {}).passwordSha256);
}

export async function setGuestPasswordHash(projectId, idToken, sha256Hex) {
  const res = await fetch(
    `${firestoreBase(projectId)}/${GUEST_GATE_PATH}?updateMask.fieldPaths=passwordSha256`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { passwordSha256: { stringValue: sha256Hex } } }),
    }
  );
  await parseJsonOrThrow(res);
}

// Which age category toys are currently appropriate for Janek (doc
// appConfig/settings) — public read (guest page needs it to split the
// wishlist into "buy now"/"buy later"), admin-only write.
const SETTINGS_PATH = 'appConfig/settings';

export async function getCurrentAgeCategory(projectId) {
  const res = await fetch(`${firestoreBase(projectId)}/${SETTINGS_PATH}`);
  if (res.status === 404) return null;
  const data = await parseJsonOrThrow(res);
  return fromFirestoreValue((data.fields || {}).currentAgeCategory);
}

export async function setCurrentAgeCategory(projectId, idToken, category) {
  const res = await fetch(
    `${firestoreBase(projectId)}/${SETTINGS_PATH}?updateMask.fieldPaths=currentAgeCategory`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { currentAgeCategory: { stringValue: category } } }),
    }
  );
  await parseJsonOrThrow(res);
}
