import { FIREBASE_CONFIG } from './config.js';
import {
  signInAnonymously,
  ensureFreshSession,
  listToys,
  listCategories,
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
const searchInput = document.getElementById('search-input');
const categoryTreeItemsEl = document.getElementById('category-tree-items');

let currentToys = [];
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

// Coerces to a number defensively: a doc with price stored as something
// other than a number (e.g. hand-edited in the Firestore console) used to
// throw here and silently kill rendering of every item after it in the
// list, since a forEach loop doesn't recover from a per-item exception.
function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function formatPrice(toy) {
  const num = toFiniteNumber(toy.price);
  if (num === null) return null;
  return `${num.toFixed(2)} ${toy.currency || ''}`.trim();
}

function buildPriceElement(toy) {
  const price = formatPrice(toy);
  const originalNum = toFiniteNumber(toy.originalPrice);
  const hasOriginal = originalNum !== null;
  if (!price && !hasOriginal) return null;

  const wrap = document.createElement('div');
  wrap.className = 'tile-price';

  if (hasOriginal) {
    const was = document.createElement('span');
    was.className = 'tile-price-original';
    was.textContent = `${originalNum.toFixed(2)} ${toy.currency || ''}`.trim();
    wrap.appendChild(was);
  }

  if (price) {
    const now = document.createElement('span');
    now.className = 'tile-price-current';
    now.textContent = price;
    wrap.appendChild(now);
  }

  return wrap;
}

function formatCheckedAt(toy) {
  if (!toy.addedAt) return null;
  const d = new Date(toy.addedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

  const priceEl = buildPriceElement(toy);
  if (priceEl) body.appendChild(priceEl);

  const checkedAt = formatCheckedAt(toy);
  if (checkedAt) {
    const checkedEl = document.createElement('div');
    checkedEl.className = 'tile-checked-at';
    checkedEl.textContent = `Cena sprawdzona: ${checkedAt}`;
    body.appendChild(checkedEl);
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

  if (toy.adminComment) {
    const comment = document.createElement('div');
    comment.className = 'tile-comment';
    comment.textContent = toy.adminComment;
    body.appendChild(comment);
  }

  const catName = categoryName(toy.categoryId);
  if (catName) {
    const catBadge = document.createElement('div');
    catBadge.className = 'tile-category-badge';
    catBadge.textContent = `🏷️ ${catName}`;
    body.appendChild(catBadge);
  }

  if (toy.ageCategory) {
    const ageBadge = document.createElement('div');
    ageBadge.className = 'tile-age-badge';
    ageBadge.textContent = `👶 ${toy.ageCategory}`;
    body.appendChild(ageBadge);
  }

  const nameForm = document.createElement('div');
  nameForm.className = 'reserve-name-form';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'reserve-name-label';
  nameLabel.textContent = 'Twoje imię (opcjonalnie — zobaczą je tylko rodzice)';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'np. Ciocia Kasia';
  nameInput.maxLength = 60;
  nameLabel.appendChild(nameInput);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Kupię to!';

  nameForm.append(nameLabel, confirmBtn);

  const tileStatus = document.createElement('p');
  tileStatus.className = 'status';

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
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

  body.appendChild(nameForm);
  body.appendChild(tileStatus);
  tile.appendChild(body);
  return tile;
}

function appendGroup(title, items) {
  if (items.length === 0) return;
  const heading = document.createElement('h3');
  heading.className = 'tile-grid-heading';
  heading.textContent = title;
  tilesEl.appendChild(heading);
  items.forEach((toy) => {
    try {
      tilesEl.appendChild(buildTile(toy, loadAndRenderToys));
    } catch (err) {
      console.error('Nie udało się wyświetlić zabawki (pominięto):', toy, err);
    }
  });
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
    renderToys();
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

function renderToys() {
  const scrollY = window.scrollY;
  tilesEl.innerHTML = '';
  emptyState.hidden = true;

  const min = priceMinInput.value === '' ? null : parseFloat(priceMinInput.value);
  const max = priceMaxInput.value === '' ? null : parseFloat(priceMaxInput.value);

  const search = searchInput.value.trim().toLowerCase();

  const preCategory = currentToys.filter((t) => {
    if (min !== null && (t.price === null || t.price === undefined || t.price < min)) return false;
    if (max !== null && (t.price === null || t.price === undefined || t.price > max)) return false;
    if (search && !(t.name || '').toLowerCase().includes(search)) return false;
    return true;
  });

  renderCategoryTree(preCategory);

  let toShow = preCategory.filter((t) => {
    if (selectedCategoryId === '__none__') return !t.categoryId;
    if (selectedCategoryId) return t.categoryId === selectedCategoryId;
    return true;
  });

  const sortMode = sortSelect.value;
  if (sortMode === 'price-asc') {
    toShow.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  } else if (sortMode === 'price-desc') {
    toShow.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  } else if (sortMode === 'added-asc') {
    toShow.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
  } else {
    // added-desc (default)
    toShow.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  }

  if (currentToys.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = 'Wszystkie zabawki mają już swoich kupujących! 🎉';
    window.scrollTo(0, scrollY);
    return;
  }
  if (toShow.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = 'Żadna zabawka nie pasuje do wyszukiwania/filtrów.';
    window.scrollTo(0, scrollY);
    return;
  }

  const nowItems = toShow.filter((t) => t.availableNow !== false);
  const futureItems = toShow.filter((t) => t.availableNow === false);

  appendGroup('✅ Można kupować teraz', nowItems);
  appendGroup('🔜 Na przyszłość (Janek jeszcze za mały)', futureItems);
  window.scrollTo(0, scrollY);
}

async function loadAndRenderToys() {
  const scrollY = window.scrollY;
  loadStatus.textContent = 'Wczytywanie listy…';
  tilesEl.innerHTML = '';
  emptyState.hidden = true;
  try {
    const session = await getGuestSession();
    const [toys, categories] = await Promise.all([
      listToys(FIREBASE_CONFIG.projectId, session.idToken),
      listCategories(FIREBASE_CONFIG.projectId, session.idToken),
    ]);
    currentToys = toys.filter((t) => !t.reserved);
    currentCategories = categories;
    loadStatus.textContent = '';
    renderToys();
  } catch (err) {
    loadStatus.textContent = 'Nie udało się wczytać listy: ' + err.message;
  } finally {
    window.scrollTo(0, scrollY);
  }
}

sortSelect.addEventListener('change', renderToys);
priceMinInput.addEventListener('input', renderToys);
priceMaxInput.addEventListener('input', renderToys);
searchInput.addEventListener('input', renderToys);

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
