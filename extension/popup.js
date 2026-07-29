import { FIREBASE_CONFIG, SITE_URL } from './config.js';
import {
  signInWithPassword,
  ensureFreshSession,
  decodeIdTokenClaims,
  listToys,
  listOwned,
  createToy,
  createOwned,
} from './firebase-rest.js';

// Same-name (case/whitespace-insensitive) or same-link match — used before
// creating a new entry to catch accidental duplicates (e.g. scanning the
// same product page twice). The popup doesn't keep a cached list like the
// admin pages do, so the caller fetches fresh right before checking.
function findDuplicate(list, name, link) {
  const normalizedName = (name || '').trim().toLowerCase();
  const normalizedLink = (link || '').trim().toLowerCase();
  return list.find((item) => {
    const itemName = (item.name || '').trim().toLowerCase();
    const itemLink = (item.link || '').trim().toLowerCase();
    return (normalizedLink && itemLink && itemLink === normalizedLink) || (normalizedName && itemName === normalizedName);
  });
}

const STORAGE_KEY = 'toysForJanek.session';

const loginView = document.getElementById('login-view');
const addView = document.getElementById('add-view');
const logoutBtn = document.getElementById('logout-btn');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const scanBtn = document.getElementById('scan-btn');
const toyForm = document.getElementById('toy-form');
const saveStatus = document.getElementById('save-status');
const imageInput = document.getElementById('toy-image');
const imagePreview = document.getElementById('toy-image-preview');
const openSiteBtn = document.getElementById('open-site-btn');
const openAdminBtn = document.getElementById('open-admin-btn');
const alreadyOwnedCheckbox = document.getElementById('toy-already-owned');
const submitBtn = document.getElementById('submit-btn');
const duplicateWarning = document.getElementById('duplicate-warning');
const duplicateWarningText = document.getElementById('duplicate-warning-text');
const duplicateConfirmBtn = document.getElementById('duplicate-confirm-btn');
const duplicateCancelBtn = document.getElementById('duplicate-cancel-btn');

alreadyOwnedCheckbox.addEventListener('change', () => {
  submitBtn.textContent = alreadyOwnedCheckbox.checked ? 'Dodaj do już posiadanych' : 'Dodaj do listy';
});

function openAdminPanel() {
  chrome.tabs.create({ url: `${SITE_URL}admin.html` });
}

openSiteBtn.addEventListener('click', openAdminPanel);
openAdminBtn.addEventListener('click', openAdminPanel);

async function getStoredSession() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || null;
}

async function storeSession(session) {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

async function clearSession() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

function showLoggedOut() {
  loginView.hidden = false;
  addView.hidden = true;
  logoutBtn.hidden = true;
}

function showLoggedIn() {
  loginView.hidden = true;
  addView.hidden = false;
  logoutBtn.hidden = false;
}

// Returns a fresh session (refreshing the token if needed) or null, and
// persists any refreshed token back to storage.
async function getValidSession() {
  const stored = await getStoredSession();
  if (!stored) return null;
  const fresh = await ensureFreshSession(FIREBASE_CONFIG.apiKey, stored);
  if (fresh !== stored) await storeSession(fresh);
  return fresh;
}

async function init() {
  try {
    const session = await getValidSession();
    if (session) {
      showLoggedIn();
    } else {
      showLoggedOut();
    }
  } catch {
    await clearSession();
    showLoggedOut();
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
    await storeSession(session);
    showLoggedIn();
  } catch (err) {
    loginError.textContent = 'Błąd logowania: ' + err.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  await clearSession();
  toyForm.hidden = true;
  showLoggedOut();
});

scanBtn.addEventListener('click', async () => {
  saveStatus.textContent = '';
  openSiteBtn.hidden = true;
  duplicateWarning.hidden = true;
  alreadyOwnedCheckbox.checked = false;
  submitBtn.textContent = 'Dodaj do listy';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js'],
    });

    document.getElementById('toy-name').value = result.name || '';
    document.getElementById('toy-price').value = result.price ?? '';
    document.getElementById('toy-currency').value = result.currency || 'PLN';
    document.getElementById('toy-image').value = result.imageUrl || '';
    document.getElementById('toy-link').value = result.link || tab.url || '';
    updateImagePreview();
    toyForm.hidden = false;
  } catch (err) {
    saveStatus.textContent = 'Nie udało się przeskanować strony: ' + err.message;
  }
});

function updateImagePreview() {
  const url = imageInput.value.trim();
  if (url) {
    imagePreview.src = url;
    imagePreview.hidden = false;
  } else {
    imagePreview.hidden = true;
  }
}

imageInput.addEventListener('input', updateImagePreview);

async function saveToy(session, toyData) {
  const { alreadyOwned, ...fields } = toyData;
  saveStatus.textContent = 'Zapisywanie…';
  try {
    if (alreadyOwned) {
      await createOwned(FIREBASE_CONFIG.projectId, session.idToken, fields);
      saveStatus.textContent = 'Dodano do już posiadanych!';
    } else {
      await createToy(FIREBASE_CONFIG.projectId, session.idToken, fields);
      saveStatus.textContent = 'Dodano do listy!';
    }
    toyForm.reset();
    toyForm.hidden = true;
    imagePreview.hidden = true;
    openSiteBtn.hidden = false;
    submitBtn.textContent = 'Dodaj do listy';
  } catch (err) {
    saveStatus.textContent = 'Błąd zapisu: ' + err.message;
  }
}

toyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  saveStatus.textContent = 'Sprawdzanie duplikatów…';
  duplicateWarning.hidden = true;

  const link = document.getElementById('toy-link').value.trim();
  if (!/^https?:\/\//i.test(link)) {
    saveStatus.textContent = 'Link musi zaczynać się od http:// lub https://';
    return;
  }

  const priceRaw = document.getElementById('toy-price').value;
  const originalPriceRaw = document.getElementById('toy-original-price').value;
  const name = document.getElementById('toy-name').value.trim();
  const alreadyOwned = alreadyOwnedCheckbox.checked;

  const toyData = alreadyOwned
    ? {
        alreadyOwned,
        name,
        price: priceRaw === '' ? null : parseFloat(priceRaw),
        currency: document.getElementById('toy-currency').value.trim() || 'PLN',
        imageUrl: document.getElementById('toy-image').value.trim() || null,
        link,
        adminComment: document.getElementById('toy-comment').value.trim() || null,
        addedAt: new Date(),
      }
    : {
        alreadyOwned,
        name,
        price: priceRaw === '' ? null : parseFloat(priceRaw),
        originalPrice: originalPriceRaw === '' ? null : parseFloat(originalPriceRaw),
        currency: document.getElementById('toy-currency').value.trim() || 'PLN',
        imageUrl: document.getElementById('toy-image').value.trim() || null,
        link,
        adminComment: document.getElementById('toy-comment').value.trim() || null,
        addedAt: new Date(),
        reserved: false,
        reservedByName: null,
        reservedAt: null,
      };

  try {
    const session = await getValidSession();
    if (!session) {
      saveStatus.textContent = 'Sesja wygasła, zaloguj się ponownie.';
      showLoggedOut();
      return;
    }

    const existing = alreadyOwned
      ? await listOwned(FIREBASE_CONFIG.projectId, session.idToken)
      : await listToys(FIREBASE_CONFIG.projectId, session.idToken);
    const duplicate = findDuplicate(existing, name, link);

    if (duplicate) {
      saveStatus.textContent = '';
      duplicateWarningText.textContent = `Na liście jest już "${duplicate.name}" (ta sama nazwa lub link). Dodać mimo to?`;
      duplicateWarning.hidden = false;

      duplicateConfirmBtn.onclick = () => {
        duplicateWarning.hidden = true;
        saveToy(session, toyData);
      };
      duplicateCancelBtn.onclick = () => {
        duplicateWarning.hidden = true;
        saveStatus.textContent = 'Anulowano — zabawka nie została dodana.';
      };
      return;
    }

    await saveToy(session, toyData);
  } catch (err) {
    saveStatus.textContent = 'Błąd zapisu: ' + err.message;
  }
});

init();
