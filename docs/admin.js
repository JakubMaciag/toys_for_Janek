import { FIREBASE_CONFIG } from './config.js';
import {
  signInWithPassword,
  ensureFreshSession,
  decodeIdTokenClaims,
  listToys,
  createToy,
  updateToyFields,
  deleteToy,
  createOwned,
  setGuestPasswordHash,
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
} from './firebase-rest.js';

// Purely informational now — shown as a badge, no longer drives any
// automatic "now vs future" grouping (that used to be computed from this
// list + an admin-set threshold, but that took the decision out of the
// admin's hands; see availableNow instead, which the admin sets directly
// per toy).
const AGE_CATEGORIES = [
  '0-6 miesięcy',
  '6-12 miesięcy',
  '1-2 lata',
  '2-3 lata',
  '3-4 lata',
  '4-5 lat',
  '5-6 lat',
  '6+ lat',
];

// Same-name (case/whitespace-insensitive) or same-link match against an
// already-fetched list — used before creating a new entry to catch
// accidental duplicates (e.g. scanning the same product page twice).
function findDuplicate(list, name, link) {
  const normalizedName = (name || '').trim().toLowerCase();
  const normalizedLink = (link || '').trim().toLowerCase();
  return list.find((item) => {
    const itemName = (item.name || '').trim().toLowerCase();
    const itemLink = (item.link || '').trim().toLowerCase();
    return (normalizedLink && itemLink && itemLink === normalizedLink) || (normalizedName && itemName === normalizedName);
  });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const SESSION_KEY = 'toysForJanek.adminSession';

const loginView = document.getElementById('login-view');
const adminView = document.getElementById('admin-view');
const logoutBtn = document.getElementById('logout-btn');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loadStatus = document.getElementById('load-status');
const tilesEl = document.getElementById('tiles');
const toggleAddBtn = document.getElementById('toggle-add-btn');
const addForm = document.getElementById('add-form');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addError = document.getElementById('add-error');
const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsForm = document.getElementById('settings-form');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
const settingsStatus = document.getElementById('settings-status');
const settingsGuestPassword = document.getElementById('settings-guest-password');
const addAgeCategorySelect = document.getElementById('add-age-category');
const addCategorySelect = document.getElementById('add-category');
const addAvailableNowCheckbox = document.getElementById('add-available-now');
const filterSelect = document.getElementById('filter-select');
const searchInput = document.getElementById('search-input');
const categoryTreeItemsEl = document.getElementById('category-tree-items');
const categoryAddForm = document.getElementById('category-add-form');
const categoryAddNameInput = document.getElementById('category-add-name');
const categoryStatus = document.getElementById('category-status');

AGE_CATEGORIES.forEach((cat) => {
  const opt = document.createElement('option');
  opt.value = cat;
  opt.textContent = cat;
  addAgeCategorySelect.appendChild(opt);
});

let currentToys = [];
let currentCategories = [];
let selectedCategoryId = ''; // '' = all, '__none__' = uncategorized, else a category id

function categoryName(categoryId) {
  if (!categoryId) return null;
  const cat = currentCategories.find((c) => c.id === categoryId);
  return cat ? cat.name : null;
}

function populateCategorySelects() {
  const sorted = [...currentCategories].sort((a, b) => a.name.localeCompare(b.name));
  addCategorySelect.innerHTML = '<option value="">Bez kategorii</option>';
  sorted.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    addCategorySelect.appendChild(opt);
  });
}

function getStoredSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function storeSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function getValidSession() {
  const stored = getStoredSession();
  if (!stored) return null;
  const fresh = await ensureFreshSession(FIREBASE_CONFIG.apiKey, stored);
  if (fresh !== stored) storeSession(fresh);
  return fresh;
}

function showLoggedOut() {
  loginView.hidden = false;
  adminView.hidden = true;
  logoutBtn.hidden = true;
}

function showLoggedIn() {
  loginView.hidden = true;
  adminView.hidden = false;
  logoutBtn.hidden = false;
  applyPrefillFromUrl();
}

// Handles the handoff from either the mobile bookmarklet (bookmarklet.html,
// full scrape) or the Android Share Target (manifest.json, link + title
// only): if the page was opened with prefill* query params, open the
// add-toy form pre-filled with whatever was provided, then strip the params
// from the URL so a refresh doesn't re-trigger it.
function applyPrefillFromUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has('prefillLink')) return;

  document.getElementById('add-name').value = params.get('prefillName') || '';
  document.getElementById('add-price').value = params.get('prefillPrice') || '';
  document.getElementById('add-currency').value = params.get('prefillCurrency') || 'PLN';
  document.getElementById('add-image').value = params.get('prefillImage') || '';
  document.getElementById('add-link').value = params.get('prefillLink') || '';
  addForm.hidden = false;

  history.replaceState(null, '', location.pathname);
}

function labeledInput(labelText, inputEl) {
  const label = document.createElement('label');
  label.textContent = labelText;
  label.appendChild(inputEl);
  return label;
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
  if (num === null) return '';
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

function buildViewTile(toy, refresh) {
  const tile = document.createElement('article');
  tile.className = 'tile' + (toy.reserved ? ' reserved' : '');

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

  if (toy.reserved) {
    const badge = document.createElement('div');
    badge.className = 'tile-reserved-badge';
    badge.textContent = toy.reservedByName
      ? `Zarezerwowane przez: ${toy.reservedByName}`
      : 'Zarezerwowane';
    body.appendChild(badge);
  }

  const status = document.createElement('p');
  status.className = 'status';

  const actions = document.createElement('div');
  actions.className = 'tile-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'secondary';
  editBtn.textContent = 'Edytuj';
  editBtn.addEventListener('click', () => {
    tile.replaceWith(buildEditTile(toy, refresh));
  });

  const toggleReservedBtn = document.createElement('button');
  toggleReservedBtn.type = 'button';
  toggleReservedBtn.className = 'secondary';
  toggleReservedBtn.textContent = toy.reserved ? 'Cofnij rezerwację' : 'Oznacz jako zarezerwowane';
  toggleReservedBtn.addEventListener('click', async () => {
    toggleReservedBtn.disabled = true;
    status.textContent = 'Zapisywanie…';
    try {
      const session = await getValidSession();
      await updateToyFields(FIREBASE_CONFIG.projectId, session.idToken, toy.id, {
        reserved: !toy.reserved,
        reservedByName: toy.reserved ? null : 'Administrator',
        reservedAt: toy.reserved ? null : new Date(),
      });
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
      toggleReservedBtn.disabled = false;
    }
  });

  const isAvailable = toy.availableNow !== false;
  const toggleAvailableBtn = document.createElement('button');
  toggleAvailableBtn.type = 'button';
  toggleAvailableBtn.className = 'secondary';
  toggleAvailableBtn.textContent = isAvailable ? 'Oznacz: na przyszłość' : 'Oznacz: można kupić teraz';
  toggleAvailableBtn.addEventListener('click', async () => {
    toggleAvailableBtn.disabled = true;
    status.textContent = 'Zapisywanie…';
    try {
      const session = await getValidSession();
      await updateToyFields(FIREBASE_CONFIG.projectId, session.idToken, toy.id, {
        availableNow: !isAvailable,
      });
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
      toggleAvailableBtn.disabled = false;
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger';
  deleteBtn.textContent = 'Usuń';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Usunąć "${toy.name}" z listy?`)) return;
    deleteBtn.disabled = true;
    status.textContent = 'Usuwanie…';
    try {
      const session = await getValidSession();
      await deleteToy(FIREBASE_CONFIG.projectId, session.idToken, toy.id);
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
      deleteBtn.disabled = false;
    }
  });

  const moveToOwnedBtn = document.createElement('button');
  moveToOwnedBtn.type = 'button';
  moveToOwnedBtn.className = 'secondary';
  moveToOwnedBtn.textContent = 'Przenieś do już kupionych →';
  moveToOwnedBtn.addEventListener('click', async () => {
    if (!confirm(`Przenieść "${toy.name}" do osobnej listy "już kupione" i usunąć z listy życzeń?`)) return;
    moveToOwnedBtn.disabled = true;
    status.textContent = 'Przenoszenie…';
    try {
      const session = await getValidSession();
      await createOwned(FIREBASE_CONFIG.projectId, session.idToken, {
        name: toy.name,
        price: toy.price ?? null,
        currency: toy.currency || 'PLN',
        imageUrl: toy.imageUrl ?? null,
        link: toy.link ?? null,
        adminComment: toy.adminComment ?? null,
        categoryId: toy.categoryId ?? null,
        addedAt: new Date(),
      });
      await deleteToy(FIREBASE_CONFIG.projectId, session.idToken, toy.id);
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
      moveToOwnedBtn.disabled = false;
    }
  });

  actions.append(editBtn, toggleReservedBtn, toggleAvailableBtn, moveToOwnedBtn, deleteBtn);
  body.appendChild(actions);
  body.appendChild(status);
  tile.appendChild(body);
  return tile;
}

function buildEditTile(toy, refresh) {
  const tile = document.createElement('article');
  tile.className = 'tile';

  const form = document.createElement('form');
  form.className = 'admin-form';
  form.style.gridTemplateColumns = '1fr';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.maxLength = 200;
  nameInput.value = toy.name || '';

  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '0.01';
  priceInput.value = toy.price ?? '';

  const originalPriceInput = document.createElement('input');
  originalPriceInput.type = 'number';
  originalPriceInput.min = '0';
  originalPriceInput.step = '0.01';
  originalPriceInput.value = toy.originalPrice ?? '';

  const currencyInput = document.createElement('input');
  currencyInput.type = 'text';
  currencyInput.maxLength = 10;
  currencyInput.value = toy.currency || 'PLN';

  const imageInput = document.createElement('input');
  imageInput.type = 'url';
  imageInput.maxLength = 2000;
  imageInput.value = toy.imageUrl || '';

  const linkInput = document.createElement('input');
  linkInput.type = 'url';
  linkInput.required = true;
  linkInput.maxLength = 2000;
  linkInput.value = toy.link || '';

  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.maxLength = 300;
  commentInput.value = toy.adminComment || '';

  const ageCategorySelect = document.createElement('select');
  const blankAgeOption = document.createElement('option');
  blankAgeOption.value = '';
  blankAgeOption.textContent = 'Brak (dla każdego wieku)';
  ageCategorySelect.appendChild(blankAgeOption);
  AGE_CATEGORIES.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    ageCategorySelect.appendChild(opt);
  });
  ageCategorySelect.value = toy.ageCategory || '';

  const categorySelect = document.createElement('select');
  const blankCatOption = document.createElement('option');
  blankCatOption.value = '';
  blankCatOption.textContent = 'Bez kategorii';
  categorySelect.appendChild(blankCatOption);
  [...currentCategories]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      categorySelect.appendChild(opt);
    });
  categorySelect.value = toy.categoryId || '';

  const availableNowInput = document.createElement('input');
  availableNowInput.type = 'checkbox';
  availableNowInput.checked = toy.availableNow !== false;
  const availableNowLabel = labeledInput('', availableNowInput);
  availableNowLabel.className = 'checkbox-label';
  availableNowLabel.append('Można kupować teraz');

  form.append(
    labeledInput('Nazwa', nameInput),
    labeledInput('Cena', priceInput),
    labeledInput('Cena przed promocją (opcjonalnie)', originalPriceInput),
    labeledInput('Waluta', currencyInput),
    labeledInput('Zdjęcie (URL)', imageInput),
    labeledInput('Link do sklepu', linkInput),
    labeledInput('Komentarz administratora (opcjonalnie)', commentInput),
    labeledInput('Kategoria wiekowa (opcjonalnie)', ageCategorySelect),
    labeledInput('Kategoria produktu (opcjonalnie)', categorySelect),
    availableNowLabel
  );

  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.textContent = 'Zapisz zmiany';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'secondary';
  cancelBtn.textContent = 'Anuluj';
  cancelBtn.addEventListener('click', () => tile.replaceWith(buildViewTile(toy, refresh)));
  actions.append(saveBtn, cancelBtn);
  form.appendChild(actions);

  const status = document.createElement('p');
  status.className = 'status';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!/^https?:\/\//i.test(linkInput.value.trim())) {
      status.textContent = 'Link musi zaczynać się od http:// lub https://';
      return;
    }
    status.textContent = 'Zapisywanie…';
    try {
      const session = await getValidSession();
      await updateToyFields(FIREBASE_CONFIG.projectId, session.idToken, toy.id, {
        name: nameInput.value.trim(),
        price: priceInput.value === '' ? null : parseFloat(priceInput.value),
        originalPrice: originalPriceInput.value === '' ? null : parseFloat(originalPriceInput.value),
        currency: currencyInput.value.trim() || 'PLN',
        imageUrl: imageInput.value.trim() || null,
        link: linkInput.value.trim(),
        adminComment: commentInput.value.trim() || null,
        ageCategory: ageCategorySelect.value || null,
        categoryId: categorySelect.value || null,
        availableNow: availableNowInput.checked,
      });
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
    }
  });

  tile.append(form, status);
  return tile;
}

function appendGroup(title, items) {
  if (items.length === 0) return;
  const heading = document.createElement('h3');
  heading.className = 'tile-grid-heading';
  heading.textContent = `${title} (${items.length})`;
  tilesEl.appendChild(heading);
  items.forEach((toy) => {
    try {
      tilesEl.appendChild(buildViewTile(toy, loadAndRenderToys));
    } catch (err) {
      console.error('Nie udało się wyświetlić zabawki (pominięto):', toy, err);
    }
  });
}

function preCategoryFilter() {
  const filter = filterSelect.value;
  const search = searchInput.value.trim().toLowerCase();
  return currentToys.filter((t) => {
    if (filter === 'unreserved' && t.reserved) return false;
    if (filter === 'reserved' && !t.reserved) return false;
    if (search && !(t.name || '').toLowerCase().includes(search)) return false;
    return true;
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

function buildCategoryRow(cat, count, isActive) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '2px';

  const btn = buildCategoryButton(cat.id, cat.name, count, isActive);
  btn.style.flex = '1';
  row.appendChild(btn);

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.textContent = '✏️';
  renameBtn.title = 'Zmień nazwę kategorii';
  renameBtn.className = 'icon-btn';
  renameBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newName = prompt('Nowa nazwa kategorii:', cat.name);
    if (!newName || !newName.trim() || newName.trim() === cat.name) return;
    categoryStatus.textContent = 'Zapisywanie…';
    try {
      const session = await getValidSession();
      await renameCategory(FIREBASE_CONFIG.projectId, session.idToken, cat.id, newName.trim());
      currentCategories = await listCategories(FIREBASE_CONFIG.projectId, session.idToken);
      populateCategorySelects();
      categoryStatus.textContent = '';
      renderToys();
    } catch (err) {
      categoryStatus.textContent = 'Błąd: ' + err.message;
    }
  });
  row.appendChild(renameBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Usuń kategorię';
  deleteBtn.className = 'icon-btn';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Usunąć kategorię "${cat.name}"? Zabawki w niej staną się "bez kategorii".`)) return;
    categoryStatus.textContent = 'Usuwanie…';
    try {
      const session = await getValidSession();
      await deleteCategory(FIREBASE_CONFIG.projectId, session.idToken, cat.id);
      if (selectedCategoryId === cat.id) selectedCategoryId = '';
      currentCategories = await listCategories(FIREBASE_CONFIG.projectId, session.idToken);
      populateCategorySelects();
      categoryStatus.textContent = '';
      renderToys();
    } catch (err) {
      categoryStatus.textContent = 'Błąd: ' + err.message;
    }
  });
  row.appendChild(deleteBtn);

  return row;
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
      categoryTreeItemsEl.appendChild(buildCategoryRow(cat, counts[cat.id] || 0, selectedCategoryId === cat.id));
    });

  if (uncategorized > 0) {
    categoryTreeItemsEl.appendChild(
      buildCategoryButton('__none__', 'Bez kategorii', uncategorized, selectedCategoryId === '__none__')
    );
  }
}

function renderToys() {
  tilesEl.innerHTML = '';

  const preCategory = preCategoryFilter();
  renderCategoryTree(preCategory);

  const toShow = preCategory.filter((t) => {
    if (selectedCategoryId === '__none__') return !t.categoryId;
    if (selectedCategoryId) return t.categoryId === selectedCategoryId;
    return true;
  });

  loadStatus.textContent = `${toShow.length} / ${currentToys.length} zabawek`;

  const sorted = toShow.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  const nowItems = sorted.filter((t) => t.availableNow !== false);
  const futureItems = sorted.filter((t) => t.availableNow === false);

  appendGroup('✅ Można kupować teraz', nowItems);
  appendGroup('🔜 Na przyszłość', futureItems);
}

async function loadAndRenderToys() {
  loadStatus.textContent = 'Wczytywanie…';
  tilesEl.innerHTML = '';
  try {
    const session = await getValidSession();
    const [toys, categories] = await Promise.all([
      listToys(FIREBASE_CONFIG.projectId, session.idToken),
      listCategories(FIREBASE_CONFIG.projectId, session.idToken),
    ]);
    currentToys = toys;
    currentCategories = categories;
    populateCategorySelects();
    renderToys();
  } catch (err) {
    loadStatus.textContent = 'Nie udało się wczytać listy: ' + err.message;
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const session = await signInWithPassword(FIREBASE_CONFIG.apiKey, email, password);
    const claims = decodeIdTokenClaims(session.idToken);
    if (claims.admin !== true) {
      loginError.textContent =
        'To konto nie ma uprawnień administratora (patrz SETUP.md, krok z set-admin-claim.js).';
      return;
    }
    storeSession(session);
    showLoggedIn();
    loadAndRenderToys();
  } catch (err) {
    loginError.textContent = 'Błąd logowania: ' + err.message;
  }
});

logoutBtn.addEventListener('click', () => {
  clearSession();
  showLoggedOut();
});

toggleAddBtn.addEventListener('click', () => {
  addForm.hidden = !addForm.hidden;
});

cancelAddBtn.addEventListener('click', () => {
  addForm.reset();
  addForm.hidden = true;
  addError.textContent = '';
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addError.textContent = '';
  const link = document.getElementById('add-link').value.trim();
  if (!/^https?:\/\//i.test(link)) {
    addError.textContent = 'Link musi zaczynać się od http:// lub https://';
    return;
  }
  const priceRaw = document.getElementById('add-price').value;
  const originalPriceRaw = document.getElementById('add-original-price').value;
  const toy = {
    name: document.getElementById('add-name').value.trim(),
    price: priceRaw === '' ? null : parseFloat(priceRaw),
    originalPrice: originalPriceRaw === '' ? null : parseFloat(originalPriceRaw),
    currency: document.getElementById('add-currency').value.trim() || 'PLN',
    imageUrl: document.getElementById('add-image').value.trim() || null,
    link,
    adminComment: document.getElementById('add-comment').value.trim() || null,
    ageCategory: addAgeCategorySelect.value || null,
    categoryId: addCategorySelect.value || null,
    availableNow: addAvailableNowCheckbox.checked,
    addedAt: new Date(),
    reserved: false,
    reservedByName: null,
    reservedAt: null,
  };

  const duplicate = findDuplicate(currentToys, toy.name, toy.link);
  if (duplicate && !confirm(`Na liście jest już "${duplicate.name}" (ta sama nazwa lub link). Dodać mimo to?`)) {
    return;
  }

  try {
    const session = await getValidSession();
    await createToy(FIREBASE_CONFIG.projectId, session.idToken, toy);
    addForm.reset();
    addForm.hidden = true;
    loadAndRenderToys();
  } catch (err) {
    addError.textContent = 'Błąd zapisu: ' + err.message;
  }
});

filterSelect.addEventListener('change', renderToys);
searchInput.addEventListener('input', renderToys);

categoryAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = categoryAddNameInput.value.trim();
  if (!name) return;
  categoryStatus.textContent = 'Dodawanie…';
  try {
    const session = await getValidSession();
    await createCategory(FIREBASE_CONFIG.projectId, session.idToken, name);
    currentCategories = await listCategories(FIREBASE_CONFIG.projectId, session.idToken);
    populateCategorySelects();
    categoryAddForm.reset();
    categoryStatus.textContent = '';
    renderToys();
  } catch (err) {
    categoryStatus.textContent = 'Błąd: ' + err.message;
  }
});

toggleSettingsBtn.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

cancelSettingsBtn.addEventListener('click', () => {
  settingsForm.reset();
  settingsPanel.hidden = true;
  settingsStatus.textContent = '';
});

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const newPassword = settingsGuestPassword.value;
  if (!newPassword) return;
  settingsStatus.textContent = 'Zapisywanie…';
  try {
    const session = await getValidSession();
    const hash = await sha256Hex(newPassword);
    await setGuestPasswordHash(FIREBASE_CONFIG.projectId, session.idToken, hash);
    settingsStatus.textContent = 'Hasło dla gości zapisane.';
    settingsForm.reset();
  } catch (err) {
    settingsStatus.textContent = 'Błąd: ' + err.message;
  }
});

async function init() {
  const session = await getValidSession().catch(() => null);
  if (session) {
    showLoggedIn();
    loadAndRenderToys();
  } else {
    showLoggedOut();
  }
}

init();
