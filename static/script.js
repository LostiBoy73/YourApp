// ==========================================
// KONFIGURATION
// ==========================================
const API_BASE_URL = "https://api.robots-compliance.cc";

function getQueryParam(param) {
  return new URLSearchParams(window.location.search).get(param);
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getCurrentUser() {
  return localStorage.getItem('kochflow_user') || localStorage.getItem('kochapp_user') || '';
}

function getAuthToken() {
  return localStorage.getItem('kochflow_token') || '';
}

function setAuth(username, token) {
  localStorage.setItem('kochflow_user', username);
  localStorage.setItem('kochflow_token', token);
  localStorage.removeItem('kochapp_user');
}

function logout() {
  localStorage.removeItem('kochflow_user');
  localStorage.removeItem('kochflow_token');
  window.location.href = './login.html';
}

function requireAuth() {
  if (!getAuthToken()) {
    const next = `${window.location.pathname.split('/').pop() || 'index.html'}${window.location.search || ''}`;
    window.location.href = `./login.html?next=${encodeURIComponent(next)}`;
    return false;
  }
  return true;
}

function authHeaders(extra = {}) {
  const token = getAuthToken();
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function renderCurrentUserBadge() {
  const el = document.getElementById('current-user');
  if (!el) return;

  const user = getCurrentUser();
  const token = getAuthToken();

  if (!user || !token) {
    el.innerHTML = `<small><span>Nicht angemeldet</span><a class="tiny-btn outline" role="button" href="./login.html">Anmelden</a></small>`;
    return;
  }

  el.innerHTML = `<small><span>Angemeldet als <strong>${escapeHTML(user)}</strong></span><button type="button" onclick="logout()">Abmelden</button></small>`;
}

async function apiFetch(path, options = {}) {
  const headers = authHeaders(options.headers || {});
  return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
}

function renderRecipeCard(rezept, options = {}) {
  const isPublic = Number(rezept.is_public || 0) === 1;
  const owner = rezept.owner_name || 'Unbekannt';
  const duration = rezept.dauer || 0;
  const categories = (rezept.kategorie || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 4);

  const catHTML = categories.length
    ? categories.map(k => `<span class="badge">${escapeHTML(k)}</span>`).join('')
    : '<span class="badge badge-muted">Ohne Kategorie</span>';

  const visibilityBadge = isPublic
    ? '<span class="badge badge-public">Öffentlich</span>'
    : '<span class="badge badge-private">Privat</span>';

  const showOwner = options.showOwner !== false;
  const showEdit = options.showEdit === true;

  return `
    <article class="recipe-card">
      <div class="recipe-main">
        <h3><a class="recipe-title" href="./rezepte_detail.html?id=${rezept.id}">${escapeHTML(rezept.titel)}</a></h3>
        <div>${catHTML} ${visibilityBadge}</div>
        <div class="recipe-meta">
          <span>⏱ ${escapeHTML(duration)} Min.</span>
          ${showOwner ? `<span>Von <strong>${escapeHTML(owner)}</strong></span>` : ''}
          <span>${rezept.source && rezept.source !== 'manual' ? 'Importiert' : 'Eigenes Rezept'}</span>
        </div>
      </div>
      <div class="recipe-actions">
        <a class="card-action" href="./rezepte_detail.html?id=${rezept.id}">Kochen</a>
        ${showEdit ? `<a class="card-action" href="./bearbeiten.html?id=${rezept.id}">Bearbeiten</a>` : ''}
      </div>
    </article>
  `;
}

// ==========================================
// AUTH
// ==========================================
function showAuthTab(mode) {
  const loginForm = document.getElementById('form-login');
  const registerForm = document.getElementById('form-register');
  const loginTab = document.getElementById('tab-login');
  const registerTab = document.getElementById('tab-register');
  if (!loginForm || !registerForm) return;
  loginForm.hidden = mode !== 'login';
  registerForm.hidden = mode !== 'register';
  loginTab?.classList.toggle('secondary', mode !== 'login');
  registerTab?.classList.toggle('secondary', mode !== 'register');
}

function initAuthForms() {
  const loginForm = document.getElementById('form-login');
  const registerForm = document.getElementById('form-register');
  if (!loginForm && !registerForm) return;

  const next = getQueryParam('next') || 'index.html';

  document.getElementById('tab-login')?.addEventListener('click', () => showAuthTab('login'));
  document.getElementById('tab-register')?.addEventListener('click', () => showAuthTab('register'));

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('auth-message');
    const payload = {
      username: document.getElementById('login-username').value.trim(),
      password: document.getElementById('login-password').value,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.detail || result.error || 'Anmeldung fehlgeschlagen');
      setAuth(result.username, result.token);
      window.location.href = `./${next}`;
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('auth-message');
    const password = document.getElementById('register-password').value;
    const repeat = document.getElementById('register-password-repeat').value;
    if (password !== repeat) {
      msg.textContent = 'Die Passwörter stimmen nicht überein.';
      msg.hidden = false;
      return;
    }
    const payload = {
      username: document.getElementById('register-username').value.trim(),
      password,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.detail || result.error || 'Registrierung fehlgeschlagen');
      setAuth(result.username, result.token);
      window.location.href = `./${next}`;
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
}

// ==========================================
// HOME
// ==========================================
async function loadHomeDashboard() {
  const myContainer = document.getElementById('home-my-recipes');
  const publicContainer = document.getElementById('home-public-recipes');
  const user = getCurrentUser();

  if (myContainer) {
    if (!getAuthToken()) {
      myContainer.innerHTML = '<p class="empty-note">Melde dich an, um deine privaten Rezepte zu sehen.</p>';
    } else {
      try {
        const response = await apiFetch('/api/rezepte?scope=mine');
        const data = await response.json();
        const items = (data.rezepte || []).slice(0, 3);
        myContainer.innerHTML = items.length
          ? items.map(r => renderRecipeCard(r, {showOwner: false, showEdit: true})).join('')
          : '<p class="empty-note">Noch keine eigenen Rezepte. Erstelle dein erstes Rezept.</p>';
      } catch {
        myContainer.innerHTML = '<p class="empty-note">Eigene Rezepte konnten nicht geladen werden.</p>';
      }
    }
  }

  if (publicContainer) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rezepte?scope=public`);
      const data = await response.json();
      const items = (data.rezepte || []).slice(0, 3);
      publicContainer.innerHTML = items.length
        ? items.map(r => renderRecipeCard(r, {showOwner: true, showEdit: false})).join('')
        : '<p class="empty-note">Noch keine öffentlichen Rezepte vorhanden.</p>';
    } catch {
      publicContainer.innerHTML = '<p class="empty-note">Öffentliche Rezepte konnten nicht geladen werden.</p>';
    }
  }
}

// ==========================================
// MEINE REZEPTE
// ==========================================
async function loadRezepte() {
  const container = document.getElementById('recipe-list-container');
  if (!container) return;
  if (!requireAuth()) return;

  const suche = getQueryParam('suche') || '';
  const kategorie = getQueryParam('kategorie') || '';

  try {
    const response = await apiFetch(`/api/rezepte?scope=mine&suche=${encodeURIComponent(suche)}&kategorie=${encodeURIComponent(kategorie)}`);
    if (!response.ok) throw new Error('Rezepte konnten nicht geladen werden');
    const data = await response.json();

    const searchInput = document.getElementById('suche-input');
    if (searchInput) searchInput.value = suche;

    const catSelect = document.getElementById('kategorie-select');
    if (catSelect) {
      catSelect.innerHTML = '<option value="">Alle Kategorien</option>';
      (data.kategorien || []).forEach(kat => {
        const selected = kat.toLowerCase() === kategorie.toLowerCase() ? 'selected' : '';
        catSelect.innerHTML += `<option value="${escapeHTML(kat)}" ${selected}>${escapeHTML(kat)}</option>`;
      });
    }

    const rezepte = data.rezepte || [];
    container.innerHTML = rezepte.length
      ? rezepte.map(r => renderRecipeCard(r, {showOwner: false, showEdit: true})).join('')
      : '<p class="empty-note">Noch keine eigenen Rezepte gefunden.</p>';
  } catch (error) {
    container.innerHTML = '<p class="empty-note">Fehler beim Laden der Rezepte.</p>';
    console.error(error);
  }
}

// ==========================================
// ÖFFENTLICHE REZEPTE
// ==========================================
async function loadPublicRezepte() {
  const container = document.getElementById('public-recipe-list-container');
  if (!container) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/rezepte?scope=public`);
    if (!response.ok) throw new Error('Öffentliche Rezepte konnten nicht geladen werden');
    const data = await response.json();
    const rezepte = data.rezepte || [];
    container.innerHTML = rezepte.length
      ? rezepte.map(r => renderRecipeCard(r, {showOwner: true, showEdit: false})).join('')
      : '<p class="empty-note">Noch keine öffentlichen Rezepte vorhanden.</p>';
  } catch (error) {
    container.innerHTML = '<p class="empty-note">Fehler beim Laden der öffentlichen Rezepte.</p>';
    console.error(error);
  }
}

// ==========================================
// REZEPT DETAIL
// ==========================================
let slides = [];
let aktuellerSchritt = 0;
let aktuellesRezept = null;

async function loadRezeptDetail() {
  const container = document.getElementById('detail-container');
  if (!container) return;

  const id = getQueryParam('id');
  if (!id) {
    container.innerHTML = 'Keine Rezept-ID angegeben.';
    return;
  }

  try {
    const response = await apiFetch(`/api/rezepte/${id}`);
    if (!response.ok) throw new Error('Rezept nicht gefunden oder privat');
    const rezept = await response.json();
    aktuellesRezept = rezept;

    document.title = `${rezept.titel} · KochFlow`;
    document.getElementById('detail-titel').innerText = rezept.titel;

    const ownerEl = document.getElementById('detail-owner');
    if (ownerEl) ownerEl.innerHTML = `Von <strong>${escapeHTML(rezept.owner_name || 'Unbekannt')}</strong> · ${Number(rezept.is_public || 0) === 1 ? 'Öffentlich' : 'Privat'}`;

    let tagsHTML = '';
    if (rezept.kategorie) {
      rezept.kategorie.split(',').forEach(k => {
        if (k.trim()) tagsHTML += `<span class="badge">${escapeHTML(k.trim())}</span>`;
      });
    }
    tagsHTML += Number(rezept.is_public || 0) === 1 ? '<span class="badge badge-public">Öffentlich</span>' : '<span class="badge badge-private">Privat</span>';
    document.getElementById('detail-tags').innerHTML = tagsHTML;

    const portionenInput = document.getElementById('portionen-rechner');
    if (portionenInput) {
      portionenInput.value = rezept.portionen || 1;
      portionenInput.dataset.standard = rezept.portionen || 1;
    }

    const zutatenList = document.getElementById('detail-zutaten');
    zutatenList.innerHTML = '';
    if (rezept.zutaten) {
      rezept.zutaten.split('\n').forEach(zeile => {
        if (!zeile.trim()) return;
        const teile = zeile.split('|');
        if (teile.length === 3) {
          zutatenList.innerHTML += `<li><strong><span class="zutat-menge" data-grundmenge="${escapeHTML(teile[0])}">${escapeHTML(teile[0])}</span> ${escapeHTML(teile[1])}</strong> ${escapeHTML(teile[2])}</li>`;
        } else {
          zutatenList.innerHTML += `<li>${escapeHTML(zeile)}</li>`;
        }
      });
    } else {
      zutatenList.innerHTML = '<li>Keine Zutaten angegeben.</li>';
    }

    const schritteContainer = document.getElementById('detail-schritte');
    schritteContainer.innerHTML = '';
    const schritte = rezept.anleitung ? rezept.anleitung.split('|||').filter(s => s.trim()) : [];

    if (schritte.length > 0) {
      schritte.forEach((schritt, index) => {
        const teile = schritt.split(':::');
        const zeit = teile.length === 2 ? teile[0] : '';
        const text = teile.length === 2 ? teile[1] : teile[0];
        const display = index === 0 ? 'flex' : 'none';
        schritteContainer.innerHTML += `
          <div class="schritt-slide" style="display:${display};">
            <div class="recipe-meta"><strong>Schritt ${index + 1} von ${schritte.length}</strong>${zeit ? `<span>${escapeHTML(zeit)} Min.</span>` : ''}</div>
            <p style="font-size:1.25rem;margin:auto 0;text-align:center;">${escapeHTML(text)}</p>
          </div>`;
      });
    } else {
      schritteContainer.innerHTML = '<p>Keine Anleitung vorhanden.</p>';
    }

    slides = document.querySelectorAll('.schritt-slide');
    aktuellerSchritt = 0;
    updateButtons();

    const isOwner = rezept.owner_name === getCurrentUser();
    const ownerControls = document.getElementById('owner-controls');
    if (ownerControls) ownerControls.style.display = isOwner ? 'flex' : 'none';

    const visibilityBtn = document.getElementById('btn-visibility');
    if (visibilityBtn) {
      visibilityBtn.style.display = isOwner ? 'inline-flex' : 'none';
      visibilityBtn.textContent = Number(rezept.is_public || 0) === 1 ? 'Wieder privat machen' : 'Öffentlich teilen';
    }
  } catch (error) {
    container.innerHTML = '<p class="empty-note">Fehler beim Laden des Rezepts.</p>';
    console.error(error);
  }
}

function portionenUmrechnen() {
  const input = document.getElementById('portionen-rechner');
  if (!input) return;
  const neuePortionen = Number(input.value || 1);
  const standardPortionen = Number(input.dataset.standard || 1);
  const mengenFelder = document.querySelectorAll('.zutat-menge');
  mengenFelder.forEach(feld => {
    const grundMenge = parseFloat(String(feld.getAttribute('data-grundmenge') || '').replace(',', '.'));
    if (!isNaN(grundMenge) && standardPortionen > 0) {
      const neueMenge = (grundMenge / standardPortionen) * neuePortionen;
      feld.innerText = (Number.isInteger(neueMenge) ? neueMenge : neueMenge.toFixed(1)).toString().replace('.', ',');
    }
  });
}

function updateButtons() {
  const btnZurueck = document.getElementById('btn-zurueck');
  const btnWeiter = document.getElementById('btn-weiter');
  if (!btnZurueck || !btnWeiter) return;
  btnZurueck.disabled = aktuellerSchritt === 0;
  btnWeiter.disabled = aktuellerSchritt >= slides.length - 1;
}
function zeigeSchritt(index) { slides.forEach((slide, i) => { slide.style.display = i === index ? 'flex' : 'none'; }); aktuellerSchritt = index; updateButtons(); }
function naechsterSchritt() { if (aktuellerSchritt < slides.length - 1) zeigeSchritt(aktuellerSchritt + 1); }
function vorherigerSchritt() { if (aktuellerSchritt > 0) zeigeSchritt(aktuellerSchritt - 1); }

async function toggleRezeptVisibility() {
  if (!aktuellesRezept) return;
  if (!requireAuth()) return;
  const nextPublic = Number(aktuellesRezept.is_public || 0) !== 1;
  try {
    const response = await apiFetch(`/api/rezepte/${aktuellesRezept.id}/visibility`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({is_public: nextPublic}),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.detail || result.error || 'Sichtbarkeit konnte nicht geändert werden');
    window.location.reload();
  } catch (err) {
    alert(err.message);
  }
}

async function addRezeptToEinkaufsliste() {
  if (!requireAuth()) return;
  const id = getQueryParam('id');
  const btn = document.getElementById('btn-einkaufsliste');
  if (btn) btn.innerHTML = 'Füge hinzu...';
  try {
    const response = await apiFetch(`/api/einkaufsliste/${id}`, { method: 'POST' });
    if (!response.ok) throw new Error('Fehler beim Hinzufügen');
    if (btn) {
      btn.innerHTML = 'Auf der Einkaufsliste';
      setTimeout(() => { btn.innerHTML = 'Zur Einkaufsliste hinzufügen'; }, 2500);
    }
  } catch (e) { alert('Fehler beim Hinzufügen.'); }
}

async function rezeptLoeschen() {
  if (!requireAuth()) return;
  if (!confirm('Möchtest du dieses Rezept wirklich löschen?')) return;
  const id = getQueryParam('id');
  try {
    const response = await apiFetch(`/api/rezepte/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Löschen fehlgeschlagen');
    window.location.href = './rezepte.html';
  } catch (e) { alert(e.message); }
}

// ==========================================
// EINKAUFSLISTE
// ==========================================
async function loadEinkaufsliste() {
  const containerRezepte = document.getElementById('einkauf-rezepte');
  const containerZutaten = document.getElementById('einkauf-zutaten');
  const containerManuell = document.getElementById('einkauf-manuell');
  if (!containerRezepte) return;
  if (!requireAuth()) return;

  try {
    const response = await apiFetch('/api/einkaufsliste');
    const data = await response.json();

    containerRezepte.innerHTML = (data.rezepte || []).length
      ? data.rezepte.map(titel => `<li><strong>${escapeHTML(titel)}</strong><button onclick="removeEinkaufRezept('${escapeHTML(titel)}')" class="outline">Entfernen</button></li>`).join('')
      : '<p class="empty-note">Noch keine Rezepte hinzugefügt.</p>';

    containerZutaten.innerHTML = (data.zutaten || []).length
      ? data.zutaten.map(z => `<li><label><input type="checkbox"> <strong>${escapeHTML(z.menge)} ${escapeHTML(z.einheit)}</strong> ${escapeHTML(z.name)}</label></li>`).join('')
      : '<p class="empty-note">Die Zutatenliste ist leer.</p>';

    const manuellHeader = document.getElementById('manuell-header');
    if ((data.manuell || []).length > 0) {
      if (manuellHeader) manuellHeader.style.display = 'block';
      containerManuell.innerHTML = data.manuell.map(item => `<li><label><input type="checkbox"> ${escapeHTML(item.name)}</label><button onclick="removeEinkaufManuell(${item.id})" class="outline">Entfernen</button></li>`).join('');
    } else {
      if (manuellHeader) manuellHeader.style.display = 'none';
      containerManuell.innerHTML = '';
    }
  } catch (e) { console.error(e); }
}
async function removeEinkaufRezept(titel) { await apiFetch('/api/einkaufsliste/entfernen_rezept', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({titel}) }); loadEinkaufsliste(); }
async function removeEinkaufManuell(id) { await apiFetch(`/api/einkaufsliste/manuell/${id}`, { method:'DELETE' }); loadEinkaufsliste(); }

// ==========================================
// FORMULARE
// ==========================================
function addZutatZeile() { const c=document.getElementById('zutaten-container'); const n=c.firstElementChild.cloneNode(true); n.querySelectorAll('input').forEach(i=>i.value=''); c.appendChild(n); }
function addSchrittZeile() { const c=document.getElementById('schritte-container'); const n=c.firstElementChild.cloneNode(true); n.querySelectorAll('input,textarea').forEach(i=>i.value=''); c.appendChild(n); }
function addKategorieZeile() { const c=document.getElementById('kategorie-container'); const n=c.firstElementChild.cloneNode(true); n.querySelectorAll('input').forEach(i=>i.value=''); c.appendChild(n); }
function removeZeile(element) { const zeile = element.parentElement; const container = zeile.parentElement; if (container.children.length > 1) zeile.remove(); else zeile.querySelectorAll('input, textarea').forEach(input => input.value = ''); }

function initCreateForm() {
  const form = document.getElementById('form-neues-rezept');
  if (!form) return;
  if (!requireAuth()) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const btn = e.submitter;
    btn.disabled = true; btn.innerHTML = 'Speichere...';
    try {
      const response = await apiFetch('/api/rezepte', {method:'POST', body: formData});
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.detail || result.error || 'Speichern fehlgeschlagen');
      window.location.href = `./rezepte_detail.html?id=${result.id}`;
    } catch (error) {
      alert('Fehler beim Speichern: ' + error.message);
      btn.disabled = false; btn.innerHTML = 'Rezept speichern';
    }
  });
}

async function loadBearbeitenForm() {
  const form = document.getElementById('form-bearbeiten');
  if (!form) return;
  if (!requireAuth()) return;
  const id = getQueryParam('id');
  if (!id) { alert('Keine ID gefunden'); return; }
  try {
    const response = await apiFetch(`/api/rezepte/${id}`);
    if (!response.ok) throw new Error('Rezept nicht gefunden');
    const rezept = await response.json();
    document.getElementById('titel').value = rezept.titel;
    document.getElementById('portionen').value = rezept.portionen || 1;

    const katContainer = document.getElementById('kategorie-container');
    if (katContainer && rezept.kategorie) {
      katContainer.innerHTML = '';
      rezept.kategorie.split(',').filter(k=>k.trim()).forEach(k => {
        katContainer.innerHTML += `<div class="dynamic-row category-row"><input type="text" name="kategorie[]" value="${escapeHTML(k.trim())}" placeholder="z.B. Vegetarisch"><button type="button" class="outline" onclick="removeZeile(this)">Entfernen</button></div>`;
      });
    }

    const zutatenContainer = document.getElementById('zutaten-container');
    if (zutatenContainer && rezept.zutaten) {
      zutatenContainer.innerHTML = '';
      rezept.zutaten.split('\n').forEach(zeile => {
        if (!zeile.trim()) return;
        const t = zeile.split('|');
        const m = t.length === 3 ? t[0] : '';
        const e = t.length === 3 ? t[1] : '';
        const n = t.length === 3 ? t[2] : zeile;
        zutatenContainer.innerHTML += `<div class="dynamic-row"><input type="text" name="zutaten_menge[]" value="${escapeHTML(m)}" placeholder="Menge"><input type="text" name="zutaten_einheit[]" value="${escapeHTML(e)}" placeholder="Einheit"><input type="text" name="zutaten_name[]" value="${escapeHTML(n)}" placeholder="Zutat" required><button type="button" class="outline" onclick="removeZeile(this)">Entfernen</button></div>`;
      });
    }

    const schritteContainer = document.getElementById('schritte-container');
    if (schritteContainer && rezept.anleitung) {
      schritteContainer.innerHTML = '';
      rezept.anleitung.split('|||').forEach(schritt => {
        if (!schritt.trim()) return;
        const t = schritt.split(':::');
        const zeit = t.length === 2 ? t[0] : '';
        const text = t.length === 2 ? t[1] : t[0];
        schritteContainer.innerHTML += `<div class="dynamic-row step-row"><input type="number" name="anleitung_dauer[]" value="${escapeHTML(zeit)}" placeholder="Min."><textarea name="anleitung_schritt[]" placeholder="Was ist zu tun?" required>${escapeHTML(text)}</textarea><button type="button" class="outline" onclick="removeZeile(this)">Entfernen</button></div>`;
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const btn = e.submitter;
      btn.disabled = true; btn.innerHTML = 'Aktualisiere...';
      try {
        const response = await apiFetch(`/api/rezepte/${id}`, {method:'PUT', body: formData});
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.detail || result.error || 'Aktualisieren fehlgeschlagen');
        window.location.href = `./rezepte_detail.html?id=${id}`;
      } catch (error) {
        alert('Fehler beim Aktualisieren: ' + error.message);
        btn.disabled = false; btn.innerHTML = 'Änderungen speichern';
      }
    });
  } catch (e) { console.error(e); }
}

// ==========================================
// IMPORT / ENTDECKEN
// ==========================================
function initImportForms() {
  const formChefkoch = document.getElementById('form-import-chefkoch');
  if (!formChefkoch) return;
  if (!requireAuth()) return;
  formChefkoch.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('url').value;
    const btn = e.submitter; btn.innerHTML = 'Importiere...'; btn.disabled = true;
    const msgBox = document.getElementById('import-message');
    try {
      const response = await apiFetch('/api/import_chefkoch', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url})});
      const result = await response.json();
      if (result.success) window.location.href = `./bearbeiten.html?id=${result.id}`;
      else throw new Error(result.error || 'Import fehlgeschlagen');
    } catch (error) {
      msgBox.innerHTML = `Fehler: ${escapeHTML(error.message)}`; msgBox.style.display = 'block';
      btn.innerHTML = 'Rezept importieren'; btn.disabled = false;
    }
  });
}

async function apiRezeptImportieren(apiId, btnElement) {
  if (!requireAuth()) return;
  btnElement.innerHTML = 'Importiere...'; btnElement.disabled = true;
  try {
    const response = await apiFetch(`/api/import_apimeal/${apiId}`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
    const result = await response.json();
    if (result.success) window.location.href = './rezepte.html';
    else throw new Error(result.error || 'Import fehlgeschlagen');
  } catch (e) {
    alert(e.message); btnElement.innerHTML = 'In meine App importieren'; btnElement.disabled = false;
  }
}

async function loadEntdecken() {
  const container = document.getElementById('entdecken-container');
  if (!container) return;
  const suche = getQueryParam('suche') || 'pasta';
  const input = document.getElementById('entdecken-suche-input');
  if (input) input.value = suche;
  try {
    const response = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(suche)}`);
    const data = await response.json();
    container.innerHTML = '';
    if (data.meals) {
      data.meals.forEach(rezept => {
        container.innerHTML += `<article class="api-card"><img src="${rezept.strMealThumb}" alt="${escapeHTML(rezept.strMeal)}"><div class="api-content"><h3>${escapeHTML(rezept.strMeal)}</h3><p>🏷 ${escapeHTML(rezept.strCategory)}<br>🌍 ${escapeHTML(rezept.strArea)}</p><button onclick="apiRezeptImportieren('${rezept.idMeal}', this)" class="secondary">In meine App importieren</button></div></article>`;
      });
    } else container.innerHTML = '<p class="empty-note">Keine Treffer gefunden. Tipp: englische Suchbegriffe nutzen.</p>';
  } catch { container.innerHTML = '<p class="empty-note">Fehler beim Abrufen der Rezeptdaten.</p>'; }
}

// ==========================================
// INITIALISIERUNG
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  renderCurrentUserBadge();
  initAuthForms();
  loadHomeDashboard();
  loadRezepte();
  loadPublicRezepte();
  loadRezeptDetail();
  loadBearbeitenForm();
  loadEinkaufsliste();
  initCreateForm();
  initImportForms();
  loadEntdecken();

  const formManuell = document.getElementById('form-einkauf-manuell');
  if (formManuell) {
    formManuell.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!requireAuth()) return;
      const input = document.getElementById('manuell-input');
      await apiFetch('/api/einkaufsliste/manuell', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name: input.value})});
      input.value = '';
      loadEinkaufsliste();
    });
  }
});
