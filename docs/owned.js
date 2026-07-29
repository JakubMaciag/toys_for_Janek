import { FIREBASE_CONFIG } from './config.js';
import {
  signInWithPassword,
  ensureFreshSession,
  decodeIdTokenClaims,
  listOwned,
  createOwned,
  updateOwnedFields,
  deleteOwned,
} from './firebase-rest.js';

// Same key as admin.js on purpose — an admin already logged into admin.html
// is automatically logged in here too (same origin, same localStorage).
const SESSION_KEY = 'toysForJanek.adminSession';

const loginView = document.getElementById('login-view');
const adminView = document.getElementById('admin-view');
const logoutBtn = document.getElementById('logout-btn');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loadStatus = document.getElementById('load-status');
const totalStatus = document.getElementById('total-status');
const tilesEl = document.getElementById('tiles');
const toggleAddBtn = document.getElementById('toggle-add-btn');
const addForm = document.getElementById('add-form');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addError = document.getElementById('add-error');

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
}

function labeledInput(labelText, inputEl) {
  const label = document.createElement('label');
  label.textContent = labelText;
  label.appendChild(inputEl);
  return label;
}

function formatPrice(item) {
  if (item.price === null || item.price === undefined) return '';
  return `${item.price.toFixed(2)} ${item.currency || ''}`.trim();
}

function buildViewTile(item, refresh) {
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

  const price = formatPrice(item);
  if (price) {
    const priceEl = document.createElement('div');
    priceEl.className = 'tile-price';
    priceEl.textContent = price;
    body.appendChild(priceEl);
  }

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

  const status = document.createElement('p');
  status.className = 'status';

  const actions = document.createElement('div');
  actions.className = 'tile-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'secondary';
  editBtn.textContent = 'Edytuj';
  editBtn.addEventListener('click', () => {
    tile.replaceWith(buildEditTile(item, refresh));
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger';
  deleteBtn.textContent = 'Usuń';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Usunąć "${item.name}" z listy?`)) return;
    deleteBtn.disabled = true;
    status.textContent = 'Usuwanie…';
    try {
      const session = await getValidSession();
      await deleteOwned(FIREBASE_CONFIG.projectId, session.idToken, item.id);
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
      deleteBtn.disabled = false;
    }
  });

  actions.append(editBtn, deleteBtn);
  body.appendChild(actions);
  body.appendChild(status);
  tile.appendChild(body);
  return tile;
}

function buildEditTile(item, refresh) {
  const tile = document.createElement('article');
  tile.className = 'tile';

  const form = document.createElement('form');
  form.className = 'admin-form';
  form.style.gridTemplateColumns = '1fr';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.maxLength = 200;
  nameInput.value = item.name || '';

  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '0.01';
  priceInput.value = item.price ?? '';

  const currencyInput = document.createElement('input');
  currencyInput.type = 'text';
  currencyInput.maxLength = 10;
  currencyInput.value = item.currency || 'PLN';

  const imageInput = document.createElement('input');
  imageInput.type = 'url';
  imageInput.maxLength = 2000;
  imageInput.value = item.imageUrl || '';

  const linkInput = document.createElement('input');
  linkInput.type = 'url';
  linkInput.maxLength = 2000;
  linkInput.value = item.link || '';

  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.maxLength = 300;
  commentInput.value = item.adminComment || '';

  form.append(
    labeledInput('Nazwa', nameInput),
    labeledInput('Cena', priceInput),
    labeledInput('Waluta', currencyInput),
    labeledInput('Zdjęcie (URL)', imageInput),
    labeledInput('Link (opcjonalnie)', linkInput),
    labeledInput('Komentarz (opcjonalnie)', commentInput)
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
  cancelBtn.addEventListener('click', () => tile.replaceWith(buildViewTile(item, refresh)));
  actions.append(saveBtn, cancelBtn);
  form.appendChild(actions);

  const status = document.createElement('p');
  status.className = 'status';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const link = linkInput.value.trim();
    if (link && !/^https?:\/\//i.test(link)) {
      status.textContent = 'Link musi zaczynać się od http:// lub https://';
      return;
    }
    status.textContent = 'Zapisywanie…';
    try {
      const session = await getValidSession();
      await updateOwnedFields(FIREBASE_CONFIG.projectId, session.idToken, item.id, {
        name: nameInput.value.trim(),
        price: priceInput.value === '' ? null : parseFloat(priceInput.value),
        currency: currencyInput.value.trim() || 'PLN',
        imageUrl: imageInput.value.trim() || null,
        link: link || null,
        adminComment: commentInput.value.trim() || null,
      });
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
    }
  });

  tile.append(form, status);
  return tile;
}

function formatTotals(items) {
  const totals = {};
  for (const item of items) {
    if (item.price === null || item.price === undefined) continue;
    const currency = item.currency || 'PLN';
    totals[currency] = (totals[currency] || 0) + item.price;
  }
  const entries = Object.entries(totals);
  if (entries.length === 0) return 'Suma: 0.00 PLN';
  return 'Suma: ' + entries.map(([currency, sum]) => `${sum.toFixed(2)} ${currency}`).join(' + ');
}

async function loadAndRenderItems() {
  loadStatus.textContent = 'Wczytywanie…';
  totalStatus.textContent = '';
  tilesEl.innerHTML = '';
  try {
    const session = await getValidSession();
    const items = await listOwned(FIREBASE_CONFIG.projectId, session.idToken);
    loadStatus.textContent = `${items.length} pozycji`;
    totalStatus.textContent = formatTotals(items);
    items
      .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
      .forEach((item) => tilesEl.appendChild(buildViewTile(item, loadAndRenderItems)));
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
      loginError.textContent = 'To konto nie ma uprawnień administratora.';
      return;
    }
    storeSession(session);
    showLoggedIn();
    loadAndRenderItems();
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
  if (link && !/^https?:\/\//i.test(link)) {
    addError.textContent = 'Link musi zaczynać się od http:// lub https://';
    return;
  }
  const priceRaw = document.getElementById('add-price').value;
  const item = {
    name: document.getElementById('add-name').value.trim(),
    price: priceRaw === '' ? null : parseFloat(priceRaw),
    currency: document.getElementById('add-currency').value.trim() || 'PLN',
    imageUrl: document.getElementById('add-image').value.trim() || null,
    link: link || null,
    adminComment: document.getElementById('add-comment').value.trim() || null,
    addedAt: new Date(),
  };
  try {
    const session = await getValidSession();
    await createOwned(FIREBASE_CONFIG.projectId, session.idToken, item);
    addForm.reset();
    addForm.hidden = true;
    loadAndRenderItems();
  } catch (err) {
    addError.textContent = 'Błąd zapisu: ' + err.message;
  }
});

async function init() {
  const session = await getValidSession().catch(() => null);
  if (session) {
    showLoggedIn();
    loadAndRenderItems();
  } else {
    showLoggedOut();
  }
}

init();
