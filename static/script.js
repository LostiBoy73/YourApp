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
// REZEPT DETAIL & KOCHMODUS
// ==========================================
let kochSchritte = [];
let aktuellerKochSchritt = 0;
let aktuellesRezept = null;
let geparsteZutaten = []; // Speichert die Zutaten für den Abgleich im Kochmodus

async function loadRezeptDetail() {
  const container = document.getElementById('standard-ansicht');
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

    // Header füllen
    document.title = `${rezept.titel} · KochFlow`;
    document.getElementById('detail-titel').innerText = rezept.titel;
    const ownerEl = document.getElementById('detail-owner');
    if (ownerEl) ownerEl.innerHTML = `Von <strong>${escapeHTML(rezept.owner_name || 'Unbekannt')}</strong> · ${Number(rezept.is_public || 0) === 1 ? 'Öffentlich' : 'Privat'}`;

    // Kategorien/Tags
    let tagsHTML = '';
    if (rezept.kategorie) {
      rezept.kategorie.split(',').forEach(k => {
        if (k.trim()) tagsHTML += `<span class="badge">${escapeHTML(k.trim())}</span>`;
      });
    }
    tagsHTML += Number(rezept.is_public || 0) === 1 ? '<span class="badge badge-public">Öffentlich</span>' : '<span class="badge badge-private">Privat</span>';
    document.getElementById('detail-tags').innerHTML = tagsHTML;

    // Portionen
    const portionenInput = document.getElementById('portionen-rechner');
    if (portionenInput) {
      portionenInput.value = rezept.portionen || 1;
      portionenInput.dataset.standard = rezept.portionen || 1;
    }

    // Zutaten verarbeiten (für die Standard-Ansicht UND den Kochmodus-Abgleich)
    const zutatenList = document.getElementById('detail-zutaten');
    zutatenList.innerHTML = '';
    geparsteZutaten = [];

    if (rezept.zutaten) {
      rezept.zutaten.split('\n').forEach(zeile => {
        if (!zeile.trim()) return;
        const teile = zeile.split('|');
        if (teile.length === 3) {
          zutatenList.innerHTML += `<li><strong><span class="zutat-menge" data-grundmenge="${escapeHTML(teile[0])}">${escapeHTML(teile[0])}</span> ${escapeHTML(teile[1])}</strong> ${escapeHTML(teile[2])}</li>`;
          
          // Für den Kochmodus speichern
          geparsteZutaten.push({
            menge: teile[0],
            einheit: teile[1],
            name: teile[2]
          });
        } else {
          zutatenList.innerHTML += `<li>${escapeHTML(zeile)}</li>`;
          // Fallback, falls das Format nicht exakt 3 Teile hat
          geparsteZutaten.push({ menge: "", einheit: "", name: zeile });
        }
      });
    } else {
      zutatenList.innerHTML = '<li>Keine Zutaten angegeben.</li>';
    }

    // Schritte verarbeiten (Standard-Ansicht auflisten)
    const standardSchritteContainer = document.getElementById('standard-schritte-liste');
    standardSchritteContainer.innerHTML = '';
    kochSchritte = rezept.anleitung ? rezept.anleitung.split('|||').filter(s => s.trim()) : [];

    if (kochSchritte.length > 0) {
      kochSchritte.forEach((schritt, index) => {
        const teile = schritt.split(':::');
        const zeit = teile.length === 2 ? teile[0] : '';
        const text = teile.length === 2 ? teile[1] : teile[0];
        
        standardSchritteContainer.innerHTML += `
          <div style="margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--app-border);">
            <h4 style="margin-bottom: 0.4rem;">Schritt ${index + 1} ${zeit ? `<span class="badge badge-warm">⏱ ${zeit} Min.</span>` : ''}</h4>
            <p style="margin: 0; line-height: 1.6;">${escapeHTML(text)}</p>
          </div>`;
      });
    } else {
      standardSchritteContainer.innerHTML = '<p>Keine Anleitung vorhanden.</p>';
    }

    // Owner Controls (Bearbeiten / Löschen)
    const isOwner = rezept.owner_name === getCurrentUser();
    const ownerControls = document.getElementById('owner-controls');
    if (ownerControls) ownerControls.style.display = isOwner ? 'flex' : 'none';

    const visibilityBtn = document.getElementById('btn-visibility');
    if (visibilityBtn) {
      visibilityBtn.textContent = Number(rezept.is_public || 0) === 1 ? 'Wieder privat machen' : 'Öffentlich teilen';
    }
  } catch (error) {
    container.innerHTML = '<p class="empty-note">Fehler beim Laden des Rezepts.</p>';
    console.error(error);
  }
}

// ==========================================
// KOCHMODUS STEUERUNG
// ==========================================
function startKochmodus() {
  if (kochSchritte.length === 0) return alert("Dieses Rezept hat keine Anleitungsschritte.");
  
  // Standard-Elemente ausblenden
  document.getElementById('standard-ansicht').style.display = 'none';
  document.querySelector('.page-header').style.display = 'none';
  
  // App-Nav ausblenden (verhindert versehentliches Wegnavigieren)
  const nav = document.querySelector('.app-nav');
  if(nav) nav.style.display = 'none';
  
  // Overlay einblenden
  document.getElementById('kochmodus-overlay').style.display = 'flex';
  
  aktuellerKochSchritt = 0;
  renderAktuellenKochSchritt();
}

function beendeKochmodus() {
  document.getElementById('kochmodus-overlay').style.display = 'none';
  document.getElementById('standard-ansicht').style.display = 'grid'; // .detail-layout verwendet grid
  document.querySelector('.page-header').style.display = 'flex';
  
  const nav = document.querySelector('.app-nav');
  if(nav) nav.style.display = 'flex';
}

function renderAktuellenKochSchritt() {
  const schritt = kochSchritte[aktuellerKochSchritt];
  const teile = schritt.split(':::');
  const zeit = teile.length === 2 ? teile[0] : '';
  const text = teile.length === 2 ? teile[1] : teile[0];

  document.getElementById('koch-schritt-text').innerHTML = escapeHTML(text);
  document.getElementById('koch-fortschritt').innerText = `${aktuellerKochSchritt + 1} / ${kochSchritte.length}`;
  
  // Texterkennung: Welche Zutaten kommen im Schritt vor?
  const textLower = text.toLowerCase();
  
  const erkannteZutaten = geparsteZutaten.filter(zutat => {
    // Wenn die Zutat keinen Namen hat (leere Zeile), ignorieren
    if(!zutat.name) return false;
    
    // Zutatennamen in Wörter zerlegen und Füllwörter ignorieren
    const worte = zutat.name.toLowerCase().split(' ').filter(w => w.length > 3);
    if(worte.length === 0) {
        // Fallback für kurze Wörter (z.B. "Ei")
        return textLower.includes(zutat.name.toLowerCase());
    }
    // Prüfen, ob eines der wichtigen Wörter im Text vorkommt
    return worte.some(wort => textLower.includes(wort));
  });

  // HTML für die erkannten Zutaten generieren
  let zutatenHtml = '';
  if (erkannteZutaten.length > 0) {
    zutatenHtml = erkannteZutaten.map(z => 
      `<span class="pill badge-public" style="font-size: 1.1rem; padding: 0.5rem 1rem; margin: 0.2rem;">
         <strong>${escapeHTML(z.menge)} ${escapeHTML(z.einheit)}</strong> ${escapeHTML(z.name)}
       </span>`
    ).join(' ');
  }

  // Anzeige zusammensetzen (Zeit + Zutaten)
  const zeitHtml = zeit ? `<span class="pill badge-warm" style="font-size: 1.1rem; padding: 0.5rem 1rem; margin: 0.2rem;">⏱ ${escapeHTML(zeit)} Min.</span>` : '';
  document.getElementById('koch-zutaten-hinweis').innerHTML = zeitHtml + zutatenHtml;

  // Buttons aktualisieren
  document.getElementById('btn-koch-zurueck').disabled = aktuellerKochSchritt === 0;
  const btnWeiter = document.getElementById('btn-koch-weiter');
  
  if (aktuellerKochSchritt >= kochSchritte.length - 1) {
    btnWeiter.innerText = "Fertig 🎉";
    btnWeiter.classList.add("primary-action");
    btnWeiter.onclick = beendeKochmodus;
  } else {
    btnWeiter.innerText = "Weiter";
    btnWeiter.classList.remove("primary-action");
    btnWeiter.onclick = naechsterSchritt;
  }
}

function naechsterSchritt() { 
  if (aktuellerKochSchritt < kochSchritte.length - 1) {
    aktuellerKochSchritt++;
    renderAktuellenKochSchritt();
  }
}

function vorherigerSchritt() { 
  if (aktuellerKochSchritt > 0) {
    aktuellerKochSchritt--;
    renderAktuellenKochSchritt();
  }
}

// ==========================================
// EINKAUFSLISTE
// ==========================================
async function loadEinkaufsliste() {
  const listRezepte = document.getElementById('einkauf-rezepte');
  const listManuell = document.getElementById('einkauf-manuell');
  const manuellHeader = document.getElementById('manuell-header');
  
  if (!listRezepte || !listManuell) return; 
  if (!requireAuth()) return;

  try {
    const response = await apiFetch('/api/einkaufsliste');
    if (!response.ok) throw new Error('API-Fehler');
    const data = await response.json();
    
    listRezepte.innerHTML = '';
    
    // 1. Geplante Rezepte als kleine Badges/Tags anzeigen
    if (data.rezepte && data.rezepte.length > 0) {
      const rezepteBox = document.createElement('div');
      rezepteBox.style.marginBottom = '1.5rem';
      rezepteBox.innerHTML = '<p style="font-size: 0.85rem; color: var(--app-muted); margin-bottom: 0.5rem;">Geplante Rezepte:</p>';

      data.rezepte.forEach(titel => {
        const badge = document.createElement('span');
        badge.className = 'pill'; 
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '0.5rem';
        badge.style.margin = '0 0.5rem 0.5rem 0';
        badge.style.background = 'var(--app-surface-3)';
        
        badge.innerHTML = `
          ${escapeHTML(titel)}
          <button onclick="removeRezeptFromEinkaufsliste('${escapeHTML(titel.replace(/'/g, "\\'"))}')" 
                  style="background: transparent; border: none; color: var(--app-danger); padding: 0; cursor: pointer; font-weight: bold; margin:0; line-height: 1;">
            ×
          </button>
        `;
        rezepteBox.appendChild(badge);
      });
      listRezepte.appendChild(rezepteBox);

      // 2. Die zusammengefassten Zutaten als einfache Liste rendern
      data.zutaten.forEach(z => {
        const li = document.createElement('li');
        li.style.marginBottom = "0.25rem";
        li.style.borderBottom = "1px dashed var(--app-border)";
        li.style.paddingBottom = "0.2rem";
        
        const einheit = z.einheit ? ` ${z.einheit}` : '';
        const menge = z.menge ? `${z.menge}${einheit} ` : '';
        
        li.innerHTML = `<span>• ${escapeHTML(menge)}${escapeHTML(z.name)}</span>`;
        listRezepte.appendChild(li);
      });
    } else {
      listRezepte.innerHTML = '<p class="empty-note">Keine Rezepte auf der Einkaufsliste.</p>';
    }

    // 3. Manuelle Einträge rendern (mit X zum Löschen)
    listManuell.innerHTML = '';
    if (data.manuell && data.manuell.length > 0) {
      manuellHeader.style.display = 'block';
      data.manuell.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span>${escapeHTML(item.name)}</span>
            <button onclick="removeManuellFromEinkaufsliste(${item.id})" class="outline secondary" style="padding: 0.1rem 0.4rem; font-size: 0.75rem; margin:0;">X</button>
          </div>
        `;
        listManuell.appendChild(li);
      });
    } else {
      manuellHeader.style.display = 'none';
    }

  } catch (err) {
    console.error("Fehler beim Laden:", err);
    listRezepte.innerHTML = '<p class="empty-note">Fehler beim Laden der Einkaufsliste.</p>';
  }
}

async function removeRezeptFromEinkaufsliste(titel) {
  try {
    await apiFetch('/api/einkaufsliste/entferrezent', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: titel })
    });
    loadEinkaufsliste(); 
  } catch(err) {
    alert("Fehler beim Entfernen des Rezepts!");
  }
}

async function removeManuellFromEinkaufsliste(id) {
  try {
    await apiFetch(`/api/einkaufsliste/manuell/${id}`, { method: 'DELETE' });
    loadEinkaufsliste(); 
  } catch(err) {
    alert("Fehler beim Löschen!");
  }
}

async function addToEinkaufsliste(rezeptId) {
  if (!requireAuth()) return;
  try {
    await apiFetch(`/api/einkaufsliste/${rezeptId}`, { method: 'POST' });
    alert('Zutaten erfolgreich auf die Einkaufsliste gesetzt!');
  } catch (err) {
    alert('Fehler beim Hinzufügen zur Einkaufsliste.');
  }
}

// (Die Funktionen toggleRezeptVisibility, addRezeptToEinkaufsliste, rezeptLoeschen und portionenUmrechnen bleiben hier unverändert stehen - stelle sicher, dass du sie nicht versehentlich gelöscht hast beim Ersetzen).

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
