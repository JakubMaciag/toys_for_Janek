import { FIREBASE_CONFIG } from './config.js';
import {
  signInWithPassword,
  ensureFreshSession,
  decodeIdTokenClaims,
  listToys,
  createToy,
  updateToyFields,
  deleteToy,
} from './firebase-rest.js';

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

function formatPrice(toy) {
  if (toy.price === null || toy.price === undefined) return '';
  return `${toy.price.toFixed(2)} ${toy.currency || ''}`.trim();
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
  toggleReservedBtn.textContent = toy.reserved ? 'Cofnij rezerwację' : 'Oznacz jako kupione';
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

  actions.append(editBtn, toggleReservedBtn, deleteBtn);
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

  form.append(
    labeledInput('Nazwa', nameInput),
    labeledInput('Cena', priceInput),
    labeledInput('Waluta', currencyInput),
    labeledInput('Zdjęcie (URL)', imageInput),
    labeledInput('Link do sklepu', linkInput)
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
        currency: currencyInput.value.trim() || 'PLN',
        imageUrl: imageInput.value.trim() || null,
        link: linkInput.value.trim(),
      });
      refresh();
    } catch (err) {
      status.textContent = 'Błąd: ' + err.message;
    }
  });

  tile.append(form, status);
  return tile;
}

async function loadAndRenderToys() {
  loadStatus.textContent = 'Wczytywanie…';
  tilesEl.innerHTML = '';
  try {
    const session = await getValidSession();
    const toys = await listToys(FIREBASE_CONFIG.projectId, session.idToken);
    loadStatus.textContent = `${toys.length} zabawek na liście`;
    toys
      .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
      .forEach((toy) => tilesEl.appendChild(buildViewTile(toy, loadAndRenderToys)));
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
  const toy = {
    name: document.getElementById('add-name').value.trim(),
    price: priceRaw === '' ? null : parseFloat(priceRaw),
    currency: document.getElementById('add-currency').value.trim() || 'PLN',
    imageUrl: document.getElementById('add-image').value.trim() || null,
    link,
    addedAt: new Date(),
    reserved: false,
    reservedByName: null,
    reservedAt: null,
  };
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
