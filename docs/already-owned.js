import { FIREBASE_CONFIG } from './config.js';
import {
  signInAnonymously,
  ensureFreshSession,
  listOwned,
  listCategories,
  getGuestPasswordHash,
} from './firebase-rest.js';

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
const categoryTreeItemsEl = document.getElementById('category-tree-items');

let currentItems = [];
let currentCategories = [];
let selectedCategoryId = ''; // '' = all, '__none__' = uncategorized, else a category id

function categoryName(categoryId) {
  if (!categoryId) return null;
  const cat = currentCategories.find((c) => c.id === categoryId);
  return cat ? cat.name : null;
}

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

  const catName = categoryName(item.categoryId);
  if (catName) {
    const catBadge = document.createElement('div');
    catBadge.className = 'tile-category-badge';
    catBadge.textContent = `🏷️ ${catName}`;
    body.appendChild(catBadge);
  }

  tile.appendChild(body);
  return tile;
}

function buildCategoryButton(id, name, count, isActive) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'category-tree-item' + (isActive ? ' active' : '');
  const nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  const countSpan = document.createElement('span');
  countSpan.className = 'category-tree-count';
  countSpan.textContent = count;
  btn.append(nameSpan, countSpan);
  btn.addEventListener('click', () => {
    selectedCategoryId = id;
    renderOwned();
  });
  return btn;
}

function renderCategoryTree(baseItems) {
  const counts = {};
  let uncategorized = 0;
  baseItems.forEach((t) => {
    if (t.categoryId) counts[t.categoryId] = (counts[t.categoryId] || 0) + 1;
    else uncategorized += 1;
  });

  categoryTreeItemsEl.innerHTML = '';
  categoryTreeItemsEl.appendChild(buildCategoryButton('', 'Wszystkie', baseItems.length, selectedCategoryId === ''));

  [...currentCategories]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((cat) => {
      categoryTreeItemsEl.appendChild(
        buildCategoryButton(cat.id, cat.name, counts[cat.id] || 0, selectedCategoryId === cat.id)
      );
    });

  if (uncategorized > 0) {
    categoryTreeItemsEl.appendChild(
      buildCategoryButton('__none__', 'Bez kategorii', uncategorized, selectedCategoryId === '__none__')
    );
  }
}

function renderOwned() {
  ownedTilesEl.innerHTML = '';
  ownedEmptyState.hidden = true;
  const search = searchInput.value.trim().toLowerCase();
  const preCategory = currentItems.filter((i) => !search || (i.name || '').toLowerCase().includes(search));

  renderCategoryTree(preCategory);

  const toShow = preCategory.filter((i) => {
    if (selectedCategoryId === '__none__') return !i.categoryId;
    if (selectedCategoryId) return i.categoryId === selectedCategoryId;
    return true;
  });

  if (toShow.length === 0) {
    ownedEmptyState.hidden = false;
    ownedEmptyState.textContent = currentItems.length === 0 ? 'Jeszcze nic tu nie ma.' : 'Nic nie pasuje do wyszukiwania/filtrów.';
    return;
  }
  toShow
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
    .forEach((item) => ownedTilesEl.appendChild(buildOwnedTile(item)));
}

async function loadAndRenderOwned() {
  try {
    const session = await getGuestSession();
    const [items, categories] = await Promise.all([
      listOwned(FIREBASE_CONFIG.projectId, session.idToken),
      listCategories(FIREBASE_CONFIG.projectId, session.idToken),
    ]);
    currentItems = items.filter((i) => i.visibleToGuests === true);
    currentCategories = categories;
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
