// ==========================================
// KONFIGURATION
// ==========================================
const API_BASE_URL = "https://api.robots-compliance.cc";


// ==========================================
// ALLGEMEINE HILFSFUNKTIONEN
// ==========================================
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getCurrentUser() {
    let user = localStorage.getItem("kochapp_user");

    if (!user || user.trim() === "") {
        user = prompt("Wie möchtest du in der App heißen?", "Gast");

        if (!user || user.trim() === "") {
            user = "Gast";
        }

        localStorage.setItem("kochapp_user", user.trim());
    }

    return user.trim();
}

function changeCurrentUser() {
    const current = getCurrentUser();
    const neuerName = prompt("Neuer Anzeigename:", current);

    if (neuerName && neuerName.trim() !== "") {
        localStorage.setItem("kochapp_user", neuerName.trim());
        location.reload();
    }
}

function renderCurrentUserBadge() {
    const el = document.getElementById("current-user");
    if (!el) return;

    el.innerHTML = `
        <small>
            Angemeldet als <strong>${escapeHTML(getCurrentUser())}</strong>
            <button type="button" class="outline" onclick="changeCurrentUser()" style="padding: 2px 8px; margin-left: 0.5rem; font-size: 0.75rem;">wechseln</button>
        </small>
    `;
}

function currentUserParam() {
    return `owner_name=${encodeURIComponent(getCurrentUser())}`;
}


// ==========================================
// 1. MEINE REZEPTE (rezepte.html)
// ==========================================
async function loadRezepte() {
    const container = document.getElementById('recipe-list-container');
    if (!container) return;

    const suche = getQueryParam('suche') || '';
    const kategorie = getQueryParam('kategorie') || '';
    const owner = getCurrentUser();

    try {
        const response = await fetch(
            `${API_BASE_URL}/api/rezepte?scope=mine&owner_name=${encodeURIComponent(owner)}&suche=${encodeURIComponent(suche)}&kategorie=${encodeURIComponent(kategorie)}`
        );

        if (!response.ok) throw new Error('Rezepte konnten nicht geladen werden');

        const data = await response.json();

        const searchInput = document.getElementById('suche-input');
        if (searchInput) searchInput.value = suche;

        const catSelect = document.getElementById('kategorie-select');
        if (catSelect) {
            catSelect.innerHTML = '<option value="">Alle Kategorien</option>';
            data.kategorien.forEach(kat => {
                const selected = kat.toLowerCase() === kategorie.toLowerCase() ? 'selected' : '';
                catSelect.innerHTML += `<option value="${escapeHTML(kat)}" ${selected}>${escapeHTML(kat)}</option>`;
            });
        }

        container.innerHTML = '';

        if (!data.rezepte || data.rezepte.length === 0) {
            container.innerHTML = `<p style="text-align: center; width: 100%;">Keine eigenen Rezepte für <strong>${escapeHTML(owner)}</strong> gefunden.</p>`;
            return;
        }

        data.rezepte.forEach(rezept => {
            let catHTML = '';
            if (rezept.kategorie) {
                rezept.kategorie.split(',').forEach(k => {
                    if (k.trim()) catHTML += `<span class="badge">🏷️ ${escapeHTML(k.trim())}</span>`;
                });
            }

            const publicBadge = Number(rezept.is_public || 0) === 1
                ? '<span class="badge">🌍 Öffentlich</span>'
                : '<span class="badge">🔒 Privat</span>';

            container.innerHTML += `
                <article>
                    <header style="margin-bottom: 0.5rem;">
                        <h3 style="margin-bottom: 0.5rem;"><a href="./rezepte_detail.html?id=${rezept.id}">${escapeHTML(rezept.titel)}</a></h3>
                        <div style="margin-bottom: 0;">${catHTML || '<span style="font-size: 0.8rem; color: var(--pico-muted-color);">Keine Kategorien</span>'} ${publicBadge}</div>
                    </header>
                    <footer style="margin-top: auto;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <span>⏱ ${escapeHTML(rezept.dauer)} Min.</span>
                            <a href="./bearbeiten.html?id=${rezept.id}" class="outline" style="padding: 2px 10px; font-size: 0.8rem;">✏️ Bearbeiten</a>
                        </div>
                    </footer>
                </article>
            `;
        });
    } catch (error) {
        container.innerHTML = '<p>Fehler beim Laden der Rezepte.</p>';
        console.error(error);
    }
}


// ==========================================
// 1b. ÖFFENTLICHE REZEPTE / COMMUNITY
// ==========================================
async function loadPublicRezepte() {
    const container = document.getElementById('public-recipe-list-container');
    if (!container) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/rezepte?scope=public`);
        if (!response.ok) throw new Error('Öffentliche Rezepte konnten nicht geladen werden');

        const data = await response.json();
        container.innerHTML = '';

        if (!data.rezepte || data.rezepte.length === 0) {
            container.innerHTML = '<p style="text-align: center; width: 100%;">Noch keine öffentlichen Rezepte vorhanden.</p>';
            return;
        }

        data.rezepte.forEach(rezept => {
            let catHTML = '';
            if (rezept.kategorie) {
                rezept.kategorie.split(',').forEach(k => {
                    if (k.trim()) catHTML += `<span class="badge">🏷️ ${escapeHTML(k.trim())}</span>`;
                });
            }

            container.innerHTML += `
                <article>
                    <header style="margin-bottom: 0.5rem;">
                        <h3 style="margin-bottom: 0.5rem;"><a href="./rezepte_detail.html?id=${rezept.id}">${escapeHTML(rezept.titel)}</a></h3>
                        <div>${catHTML || '<span style="font-size: 0.8rem; color: var(--pico-muted-color);">Keine Kategorien</span>'}</div>
                    </header>
                    <footer>
                        <small>Von <strong>${escapeHTML(rezept.owner_name || 'Gast')}</strong> · ⏱ ${escapeHTML(rezept.dauer)} Min.</small>
                    </footer>
                </article>
            `;
        });
    } catch (error) {
        container.innerHTML = '<p>Fehler beim Laden der öffentlichen Rezepte.</p>';
        console.error(error);
    }
}


// ==========================================
// 2. REZEPT DETAILANSICHT (rezepte_detail.html)
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
        const response = await fetch(`${API_BASE_URL}/api/rezepte/${id}`);
        if (!response.ok) throw new Error('Rezept nicht gefunden');
        const rezept = await response.json();
        aktuellesRezept = rezept;

        const isOwner = (rezept.owner_name || 'Gast') === getCurrentUser();

        document.title = rezept.titel;
        document.getElementById('detail-titel').innerText = rezept.titel;

        const ownerInfo = document.getElementById('detail-owner');
        if (ownerInfo) {
            const sichtbar = Number(rezept.is_public || 0) === 1 ? '🌍 Öffentlich' : '🔒 Privat';
            ownerInfo.innerHTML = `Von <strong>${escapeHTML(rezept.owner_name || 'Gast')}</strong> · ${sichtbar}`;
        }

        const ownerControls = document.getElementById('owner-controls');
        if (ownerControls) {
            ownerControls.style.display = isOwner ? 'block' : 'none';
        }

        const visibilityButton = document.getElementById('btn-visibility');
        if (visibilityButton) {
            visibilityButton.style.display = isOwner ? 'inline-block' : 'none';
            visibilityButton.innerText = Number(rezept.is_public || 0) === 1 ? '🔒 Wieder privat machen' : '🌍 Öffentlich teilen';
        }

        let tagsHTML = '';
        if (rezept.kategorie) {
            rezept.kategorie.split(',').forEach(k => {
                if (k.trim()) tagsHTML += `🏷️ ${escapeHTML(k.trim())} &nbsp;`;
            });
        }
        document.getElementById('detail-tags').innerHTML = tagsHTML;

        document.getElementById('portionen-rechner').value = rezept.portionen || 1;
        document.getElementById('portionen-rechner').dataset.standard = rezept.portionen || 1;

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
                    <div class="schritt-slide" style="display: ${display};">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; color: var(--pico-muted-color); font-size: 0.9rem; font-weight: bold; border-bottom: 1px solid var(--pico-muted-border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;">
                            <span>Schritt ${index + 1} von ${schritte.length}</span>
                            ${zeit ? `<span>⏱ ${escapeHTML(zeit)} Min.</span>` : ''}
                        </div>
                        <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; text-align: center;">
                            <p style="font-size: 1.3rem; margin: 0;">${escapeHTML(text)}</p>
                        </div>
                    </div>
                `;
            });
        } else {
            schritteContainer.innerHTML = '<p>Keine Anleitung vorhanden.</p>';
        }

        slides = document.querySelectorAll('.schritt-slide');
        aktuellerSchritt = 0;
        updateButtons();

    } catch (error) {
        container.innerHTML = '<p>Fehler beim Laden des Rezepts.</p>';
        console.error(error);
    }
}

function portionenUmrechnen() {
    const input = document.getElementById('portionen-rechner');
    const neuePortionen = input.value;
    const standardPortionen = input.dataset.standard;
    const mengenFelder = document.querySelectorAll('.zutat-menge');

    mengenFelder.forEach(feld => {
        let grundMengeStr = feld.getAttribute('data-grundmenge').replace(',', '.');
        let grundMenge = parseFloat(grundMengeStr);

        if (!isNaN(grundMenge) && standardPortionen > 0) {
            let neueMenge = (grundMenge / standardPortionen) * neuePortionen;
            let anzeige = Number.isInteger(neueMenge) ? neueMenge : neueMenge.toFixed(1);
            feld.innerText = anzeige.toString().replace('.', ',');
        }
    });
}

function updateButtons() {
    const btnZurueck = document.getElementById('btn-zurueck');
    const btnWeiter = document.getElementById('btn-weiter');
    if (!btnZurueck || !btnWeiter) return;

    if (slides.length <= 1) {
        btnZurueck.style.display = 'none';
        btnWeiter.style.display = 'none';
        return;
    }
    btnZurueck.disabled = (aktuellerSchritt === 0);
    btnWeiter.disabled = (aktuellerSchritt === slides.length - 1);
}

function zeigeSchritt(index) {
    slides.forEach((slide, i) => { slide.style.display = (i === index) ? 'flex' : 'none'; });
    aktuellerSchritt = index;
    updateButtons();
}

function naechsterSchritt() { if (aktuellerSchritt < slides.length - 1) zeigeSchritt(aktuellerSchritt + 1); }
function vorherigerSchritt() { if (aktuellerSchritt > 0) zeigeSchritt(aktuellerSchritt - 1); }

async function addRezeptToEinkaufsliste() {
    const id = getQueryParam('id');
    const btn = document.getElementById('btn-einkaufsliste');
    if (!btn) return;

    btn.innerHTML = '⏳ Füge hinzu...';
    try {
        const response = await fetch(`${API_BASE_URL}/api/einkaufsliste/${id}?${currentUserParam()}`, { method: 'POST' });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.detail || result.error || 'Fehler beim Hinzufügen');
        }
        btn.innerHTML = '✅ Auf der Einkaufsliste!';
        btn.classList.add('outline');
        setTimeout(() => { btn.innerHTML = '🛒 Zur Einkaufsliste hinzufügen'; btn.classList.remove('outline'); }, 3000);
    } catch (e) {
        alert('Fehler beim Hinzufügen: ' + e.message);
        btn.innerHTML = '🛒 Zur Einkaufsliste hinzufügen';
    }
}

async function rezeptLoeschen() {
    if (!confirm('Möchtest du dieses Rezept wirklich unwiderruflich löschen?')) return;
    const id = getQueryParam('id');
    try {
        const response = await fetch(`${API_BASE_URL}/api/rezepte/${id}?${currentUserParam()}`, { method: 'DELETE' });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.detail || result.error || 'Löschen fehlgeschlagen');
        }
        window.location.href = './rezepte.html';
    } catch (e) {
        alert('Fehler beim Löschen: ' + e.message);
    }
}

async function toggleRezeptVisibility() {
    const id = getQueryParam('id');
    if (!id || !aktuellesRezept) return;

    const nextPublic = Number(aktuellesRezept.is_public || 0) !== 1;

    try {
        const response = await fetch(`${API_BASE_URL}/api/rezepte/${id}/visibility`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                owner_name: getCurrentUser(),
                is_public: nextPublic
            })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.detail || result.error || 'Sichtbarkeit konnte nicht geändert werden');
        }

        location.reload();
    } catch (error) {
        alert('Fehler: ' + error.message);
    }
}


// ==========================================
// 3. EINKAUFSLISTE (einkaufsliste.html)
// ==========================================
async function loadEinkaufsliste() {
    const containerRezepte = document.getElementById('einkauf-rezepte');
    const containerZutaten = document.getElementById('einkauf-zutaten');
    const containerManuell = document.getElementById('einkauf-manuell');
    if (!containerRezepte) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/einkaufsliste?${currentUserParam()}`);
        if (!response.ok) throw new Error('Einkaufsliste konnte nicht geladen werden');
        const data = await response.json();

        containerRezepte.innerHTML = '';
        if (data.rezepte.length > 0) {
            data.rezepte.forEach(titel => {
                containerRezepte.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--pico-muted-border-color);">
                        <strong>${escapeHTML(titel)}</strong>
                        <button onclick="removeEinkaufRezept('${escapeHTML(String(titel)).replaceAll('&#039;', '\\&#039;')}')" class="outline" style="padding: 2px 10px; border: none; font-size: 1.2rem; margin:0;" title="Entfernen">🗑️</button>
                    </li>
                `;
            });
        } else {
            containerRezepte.innerHTML = '<p style="color: var(--pico-muted-color);">Noch keine Rezepte hinzugefügt.</p>';
        }

        containerZutaten.innerHTML = '';
        if (data.zutaten.length > 0) {
            data.zutaten.forEach(z => {
                containerZutaten.innerHTML += `
                    <li style="margin-bottom: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 10px; margin: 0;">
                            <input type="checkbox" style="margin:0;">
                            <span><strong>${escapeHTML(z.menge)} ${escapeHTML(z.einheit)}</strong> ${escapeHTML(z.name)}</span>
                        </label>
                    </li>
                `;
            });
        } else {
            containerZutaten.innerHTML = '<p style="color: var(--pico-muted-color);">Die Zutatenliste ist leer.</p>';
        }

        if (data.manuell.length > 0) {
            document.getElementById('manuell-header').style.display = 'block';
            containerManuell.innerHTML = '';
            data.manuell.forEach(item => {
                containerManuell.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 10px; margin: 0;">
                            <input type="checkbox" style="margin:0;">
                            <span>${escapeHTML(item.name)}</span>
                        </label>
                        <button onclick="removeEinkaufManuell(${item.id})" class="outline" style="padding: 2px 10px; border: none; font-size: 1.2rem; margin:0;">🗑️</button>
                    </li>
                `;
            });
        } else {
            document.getElementById('manuell-header').style.display = 'none';
            containerManuell.innerHTML = '';
        }

    } catch (e) {
        console.error(e);
    }
}

async function removeEinkaufRezept(titel) {
    await fetch(`${API_BASE_URL}/api/einkaufsliste/entfernen_rezept`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            titel: titel,
            owner_name: getCurrentUser()
        })
    });
    loadEinkaufsliste();
}

async function removeEinkaufManuell(id) {
    await fetch(`${API_BASE_URL}/api/einkaufsliste/manuell/${id}?${currentUserParam()}`, { method: 'DELETE' });
    loadEinkaufsliste();
}

const formManuell = document.getElementById('form-einkauf-manuell');
if (formManuell) {
    formManuell.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('manuell-input');
        await fetch(`${API_BASE_URL}/api/einkaufsliste/manuell`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: input.value,
                owner_name: getCurrentUser()
            })
        });
        input.value = '';
        loadEinkaufsliste();
    });
}


// ==========================================
// 4. FORMULARE (Neues Rezept & Bearbeiten)
// ==========================================
function addZutatZeile() {
    const container = document.getElementById('zutaten-container');
    const neueZeile = container.firstElementChild.cloneNode(true);
    const inputs = neueZeile.getElementsByTagName('input');
    for (let input of inputs) { input.value = ''; }
    container.appendChild(neueZeile);
}

function addSchrittZeile() {
    const container = document.getElementById('schritte-container');
    const neueZeile = container.firstElementChild.cloneNode(true);
    const textareas = neueZeile.getElementsByTagName('textarea');
    const inputs = neueZeile.getElementsByTagName('input');
    for (let textarea of textareas) { textarea.value = ''; }
    for (let input of inputs) { input.value = ''; }
    container.appendChild(neueZeile);
}

function addKategorieZeile() {
    const container = document.getElementById('kategorie-container');
    const neueZeile = container.firstElementChild.cloneNode(true);
    const inputs = neueZeile.getElementsByTagName('input');
    for (let input of inputs) { input.value = ''; }
    container.appendChild(neueZeile);
}

function removeZeile(element) {
    const zeile = element.parentElement;
    const container = zeile.parentElement;
    if (container.children.length > 1) {
        zeile.remove();
    } else {
        const inputs = zeile.querySelectorAll('input, textarea');
        inputs.forEach(input => input.value = '');
    }
}

const formNeuesRezept = document.getElementById('form-neues-rezept');

if (formNeuesRezept) {
    formNeuesRezept.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(formNeuesRezept);
        formData.append('owner_name', getCurrentUser());

        const btn = e.submitter;
        btn.disabled = true;
        btn.innerHTML = 'Speichere...';

        try {
            const response = await fetch(`${API_BASE_URL}/api/rezepte`, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.detail || result.error || 'Speichern fehlgeschlagen');
            }

            window.location.href = `./rezepte_detail.html?id=${result.id}`;
        } catch (error) {
            alert('Fehler beim Speichern: ' + error.message);
            btn.disabled = false;
            btn.innerHTML = 'Rezept speichern';
        }
    });
}

async function loadBearbeitenForm() {
    const formBearbeiten = document.getElementById('form-bearbeiten');
    if (!formBearbeiten) return;

    const id = getQueryParam('id');
    if (!id) { alert('Keine ID gefunden'); return; }

    try {
        const response = await fetch(`${API_BASE_URL}/api/rezepte/${id}`);
        const rezept = await response.json();

        if (rezept.owner_name && rezept.owner_name !== getCurrentUser()) {
            alert('Dieses Rezept gehört einem anderen Nutzer und kann nicht bearbeitet werden.');
            window.location.href = `./rezepte_detail.html?id=${id}`;
            return;
        }

        document.getElementById('titel').value = rezept.titel;
        document.getElementById('portionen').value = rezept.portionen || 1;

        const publicCheckbox = document.querySelector('[name="is_public"]');
        if (publicCheckbox) {
            publicCheckbox.checked = Number(rezept.is_public || 0) === 1;
        }

        if (rezept.kategorie) {
            const katContainer = document.getElementById('kategorie-container');
            const kats = rezept.kategorie.split(',');
            katContainer.innerHTML = '';
            kats.forEach(k => {
                if(k.trim()) {
                    katContainer.innerHTML += `
                        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                            <input type="text" name="kategorie[]" value="${escapeHTML(k.trim())}" placeholder="z.B. Vegetarisch" style="margin-bottom: 0;">
                            <button type="button" class="outline" onclick="removeZeile(this)" style="margin-bottom: 0; padding: 0 15px;" title="Zeile löschen">🗑️</button>
                        </div>`;
                }
            });
            if(katContainer.innerHTML === '') addKategorieZeile();
        }

        if (rezept.zutaten) {
            const zutatenContainer = document.getElementById('zutaten-container');
            zutatenContainer.innerHTML = '';
            rezept.zutaten.split('\n').forEach(zeile => {
                if(!zeile.trim()) return;
                const t = zeile.split('|');
                let m = t.length === 3 ? t[0] : '';
                let e = t.length === 3 ? t[1] : '';
                let n = t.length === 3 ? t[2] : zeile;
                zutatenContainer.innerHTML += `
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <input type="text" name="zutaten_menge[]" value="${escapeHTML(m)}" placeholder="Menge" style="width: 80px; margin-bottom: 0;">
                        <input type="text" name="zutaten_einheit[]" value="${escapeHTML(e)}" placeholder="Einheit" style="width: 100px; margin-bottom: 0;">
                        <input type="text" name="zutaten_name[]" value="${escapeHTML(n)}" placeholder="Zutat" required style="flex-grow: 1; margin-bottom: 0;">
                        <button type="button" class="outline" onclick="removeZeile(this)" style="margin-bottom: 0; padding: 0 15px;" title="Zeile löschen">🗑️</button>
                    </div>`;
            });
            if(zutatenContainer.innerHTML === '') addZutatZeile();
        }

        if (rezept.anleitung) {
            const schritteContainer = document.getElementById('schritte-container');
            schritteContainer.innerHTML = '';
            rezept.anleitung.split('|||').forEach(schritt => {
                if(!schritt.trim()) return;
                const t = schritt.split(':::');
                let zeit = t.length === 2 ? t[0] : '';
                let text = t.length === 2 ? t[1] : t[0];
                schritteContainer.innerHTML += `
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <input type="number" name="anleitung_dauer[]" value="${escapeHTML(zeit)}" placeholder="Min." style="width: 80px; margin-bottom: 0;">
                        <textarea name="anleitung_schritt[]" placeholder="Was ist zu tun?" required style="flex-grow: 1; margin-bottom: 0; min-height: 50px;">${escapeHTML(text)}</textarea>
                        <button type="button" class="outline" onclick="removeZeile(this)" style="margin-bottom: 0; padding: 0 15px;" title="Zeile löschen">🗑️</button>
                    </div>`;
            });
            if(schritteContainer.innerHTML === '') addSchrittZeile();
        }

        formBearbeiten.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(formBearbeiten);
            formData.append('owner_name', getCurrentUser());
            const btn = e.submitter;

            btn.disabled = true;
            btn.innerHTML = 'Aktualisiere...';

            try {
                const response = await fetch(`${API_BASE_URL}/api/rezepte/${id}`, {
                    method: 'PUT',
                    body: formData
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.detail || result.error || 'Aktualisieren fehlgeschlagen');
                }

                window.location.href = `./rezepte_detail.html?id=${id}`;
            } catch (error) {
                alert('Fehler beim Aktualisieren: ' + error.message);
                btn.disabled = false;
                btn.innerHTML = 'Änderungen speichern';
            }
        });

    } catch (e) {
        console.error('Fehler beim Laden der Bearbeitungs-Daten:', e);
    }
}


// ==========================================
// 5. IMPORT (Chefkoch & API)
// ==========================================
const formChefkoch = document.getElementById('form-import-chefkoch');
if (formChefkoch) {
    formChefkoch.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('url').value;
        const btn = e.submitter;
        btn.innerHTML = '⏳ Importiere, bitte warten...';
        btn.disabled = true;
        const msgBox = document.getElementById('import-message');

        try {
            const response = await fetch(`${API_BASE_URL}/api/import_chefkoch`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    url: url,
                    owner_name: getCurrentUser()
                })
            });
            const result = await response.json();

            if (result.success) {
                window.location.href = `./bearbeiten.html?id=${result.id}`;
            } else {
                msgBox.innerHTML = `❌ Fehler: ${escapeHTML(result.error)}`;
                msgBox.style.display = 'block';
                btn.innerHTML = '📥 Rezept jetzt importieren';
                btn.disabled = false;
            }
        } catch (error) {
            msgBox.innerHTML = '❌ Server-Fehler beim Import. Läuft die API?';
            msgBox.style.display = 'block';
            btn.innerHTML = '📥 Rezept jetzt importieren';
            btn.disabled = false;
        }
    });
}

async function apiRezeptImportieren(apiId, btnElement) {
    btnElement.innerHTML = '⏳ Importiere...';
    btnElement.disabled = true;
    try {
        const response = await fetch(`${API_BASE_URL}/api/import_apimeal/${apiId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                owner_name: getCurrentUser()
            })
        });
        const result = await response.json();
        if (result.success) {
            window.location.href = './rezepte.html';
        } else {
            alert('Fehler beim Import: ' + result.error);
            btnElement.innerHTML = '📥 In meine App importieren';
            btnElement.disabled = false;
        }
    } catch (e) {
        alert('Serverfehler beim Import.');
        btnElement.innerHTML = '📥 In meine App importieren';
        btnElement.disabled = false;
    }
}

async function loadEntdecken() {
    const container = document.getElementById('entdecken-container');
    if (!container) return;

    const suche = getQueryParam('suche') || 'c';
    document.getElementById('entdecken-suche-input').value = suche;

    try {
        const response = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(suche)}`);
        const data = await response.json();

        container.innerHTML = '';
        if (data.meals) {
            data.meals.forEach(rezept => {
                container.innerHTML += `
                    <article class="api-card">
                        <img src="${escapeHTML(rezept.strMealThumb)}" alt="${escapeHTML(rezept.strMeal)}">
                        <div class="api-content">
                            <h3>${escapeHTML(rezept.strMeal)}</h3>
                            <p style="color: var(--pico-muted-color); margin-bottom: 1.5rem; flex-grow: 1;">
                                🏷️ ${escapeHTML(rezept.strCategory)}<br>
                                🌍 ${escapeHTML(rezept.strArea)}
                            </p>
                            <button onclick="apiRezeptImportieren('${escapeHTML(rezept.idMeal)}', this)" class="secondary" style="width: 100%; margin: 0;">📥 In meine App importieren</button>
                        </div>
                    </article>
                `;
            });
        } else {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; margin-top: 2rem;">
                    <h3 style="color: var(--pico-muted-color);">Leider nichts gefunden 😕</h3>
                    <p>Für "<strong>${escapeHTML(suche)}</strong>" gab es keine Treffer.<br>
                    <em>Tipp: Da wir eine englische Datenbank nutzen, musst du auf Englisch suchen!</em></p>
                </div>
            `;
        }
    } catch (e) {
        container.innerHTML = '<p>Fehler beim Abrufen der API-Daten.</p>';
    }
}


// ==========================================
// INITIALISIERUNG
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    renderCurrentUserBadge();
    loadRezepte();
    loadPublicRezepte();
    loadRezeptDetail();
    loadBearbeitenForm();
    loadEinkaufsliste();
    loadEntdecken();
});
