import { FIREBASE_CONFIG } from './config.js';
import {
  signInAnonymously,
  ensureFreshSession,
  listToys,
  updateToyFields,
  getGuestPasswordHash,
} from './firebase-rest.js';

const GATE_OK_KEY = 'toysForJanek.gateOk';
const SESSION_KEY = 'toysForJanek.guestSession';

const gate = document.getElementById('gate');
const gateForm = document.getElementById('gate-form');
const gateError = document.getElementById('gate-error');
const content = document.getElementById('content');
const loadStatus = document.getElementById('load-status');
const tilesEl = document.getElementById('tiles');
const emptyState = document.getElementById('empty-state');
const sortSelect = document.getElementById('sort-select');
const priceMinInput = document.getElementById('price-min');
const priceMaxInput = document.getElementById('price-max');

let currentToys = [];

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

function formatPrice(toy) {
  if (toy.price === null || toy.price === undefined) return null;
  return `${toy.price.toFixed(2)} ${toy.currency || ''}`.trim();
}

function buildTile(toy, onReserved) {
  const tile = document.createElement('article');
  tile.className = 'tile';

  if (toy.imageUrl) {
    const img = document.createElement('img');
    img.src = toy.imageUrl;
    img.alt = '';
    tile.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'tile-body';

  const name = document.createElement('div');
  name.className = 'tile-name';
  name.textContent = toy.name || '(bez nazwy)';
  body.appendChild(name);

  const price = formatPrice(toy);
  if (price) {
    const priceEl = document.createElement('div');
    priceEl.className = 'tile-price';
    priceEl.textContent = price;
    body.appendChild(priceEl);
  }

  if (toy.link && /^https?:\/\//i.test(toy.link)) {
    const link = document.createElement('a');
    link.className = 'tile-link';
    link.href = toy.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Zobacz w sklepie ↗';
    body.appendChild(link);
  }

  const actions = document.createElement('div');
  actions.className = 'tile-actions';

  const reserveBtn = document.createElement('button');
  reserveBtn.type = 'button';
  reserveBtn.textContent = 'Kupię to!';
  actions.appendChild(reserveBtn);

  const nameForm = document.createElement('div');
  nameForm.hidden = true;
  nameForm.className = 'reserve-name-form';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'reserve-name-label';
  nameLabel.textContent = 'Twoje imię (opcjonalnie, żeby inni wiedzieli kto kupuje)';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'np. Ciocia Kasia';
  nameInput.maxLength = 60;
  nameLabel.appendChild(nameInput);

  const nameActions = document.createElement('div');
  nameActions.className = 'reserve-name-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Potwierdź';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'secondary';
  cancelBtn.textContent = 'Anuluj';

  nameActions.append(confirmBtn, cancelBtn);
  nameForm.append(nameLabel, nameActions);

  const tileStatus = document.createElement('p');
  tileStatus.className = 'status';

  reserveBtn.addEventListener('click', () => {
    reserveBtn.hidden = true;
    nameForm.hidden = false;
    nameInput.focus();
  });

  cancelBtn.addEventListener('click', () => {
    nameForm.hidden = true;
    reserveBtn.hidden = false;
  });

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    tileStatus.textContent = 'Zapisywanie…';
    try {
      const session = await getGuestSession();
      await updateToyFields(FIREBASE_CONFIG.projectId, session.idToken, toy.id, {
        reserved: true,
        reservedByName: nameInput.value.trim() || null,
        reservedAt: new Date(),
      });
      onReserved();
    } catch (err) {
      tileStatus.textContent = 'Ups, ktoś już chyba to zarezerwował. Odświeżam listę…';
      setTimeout(onReserved, 1200);
    }
  });

  body.appendChild(actions);
  body.appendChild(nameForm);
  body.appendChild(tileStatus);
  tile.appendChild(body);
  return tile;
}

function renderToys() {
  tilesEl.innerHTML = '';
  emptyState.hidden = true;

  const min = priceMinInput.value === '' ? null : parseFloat(priceMinInput.value);
  const max = priceMaxInput.value === '' ? null : parseFloat(priceMaxInput.value);

  let toShow = currentToys.filter((t) => {
    if (min !== null && (t.price === null || t.price === undefined || t.price < min)) return false;
    if (max !== null && (t.price === null || t.price === undefined || t.price > max)) return false;
    return true;
  });

  const sortMode = sortSelect.value;
  if (sortMode === 'price-asc') {
    toShow.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  } else if (sortMode === 'price-desc') {
    toShow.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  } else {
    toShow.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
  }

  if (currentToys.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = 'Wszystkie zabawki mają już swoich kupujących! 🎉';
    return;
  }
  if (toShow.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = 'Żadna zabawka nie pasuje do wybranego zakresu cen.';
    return;
  }

  toShow.forEach((toy) => {
    tilesEl.appendChild(buildTile(toy, loadAndRenderToys));
  });
}

async function loadAndRenderToys() {
  loadStatus.textContent = 'Wczytywanie listy…';
  tilesEl.innerHTML = '';
  emptyState.hidden = true;
  try {
    const session = await getGuestSession();
    const toys = await listToys(FIREBASE_CONFIG.projectId, session.idToken);
    currentToys = toys.filter((t) => !t.reserved);
    loadStatus.textContent = '';
    renderToys();
  } catch (err) {
    loadStatus.textContent = 'Nie udało się wczytać listy: ' + err.message;
  }
}

sortSelect.addEventListener('change', renderToys);
priceMinInput.addEventListener('input', renderToys);
priceMaxInput.addEventListener('input', renderToys);

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
    loadAndRenderToys();
  } catch (err) {
    gateError.textContent = 'Błąd sprawdzania hasła: ' + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

if (localStorage.getItem(GATE_OK_KEY) === '1') {
  gate.hidden = true;
  content.hidden = false;
  loadAndRenderToys();
}
