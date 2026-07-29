import { FIREBASE_CONFIG } from './config.js';
import { signInAnonymously, ensureFreshSession, listOwned, getGuestPasswordHash } from './firebase-rest.js';

// Same keys as guest.js on purpose — sharing localStorage means a guest who
// already unlocked index.html doesn't have to enter the password again here,
// and vice versa.
const GATE_OK_KEY = 'toysForJanek.gateOk';
const SESSION_KEY = 'toysForJanek.guestSession';

const gate = document.getElementById('gate');
const gateForm = document.getElementById('gate-form');
const gateError = document.getElementById('gate-error');
const content = document.getElementById('content');
const ownedTilesEl = document.getElementById('owned-tiles');
const ownedEmptyState = document.getElementById('owned-empty-state');
const searchInput = document.getElementById('search-input');

let currentItems = [];

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getStoredSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function storeSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function getGuestSession() {
  let session = getStoredSession();
  if (session) {
    const fresh = await ensureFreshSession(FIREBASE_CONFIG.apiKey, session);
    if (fresh !== session) storeSession(fresh);
    return fresh;
  }
  session = await signInAnonymously(FIREBASE_CONFIG.apiKey);
  storeSession(session);
  return session;
}

function buildOwnedTile(item) {
  const tile = document.createElement('article');
  tile.className = 'tile';

  if (item.imageUrl) {
    const img = document.createElement('img');
    img.src = item.imageUrl;
    img.alt = '';
    tile.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'tile-body';

  const name = document.createElement('div');
  name.className = 'tile-name';
  name.textContent = item.name || '(bez nazwy)';
  body.appendChild(name);

  if (item.link && /^https?:\/\//i.test(item.link)) {
    const link = document.createElement('a');
    link.className = 'tile-link';
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Zobacz w sklepie ↗';
    body.appendChild(link);
  }

  if (item.adminComment) {
    const comment = document.createElement('div');
    comment.className = 'tile-comment';
    comment.textContent = item.adminComment;
    body.appendChild(comment);
  }

  tile.appendChild(body);
  return tile;
}

function renderOwned() {
  ownedTilesEl.innerHTML = '';
  ownedEmptyState.hidden = true;
  const search = searchInput.value.trim().toLowerCase();
  const toShow = currentItems.filter((i) => !search || (i.name || '').toLowerCase().includes(search));
  if (toShow.length === 0) {
    ownedEmptyState.hidden = false;
    ownedEmptyState.textContent = currentItems.length === 0 ? 'Jeszcze nic tu nie ma.' : 'Nic nie pasuje do wyszukiwania.';
    return;
  }
  toShow
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
    .forEach((item) => ownedTilesEl.appendChild(buildOwnedTile(item)));
}

async function loadAndRenderOwned() {
  try {
    const session = await getGuestSession();
    const items = await listOwned(FIREBASE_CONFIG.projectId, session.idToken);
    currentItems = items.filter((i) => i.visibleToGuests === true);
    renderOwned();
  } catch (err) {
    ownedEmptyState.hidden = false;
    ownedEmptyState.textContent = 'Nie udało się wczytać listy: ' + err.message;
  }
}

searchInput.addEventListener('input', renderOwned);

gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  gateError.textContent = '';
  const submitBtn = gateForm.querySelector('button');
  submitBtn.disabled = true;
  try {
    const expectedHash = await getGuestPasswordHash(FIREBASE_CONFIG.projectId);
    if (!expectedHash) {
      gateError.textContent = 'Administrator nie ustawił jeszcze hasła (zrobi to w panelu admina).';
      return;
    }
    const entered = document.getElementById('gate-password').value;
    const hash = await sha256Hex(entered);
    if (hash !== expectedHash) {
      gateError.textContent = 'Błędne hasło.';
      return;
    }
    localStorage.setItem(GATE_OK_KEY, '1');
    gate.hidden = true;
    content.hidden = false;
    loadAndRenderOwned();
  } catch (err) {
    gateError.textContent = 'Błąd sprawdzania hasła: ' + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

if (localStorage.getItem(GATE_OK_KEY) === '1') {
  gate.hidden = true;
  content.hidden = false;
  loadAndRenderOwned();
}
